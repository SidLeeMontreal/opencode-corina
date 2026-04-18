import { createCapabilityOutput, createToolEnvelope, createToolEnvelopeFromCapabilityOutput } from "./capability-output.js";
import { writeCapabilityAudit } from "./audit-log.js";
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
import type {
  AgentCapabilityOutput,
  ConciseArtifact,
  CorinaToolEnvelope,
  HeatMapEntry,
  OpenCodeClient,
  ParagraphFunctionEntry,
  PreservationCheck,
  ReconciliationEntry,
  RevisionLogEntry,
} from "./types.js";
import { validate } from "./validators.js";

export interface ConciseArgs {
  text: string;
  mode?: "quick" | "full" | "auto";
  target_words?: number;
  format?: "json" | "text";
}

interface ParagraphUnit {
  id: string;
  text: string;
}

interface ConciseAuditRow {
  id: string;
  paragraph: string;
  excerpt: string;
  tags: string[];
  severity: "Minor" | "Moderate" | "Major";
  scope: "Local" | "Bridge" | "Global";
  note: string;
}

interface ConciseAuditPayload {
  document_overview?: {
    assessment?: string;
    primary_global_risks?: string[];
    recommended_intensity?: "light" | "moderate" | "heavy";
  };
  paragraph_function_map?: Array<ParagraphFunctionEntry & { notes?: string }>;
  audit_rows?: ConciseAuditRow[];
  revision_sequence?: Array<{ paragraph: string; reason: string }>;
  heat_map?: HeatMapEntry[];
  revision_routing_summary?: {
    local_revision_candidates?: string[];
    bridge_aware_revision_candidates?: string[];
    global_reconciliation_issues?: string[];
  };
  unresolved_issues?: string[];
}

interface ConciseRevisionPayload {
  mode?: "quick" | "full";
  revised_text?: string;
  revised_paragraph?: string;
  optional_bridge_edits?: {
    previous_paragraph?: string | null;
    next_paragraph?: string | null;
  };
  revision_log?: RevisionLogEntry[];
  preservation_check?: PreservationCheck;
  unresolved_issues?: string[];
}

interface ConciseStitchPayload {
  stitched_draft?: string;
  stitch_log?: ReconciliationEntry[];
  unresolved_issues?: string[];
}

interface ConciseReconciliationPayload {
  reconciled_draft?: string;
  reconciliation_log?: ReconciliationEntry[];
  preserved?: string[];
  restored?: string[];
  remaining_acceptable_tradeoffs?: string[];
  final_integrity_assessment?: string;
}

const DEFAULT_PRESERVATION_CHECK: PreservationCheck = {
  facts: true,
  nuance: true,
  argument_function: true,
  evidence: true,
  tone_voice: true,
  chronology: true,
};

const DELIMITERS = {
  audit: ["<concise_audit>", "</concise_audit>"],
  revision: ["<concise_revision>", "</concise_revision>"],
  stitch: ["<concise_stitch>", "</concise_stitch>"],
  reconciliation: ["<concise_reconciliation>", "</concise_reconciliation>"],
} as const;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0;
}

export function detectMode(text: string, requested?: string): "quick" | "full" {
  if (requested === "quick" || requested === "full") {
    return requested;
  }

  return countWords(text) <= 500 ? "quick" : "full";
}

export function splitParagraphs(text: string): ParagraphUnit[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph, index) => ({ id: `P${index + 1}`, text: paragraph }));
}

function extractText(parts: unknown): string {
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

function unwrapData<T>(response: unknown): T {
  if (typeof response === "object" && response !== null && "data" in response) {
    return (response as { data: T }).data;
  }

  return response as T;
}

export function normalizeHeatMap(entries: unknown): HeatMapEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry): HeatMapEntry => ({
      tag: typeof entry["tag"] === "string" ? entry["tag"] : "UNKNOWN",
      severity:
        entry["severity"] === "Major" || entry["severity"] === "Moderate" || entry["severity"] === "Minor"
          ? entry["severity"]
          : "Minor",
      count:
        typeof entry["count"] === "number" && Number.isFinite(entry["count"])
          ? Math.max(0, Math.round(entry["count"]))
          : 0,
    }))
    .filter((entry) => entry.count > 0 || entry.tag !== "UNKNOWN");
}

export function normalizeRevisionLog(entries: unknown): RevisionLogEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry, index): RevisionLogEntry => ({
      id: typeof entry["id"] === "string" && entry["id"] ? entry["id"] : `R${index + 1}`,
      original_excerpt: typeof entry["original_excerpt"] === "string" ? entry["original_excerpt"] : "",
      tags: Array.isArray(entry["tags"]) ? entry["tags"].filter((tag): tag is string => typeof tag === "string") : [],
      solution_move:
        typeof entry["solution_move"] === "string" && entry["solution_move"] ? entry["solution_move"] : "Preserve the grain",
      new_text: typeof entry["new_text"] === "string" ? entry["new_text"] : "",
      scope:
        entry["scope"] === "Previous bridge" || entry["scope"] === "Next bridge" || entry["scope"] === "Target"
          ? entry["scope"]
          : "Target",
    }));
}

export function normalizePreservationCheck(value: unknown, note?: string): PreservationCheck {
  if (!value || typeof value !== "object") {
    return note ? { ...DEFAULT_PRESERVATION_CHECK, notes: note } : { ...DEFAULT_PRESERVATION_CHECK };
  }

  const payload = value as Record<string, unknown>;
  return {
    facts: payload["facts"] !== false,
    nuance: payload["nuance"] !== false,
    argument_function: payload["argument_function"] !== false,
    evidence: payload["evidence"] !== false,
    tone_voice: payload["tone_voice"] !== false,
    chronology: payload["chronology"] !== false,
    ...(typeof payload["notes"] === "string" && payload["notes"]
      ? { notes: payload["notes"] }
      : note
        ? { notes: note }
        : {}),
  };
}

export function normalizeParagraphFunctionMap(entries: unknown, paragraphs: ParagraphUnit[]): ParagraphFunctionEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) {
    return paragraphs.map((paragraph) => ({
      paragraph: paragraph.id,
      function: paragraph.id === "P1" ? "opening" : paragraph.id === `P${paragraphs.length}` ? "conclusion" : "body",
      compression_priority: "Low",
      revision_risk: "Medium risk",
      preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
    }));
  }

  return entries
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry, index): ParagraphFunctionEntry => ({
      paragraph: typeof entry["paragraph"] === "string" && entry["paragraph"] ? entry["paragraph"] : `P${index + 1}`,
      function: typeof entry["function"] === "string" && entry["function"] ? entry["function"] : "body",
      compression_priority:
        entry["compression_priority"] === "High" ||
        entry["compression_priority"] === "Medium" ||
        entry["compression_priority"] === "Low" ||
        entry["compression_priority"] === "None"
          ? entry["compression_priority"]
          : "Low",
      revision_risk:
        entry["revision_risk"] === "Low risk" ||
        entry["revision_risk"] === "Medium risk" ||
        entry["revision_risk"] === "High risk"
          ? entry["revision_risk"]
          : "Medium risk",
      preservation_constraints:
        typeof entry["preservation_constraints"] === "string" && entry["preservation_constraints"]
          ? entry["preservation_constraints"]
          : "Preserve key meaning and continuity.",
    }));
}

export function normalizeReconciliationLog(entries: unknown): ReconciliationEntry[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries
    .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
    .map((entry, index): ReconciliationEntry => ({
      id: typeof entry["id"] === "string" && entry["id"] ? entry["id"] : `RC${index + 1}`,
      location: typeof entry["location"] === "string" && entry["location"] ? entry["location"] : "document",
      issue_type: typeof entry["issue_type"] === "string" && entry["issue_type"] ? entry["issue_type"] : "Repair",
      what_changed:
        typeof entry["what_changed"] === "string" ? entry["what_changed"] : "No substantive change recorded.",
      reason:
        typeof entry["reason"] === "string" && entry["reason"]
          ? entry["reason"]
          : "Required to preserve continuity or substance.",
    }));
}

export function buildHeatMapFromAuditRows(rows: ConciseAuditRow[]): HeatMapEntry[] {
  const map = new Map<string, number>();

  for (const row of rows) {
    for (const tag of row.tags) {
      const key = `${tag}::${row.severity}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  return [...map.entries()].map(([key, count]) => {
    const [tag, severity] = key.split("::");
    return {
      tag,
      severity: (severity as HeatMapEntry["severity"]) ?? "Minor",
      count,
    };
  });
}

export function summarizeHeatMap(heatMap: HeatMapEntry[]): string {
  if (!heatMap.length) {
    return "none";
  }

  return heatMap.map((entry) => `${entry.tag} ${entry.severity}:${entry.count}`).join(", ");
}

export function buildRendered(mode: "quick" | "full", draft: string, originalWordCount: number, revisedWordCount: number, heatMap: HeatMapEntry[]): string {
  const ratio = originalWordCount > 0 ? revisedWordCount / originalWordCount : 1;
  const reductionPercent = Math.round((1 - ratio) * 100);
  const reductionLabel = reductionPercent >= 0 ? `-${reductionPercent}%` : `+${Math.abs(reductionPercent)}%`;

  return [
    `## Concise Draft (mode: ${mode}, ${reductionLabel} words)`,
    "",
    draft,
    "",
    "---",
    `Heat Map: ${summarizeHeatMap(heatMap)}`,
    `Compression: ${originalWordCount} → ${revisedWordCount} words (${Math.round((revisedWordCount / Math.max(originalWordCount || 1, 1)) * 100)}%)`,
  ].join("\n");
}

function defaultParagraphFunctionMap(text: string): ParagraphFunctionEntry[] {
  return normalizeParagraphFunctionMap([], splitParagraphs(text));
}

export function buildFallbackArtifact(
  text: string,
  mode: "quick" | "full",
  note: string,
  options?: Partial<Pick<ConciseArtifact, "heat_map" | "revision_log" | "paragraph_function_map" | "reconciliation_log">>,
): ConciseArtifact {
  const originalWordCount = countWords(text);
  const revisedDraft = text.trim();
  const revisedWordCount = countWords(revisedDraft);

  return {
    mode,
    original_word_count: originalWordCount,
    revised_word_count: revisedWordCount,
    compression_ratio: originalWordCount > 0 ? revisedWordCount / originalWordCount : 1,
    revised_draft: revisedDraft,
    heat_map: options?.heat_map ?? [],
    revision_log: options?.revision_log ?? [],
    preservation_check: normalizePreservationCheck(undefined, note),
    unresolved_issues: note ? [note] : [],
    ...(mode === "full"
      ? {
          paragraph_function_map: options?.paragraph_function_map ?? defaultParagraphFunctionMap(text),
          reconciliation_log: options?.reconciliation_log ?? [],
        }
      : {}),
  };
}

export function extractDelimitedJson<T>(text: string, startTag: string, endTag: string): T {
  const start = text.indexOf(startTag);
  const end = text.lastIndexOf(endTag);

  const candidate = start >= 0 && end > start ? text.slice(start + startTag.length, end).trim() : text.trim();
  if (!candidate) {
    throw new Error(`Missing delimited JSON payload for ${startTag}`);
  }

  return JSON.parse(candidate) as T;
}

function getResponseText(result: unknown): string {
  const data = unwrapData<any>(result);
  return extractText(data?.parts);
}

async function promptSession(client: OpenCodeClient, sessionId: string, body: Record<string, unknown>): Promise<unknown> {
  const sessionClient = client.session as unknown as {
    prompt: (options: Record<string, unknown>) => Promise<unknown>;
  };

  try {
    return await sessionClient.prompt({ path: { id: sessionId }, body });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("sessionID") && !message.includes("id")) {
      throw error;
    }

    return sessionClient.prompt({ path: { sessionID: sessionId }, body });
  }
}

async function deleteSession(client: OpenCodeClient, sessionId: string): Promise<void> {
  const sessionClient = client.session as unknown as {
    delete: (options: Record<string, unknown>) => Promise<unknown>;
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

async function runDelimitedAgent<T>(input: {
  client: OpenCodeClient;
  title: string;
  step: string;
  agent: string;
  promptFile: string;
  taskPrompt: string;
  delimiter: readonly [string, string];
  logger: AgentLogger;
  usage: UsageAccumulator;
}): Promise<T> {
  const sessionResponse = await input.client.session.create({ body: { title: input.title } });
  const session = unwrapData<{ id: string }>(sessionResponse);

  input.logger.debug("session_created", {
    capability: "concise",
    step: input.step,
    session_id: session.id,
    agent: input.agent,
  });

  try {
    const primerStartMs = Date.now();
    const primerResult = await promptSession(input.client, session.id, {
      agent: input.agent,
      noReply: true,
      parts: [{ type: "text", text: loadPrompt(input.promptFile) }],
    });
    const primerMetrics = extractLlmMetrics(primerResult, `${input.step}_setup`, primerStartMs);
    addLlmMetrics(input.usage, primerMetrics);
    input.logger.info("llm_call", { capability: "concise", ...primerMetrics });

    const resultStartMs = Date.now();
    const result = await promptSession(input.client, session.id, {
      agent: input.agent,
      parts: [{ type: "text", text: input.taskPrompt }],
    });
    const resultMetrics = extractLlmMetrics(result, input.step, resultStartMs);
    addLlmMetrics(input.usage, resultMetrics);
    input.logger.info("llm_call", { capability: "concise", ...resultMetrics });

    return extractDelimitedJson<T>(getResponseText(result), input.delimiter[0], input.delimiter[1]);
  } catch (error) {
    input.logger.error("step_error", {
      capability: "concise",
      step: input.step,
      session_id: session.id,
      degraded: true,
      ...errorDetails(error),
    });
    throw error;
  } finally {
    try {
      await deleteSession(input.client, session.id);
      input.logger.debug("session_deleted", {
        capability: "concise",
        step: input.step,
        session_id: session.id,
      });
    } catch (error) {
      input.logger.warn("session_delete_failed", {
        capability: "concise",
        step: input.step,
        session_id: session.id,
        degraded: true,
        ...errorDetails(error),
      });
    }
  }
}

function buildQuickAuditPrompt(text: string, targetWords?: number): string {
  return [
    "QUICK MODE",
    "Audit this short text for safe concision opportunities.",
    "Do not rewrite it. Return only the required delimited JSON package.",
    targetWords ? `Optional target_words: ${targetWords}` : "Optional target_words: none",
    "",
    "TEXT:",
    text,
  ].join("\n");
}

function buildQuickRevisionPrompt(text: string, audit: ConciseAuditPayload, targetWords?: number): string {
  return [
    "QUICK MODE",
    "Revise the full text in one pass using the audit guidance below.",
    "If there is no safe gain, preserve the text and explain why.",
    targetWords ? `Optional target_words: ${targetWords}` : "Optional target_words: none",
    "",
    "=== ORIGINAL TEXT ===",
    text,
    "",
    "=== CONCISE AUDIT PACKAGE ===",
    JSON.stringify(audit, null, 2),
  ].join("\n");
}

function buildFullAuditPrompt(text: string, targetWords?: number): string {
  return [
    "FULL MODE",
    "Audit this long-form text for safe paragraph-window concision.",
    "Do not rewrite it. Return only the required delimited JSON package.",
    targetWords ? `Optional target_words: ${targetWords}` : "Optional target_words: none",
    "",
    "TEXT:",
    text,
  ].join("\n");
}

function buildParagraphRevisionPrompt(args: {
  originalText: string;
  workingDraft: string;
  target: ParagraphUnit;
  previous: ParagraphUnit | null;
  next: ParagraphUnit | null;
  auditRows: ConciseAuditRow[];
  paragraphMapEntry?: ParagraphFunctionEntry;
  mode: "quick" | "full";
  targetWords?: number;
}): string {
  return [
    `${args.mode.toUpperCase()} MODE`,
    args.mode === "full"
      ? "Revise only the target paragraph using the sliding window context below."
      : "Revise the full text using the audit guidance below.",
    args.targetWords ? `Optional target_words: ${args.targetWords}` : "Optional target_words: none",
    "",
    "=== ORIGINAL FULL TEXT ===",
    args.originalText,
    "",
    "=== CURRENT WORKING DRAFT ===",
    args.workingDraft,
    "",
    "=== TARGET PARAGRAPH ID ===",
    args.target.id,
    "",
    "=== PREVIOUS PARAGRAPH ===",
    args.previous?.text ?? "[NONE]",
    "",
    "=== TARGET PARAGRAPH ===",
    args.target.text,
    "",
    "=== NEXT PARAGRAPH ===",
    args.next?.text ?? "[NONE]",
    "",
    "=== RELEVANT AUDIT ROWS ===",
    JSON.stringify(args.auditRows, null, 2),
    "",
    "=== PARAGRAPH FUNCTION ===",
    args.paragraphMapEntry?.function ?? "body",
    "",
    "=== COMPRESSION PRIORITY ===",
    args.paragraphMapEntry?.compression_priority ?? "Low",
    "",
    "=== REVISION RISK ===",
    args.paragraphMapEntry?.revision_risk ?? "Medium risk",
    "",
    "=== PRESERVATION CONSTRAINTS ===",
    args.paragraphMapEntry?.preservation_constraints ?? "Preserve key meaning, continuity, names, numbers, chronology, and tone.",
  ].join("\n");
}

function buildStitchPrompt(originalText: string, revisedDraft: string, audit: ConciseAuditPayload, unresolvedIssues: string[]): string {
  return [
    "FULL MODE — STITCH PASS",
    "Repair only seams between local revisions. Do not re-compress the document.",
    "",
    "=== ORIGINAL FULL TEXT ===",
    originalText,
    "",
    "=== CURRENT REVISED FULL DRAFT ===",
    revisedDraft,
    "",
    "=== DOCUMENT AUDIT SUMMARY ===",
    JSON.stringify(audit, null, 2),
    "",
    "=== UNRESOLVED ISSUES FROM LOCAL PASSES ===",
    unresolvedIssues.length ? JSON.stringify(unresolvedIssues, null, 2) : "[NONE]",
  ].join("\n");
}

function buildReconciliationPrompt(originalText: string, stitchedDraft: string, audit: ConciseAuditPayload, unresolvedIssues: string[]): string {
  return [
    "FULL MODE — RECONCILIATION PASS",
    "Make only surgical repairs needed to preserve substance and coherence.",
    "",
    "=== ORIGINAL FULL TEXT ===",
    originalText,
    "",
    "=== REVISED FULL DRAFT ===",
    stitchedDraft,
    "",
    "=== DOCUMENT AUDIT SUMMARY ===",
    JSON.stringify(audit, null, 2),
    "",
    "=== UNRESOLVED ISSUES FROM LOCAL PASSES ===",
    unresolvedIssues.length ? JSON.stringify(unresolvedIssues, null, 2) : "[NONE]",
    "",
    "=== PRESERVATION PRIORITIES ===",
    JSON.stringify(
      audit.paragraph_function_map?.map((entry) => `${entry.paragraph}: ${entry.preservation_constraints}`) ?? [],
      null,
      2,
    ),
  ].join("\n");
}

export function replaceParagraphById(text: string, paragraphId: string, newParagraph: string): string {
  const paragraphs = splitParagraphs(text);
  if (!paragraphs.length) {
    return newParagraph.trim();
  }

  const updated = paragraphs.map((paragraph) => (paragraph.id === paragraphId ? newParagraph.trim() : paragraph.text.trim()));
  return updated.join("\n\n");
}

async function runQuickMode(
  args: ConciseArgs,
  client: OpenCodeClient,
  logger: AgentLogger,
  startMs: number,
  usage: UsageAccumulator,
): Promise<AgentCapabilityOutput<ConciseArtifact>> {
  const originalText = args.text.trim();

  if (!originalText) {
    const artifact = buildFallbackArtifact("", "quick", "Input was empty. Returned a valid concise artifact without edits.");
    return finalizeOutput(artifact, usage, logger, startMs);
  }

  let audit: ConciseAuditPayload = {};
  try {
    audit = await runDelimitedAgent<ConciseAuditPayload>({
      client,
      title: "Corina concise audit",
      step: "concise_audit",
      agent: "concise-auditor",
      promptFile: "tasks/concise-auditor.md",
      taskPrompt: buildQuickAuditPrompt(originalText, args.target_words),
      delimiter: DELIMITERS.audit,
      logger,
      usage,
    });
  } catch (error) {
    logger.warn("pass_degraded", {
      capability: "concise",
      mode: "quick",
      pass: "audit",
      ...errorDetails(error),
    });
  }

  let revision: ConciseRevisionPayload = {};
  try {
    revision = await runDelimitedAgent<ConciseRevisionPayload>({
      client,
      title: "Corina concise revise",
      step: "concise_revision",
      agent: "concise-reviser",
      promptFile: "tasks/concise-reviser.md",
      taskPrompt: buildQuickRevisionPrompt(originalText, audit, args.target_words),
      delimiter: DELIMITERS.revision,
      logger,
      usage,
    });
  } catch (error) {
    logger.warn("pass_degraded", {
      capability: "concise",
      mode: "quick",
      pass: "revision",
      ...errorDetails(error),
    });
  }

  const revisedDraft = revision.revised_text?.trim() || originalText;
  const heatMap = normalizeHeatMap(audit.heat_map) || buildHeatMapFromAuditRows(audit.audit_rows ?? []);
  const artifact: ConciseArtifact = {
    mode: "quick",
    original_word_count: countWords(originalText),
    revised_word_count: countWords(revisedDraft),
    compression_ratio: countWords(originalText) > 0 ? countWords(revisedDraft) / countWords(originalText) : 1,
    revised_draft: revisedDraft,
    heat_map: heatMap.length ? heatMap : buildHeatMapFromAuditRows(audit.audit_rows ?? []),
    revision_log: normalizeRevisionLog(revision.revision_log),
    preservation_check: normalizePreservationCheck(
      revision.preservation_check,
      revisedDraft === originalText
        ? "No safe compression gain was found, so the original wording was preserved or minimally touched."
        : undefined,
    ),
    unresolved_issues: [
      ...(audit.unresolved_issues ?? []),
      ...(revision.unresolved_issues ?? []),
      ...(revisedDraft === originalText ? ["Quick mode preserved most or all original phrasing because safe gains were limited."] : []),
    ].filter((value, index, array) => Boolean(value) && array.indexOf(value) === index),
  };

  return finalizeOutput(artifact, usage, logger, startMs);
}

export function sortRevisionTargets(paragraphMap: ParagraphFunctionEntry[]): ParagraphFunctionEntry[] {
  const priorityRank: Record<ParagraphFunctionEntry["compression_priority"], number> = {
    High: 0,
    Medium: 1,
    Low: 2,
    None: 3,
  };

  return [...paragraphMap].sort((left, right) => priorityRank[left.compression_priority] - priorityRank[right.compression_priority]);
}

async function runFullMode(
  args: ConciseArgs,
  client: OpenCodeClient,
  logger: AgentLogger,
  startMs: number,
  usage: UsageAccumulator,
): Promise<AgentCapabilityOutput<ConciseArtifact>> {
  const originalText = args.text.trim();
  if (!originalText) {
    const artifact = buildFallbackArtifact("", "full", "Input was empty. Returned a valid concise artifact without edits.");
    return finalizeOutput(artifact, usage, logger, startMs);
  }

  let audit: ConciseAuditPayload = {};
  try {
    audit = await runDelimitedAgent<ConciseAuditPayload>({
      client,
      title: "Corina concise orchestration",
      step: "concise_audit",
      agent: "concise-auditor",
      promptFile: "tasks/concise-auditor.md",
      taskPrompt: buildFullAuditPrompt(originalText, args.target_words),
      delimiter: DELIMITERS.audit,
      logger,
      usage,
    });
  } catch (error) {
    logger.warn("pass_degraded", {
      capability: "concise",
      mode: "full",
      pass: "audit",
      ...errorDetails(error),
    });
  }

  const paragraphMap = normalizeParagraphFunctionMap(audit.paragraph_function_map, splitParagraphs(originalText));
  let workingDraft = originalText;
  const revisionLog: RevisionLogEntry[] = [];
  const unresolvedIssues = [...(audit.unresolved_issues ?? [])];
  let preservationCheck = { ...DEFAULT_PRESERVATION_CHECK };

  for (const entry of sortRevisionTargets(paragraphMap)) {
    if (entry.compression_priority !== "High" && entry.compression_priority !== "Medium") {
      continue;
    }

    const draftParagraphs = splitParagraphs(workingDraft);
    const targetIndex = draftParagraphs.findIndex((paragraph) => paragraph.id === entry.paragraph);
    if (targetIndex === -1) {
      unresolvedIssues.push(`Target paragraph ${entry.paragraph} was unavailable in the working draft.`);
      continue;
    }

    const target = draftParagraphs[targetIndex]!;
    const previous = targetIndex > 0 ? draftParagraphs[targetIndex - 1] ?? null : null;
    const next = targetIndex < draftParagraphs.length - 1 ? draftParagraphs[targetIndex + 1] ?? null : null;
    const relevantAuditRows = (audit.audit_rows ?? []).filter(
      (row) => row.paragraph === entry.paragraph || row.scope === "Bridge" || row.id.startsWith(entry.paragraph),
    );

    try {
      const revision = await runDelimitedAgent<ConciseRevisionPayload>({
        client,
        title: `Corina concise revise ${entry.paragraph}`,
        step: `concise_revision_${entry.paragraph}`,
        agent: "concise-reviser",
        promptFile: "tasks/concise-reviser.md",
        taskPrompt: buildParagraphRevisionPrompt({
          originalText,
          workingDraft,
          target,
          previous,
          next,
          auditRows: relevantAuditRows,
          paragraphMapEntry: entry,
          mode: "full",
          targetWords: args.target_words,
        }),
        delimiter: DELIMITERS.revision,
        logger,
        usage,
      });

      const revisedParagraph = revision.revised_paragraph?.trim();
      if (revisedParagraph) {
        workingDraft = replaceParagraphById(workingDraft, entry.paragraph, revisedParagraph);
      }

      const bridgeEdits = revision.optional_bridge_edits;
      if (bridgeEdits?.previous_paragraph && previous) {
        workingDraft = replaceParagraphById(workingDraft, previous.id, bridgeEdits.previous_paragraph.trim());
      }
      if (bridgeEdits?.next_paragraph && next) {
        workingDraft = replaceParagraphById(workingDraft, next.id, bridgeEdits.next_paragraph.trim());
      }

      revisionLog.push(...normalizeRevisionLog(revision.revision_log));
      preservationCheck = normalizePreservationCheck(revision.preservation_check, preservationCheck.notes);
      unresolvedIssues.push(...(revision.unresolved_issues ?? []));
    } catch (error) {
      logger.warn("pass_degraded", {
        capability: "concise",
        mode: "full",
        pass: `revision_${entry.paragraph}`,
        ...errorDetails(error),
      });
      unresolvedIssues.push(`Revision pass degraded for ${entry.paragraph}; preserved prior working draft.`);
    }
  }

  let stitchedDraft = workingDraft;
  let stitchLog: ReconciliationEntry[] = [];
  try {
    const stitch = await runDelimitedAgent<ConciseStitchPayload>({
      client,
      title: "Corina concise stitch",
      step: "concise_stitch",
      agent: "concise-stitcher",
      promptFile: "tasks/concise-stitcher.md",
      taskPrompt: buildStitchPrompt(originalText, workingDraft, audit, unresolvedIssues),
      delimiter: DELIMITERS.stitch,
      logger,
      usage,
    });
    stitchedDraft = stitch.stitched_draft?.trim() || workingDraft;
    stitchLog = normalizeReconciliationLog(stitch.stitch_log);
    unresolvedIssues.push(...(stitch.unresolved_issues ?? []));
  } catch (error) {
    logger.warn("pass_degraded", {
      capability: "concise",
      mode: "full",
      pass: "stitch",
      ...errorDetails(error),
    });
    unresolvedIssues.push("Stitch pass degraded; kept the last good working draft.");
  }

  let reconciledDraft = stitchedDraft;
  let reconciliationLog: ReconciliationEntry[] = [...stitchLog];
  try {
    const reconciliation = await runDelimitedAgent<ConciseReconciliationPayload>({
      client,
      title: "Corina concise reconciliation",
      step: "concise_reconciliation",
      agent: "concise-reconciler",
      promptFile: "tasks/concise-reconciler.md",
      taskPrompt: buildReconciliationPrompt(originalText, stitchedDraft, audit, unresolvedIssues),
      delimiter: DELIMITERS.reconciliation,
      logger,
      usage,
    });
    reconciledDraft = reconciliation.reconciled_draft?.trim() || stitchedDraft;
    reconciliationLog = [...stitchLog, ...normalizeReconciliationLog(reconciliation.reconciliation_log)];
    const integrityNote = [
      reconciliation.final_integrity_assessment,
      (reconciliation.restored ?? []).length ? `Restored: ${(reconciliation.restored ?? []).join(", ")}` : "",
      (reconciliation.remaining_acceptable_tradeoffs ?? []).length
        ? `Tradeoffs: ${(reconciliation.remaining_acceptable_tradeoffs ?? []).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    preservationCheck = normalizePreservationCheck(preservationCheck, integrityNote || preservationCheck.notes);
  } catch (error) {
    logger.warn("pass_degraded", {
      capability: "concise",
      mode: "full",
      pass: "reconciliation",
      ...errorDetails(error),
    });
    unresolvedIssues.push("Reconciliation pass degraded; kept the stitched draft.");
  }

  const heatMap = normalizeHeatMap(audit.heat_map);
  const artifact: ConciseArtifact = {
    mode: "full",
    original_word_count: countWords(originalText),
    revised_word_count: countWords(reconciledDraft),
    compression_ratio: countWords(originalText) > 0 ? countWords(reconciledDraft) / countWords(originalText) : 1,
    revised_draft: reconciledDraft,
    heat_map: heatMap.length ? heatMap : buildHeatMapFromAuditRows(audit.audit_rows ?? []),
    revision_log: revisionLog,
    preservation_check: preservationCheck,
    unresolved_issues: unresolvedIssues.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index),
    reconciliation_log: reconciliationLog,
    paragraph_function_map: paragraphMap,
  };

  return finalizeOutput(artifact, usage, logger, startMs);
}

function finalizeOutput(
  artifact: ConciseArtifact,
  usage: UsageAccumulator,
  logger: AgentLogger,
  startMs: number,
): AgentCapabilityOutput<ConciseArtifact> {
  const validation = validate("ConciseArtifact", artifact);
  if (!validation.valid) {
    artifact.unresolved_issues = [
      ...artifact.unresolved_issues,
      `ConciseArtifact validation warning: ${validation.errors.join("; ")}`,
    ];
  }

  const rendered = buildRendered(
    artifact.mode,
    artifact.revised_draft,
    artifact.original_word_count,
    artifact.revised_word_count,
    artifact.heat_map,
  );

  logger.info("capability_complete", {
    capability: "concise",
    mode: artifact.mode,
    duration_ms: Date.now() - startMs,
    word_count: artifact.revised_word_count,
    assumptions_count: artifact.unresolved_issues.length,
    total_tokens: usage.total_tokens,
    total_cost: usage.total_cost,
    outcome: artifact.unresolved_issues.length ? "degraded" : "success",
  });

  return createCapabilityOutput({
    capability: "concise",
    mode: artifact.mode,
    inputSummary: `Made text more concise in ${artifact.mode} mode (${artifact.original_word_count} → ${artifact.revised_word_count} words).`,
    artifact,
    rendered,
    assumptions: artifact.unresolved_issues,
    metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
  });
}

function buildCapabilityInputSummary(wordCount: number, mode: "quick" | "full"): string {
  return `Concise input provided (${wordCount} words, mode=${mode}).`;
}

export async function runConciseWithArtifact(
  args: ConciseArgs,
  client: OpenCodeClient,
  logger: AgentLogger = makeConsoleLogger("concise"),
): Promise<CorinaToolEnvelope<ConciseArtifact>> {
  const mode = detectMode(args.text, args.mode);
  const usage = createUsageAccumulator();
  const startMs = Date.now();

  logger.info("capability_start", {
    capability: "concise",
    mode,
    input_word_count: countWords(args.text),
    target_words: args.target_words ?? null,
    input_summary: buildCapabilityInputSummary(countWords(args.text), mode),
  });

  try {
    const output = mode === "quick"
      ? await runQuickMode(args, client, logger, startMs, usage)
      : await runFullMode(args, client, logger, startMs, usage);

    writeCapabilityAudit({
      capability: "concise",
      mode,
      input_summary: buildCapabilityInputSummary(countWords(args.text), mode),
      outcome: output.assumptions?.length ? "degraded" : "success",
      duration_ms: Date.now() - startMs,
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost,
      assumptions_count: output.assumptions?.length ?? 0,
    });

    return createToolEnvelopeFromCapabilityOutput({
      capability: "concise",
      output,
      outcome: output.assumptions?.length ? "degraded" : "success",
      shouldPersist: true,
      warnings: output.assumptions?.length ? output.assumptions : [],
    });
  } catch (error) {
    writeCapabilityAudit({
      capability: "concise",
      mode,
      input_summary: buildCapabilityInputSummary(countWords(args.text), mode),
      outcome: "failed",
      duration_ms: Date.now() - startMs,
      total_tokens: usage.total_tokens,
      total_cost: usage.total_cost,
      assumptions_count: 0,
    });
    logger.error("capability_error", {
      capability: "concise",
      mode,
      degraded: false,
      ...errorDetails(error),
    });
    const rendered = `Corina concise failed: ${error instanceof Error ? error.message : String(error)}`;
    return createToolEnvelope<ConciseArtifact>({
      capability: "concise",
      outcome: "failed",
      shouldPersist: false,
      artifact: null,
      rendered,
      warnings: [rendered],
      inputSummary: buildCapabilityInputSummary(countWords(args.text), mode),
      metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
    });
  }
}

export async function runConcise(args: ConciseArgs, client: OpenCodeClient, logger?: AgentLogger): Promise<string> {
  const output = await runConciseWithArtifact(args, client, logger);
  return output.rendered;
}
