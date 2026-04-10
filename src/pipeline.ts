import { ModelResolver } from "opencode-model-resolver";

import { createCapabilityOutput } from "./capability-output.js";
import { createUsageAccumulator, errorDetails, makeConsoleLogger, type AgentLogger } from "./logger.js";
import { DEFAULT_MODEL_CONFIG } from "./model-config.js";
import { runAudit, runBriefIntake, runCritique, runDraft, runOutline, runRevise } from "./steps.js";
import type { AgentCapabilityOutput, AuditArtifact, OpenCodeClient, PipelineModelConfig, WorkflowState } from "./types.js";
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
): Promise<AgentCapabilityOutput<{ final_content: string; audit: AuditArtifact }>> {
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
    input_summary: brief.slice(0, 160),
  });

  try {
    const briefModel = await resolver.resolveStepModel(config.briefIntake, config.provider);
    const { result: briefResult } = await runStep(logger, "brief_intake", briefModel.modelID, () =>
      runBriefIntake(client, brief, briefModel, logger, usage),
    );
    state.briefArtifact = briefResult.artifact;
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

      return createCapabilityOutput({
        capability: "pipeline",
        inputSummary: buildInputSummary(brief, state),
        artifact: { final_content: rendered, audit },
        rendered,
        assumptions: state.warnings,
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
      runDraft(client, state.briefArtifact!, state.outlineArtifact!, draftModel, logger, usage),
    );
    state.draftArtifact = draftResult.artifact;
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
    const { result: auditResult } = await runStep(logger, "audit", auditModel.modelID, () =>
      runAudit(client, state.draftArtifact!, state.briefArtifact!, auditModel, logger, usage),
    );
    state.auditArtifact = auditResult.artifact;
    state.warnings.push(...(auditResult.warnings ?? []));

    const auditValidation = validate("AuditArtifact", state.auditArtifact);
    if (!auditValidation.valid) {
      throw new Error(`AuditArtifact validation failed: ${auditValidation.errors.join("; ")}`);
    }

    const rendered =
      state.auditArtifact.approved_for_delivery && state.auditArtifact.final_content
        ? state.auditArtifact.final_content
        : [
            state.draftArtifact.content,
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

    return createCapabilityOutput({
      capability: "pipeline",
      inputSummary: buildInputSummary(brief, state),
      artifact: {
        final_content: state.auditArtifact.final_content ?? rendered,
        audit: state.auditArtifact,
      },
      rendered,
      assumptions: state.warnings,
      metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
    });
  } catch (error) {
    logger.error("capability_error", {
      capability: "pipeline",
      degraded: false,
      ...errorDetails(error),
    });
    throw error;
  }
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
