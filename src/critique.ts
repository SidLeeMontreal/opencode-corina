import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ModelResolver } from "opencode-model-resolver";
import type { ResolvedModel } from "opencode-model-resolver";

import { createCapabilityOutput } from "./capability-output.js";
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
import type {
  AgentCapabilityOutput,
  AudienceCritiqueReport,
  ComparisonReport,
  CritiqueArtifactUnion,
  CritiqueChain,
  CritiqueIssue,
  CritiqueMode,
  CritiqueRenderFormat,
  CritiqueReport,
  DetectionReport,
  OpenCodeClient,
  ResolvedRubric,
  RubricReport,
  ToneOutputArtifact,
} from "./types.js";
import { validate } from "./validators.js";

const PROMPTS_DIR = join(homedir(), ".config", "opencode", "prompts");
const SCHEMAS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const promptCache = new Map<string, string>();
const schemaCache = new Map<string, Record<string, unknown>>();
const modelResolver = new ModelResolver();

export interface RunCritiqueOptions {
  mode?: CritiqueMode;
  audience?: string;
  rubric?: string;
  chain?: CritiqueChain;
  format?: CritiqueRenderFormat;
  modelPreset?: string;
}

function loadPrompt(filename: string): string {
  const cached = promptCache.get(filename);
  if (cached) return cached;
  const content = readFileSync(join(PROMPTS_DIR, filename), "utf8").trim();
  promptCache.set(filename, content);
  return content;
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
  agent: string;
  personaFile: string;
  schemaFile: string;
  taskPrompt: string;
  model?: ResolvedModel;
}): Promise<T> {
  const sessionResponse = await input.client.session.create({ body: { title: input.title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  try {
    await promptSession(
      input.client,
      session.id,
      {
        agent: input.agent,
        noReply: true,
        parts: [{ type: "text", text: loadPrompt(input.personaFile) }],
      },
      input.model,
    );

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

    return parseStructuredOutput<T>(result);
  } finally {
    await deleteSession(input.client, session.id);
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
      corina_tone: emptyDimension,
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
  const dimensionKeys = ["ai_patterns", "corina_tone", "precision", "evidence", "rhythm"] as const;
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

function applyChain(rendered: string, chain: CritiqueChain | undefined): { rendered: string; chainedTo?: string; extraAssumption?: string } {
  if (!chain) return { rendered };
  return {
    rendered: `${rendered}\n\nChain requested: ${chain} (not yet executed by /corina-critique).`,
    chainedTo: chain,
    extraAssumption: `Chain target '${chain}' was recorded but not executed by this capability yet.`,
  };
}

async function runQualityMode(text: string, sourcePath: string | null, toneOutput: ToneOutputArtifact | undefined, detectionReport: DetectionReport | undefined, assumptions: string[], client: OpenCodeClient, model?: ResolvedModel): Promise<CritiqueReport> {
  const report = await runStructuredSession<CritiqueReport>({
    client,
    title: "Corina critique",
    agent: "corina-critic",
    personaFile: "corina-critic.txt",
    schemaFile: "CritiqueReport.json",
    taskPrompt: buildQualityPrompt({ text, sourcePath, toneOutput, detectionReport, assumptions }),
    model,
  });

  return enrichQualityReport(report, assumptions);
}

export async function runCritiqueWithArtifact(
  inputs: string[],
  options: RunCritiqueOptions,
  client: OpenCodeClient,
): Promise<AgentCapabilityOutput<CritiqueArtifactUnion>> {
  const normalized = await normalizeCritiqueInputs(inputs, options);
  const assumptions = [...normalized.assumptions, ...normalized.warnings];
  const model = await resolveModel(options.modelPreset);

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
    const chainInfo = applyChain(renderOutput(provisional as AgentCapabilityOutput<CritiqueArtifactUnion>, options.format), options.chain);
    return {
      ...provisional,
      rendered: chainInfo.rendered,
      ...(chainInfo.chainedTo ? { chained_to: chainInfo.chainedTo } : {}),
      assumptions: chainInfo.extraAssumption ? [...assumptions, chainInfo.extraAssumption] : assumptions,
    };
  }

  if (normalized.mode === "quality") {
    let artifact: CritiqueReport;
    try {
      const item = normalized.items[0];
      artifact = await runQualityMode(item.text, item.sourcePath, item.toneOutput, item.detectionReport, assumptions, client, model);
    } catch (error) {
      artifact = buildEmptyCritiqueReport(`Quality critique degraded: ${error instanceof Error ? error.message : String(error)}`, assumptions);
      artifact.status = "degraded";
    }

    const validation = validate("CritiqueReport", artifact);
    if (!validation.valid) artifact.assumptions.push(`CritiqueReport validation warning: ${validation.errors.join("; ")}`);
    const baseOutput = createCapabilityOutput({
      capability: "critique",
      mode: normalized.mode,
      inputSummary: buildInputSummary(1, normalized.mode),
      artifact,
      rendered: "",
      assumptions: artifact.assumptions,
    });
    const rendered = renderOutput(baseOutput, options.format);
    const chainInfo = applyChain(rendered, options.chain);
    return {
      ...baseOutput,
      rendered: chainInfo.rendered,
      ...(chainInfo.chainedTo ? { chained_to: chainInfo.chainedTo } : {}),
      assumptions: chainInfo.extraAssumption ? [...artifact.assumptions, chainInfo.extraAssumption] : artifact.assumptions,
    };
  }

  if (normalized.mode === "audience") {
    const item = normalized.items[0];
    let artifact: AudienceCritiqueReport;
    try {
      artifact = await runStructuredSession<AudienceCritiqueReport>({
        client,
        title: "Corina audience critique",
        agent: "corina-audience-critic",
        personaFile: "corina-audience-critic.txt",
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
    const baseOutput = createCapabilityOutput({
      capability: "critique",
      mode: normalized.mode,
      inputSummary: buildInputSummary(1, normalized.mode),
      artifact,
      rendered: "",
      assumptions: artifact.assumptions,
    });
    const rendered = renderOutput(baseOutput, options.format);
    const chainInfo = applyChain(rendered, options.chain);
    return {
      ...baseOutput,
      rendered: chainInfo.rendered,
      ...(chainInfo.chainedTo ? { chained_to: chainInfo.chainedTo } : {}),
      assumptions: chainInfo.extraAssumption ? [...artifact.assumptions, chainInfo.extraAssumption] : artifact.assumptions,
    };
  }

  if (normalized.mode === "rubric") {
    const item = normalized.items[0];
    let artifact: RubricReport;
    try {
      artifact = await runStructuredSession<RubricReport>({
        client,
        title: "Corina rubric critique",
        agent: "corina-rubric-critic",
        personaFile: "corina-rubric-critic.txt",
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
      });
      artifact.assumptions = [...(artifact.assumptions ?? []), ...assumptions];
    } catch (error) {
      artifact = buildEmptyRubricReport(normalized.resolvedRubric, [
        ...assumptions,
        `Rubric critique degraded: ${error instanceof Error ? error.message : String(error)}`,
      ]);
      artifact.status = "degraded";
    }

    const validation = validate("RubricReport", artifact);
    if (!validation.valid) artifact.assumptions.push(`RubricReport validation warning: ${validation.errors.join("; ")}`);
    const baseOutput = createCapabilityOutput({
      capability: "critique",
      mode: normalized.mode,
      inputSummary: buildInputSummary(1, normalized.mode),
      artifact,
      rendered: "",
      assumptions: artifact.assumptions,
    });
    const rendered = renderOutput(baseOutput, options.format);
    const chainInfo = applyChain(rendered, options.chain);
    return {
      ...baseOutput,
      rendered: chainInfo.rendered,
      ...(chainInfo.chainedTo ? { chained_to: chainInfo.chainedTo } : {}),
      assumptions: chainInfo.extraAssumption ? [...artifact.assumptions, chainInfo.extraAssumption] : artifact.assumptions,
    };
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
      const report = await runQualityMode(item.text, item.sourcePath, item.toneOutput, item.detectionReport, assumptions, client, model);
      reports.push({ label: item.label, score: report.overall_score, report, itemId: item.id, text: item.text });
    } catch {
      skippedInputs.push(item.label);
    }
  }

  const artifact = aggregateComparison(reports);
  artifact.assumptions = [...artifact.assumptions, ...assumptions];
  artifact.skipped_inputs = [...artifact.skipped_inputs, ...skippedInputs];
  if (skippedInputs.length) artifact.status = "degraded";

  const validation = validate("ComparisonReport", artifact);
  if (!validation.valid) artifact.assumptions.push(`ComparisonReport validation warning: ${validation.errors.join("; ")}`);
  const baseOutput = createCapabilityOutput({
    capability: "critique",
    mode: normalized.mode,
    inputSummary: buildInputSummary(normalized.items.length, normalized.mode),
    artifact,
    rendered: "",
    assumptions: artifact.assumptions,
  });
  const rendered = renderOutput(baseOutput, options.format);
  const chainInfo = applyChain(rendered, options.chain);
  return {
    ...baseOutput,
    rendered: chainInfo.rendered,
    ...(chainInfo.chainedTo ? { chained_to: chainInfo.chainedTo } : {}),
    assumptions: chainInfo.extraAssumption ? [...artifact.assumptions, chainInfo.extraAssumption] : artifact.assumptions,
  };
}

export async function runCritique(inputs: string[], options: RunCritiqueOptions, client: OpenCodeClient): Promise<string> {
  const output = await runCritiqueWithArtifact(inputs, options, client);
  return options.format === "json" ? formatJson(output) : output.rendered;
}
