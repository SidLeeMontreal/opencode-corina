import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelResolver } from "opencode-model-resolver";
import type { ResolvedModel } from "opencode-model-resolver";
import { detectAiPatterns } from "opencode-text-tools";

import { createCapabilityOutput } from "./capability-output.js";
import {
  addLlmMetrics,
  createUsageAccumulator,
  errorDetails,
  extractLlmMetrics,
  makeConsoleLogger,
  type AgentLogger,
  type UsageAccumulator,
} from "./logger.js";
import { loadPrompt } from "./prompt-loader.js";
import { aggregateComparison } from "./critique-compare.js";
import {
  formatAudienceInline,
  formatComparisonInline,
  formatCritiqueInline,
  formatCritiqueReport,
  formatJson,
  formatRubricInline,
} from "./critique-formatters.js";
import { normalizeCritiqueInputs } from "./critique-normalizer.js";
import { runDetectWithArtifact } from "./detect.js";
import { runPipelineWithArtifact } from "./pipeline.js";
import { runTonePipelineWithArtifact } from "./tone-pipeline.js";
import type {
  AgentCapabilityOutput,
  AudienceCritiqueReport,
  ComparisonReport,
  CritiqueArtifactUnion,
  CritiqueChain,
  CritiqueMode,
  CritiqueRenderFormat,
  CritiqueReport,
  DetectionReport,
  OpenCodeClient,
  ResolvedRubric,
  RubricReport,
  ToneOutputArtifact,
  ToneVoice,
} from "./types.js";
import { validate } from "./validators.js";

const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const schemaCache = new Map<string, Record<string, unknown>>();
const modelResolver = new ModelResolver();
const TONE_VOICES = new Set<ToneVoice>([
  "journalist",
  "technical",
  "persuasive",
  "social",
  "ux",
  "seo",
  "accessibility",
  "executive",
  "brand",
  "email",
  "personal",
]);

export interface RunCritiqueOptions {
  mode?: CritiqueMode;
  audience?: string;
  rubric?: string;
  chain?: CritiqueChain;
  format?: CritiqueRenderFormat;
  modelPreset?: string;
  voice?: string;
  __chainSourceText?: string;
}

function loadSchema(filename: string): Record<string, unknown> {
  const cached = schemaCache.get(filename);
  if (cached) return cached;
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

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part): part is { type: string; text?: string } => typeof part === "object" && part !== null && "type" in part)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseStructuredOutput<T>(result: unknown): T {
  const data = unwrapData<any>(result);
  const candidates = [
    data?.info?.structured,
    data?.info?.structured_output,
    data?.info?.structuredOutput,
    data?.structured_output,
    data?.structuredOutput,
  ];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate as T;
  }

  const text = extractText(data?.parts);
  if (!text) throw new Error("Structured response missing JSON output.");
  return JSON.parse(text) as T;
}

async function promptSession(client: OpenCodeClient, sessionId: string, body: Record<string, unknown>, model?: ResolvedModel) {
  const sessionClient = client.session as unknown as { prompt: (options: Record<string, unknown>) => Promise<unknown> };
  const fullBody = model
    ? { ...body, model: { providerID: model.providerID, modelID: model.modelID } }
    : body;

  try {
    return await sessionClient.prompt({ path: { id: sessionId }, body: fullBody });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) throw error;
    return sessionClient.prompt({ path: { sessionID: sessionId }, body: fullBody });
  }
}

async function deleteSession(client: OpenCodeClient, sessionId: string) {
  const sessionClient = client.session as unknown as { delete: (options: Record<string, unknown>) => Promise<unknown> };
  try {
    await sessionClient.delete({ path: { id: sessionId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) throw error;
    await sessionClient.delete({ path: { sessionID: sessionId } });
  }
}

async function runStructuredSession<T>(input: {
  client: OpenCodeClient;
  title: string;
  step: string;
  agent: string;
  personaFile: string;
  schemaFile: string;
  taskPrompt: string;
  model?: ResolvedModel;
  logger: AgentLogger;
  usage: UsageAccumulator;
}): Promise<T> {
  const sessionResponse = await input.client.session.create({ body: { title: input.title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  input.logger.debug("session_created", { capability: "critique", step: input.step, session_id: session.id, agent: input.agent, model_id: input.model?.modelID, provider_id: input.model?.providerID });

  try {
    const primerStartMs = Date.now();
    const primerResult = await promptSession(
      input.client,
      session.id,
      {
        agent: input.agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(input.personaFile) }],
      },
      input.model,
    );
    const primerMetrics = extractLlmMetrics(primerResult, `${input.step}_setup`, primerStartMs);
    addLlmMetrics(input.usage, primerMetrics);
    input.logger.info("llm_call", { capability: "critique", ...primerMetrics });

    const resultStartMs = Date.now();
    const result = await promptSession(
      input.client,
      session.id,
      {
        agent: input.agent,
        parts: [{ type: "text", text: input.taskPrompt }],
        format: {
          type: "json_schema",
          schema: loadSchema(input.schemaFile),
          retryCount: 2,
        },
      },
      input.model,
    );
    const resultMetrics = extractLlmMetrics(result, input.step, resultStartMs);
    addLlmMetrics(input.usage, resultMetrics);
    input.logger.info("llm_call", { capability: "critique", ...resultMetrics });

    return parseStructuredOutput<T>(result);
  } catch (error) {
    input.logger.error("step_error", { capability: "critique", step: input.step, session_id: session.id, degraded: false, ...errorDetails(error) });
    throw error;
  } finally {
    await deleteSession(input.client, session.id);
    input.logger.debug("session_deleted", { capability: "critique", step: input.step, session_id: session.id });
  }
}

async function resolveModel(modelPreset?: string): Promise<ResolvedModel | undefined> {
  if (!modelPreset) {
    return modelResolver.resolveStepModel({ preset: "writing-analysis" });
  }

  const preset = ["fast", "balanced", "quality", "writing-quality", "writing-analysis", "writing-fast"].includes(modelPreset)
    ? (modelPreset as Parameters<ModelResolver["resolveStepModel"]>[0]["preset"])
    : "writing-analysis";
  return modelResolver.resolveStepModel({ preset });
}

function buildEmptyCritiqueReport(note: string, assumptions: string[]): CritiqueReport {
  const emptyDimension = { score: 1, issues: [note], strengths: [] };
  return {
    status: "no_input",
    pass: false,
    overall_score: 0,
    pass_threshold: 20,
    dimensions: {
      ai_patterns: emptyDimension,
      tone: emptyDimension,
      precision: emptyDimension,
      evidence: emptyDimension,
      rhythm: emptyDimension,
    },
    issues: [],
    strengths: [],
    revision_instructions: ["Provide text or a readable file path before running critique."],
    fatal_issues: [note],
    assumptions,
  };
}

function buildEmptyAudienceReport(audience: string | null, assumptions: string[]): AudienceCritiqueReport {
  return {
    status: "no_input",
    audience_requested: audience,
    audience_applied: audience ?? "general",
    audience_inferred: !audience,
    resonance_score: 0,
    what_lands: [],
    what_misses: ["No input text was available to critique."],
    unclear_points: [],
    missing_for_audience: ["Provide a draft before requesting an audience critique."],
    jargon_risks: [],
    need_gaps: [],
    rewrite_brief: ["Provide source text, then rerun audience critique."],
    assumptions,
  };
}

function buildEmptyRubricReport(rubric: ResolvedRubric | undefined, assumptions: string[]): RubricReport {
  return {
    status: "no_input",
    rubric_id: rubric?.id ?? "corina",
    rubric_name: rubric?.name ?? "Corina Editorial Standard",
    voice_profile_hint: null,
    total_score: 0,
    max_total_score: rubric?.dimensions.reduce((sum, dimension) => sum + dimension.max_score, 0) ?? 25,
    dimensions: [],
    strongest_dimensions: [],
    weakest_dimensions: [],
    overall_assessment: "No input text was available to score.",
    assumptions,
  };
}

function buildInputSummary(count: number, mode: CritiqueMode): string {
  return `Critiqued ${count} input${count === 1 ? "" : "s"} in ${mode} mode.`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buildFallbackQualityReport(text: string, assumptions: string[], error: unknown): CritiqueReport {
  const scan = detectAiPatterns(text);
  const findings = scan.patternMatches.slice(0, 5);
  const derivedIssues = findings.map((match, index) => ({
    id: `fallback_${index + 1}`,
    dimension: (match.category === "language" || match.category === "filler"
      ? "ai_patterns"
      : match.category === "style"
        ? "rhythm"
        : match.category === "communication"
          ? "tone"
          : "precision") as CritiqueReport["issues"][number]["dimension"],
    severity: match.severity,
    summary: `${match.explanation} (${match.locationHint})`,
    fix_direction: match.fixSuggestion,
  }));

  const issues = derivedIssues.length
    ? derivedIssues
    : [
        {
          id: "fallback_generic",
          dimension: "precision" as const,
          severity: "medium" as const,
          summary: "Live critique was unavailable, so this report used local heuristic checks.",
          fix_direction: "Tighten specificity, remove generic phrasing, and rerun critique when the server is available.",
        },
      ];

  const aiScore = scan.counts.totalMatches >= 6 ? 1 : scan.counts.totalMatches >= 3 ? 2 : scan.counts.totalMatches >= 1 ? 3 : 4;
  const toneScore = /(innovative|transformative|seamless|unlock|elevate)/i.test(text) ? 2 : 3;
  const precisionScore = /(many|various|numerous|several|robust|powerful)/i.test(text) ? 2 : 3;
  const evidenceScore = /(according to|study|data|survey|report|research|%|percent|202\d)/i.test(text) ? 3 : 2;
  const rhythmScore = /(additionally|furthermore|moreover)/i.test(text) ? 2 : 3;
  const overallScore = aiScore + toneScore + precisionScore + evidenceScore + rhythmScore;

  return {
    status: "degraded",
    pass: false,
    overall_score: overallScore,
    pass_threshold: 20,
    dimensions: {
      ai_patterns: {
        score: aiScore,
        issues: issues.filter((issue) => issue.dimension === "ai_patterns").map((issue) => issue.summary),
        strengths: scan.counts.totalMatches === 0 ? ["Local scan found few explicit AI-pattern signals."] : [],
      },
      tone: {
        score: toneScore,
        issues: issues.filter((issue) => issue.dimension === "tone").map((issue) => issue.summary),
        strengths: [],
      },
      precision: {
        score: precisionScore,
        issues: issues.filter((issue) => issue.dimension === "precision").map((issue) => issue.summary),
        strengths: [],
      },
      evidence: {
        score: evidenceScore,
        issues: evidenceScore < 3 ? ["The text makes broad claims without enough concrete support."] : [],
        strengths: evidenceScore >= 3 ? ["The text includes at least some concrete evidence markers."] : [],
      },
      rhythm: {
        score: rhythmScore,
        issues: issues.filter((issue) => issue.dimension === "rhythm").map((issue) => issue.summary),
        strengths: [],
      },
    },
    issues,
    strengths: ["Fallback heuristic critique used because the live critique call failed."],
    revision_instructions: [...new Set(issues.map((issue) => issue.fix_direction))],
    fatal_issues: [`Quality critique degraded: ${errorMessage(error)}`],
    assumptions,
  };
}

function buildFallbackRubricReport(rubric: ResolvedRubric | undefined, assumptions: string[], error: unknown, text: string): RubricReport {
  const scan = detectAiPatterns(text);
  const baseDimensions = rubric?.dimensions ?? [];
  const dimensions = baseDimensions.map((dimension, index) => {
    const penalty = Math.min(Math.max(scan.counts.totalMatches, 1), Math.max(dimension.max_score - 1, 1));
    const score = Math.max(1, dimension.max_score - penalty + (index === 0 ? 0 : 1));
    return {
      id: dimension.id,
      label: dimension.name,
      score,
      max_score: dimension.max_score,
      rationale: `Fallback rubric scoring used because the live rubric critic was unavailable (${errorMessage(error)}).`,
      strengths: score >= Math.ceil(dimension.max_score / 2) ? ["Text partially satisfies this dimension under heuristic scoring."] : [],
      weaknesses: [dimension.description || "Needs stronger execution for this rubric dimension."],
      fix_directions: scan.patternMatches.slice(0, 2).map((match) => match.fixSuggestion),
    };
  });

  const total_score = dimensions.reduce((sum, dimension) => sum + dimension.score, 0);
  const sorted = [...dimensions].sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return {
    status: "degraded",
    rubric_id: rubric?.id ?? "corina",
    rubric_name: rubric?.name ?? "Corina Editorial Standard",
    voice_profile_hint: null,
    total_score,
    max_total_score: dimensions.reduce((sum, dimension) => sum + dimension.max_score, 0),
    dimensions,
    strongest_dimensions: sorted.slice(0, 2).map((dimension) => dimension.label),
    weakest_dimensions: [...sorted].reverse().slice(0, 2).map((dimension) => dimension.label),
    overall_assessment: `Fallback rubric scoring used because the live rubric critic was unavailable (${errorMessage(error)}).`,
    assumptions: [...assumptions, `Rubric critique degraded: ${errorMessage(error)}`],
  };
}

function buildQualityPrompt(input: {
  text: string;
  sourcePath: string | null;
  toneOutput?: ToneOutputArtifact;
  detectionReport?: DetectionReport;
  assumptions: string[];
}): string {
  return [
    "Evaluate the text below and return a CritiqueReport.",
    "Return JSON only via the schema formatter for this step.",
    "Be strict and specific. Diagnose; do not rewrite.",
    "",
    "INPUT:",
    JSON.stringify(
      {
        text: input.text,
        source_path: input.sourcePath,
        tone_output: input.toneOutput ?? null,
        detection_report: input.detectionReport ?? null,
        assumptions: input.assumptions,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildAudiencePrompt(input: {
  text: string;
  sourcePath: string | null;
  audienceRequested: string | null;
  inferredAudience: string | undefined;
  toneOutput?: ToneOutputArtifact;
  detectionReport?: DetectionReport;
  assumptions: string[];
}): string {
  return [
    "Evaluate the text below for audience fit and return an AudienceCritiqueReport.",
    "Return JSON only via the schema formatter for this step.",
    "Diagnose from the audience's perspective. Do not rewrite.",
    "",
    "INPUT:",
    JSON.stringify(
      {
        text: input.text,
        source_path: input.sourcePath,
        audience: input.audienceRequested,
        inferred_audience: input.inferredAudience ?? null,
        tone_output: input.toneOutput ?? null,
        detection_report: input.detectionReport ?? null,
        assumptions: input.assumptions,
      },
      null,
      2,
    ),
  ].join("\n");
}

function buildRubricPrompt(input: {
  text: string;
  sourcePath: string | null;
  rubric: ResolvedRubric;
  toneOutput?: ToneOutputArtifact;
  detectionReport?: DetectionReport;
  assumptions: string[];
}): string {
  return [
    "Evaluate the text below against the supplied rubric and return a RubricReport.",
    "Return JSON only via the schema formatter for this step.",
    "Use only the rubric's dimensions and guidance. Do not rewrite.",
    "",
    "INPUT:",
    JSON.stringify(
      {
        text: input.text,
        source_path: input.sourcePath,
        rubric_id: input.rubric.id,
        rubric_path: input.rubric.source_path,
        resolved_rubric: input.rubric,
        tone_output: input.toneOutput ?? null,
        detection_report: input.detectionReport ?? null,
        assumptions: input.assumptions,
      },
      null,
      2,
    ),
  ].join("\n");
}

function enrichQualityReport(report: CritiqueReport, inheritedAssumptions: string[]): CritiqueReport {
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const strengths = Array.isArray(report.strengths) ? report.strengths : [];
  const dimensionKeys = ["ai_patterns", "tone", "precision", "evidence", "rhythm"] as const;
  const overallScore = dimensionKeys.reduce((sum, key) => sum + Number(report.dimensions[key]?.score ?? 0), 0);
  return {
    ...report,
    status: report.status ?? "ok",
    pass_threshold: 20,
    overall_score: overallScore,
    pass: overallScore >= 20 && (report.fatal_issues?.length ?? 0) === 0,
    issues,
    strengths,
    assumptions: [...(report.assumptions ?? []), ...inheritedAssumptions],
  };
}

function renderOutput(output: AgentCapabilityOutput<CritiqueArtifactUnion>, format: CritiqueRenderFormat | undefined): string {
  if (format === "json") return formatJson(output);
  if (output.mode === "quality") return format === "report" ? formatCritiqueReport(output.artifact as CritiqueReport) : formatCritiqueInline(output.artifact as CritiqueReport);
  if (output.mode === "audience") return formatAudienceInline(output.artifact as AudienceCritiqueReport);
  if (output.mode === "rubric") return formatRubricInline(output.artifact as RubricReport);
  return formatComparisonInline(output.artifact as ComparisonReport);
}

function isToneVoice(value: string | undefined | null): value is ToneVoice {
  return Boolean(value && TONE_VOICES.has(value as ToneVoice));
}

export function inferVoiceFromAudience(audience: string | undefined | null): ToneVoice {
  const normalized = audience?.trim().toLowerCase() ?? "";
  if (/(cmo|vp marketing|chief marketing officer|executive|leadership|board)/.test(normalized)) return "executive";
  if (/(developer|engineer|technical|architect|api|platform)/.test(normalized)) return "technical";
  return "persuasive";
}

function collectQualityFixes(report: CritiqueReport): string[] {
  const issueDirections = report.issues.map((issue) => `${issue.dimension}: ${issue.fix_direction}`);
  return [...report.revision_instructions, ...issueDirections, ...report.fatal_issues];
}

function collectRubricFixes(report: RubricReport): string[] {
  return report.dimensions.flatMap((dimension) => [
    ...dimension.weaknesses,
    ...dimension.fix_directions.map((direction) => `${dimension.label}: ${direction}`),
  ]);
}

function getCritiquedText(output: AgentCapabilityOutput<CritiqueArtifactUnion>, options: RunCritiqueOptions): string {
  if (output.mode === "compare") {
    return (output.artifact as ComparisonReport).winner_text?.trim() ?? "";
  }

  return options.__chainSourceText?.trim() ?? "";
}

function getRequestedVoice(options: RunCritiqueOptions): ToneVoice | undefined {
  return isToneVoice(options.voice) ? options.voice : undefined;
}

function buildToneChainInput(
  critiqueOutput: AgentCapabilityOutput<CritiqueArtifactUnion>,
  options: RunCritiqueOptions,
): {
  text: string;
  voice: ToneVoice;
  fixInstructions?: string[];
  preservationInstructions?: string[];
} {
  const requestedVoice = getRequestedVoice(options);

  if (critiqueOutput.mode === "quality") {
    const artifact = critiqueOutput.artifact as CritiqueReport;
    return {
      text: getCritiquedText(critiqueOutput, options),
      voice: requestedVoice ?? "persuasive",
      fixInstructions: collectQualityFixes(artifact),
      preservationInstructions: artifact.revision_instructions,
    };
  }

  if (critiqueOutput.mode === "audience") {
    const artifact = critiqueOutput.artifact as AudienceCritiqueReport;
    const fixInstructions = [...artifact.rewrite_brief, ...artifact.what_misses, ...artifact.missing_for_audience];
    return {
      text: getCritiquedText(critiqueOutput, options),
      voice: requestedVoice ?? inferVoiceFromAudience(artifact.audience_applied || options.audience),
      fixInstructions,
    };
  }

  if (critiqueOutput.mode === "rubric") {
    const artifact = critiqueOutput.artifact as RubricReport;
    return {
      text: getCritiquedText(critiqueOutput, options),
      voice: requestedVoice ?? (isToneVoice(artifact.rubric_id) ? artifact.rubric_id : "persuasive"),
      fixInstructions: collectRubricFixes(artifact),
    };
  }

  return {
    text: getCritiquedText(critiqueOutput, options),
    voice: requestedVoice ?? "persuasive",
  };
}

export function buildBriefFromCritique(text: string, report: CritiqueReport): string {
  const issues = report.issues.length
    ? report.issues.map((issue, index) => `${index + 1}. [${issue.dimension}] ${issue.summary} — ${issue.fix_direction}`).join("\n")
    : "1. Resolve the critique's flagged issues while preserving meaning.";

  const revisionInstructions = report.revision_instructions.length
    ? report.revision_instructions.map((instruction, index) => `${index + 1}. ${instruction}`).join("\n")
    : "1. Revise the draft so it passes critique.";

  const fatalIssues = report.fatal_issues.length
    ? report.fatal_issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")
    : "None.";

  return [
    "Revise the following draft so it addresses the critique findings and comes back publishable.",
    "Preserve the underlying facts, named entities, numbers, and intent unless the critique explicitly requires a change.",
    "",
    "ORIGINAL TEXT:",
    text,
    "",
    "CRITIQUE ISSUES TO ADDRESS:",
    issues,
    "",
    "REVISION INSTRUCTIONS:",
    revisionInstructions,
    "",
    "FATAL ISSUES:",
    fatalIssues,
  ].join("\n");
}

export async function executeChain(
  chain: CritiqueChain,
  critiqueOutput: AgentCapabilityOutput<CritiqueArtifactUnion>,
  client: OpenCodeClient,
  options: RunCritiqueOptions,
  logger: AgentLogger,
): Promise<{ chainResult: AgentCapabilityOutput<unknown>; appendedRendered: string }> {
  const text = getCritiquedText(critiqueOutput, options);
  if (!text) {
    throw new Error(`Chain target '${chain}' could not find source text to execute.`);
  }

  let chainResult: AgentCapabilityOutput<unknown>;

  logger.info("chain_start", { capability: "critique", chain_target: chain, mode: critiqueOutput.mode });

  if (chain === "tone") {
    const toneInput = buildToneChainInput(critiqueOutput, options);
    chainResult = await runTonePipelineWithArtifact(
      {
        text: toneInput.text,
        voice: toneInput.voice,
        modelPreset: options.modelPreset,
        fixInstructions: toneInput.fixInstructions,
        preservationInstructions: toneInput.preservationInstructions,
      },
      client,
      logger,
    );
  } else if (chain === "detect") {
    chainResult = await runDetectWithArtifact({ text, format: "report", modelPreset: options.modelPreset }, client, logger);
  } else if (critiqueOutput.mode === "quality") {
    chainResult = await runPipelineWithArtifact(buildBriefFromCritique(text, critiqueOutput.artifact as CritiqueReport), client, undefined, logger);
  } else {
    const guidance = critiqueOutput.mode === "audience"
      ? (critiqueOutput.artifact as AudienceCritiqueReport).rewrite_brief
      : critiqueOutput.mode === "rubric"
        ? collectRubricFixes(critiqueOutput.artifact as RubricReport)
        : [(critiqueOutput.artifact as ComparisonReport).recommendation_reason];
    chainResult = await runPipelineWithArtifact(
      [
        "Revise the following text so it resolves the supplied critique guidance.",
        "",
        "TEXT:",
        text,
        "",
        "GUIDANCE:",
        ...guidance.map((item, index) => `${index + 1}. ${item}`),
      ].join("\n"),
      client,
      undefined,
      logger,
    );
  }

  logger.info("chain_complete", { capability: "critique", chain_target: chain, outcome: "success", mode: critiqueOutput.mode });

  return {
    chainResult,
    appendedRendered: `Chain result (${chain})\n-------------------\n${chainResult.rendered}`,
  };
}

async function finalizeOutput(
  output: AgentCapabilityOutput<CritiqueArtifactUnion>,
  options: RunCritiqueOptions,
  client: OpenCodeClient,
  logger: AgentLogger,
  usage: UsageAccumulator,
  startMs: number,
): Promise<AgentCapabilityOutput<CritiqueArtifactUnion>> {
  let finalized = {
    ...output,
    rendered: renderOutput(output, options.format),
  };

  if (!options.chain) {
    logger.info("critique_complete", { capability: "critique", mode: finalized.mode, assumptions_count: finalized.assumptions?.length ?? 0, total_tokens: usage.total_tokens, total_cost: usage.total_cost });
    logger.info("capability_complete", { capability: "critique", mode: finalized.mode, duration_ms: Date.now() - startMs, assumptions_count: finalized.assumptions?.length ?? 0, total_tokens: usage.total_tokens, total_cost: usage.total_cost, outcome: "success" });
    return finalized;
  }

  const { chainResult, appendedRendered } = await executeChain(options.chain, finalized, client, options, logger);
  finalized = {
    ...finalized,
    rendered: `${finalized.rendered}\n\n${appendedRendered}`,
    chained_to: options.chain,
    chain_result: chainResult.artifact,
  };

  logger.info("critique_complete", { capability: "critique", mode: finalized.mode, assumptions_count: finalized.assumptions?.length ?? 0, total_tokens: usage.total_tokens, total_cost: usage.total_cost });
  logger.info("capability_complete", { capability: "critique", mode: finalized.mode, duration_ms: Date.now() - startMs, assumptions_count: finalized.assumptions?.length ?? 0, total_tokens: usage.total_tokens, total_cost: usage.total_cost, outcome: "success", chain_target: options.chain });

  return finalized;
}

async function runQualityMode(text: string, sourcePath: string | null, toneOutput: ToneOutputArtifact | undefined, detectionReport: DetectionReport | undefined, assumptions: string[], client: OpenCodeClient, model: ResolvedModel | undefined, logger: AgentLogger, usage: UsageAccumulator): Promise<CritiqueReport> {
  const report = await runStructuredSession<CritiqueReport>({
    client,
    title: "Corina critique",
    step: "quality",
    agent: "critic",
    personaFile: "tasks/critic.md",
    schemaFile: "CritiqueReport.json",
    taskPrompt: buildQualityPrompt({ text, sourcePath, toneOutput, detectionReport, assumptions }),
    model,
    logger,
    usage,
  });

  return enrichQualityReport(report, assumptions);
}

export async function runCritiqueWithArtifact(
  inputs: string[],
  options: RunCritiqueOptions,
  client: OpenCodeClient,
  logger: AgentLogger = makeConsoleLogger("corina"),
): Promise<AgentCapabilityOutput<CritiqueArtifactUnion>> {
  const startMs = Date.now();
  const usage = createUsageAccumulator();
  const normalized = await normalizeCritiqueInputs(inputs, options);
  const assumptions = [...normalized.assumptions, ...normalized.warnings];
  const model = await resolveModel(options.modelPreset);

  logger.info("capability_start", { capability: "critique", mode: normalized.mode, input_summary: inputs.join(" | ").slice(0, 160), model_preset: options.modelPreset ?? null, input_count: inputs.length });

  if (!normalized.items.length) {
    const mode = normalized.mode;
    const artifact = mode === "audience"
      ? buildEmptyAudienceReport(options.audience ?? normalized.inferredAudience ?? null, assumptions)
      : mode === "rubric"
        ? buildEmptyRubricReport(normalized.resolvedRubric, assumptions)
        : buildEmptyCritiqueReport("No input text was provided.", assumptions);
    const provisional = createCapabilityOutput({
      capability: "critique",
      mode,
      inputSummary: buildInputSummary(0, mode),
      artifact,
      rendered: "",
      assumptions,
    });
    const finalized = {
      ...provisional,
      rendered: renderOutput(provisional as AgentCapabilityOutput<CritiqueArtifactUnion>, options.format),
    };
    logger.warn("critique_complete", { capability: "critique", mode, assumptions_count: assumptions.length, total_tokens: usage.total_tokens, total_cost: usage.total_cost });
    logger.warn("capability_complete", { capability: "critique", mode, duration_ms: Date.now() - startMs, assumptions_count: assumptions.length, total_tokens: usage.total_tokens, total_cost: usage.total_cost, outcome: "degraded" });
    return finalized;
  }

  if (normalized.mode === "quality") {
    const item = normalized.items[0];
    let artifact: CritiqueReport;
    try {
      artifact = await runQualityMode(item.text, item.sourcePath, item.toneOutput, item.detectionReport, assumptions, client, model, logger, usage);
    } catch (error) {
      artifact = buildFallbackQualityReport(item.text, assumptions, error);
    }

    const validation = validate("CritiqueReport", artifact);
    if (!validation.valid) artifact.assumptions.push(`CritiqueReport validation warning: ${validation.errors.join("; ")}`);
    return finalizeOutput(
      createCapabilityOutput({
        capability: "critique",
        mode: normalized.mode,
        inputSummary: buildInputSummary(1, normalized.mode),
        artifact,
        rendered: "",
        assumptions: artifact.assumptions,
        metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
      }),
      { ...options, __chainSourceText: item.text },
      client,
      logger,
      usage,
      startMs,
    );
  }

  if (normalized.mode === "audience") {
    const item = normalized.items[0];
    let artifact: AudienceCritiqueReport;
    try {
      artifact = await runStructuredSession<AudienceCritiqueReport>({
        client,
        title: "Corina audience critique",
        step: "audience",
        agent: "audience-critic",
        personaFile: "tasks/audience-critic.md",
        schemaFile: "AudienceCritiqueReport.json",
        taskPrompt: buildAudiencePrompt({
          text: item.text,
          sourcePath: item.sourcePath,
          audienceRequested: options.audience ?? null,
          inferredAudience: normalized.inferredAudience,
          toneOutput: item.toneOutput,
          detectionReport: item.detectionReport,
          assumptions,
        }),
        model,
        logger,
        usage,
      });
      artifact.assumptions = [...(artifact.assumptions ?? []), ...assumptions];
    } catch (error) {
      artifact = buildEmptyAudienceReport(options.audience ?? normalized.inferredAudience ?? null, [
        ...assumptions,
        `Audience critique degraded: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      artifact.status = "degraded";
    }

    const validation = validate("AudienceCritiqueReport", artifact);
    if (!validation.valid) artifact.assumptions.push(`AudienceCritiqueReport validation warning: ${validation.errors.join("; ")}`);
    return finalizeOutput(
      createCapabilityOutput({
        capability: "critique",
        mode: normalized.mode,
        inputSummary: buildInputSummary(1, normalized.mode),
        artifact,
        rendered: "",
        assumptions: artifact.assumptions,
        metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
      }),
      { ...options, __chainSourceText: item.text },
      client,
      logger,
      usage,
      startMs,
    );
  }

  if (normalized.mode === "rubric") {
    const item = normalized.items[0];
    let artifact: RubricReport;
    try {
      artifact = await runStructuredSession<RubricReport>({
        client,
        title: "Corina rubric critique",
        step: "rubric",
        agent: "rubric-critic",
        personaFile: "tasks/rubric-critic.md",
        schemaFile: "RubricReport.json",
        taskPrompt: buildRubricPrompt({
          text: item.text,
          sourcePath: item.sourcePath,
          rubric: normalized.resolvedRubric!,
          toneOutput: item.toneOutput,
          detectionReport: item.detectionReport,
          assumptions,
        }),
        model,
        logger,
        usage,
      });
      artifact.assumptions = [...(artifact.assumptions ?? []), ...assumptions];
    } catch (error) {
      artifact = buildFallbackRubricReport(normalized.resolvedRubric, assumptions, error, item.text);
    }

    const validation = validate("RubricReport", artifact);
    if (!validation.valid) artifact.assumptions.push(`RubricReport validation warning: ${validation.errors.join("; ")}`);
    return finalizeOutput(
      createCapabilityOutput({
        capability: "critique",
        mode: normalized.mode,
        inputSummary: buildInputSummary(1, normalized.mode),
        artifact,
        rendered: "",
        assumptions: artifact.assumptions,
        metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
      }),
      { ...options, __chainSourceText: item.text },
      client,
      logger,
      usage,
      startMs,
    );
  }

  const reports: Array<{
    label: string;
    score: number;
    report: CritiqueReport;
    itemId: string;
    text: string;
  }> = [];
  const skippedInputs: string[] = [];

  for (const item of normalized.items) {
    try {
      const report = await runQualityMode(item.text, item.sourcePath, item.toneOutput, item.detectionReport, assumptions, client, model, logger, usage);
      reports.push({ label: item.label, score: report.overall_score, report, itemId: item.id, text: item.text });
    } catch (error) {
      const report = buildFallbackQualityReport(item.text, assumptions, error);
      reports.push({ label: item.label, score: report.overall_score, report, itemId: item.id, text: item.text });
      skippedInputs.push(`${item.label} (live critique unavailable; used fallback)`);
    }
  }

  const artifact = aggregateComparison(reports);
  artifact.assumptions = [...artifact.assumptions, ...assumptions];
  artifact.skipped_inputs = [...artifact.skipped_inputs, ...skippedInputs];
  if (skippedInputs.length) artifact.status = "degraded";

  const validation = validate("ComparisonReport", artifact);
  if (!validation.valid) artifact.assumptions.push(`ComparisonReport validation warning: ${validation.errors.join("; ")}`);
  return finalizeOutput(
    createCapabilityOutput({
      capability: "critique",
      mode: normalized.mode,
      inputSummary: buildInputSummary(normalized.items.length, normalized.mode),
      artifact,
      rendered: "",
      assumptions: artifact.assumptions,
    }),
    options,
    client,
    logger,
    usage,
    startMs,
  );
}

export async function runCritique(inputs: string[], options: RunCritiqueOptions, client: OpenCodeClient, logger?: AgentLogger): Promise<string> {
  const output = await runCritiqueWithArtifact(inputs, options, client, logger);
  return options.format === "json" ? formatJson(output) : output.rendered;
}
