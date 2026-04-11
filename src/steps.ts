import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedModel } from "opencode-model-resolver";
import { detectBannedWords, wordCount } from "opencode-text-tools";

import {
  addLlmMetrics,
  errorDetails,
  extractLlmMetrics,
  makeConsoleLogger,
  type AgentLogger,
  type UsageAccumulator,
} from "./logger.js";
import { loadPrompt } from "./prompt-loader.js";
import { deduplicateFindings, normalizeModuleOutput } from "./evaluation-normalizer.js";
import { buildEvaluationContextFromCritiqueArgs, selectModules } from "./evaluation-registry.js";
import { buildEvaluationContextBlock, runEvaluationAgent } from "./evaluation-runtime.js";
import type {
  EvaluationFinding,
  EvaluationModuleId,
  ModuleRunStatus,
  BriefArtifact,
  CritiqueArtifact,
  DraftArtifact,
  OpenCodeClient,
  OutlineArtifact,
  StepResult,
} from "./types.js";

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");

const schemaCache = new Map<string, Record<string, unknown>>();

export function sanitizeWords(text: string): string[] {
  return detectBannedWords(text).found;
}

export function countWords(text: string): number {
  return wordCount(text).total_words;
}

function loadSchema(filename: string): Record<string, unknown> {
  const cached = schemaCache.get(filename);
  if (cached) {
    return cached;
  }

  const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, filename), "utf8")) as Record<string, unknown>;
  schemaCache.set(filename, schema);
  return schema;
}

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: T }).data;
  }

  return response as T;
}

function buildPromptBody(body: Record<string, unknown>, model?: ResolvedModel): Record<string, unknown> {
  return {
    model: model
      ? {
          providerID: model.providerID,
          modelID: model.modelID,
        }
      : undefined,
    ...body,
  };
}

async function promptSession(
  client: OpenCodeClient,
  sessionId: string,
  body: Record<string, unknown>,
  model?: ResolvedModel,
): Promise<any> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<any>;
  };

  try {
    return await sessionClient.prompt({
      path: { id: sessionId },
      body: buildPromptBody(body, model),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    return sessionClient.prompt({
      path: { sessionID: sessionId },
      body: buildPromptBody(body, model),
    });
  }
}

async function deleteSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  const sessionClient = client.session as unknown as {
    delete: (options: Record<string, unknown>) => Promise<any>;
  };

  try {
    await sessionClient.delete({ path: { id: sessionId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    await sessionClient.delete({ path: { sessionID: sessionId } });
  }
}

export function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) {
    return "";
  }

  return parts
    .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null && "type" in part)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function parseStructuredOutput<T>(result: unknown): T {
  const data = unwrapData<any>(result);
  const candidates = [
    data?.info?.structured,
    data?.info?.structured_output,
    data?.info?.structuredOutput,
    data?.info?.metadata?.structured_output,
    data?.structured_output,
    data?.structuredOutput,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      return candidate as T;
    }
  }

  const text = extractText(data?.parts);
  if (!text) {
    throw new Error("Structured response did not include structured_output or JSON text parts.");
  }

  return JSON.parse(text) as T;
}

export function extractFinalText(responseText: string): string {
  const finalHeader = /^## FINAL\s*$/im;
  if (!finalHeader.test(responseText)) {
    return responseText.trim();
  }

  const segments = responseText.split(finalHeader);
  return (segments.at(-1) ?? responseText).trim();
}

async function runSession<T>(input: {
  client: OpenCodeClient;
  title: string;
  step: string;
  agent: string;
  personaFile: string;
  taskPrompt: string;
  schemaFile?: string;
  model?: ResolvedModel;
  logger?: AgentLogger;
  usage?: UsageAccumulator;
}): Promise<T> {
  const { client, title, step, agent, personaFile, taskPrompt, schemaFile, model, usage } = input;
  const logger = input.logger ?? makeConsoleLogger("corina");
  const sessionResponse = await client.session.create({ body: { title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  logger.debug("session_created", {
    capability: "pipeline",
    step,
    session_id: session.id,
    agent,
    model_id: model?.modelID,
    provider_id: model?.providerID,
  });

  try {
    const primerStartMs = Date.now();
    const primerResult = await promptSession(
      client,
      session.id,
      {
        agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(personaFile) }],
      },
      model,
    );
    const primerMetrics = extractLlmMetrics(primerResult, `${step}_setup`, primerStartMs);
    addLlmMetrics(usage, primerMetrics);
    logger.info("llm_call", { capability: "pipeline", ...primerMetrics });

    const taskStartMs = Date.now();
    const result = await promptSession(
      client,
      session.id,
      {
        agent,
        parts: [{ type: "text", text: taskPrompt }],
        ...(schemaFile
          ? {
              format: {
                type: "json_schema",
                schema: loadSchema(schemaFile),
                retryCount: 2,
              },
            }
          : {}),
      },
      model,
    );
    const taskMetrics = extractLlmMetrics(result, step, taskStartMs);
    addLlmMetrics(usage, taskMetrics);
    logger.info("llm_call", { capability: "pipeline", ...taskMetrics });

    if (schemaFile) {
      return parseStructuredOutput<T>(result);
    }

    const text = extractText(unwrapData<any>(result)?.parts);
    return extractFinalText(text) as T;
  } catch (error) {
    logger.error("step_error", {
      capability: "pipeline",
      step,
      session_id: session.id,
      degraded: false,
      ...errorDetails(error),
    });
    throw error;
  } finally {
    try {
      await deleteSession(client, session.id);
      logger.debug("session_deleted", {
        capability: "pipeline",
        step,
        session_id: session.id,
      });
    } catch (error) {
      logger.error("session_delete_failed", {
        capability: "pipeline",
        step,
        session_id: session.id,
        degraded: true,
        ...errorDetails(error),
      });
      throw error;
    }
  }
}

export async function runBriefIntake(
  client: OpenCodeClient,
  rawBrief: string,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<BriefArtifact>> {
  const artifact = await runSession<BriefArtifact>({
    client,
    title: "Corina brief intake",
    step: "brief_intake",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    schemaFile: "BriefArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Turn the raw writing request into a validated BriefArtifact.",
      "Return JSON only via the schema formatter for this step.",
      "If the brief is underspecified, fill missing_info with concrete clarification questions.",
      "Prefer conservative inference over invented facts.",
      "",
      "RAW BRIEF:",
      rawBrief.trim(),
    ].join("\n"),
  });

  return { artifact };
}

export async function runOutline(
  client: OpenCodeClient,
  brief: BriefArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<OutlineArtifact>> {
  const artifact = await runSession<OutlineArtifact>({
    client,
    title: "Corina outline",
    step: "outline",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    schemaFile: "OutlineArtifact.json",
    model,
    logger,
    usage,
    taskPrompt: [
      "Create an OutlineArtifact for the writing assignment below.",
      "Return JSON only via the schema formatter for this step.",
      "Build a thesis, useful structure, explicit risks, and a strong editorial intent.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
    ].join("\n"),
  });

  return { artifact };
}

export async function runDraft(
  client: OpenCodeClient,
  brief: BriefArtifact,
  outline: OutlineArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina draft",
    step: "draft",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    model,
    logger,
    usage,
    taskPrompt: [
      "Write the full draft using the brief and outline below.",
      "Follow the Corina persona process, but the content we will keep is the ## FINAL section.",
      "Ground claims in the supplied material only. Do not invent statistics.",
      "Keep the writing human, specific, and free of generic AI phrasing.",
      "",
      "BRIEF ARTIFACT:",
      JSON.stringify(brief, null, 2),
      "",
      "OUTLINE ARTIFACT:",
      JSON.stringify(outline, null, 2),
    ].join("\n"),
  });

  const bannedWords = sanitizeWords(content);

  return {
    artifact: {
      content,
      word_count: countWords(content),
      claims: [outline.thesis],
      assumptions: brief.missing_info,
      open_risks: outline.risks,
    },
    warnings: bannedWords.length ? [`Banned words detected in draft pre-scan: ${bannedWords.join(", ")}`] : [],
  };
}

const MODULE_PROMPTS: Record<
  Exclude<EvaluationModuleId, "critic-adjudicator" | "auditor-adjudicator">,
  { promptFile: string; delimiter: string }
> = {
  "prose-evaluator": { promptFile: "tasks/prose-evaluator.md", delimiter: "prose_evaluation" },
  "voice-evaluator": { promptFile: "tasks/voice-evaluator.md", delimiter: "voice_evaluation" },
  "evidence-evaluator": { promptFile: "tasks/evidence-evaluator.md", delimiter: "evidence_evaluation" },
  "format-auditor": { promptFile: "tasks/format-auditor.md", delimiter: "format_evaluation" },
};

function severityPenalty(finding: EvaluationFinding): number {
  if (typeof finding.score_impact === "number" && finding.score_impact < 0) {
    return Math.abs(finding.score_impact);
  }

  if (finding.severity === "blocking") return 3;
  if (finding.severity === "major") return 2;
  return 1;
}

function classifyDimension(finding: EvaluationFinding): keyof CritiqueArtifact["dimensions"] | null {
  if (finding.module === "voice") return "tone";
  if (finding.module === "evidence") return "evidence";
  if (finding.module !== "prose") return null;
  if (finding.rule_id.startsWith("prose.rhythm.")) return "rhythm";
  if (finding.rule_id.startsWith("prose.precision.")) return "precision";
  return "ai_patterns";
}

function summarizeFinding(finding: EvaluationFinding): string {
  const location = finding.location ? ` (${finding.location})` : "";
  return `${finding.rule_id}${location}: ${finding.explanation}`;
}

function buildModuleTaskPrompt(input: {
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
    input.findings
      ? `=== FINDINGS ===\n${JSON.stringify(input.findings, null, 2)}\n=== END FINDINGS ===`
      : null,
    input.moduleStatus
      ? `=== MODULE STATUS ===\n${JSON.stringify(input.moduleStatus, null, 2)}\n=== END MODULE STATUS ===`
      : null,
    `=== DRAFT TEXT ===\n${input.draft.trim()}\n=== END DRAFT TEXT ===`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runCritique(
  client: OpenCodeClient,
  draft: DraftArtifact,
  brief: BriefArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<CritiqueArtifact>> {
  const context = buildEvaluationContextFromCritiqueArgs({ mode: "quality" }, draft.content, JSON.stringify(brief, null, 2));
  const selectedModules = selectModules(context, "critic");
  const evaluatorModules = selectedModules.filter((module) => module.id !== "critic-adjudicator");
  const module_status: Partial<Record<EvaluationModuleId, ModuleRunStatus>> = {};
  const contextBlock = buildEvaluationContextBlock(context);

  const moduleResults = await Promise.all(
    evaluatorModules.map(async (module) => {
      const config = MODULE_PROMPTS[module.id as keyof typeof MODULE_PROMPTS];
      try {
        const result = await runEvaluationAgent({
          client,
          capability: "pipeline",
          title: `Corina ${module.id}`,
          step: module.id,
          agent: module.id,
          promptFile: config.promptFile,
          delimiter: config.delimiter,
          taskPrompt: buildModuleTaskPrompt({
            contextBlock,
            brief: context.brief_text,
            draft: context.draft_text,
            voicePrompt: context.voice_prompt,
          }),
          model,
          logger: logger ?? makeConsoleLogger("corina"),
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
        return normalized;
      } catch (error) {
        module_status[module.id] = "degraded";
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

  const findings = deduplicateFindings(moduleResults.flatMap((result) => result.findings));
  const adjudicator = await runEvaluationAgent({
    client,
    capability: "pipeline",
    title: "Corina critic adjudicator",
    step: "critic-adjudicator",
    agent: "critic-adjudicator",
    promptFile: "tasks/critic-adjudicator.md",
    delimiter: "critique_result",
    taskPrompt: buildModuleTaskPrompt({
      contextBlock,
      brief: context.brief_text,
      draft: context.draft_text,
      findings,
      moduleStatus: module_status,
      voicePrompt: context.voice_prompt,
    }),
    model,
    logger: logger ?? makeConsoleLogger("corina"),
    usage,
  });

  const rawArtifact = adjudicator.raw as CritiqueArtifact;
  const artifact: CritiqueArtifact = {
    pass: Boolean(rawArtifact.pass),
    overall_score: typeof rawArtifact.overall_score === "number" ? rawArtifact.overall_score : 0,
    dimensions: rawArtifact.dimensions ?? {
      ai_patterns: { score: 6, issues: [] },
      tone: { score: 6, issues: [] },
      precision: { score: 6, issues: [] },
      evidence: { score: 6, issues: [] },
      rhythm: { score: 6, issues: [] },
    },
    revision_instructions: Array.isArray(rawArtifact.revision_instructions) ? rawArtifact.revision_instructions : [],
    fatal_issues: Array.isArray(rawArtifact.fatal_issues) ? rawArtifact.fatal_issues : [],
    findings,
    module_status,
    degraded: Object.values(module_status).includes("degraded"),
  };

  if (!rawArtifact.dimensions) {
    const base = { ai_patterns: 6, tone: 6, precision: 6, evidence: 6, rhythm: 6 };
    for (const finding of findings) {
      const dimension = classifyDimension(finding);
      if (!dimension) continue;
      base[dimension] = Math.max(0, base[dimension] - severityPenalty(finding));
    }
    artifact.dimensions = {
      ai_patterns: { score: base.ai_patterns, issues: findings.filter((finding) => classifyDimension(finding) === "ai_patterns").map(summarizeFinding) },
      tone: { score: base.tone, issues: findings.filter((finding) => classifyDimension(finding) === "tone").map(summarizeFinding) },
      precision: { score: base.precision, issues: findings.filter((finding) => classifyDimension(finding) === "precision").map(summarizeFinding) },
      evidence: { score: base.evidence, issues: findings.filter((finding) => classifyDimension(finding) === "evidence").map(summarizeFinding) },
      rhythm: { score: base.rhythm, issues: findings.filter((finding) => classifyDimension(finding) === "rhythm").map(summarizeFinding) },
    };
    artifact.overall_score = Object.values(artifact.dimensions).reduce((sum, dimension) => sum + dimension.score, 0);
    artifact.fatal_issues = findings.filter((finding) => finding.module === "evidence" && finding.severity === "blocking").map(summarizeFinding);
    artifact.revision_instructions = findings.filter((finding) => finding.severity !== "minor").map((finding) => finding.fix_hint);
    artifact.pass = artifact.overall_score >= 22 && artifact.fatal_issues.length === 0;
    artifact.degraded = true;
  }

  return { artifact };
}
export async function runRevise(
  client: OpenCodeClient,
  draft: DraftArtifact,
  critique: CritiqueArtifact,
  model?: ResolvedModel,
  logger?: AgentLogger,
  usage?: UsageAccumulator,
): Promise<StepResult<DraftArtifact>> {
  const content = await runSession<string>({
    client,
    title: "Corina revise",
    step: "revise",
    agent: "corina",
    personaFile: "base/corina-persona.md",
    model,
    logger,
    usage,
    taskPrompt: [
      "Revise the draft using the critique below.",
      "Follow the Corina persona process, but the content we will keep is the ## FINAL section.",
      "Fix every revision instruction and every fatal issue. Preserve the core argument unless the critique requires changing it.",
      "Do not add fabricated evidence.",
      "",
      "DRAFT ARTIFACT:",
      JSON.stringify(draft, null, 2),
      "",
      "CRITIQUE ARTIFACT:",
      JSON.stringify(critique, null, 2),
    ].join("\n"),
  });

  return {
    artifact: {
      ...draft,
      content,
      word_count: countWords(content),
    },
  };
}
