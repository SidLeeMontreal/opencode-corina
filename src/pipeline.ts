import { ModelResolver } from "opencode-model-resolver";
import type { ResolvedModel } from "opencode-model-resolver";

import { writeCapabilityAudit } from "./audit-log.js";
import { createToolEnvelope } from "./capability-output.js";
import { deduplicateFindings, normalizeModuleOutput } from "./evaluation-normalizer.js";
import { buildEvaluationContextFromWorkflowState, selectModules } from "./evaluation-registry.js";
import { buildEvaluationContextBlock, normalizeBlankLines, runEvaluationAgent } from "./evaluation-runtime.js";
import { createUsageAccumulator, errorDetails, makeConsoleLogger, type AgentLogger } from "./logger.js";
import { DEFAULT_MODEL_CONFIG } from "./model-config.js";
import { loadPrompt } from "./prompt-loader.js";
import { runBriefIntake, runCritique, runDraft as runDraftStep, runOutline, runRevise } from "./steps.js";
import { inferVoice } from "./tone-defaults.js";
import type { AuditArtifact, CorinaToolEnvelope, DraftToolArtifact, EvaluationFinding, EvaluationModuleId, ModuleRunStatus, OpenCodeClient, PipelineModelConfig, WorkflowState } from "./types.js";
import { validate } from "./validators.js";

export function mergeModelConfig(modelConfig?: Partial<PipelineModelConfig>): PipelineModelConfig {
  return {
    ...DEFAULT_MODEL_CONFIG,
    ...modelConfig,
    briefIntake: modelConfig?.briefIntake ?? DEFAULT_MODEL_CONFIG.briefIntake,
    outline: modelConfig?.outline ?? DEFAULT_MODEL_CONFIG.outline,
    draft: modelConfig?.draft ?? DEFAULT_MODEL_CONFIG.draft,
    critique: modelConfig?.critique ?? DEFAULT_MODEL_CONFIG.critique,
    revise: modelConfig?.revise ?? DEFAULT_MODEL_CONFIG.revise,
    audit: modelConfig?.audit ?? DEFAULT_MODEL_CONFIG.audit,
  };
}

function buildInputSummary(brief: string, state: WorkflowState): string {
  const wordCount = brief.trim().split(/\s+/).filter(Boolean).length;
  return `Processed pipeline brief (${wordCount} words, ${state.critiquePasses || 0} critique passes).`;
}

function buildCapabilityInputSummary(wordCount: number): string {
  return `Pipeline brief provided (${wordCount} words).`;
}

function buildFallbackAudit(note: string, finalContent: string | null = null): AuditArtifact {
  return {
    approved_for_delivery: false,
    ai_patterns_remaining: [],
    banned_words_remaining: [],
    style_violations: [],
    publishability_note: note,
    final_content: finalContent,
  };
}

const AUDIT_MODULE_PROMPTS: Record<
  Exclude<EvaluationModuleId, "critic-adjudicator" | "auditor-adjudicator">,
  { promptFile: string; delimiter: string }
> = {
  "prose-evaluator": { promptFile: "tasks/prose-evaluator.md", delimiter: "prose_evaluation" },
  "voice-evaluator": { promptFile: "tasks/voice-evaluator.md", delimiter: "voice_evaluation" },
  "evidence-evaluator": { promptFile: "tasks/evidence-evaluator.md", delimiter: "evidence_evaluation" },
  "format-auditor": { promptFile: "tasks/format-auditor.md", delimiter: "format_evaluation" },
};

function buildAuditModulePrompt(input: {
  contextBlock: string;
  draft: string;
  brief?: string | null;
  findings?: EvaluationFinding[];
  moduleStatus?: Partial<Record<EvaluationModuleId, ModuleRunStatus>>;
  voicePrompt?: string | null;
}): string {
  return [
    input.contextBlock,
    input.voicePrompt ? `=== VOICE PROFILE ===\n${input.voicePrompt.trim()}\n=== END VOICE PROFILE ===` : null,
    input.brief ? `=== BRIEF TEXT ===\n${input.brief.trim()}\n=== END BRIEF TEXT ===` : null,
    input.findings ? `=== FINDINGS ===\n${JSON.stringify(input.findings, null, 2)}\n=== END FINDINGS ===` : null,
    input.moduleStatus ? `=== MODULE STATUS ===\n${JSON.stringify(input.moduleStatus, null, 2)}\n=== END MODULE STATUS ===` : null,
    `=== DRAFT TEXT ===\n${input.draft.trim()}\n=== END DRAFT TEXT ===`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runAuditV2(
  client: OpenCodeClient,
  state: WorkflowState,
  model: ResolvedModel | undefined,
  logger: AgentLogger,
  usage: ReturnType<typeof createUsageAccumulator>,
): Promise<AuditArtifact> {
  const context = buildEvaluationContextFromWorkflowState(state, "audit");
  const selectedModules = selectModules(context, "auditor");
  const evaluatorModules = selectedModules.filter((module) => module.id !== "auditor-adjudicator");
  const module_status: Partial<Record<EvaluationModuleId, ModuleRunStatus>> = {};
  const contextBlock = buildEvaluationContextBlock(context);

  logger.info("evaluation_plan_selected", {
    capability: "pipeline",
    step: "audit",
    modules: selectedModules.map((module) => module.id),
  });

  const moduleOutputs = await Promise.all(
    evaluatorModules.map(async (module) => {
      const config = AUDIT_MODULE_PROMPTS[module.id as keyof typeof AUDIT_MODULE_PROMPTS];
      const moduleStartMs = Date.now();
      try {
        logger.debug("step_start", { capability: "pipeline", step: module.id, module_id: module.id, model_id: model?.modelID });
        const result = await runEvaluationAgent({
          client,
          capability: "pipeline",
          title: `Corina ${module.id}`,
          step: module.id,
          agent: module.id,
          promptFile: config.promptFile,
          delimiter: config.delimiter,
          taskPrompt: buildAuditModulePrompt({
            contextBlock,
            brief: context.brief_text,
            draft: context.draft_text,
            voicePrompt: context.voice_prompt,
          }),
          model,
          logger,
          usage,
        });
        const normalized = normalizeModuleOutput(
          {
            ...(result.raw as Record<string, unknown>),
            metrics: {
              total_tokens: result.metrics.tokens?.total ?? 0,
              total_cost: result.metrics.cost ?? 0,
              duration_ms: result.metrics.duration_ms,
              model_id: result.metrics.model_id,
              provider_id: result.metrics.provider_id,
            },
          },
          module.id,
        );
        module_status[module.id] = normalized.status;
        logger.info("step_complete", {
          capability: "pipeline",
          step: module.id,
          module_id: module.id,
          duration_ms: Date.now() - moduleStartMs,
          model_id: result.metrics.model_id ?? model?.modelID,
          status: normalized.status,
          finding_count: normalized.findings.length,
          degraded: normalized.status === "degraded" ? true : undefined,
        });
        return normalized;
      } catch (error) {
        module_status[module.id] = "degraded";
        logger.warn("step_complete", {
          capability: "pipeline",
          step: module.id,
          module_id: module.id,
          duration_ms: Date.now() - moduleStartMs,
          model_id: model?.modelID,
          status: "degraded",
          finding_count: 0,
          degraded: true,
        });
        return normalizeModuleOutput(
          {
            module_id: module.id,
            status: "degraded",
            skipped: false,
            findings: [],
            summary: `${module.id} degraded: ${error instanceof Error ? error.message : String(error)}`,
            errors: [`${module.id} degraded: ${error instanceof Error ? error.message : String(error)}`],
          },
          module.id,
        );
      }
    }),
  );

  const findings = deduplicateFindings(moduleOutputs.flatMap((output) => output.findings));
  const adjudicatorStartMs = Date.now();
  logger.debug("step_start", { capability: "pipeline", step: "auditor-adjudicator", module_id: "auditor-adjudicator", model_id: model?.modelID });
  const result = await runEvaluationAgent({
    client,
    capability: "pipeline",
    title: "Corina auditor adjudicator",
    step: "auditor-adjudicator",
    agent: "auditor-adjudicator",
    promptFile: "tasks/auditor-adjudicator.md",
    delimiter: "audit_result",
    taskPrompt: buildAuditModulePrompt({
      contextBlock,
      brief: context.brief_text,
      draft: context.draft_text,
      findings,
      moduleStatus: module_status,
      voicePrompt: context.voice_prompt,
    }),
    model,
    logger,
    usage,
  });

  logger.info("step_complete", {
    capability: "pipeline",
    step: "auditor-adjudicator",
    module_id: "auditor-adjudicator",
    duration_ms: Date.now() - adjudicatorStartMs,
    model_id: result.metrics.model_id ?? model?.modelID,
    status: Object.values(module_status).includes("degraded") ? "degraded" : "ok",
    finding_count: findings.length,
    pass: Boolean((result.raw as Partial<AuditArtifact>).approved_for_delivery),
    degraded: Object.values(module_status).includes("degraded") ? true : undefined,
  });

  const rawArtifact = result.raw as Partial<AuditArtifact>;
  return {
    approved_for_delivery: Boolean(rawArtifact.approved_for_delivery) && !Object.values(module_status).includes("degraded"),
    ai_patterns_remaining: Array.isArray(rawArtifact.ai_patterns_remaining) ? rawArtifact.ai_patterns_remaining : findings.filter((finding) => finding.module === "prose").map((finding) => finding.explanation),
    banned_words_remaining: Array.isArray(rawArtifact.banned_words_remaining) ? rawArtifact.banned_words_remaining : findings.filter((finding) => finding.module === "voice" && finding.rule_id.includes("banned")).map((finding) => finding.explanation),
    style_violations: Array.isArray(rawArtifact.style_violations) ? rawArtifact.style_violations : findings.filter((finding) => finding.module === "format").map((finding) => finding.explanation),
    publishability_note: typeof rawArtifact.publishability_note === "string"
      ? rawArtifact.publishability_note
      : "Audit adjudicator degraded; delivery approval remains closed.",
    final_content: typeof rawArtifact.final_content === "string" ? normalizeBlankLines(rawArtifact.final_content) : null,
    findings,
    module_status,
    degraded: Object.values(module_status).includes("degraded") || rawArtifact.degraded === true,
  };
}

async function runStep<T>(
  logger: AgentLogger,
  step: string,
  modelId: string | undefined,
  fn: () => Promise<T>,
): Promise<{ result: T; durationMs: number }> {
  const startMs = Date.now();
  logger.debug("step_start", { capability: "pipeline", step, model_id: modelId });
  const result = await fn();
  const durationMs = Date.now() - startMs;
  logger.info("step_complete", { capability: "pipeline", step, duration_ms: durationMs, model_id: modelId, pass: true });
  return { result, durationMs };
}

export async function runPipelineWithArtifact(
  brief: string,
  client: OpenCodeClient,
  modelConfig?: Partial<PipelineModelConfig>,
  logger: AgentLogger = makeConsoleLogger("corina"),
): Promise<CorinaToolEnvelope<DraftToolArtifact>> {
  const startMs = Date.now();
  const usage = createUsageAccumulator();
  const state: WorkflowState = {
    briefText: brief,
    critiquePasses: 0,
    warnings: [],
  };

  const config = mergeModelConfig(modelConfig);
  const resolver = new ModelResolver();
  const inputWordCount = brief.trim().split(/\s+/).filter(Boolean).length;

  logger.info("capability_start", {
    capability: "pipeline",
    input_word_count: inputWordCount,
    model_preset: config.briefIntake.preset ?? null,
    input_summary: buildCapabilityInputSummary(inputWordCount),
  });

  try {
    const briefModel = await resolver.resolveStepModel(config.briefIntake, config.provider);
    const { result: briefResult } = await runStep(logger, "brief_intake", briefModel.modelID, () =>
      runBriefIntake(client, brief, briefModel, logger, usage),
    );
    state.briefArtifact = briefResult.artifact;
    state.user_constraints = [...(state.briefArtifact.constraints ?? [])];
    state.warnings.push(...(briefResult.warnings ?? []));

    const briefValidation = validate("BriefArtifact", state.briefArtifact);
    if (!briefValidation.valid) {
      throw new Error(`BriefArtifact validation failed: ${briefValidation.errors.join("; ")}`);
    }

    if (state.briefArtifact.missing_info.length > 0) {
      const rendered = [
        "Corina needs a little more input before writing:",
        ...state.briefArtifact.missing_info.map((item, index) => `${index + 1}. ${item}`),
      ].join("\n");
      const audit = buildFallbackAudit("Brief intake reported missing information.", rendered);
      const durationMs = Date.now() - startMs;
      logger.warn("capability_complete", {
        capability: "pipeline",
        duration_ms: durationMs,
        word_count: rendered.trim().split(/\s+/).filter(Boolean).length,
        assumptions_count: state.warnings.length,
        outcome: "degraded",
      });

      writeCapabilityAudit({
        capability: "pipeline",
        input_summary: buildCapabilityInputSummary(inputWordCount),
        outcome: "degraded",
        duration_ms: durationMs,
        total_tokens: usage.total_tokens,
        total_cost: usage.total_cost,
        assumptions_count: state.warnings.length,
      });

      return createToolEnvelope<DraftToolArtifact>({
        capability: "draft",
        outcome: "degraded",
        shouldPersist: true,
        inputSummary: buildInputSummary(brief, state),
        artifact: { final_content: rendered, audit },
        rendered,
        warnings: state.warnings,
        metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
      });
    }

    let outlineValidation = { valid: false, errors: ["Outline not generated"] };
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const outlineModel = await resolver.resolveStepModel(config.outline, config.provider);
      const { result: outlineResult } = await runStep(logger, "outline", outlineModel.modelID, () =>
        runOutline(client, state.briefArtifact!, outlineModel, logger, usage),
      );
      state.outlineArtifact = outlineResult.artifact;
      state.warnings.push(...(outlineResult.warnings ?? []));

      outlineValidation = validate("OutlineArtifact", state.outlineArtifact);
      if (outlineValidation.valid) {
        break;
      }

      logger.warn("partial_parse", {
        capability: "pipeline",
        step: "outline",
        attempt,
        errors: outlineValidation.errors,
      });

      if (attempt === 2) {
        throw new Error(`OutlineArtifact validation failed after retry: ${outlineValidation.errors.join("; ")}`);
      }
    }

    const draftModel = await resolver.resolveStepModel(config.draft, config.provider);
    const { result: draftResult } = await runStep(logger, "draft", draftModel.modelID, () =>
      runDraftStep(client, state.briefArtifact!, state.outlineArtifact!, draftModel, logger, usage),
    );
    state.draftArtifact = draftResult.artifact;
    state.requested_voice = inferVoice(state.draftArtifact.content);
    state.voice_prompt = state.requested_voice ? loadPrompt(`voices/${state.requested_voice}.md`) : undefined;
    state.warnings.push(...(draftResult.warnings ?? []));

    const draftValidation = validate("DraftArtifact", state.draftArtifact);
    if (!draftValidation.valid) {
      throw new Error(`DraftArtifact validation failed: ${draftValidation.errors.join("; ")}`);
    }

    for (let pass = 1; pass <= 2; pass += 1) {
      state.critiquePasses = pass;
      const critiqueModel = await resolver.resolveStepModel(config.critique, config.provider);
      const { result: critiqueResult } = await runStep(logger, "critique", critiqueModel.modelID, () =>
        runCritique(client, state.draftArtifact!, state.briefArtifact!, critiqueModel, logger, usage),
      );
      state.critiqueArtifact = critiqueResult.artifact;
      state.warnings.push(...(critiqueResult.warnings ?? []));

      const critiqueValidation = validate("CritiqueArtifact", state.critiqueArtifact);
      if (!critiqueValidation.valid) {
        throw new Error(`CritiqueArtifact validation failed: ${critiqueValidation.errors.join("; ")}`);
      }

      if (state.critiqueArtifact.pass) {
        break;
      }

      const reviseModel = await resolver.resolveStepModel(config.revise, config.provider);
      const { result: revisionResult } = await runStep(logger, "revise", reviseModel.modelID, () =>
        runRevise(client, state.draftArtifact!, state.critiqueArtifact!, reviseModel, logger, usage),
      );
      state.draftArtifact = revisionResult.artifact;
      state.warnings.push(...(revisionResult.warnings ?? []));

      const revisedDraftValidation = validate("DraftArtifact", state.draftArtifact);
      if (!revisedDraftValidation.valid) {
        throw new Error(`Revised DraftArtifact validation failed: ${revisedDraftValidation.errors.join("; ")}`);
      }
    }

    const auditModel = await resolver.resolveStepModel(config.audit, config.provider);
    const auditStartMs = Date.now();
    logger.debug("step_start", { capability: "pipeline", step: "audit", model_id: auditModel.modelID });
    state.auditArtifact = await runAuditV2(client, state, auditModel, logger, usage);
    logger.info("step_complete", {
      capability: "pipeline",
      step: "audit",
      duration_ms: Date.now() - auditStartMs,
      model_id: auditModel.modelID,
      pass: state.auditArtifact.approved_for_delivery,
      status: state.auditArtifact.degraded ? "degraded" : "ok",
      degraded: state.auditArtifact.degraded ? true : undefined,
    });

    const auditValidation = validate("AuditArtifact", state.auditArtifact);
    if (!auditValidation.valid) {
      throw new Error(`AuditArtifact validation failed: ${auditValidation.errors.join("; ")}`);
    }

    const canonicalContent = state.auditArtifact.final_content ?? state.draftArtifact!.content;
    const rendered =
      state.auditArtifact.approved_for_delivery && state.auditArtifact.final_content
        ? state.auditArtifact.final_content
        : [
            state.draftArtifact!.content,
            "",
            "[Corina warning]",
            state.auditArtifact.publishability_note,
            ...state.warnings.map((warning) => `- ${warning}`),
          ].join("\n");

    const durationMs = Date.now() - startMs;
    const wordCount = rendered.trim().split(/\s+/).filter(Boolean).length;
    logger.info("capability_complete", {
      capability: "pipeline",
      duration_ms: durationMs,
      word_count: wordCount,
      assumptions_count: state.warnings.length,
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost,
      pass: state.auditArtifact.approved_for_delivery,
      outcome: state.auditArtifact.approved_for_delivery ? "success" : "degraded",
    });

    writeCapabilityAudit({
      capability: "pipeline",
      input_summary: buildCapabilityInputSummary(inputWordCount),
      outcome: state.auditArtifact.approved_for_delivery ? "success" : "degraded",
      duration_ms: durationMs,
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost,
      assumptions_count: state.warnings.length,
    });

    return createToolEnvelope<DraftToolArtifact>({
      capability: "draft",
      outcome: state.auditArtifact.approved_for_delivery ? "success" : "degraded",
      shouldPersist: true,
      inputSummary: buildInputSummary(brief, state),
      artifact: {
        final_content: canonicalContent,
        audit: state.auditArtifact,
      },
      rendered,
      warnings: state.warnings,
      metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
    });
  } catch (error) {
    const rendered = `Corina draft failed: ${error instanceof Error ? error.message : String(error)}`;
    const inputSummary = buildInputSummary(brief, state);
    const warnings = [...state.warnings, rendered];
    writeCapabilityAudit({
      capability: "pipeline",
      input_summary: buildCapabilityInputSummary(inputWordCount),
      outcome: "failed",
      duration_ms: Date.now() - startMs,
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost,
      assumptions_count: state.warnings.length,
    });
    logger.error("capability_error", {
      capability: "pipeline",
      degraded: false,
      ...errorDetails(error),
    });
    return createToolEnvelope<DraftToolArtifact>({
      capability: "draft",
      outcome: "failed",
      shouldPersist: false,
      artifact: null,
      rendered,
      warnings,
      inputSummary,
      metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
    });
  }
}

export async function runDraftWithArtifact(
  brief: string,
  client: OpenCodeClient,
  modelConfig?: Partial<PipelineModelConfig>,
  logger?: AgentLogger,
): Promise<CorinaToolEnvelope<DraftToolArtifact>> {
  return runPipelineWithArtifact(brief, client, modelConfig, logger);
}

export async function runPipeline(
  brief: string,
  client: OpenCodeClient,
  modelConfig?: Partial<PipelineModelConfig>,
  logger?: AgentLogger,
): Promise<string> {
  const output = await runPipelineWithArtifact(brief, client, modelConfig, logger);
  return output.rendered;
}

export async function runDraft(
  brief: string,
  client: OpenCodeClient,
  modelConfig?: Partial<PipelineModelConfig>,
  logger?: AgentLogger,
): Promise<string> {
  return runPipeline(brief, client, modelConfig, logger);
}
