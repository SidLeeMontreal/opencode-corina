import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AI_PATTERN_MAP, detectAiPatterns, type Layer1Scan, type PatternMatch } from "opencode-text-tools";

import { createCapabilityOutput } from "./capability-output.js";
import { createUsageAccumulator, errorDetails, makeConsoleLogger, type AgentLogger } from "./logger.js";
import { formatInline, formatJson, formatReport } from "./detect-formatters.js";
import { runLayer2Analysis } from "./detect-layer2.js";
import {
  applyLayer2Adjustment,
  buildPatternCounts,
  buildTopSignals,
  confidenceFromScore,
  scoreFindings,
  summaryFromVerdict,
  verdictFromScore,
} from "./detect-scoring.js";
import { runPipelineWithArtifact } from "./pipeline.js";
import { runTonePipelineWithArtifact } from "./tone-pipeline.js";
import type { AgentCapabilityOutput, DetectionReport, OpenCodeClient, PatternFinding } from "./types.js";
import { validate } from "./validators.js";

interface ResolvedInput {
  text: string;
  sourcePath: string | null;
  sourceType: "text" | "file";
  note?: string;
}

function cleanText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\t/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

function resolveInput(textOrPath: string): ResolvedInput {
  const trimmed = textOrPath.trim();
  const candidates = [trimmed, resolve(trimmed)];

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      return { text: readFileSync(candidate, "utf8"), sourcePath: candidate, sourceType: "file" };
    } catch {
      return {
        text: "",
        sourcePath: candidate,
        sourceType: "file",
        note: `Could not read file at ${candidate}.`,
      };
    }
  }

  return { text: trimmed, sourcePath: null, sourceType: "text" };
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function countParagraphs(text: string): number {
  return text.trim() ? text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim()).length : 0;
}

function countSentences(text: string): number {
  return [...text.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)].filter((match) => match[0].trim()).length;
}

function paragraphSentenceHint(text: string, start: number): string {
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  let cursor = 0;

  for (let paragraphIndex = 0; paragraphIndex < paragraphs.length; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const paragraphStart = text.indexOf(paragraph, cursor);
    const paragraphEnd = paragraphStart + paragraph.length;
    cursor = paragraphEnd;

    if (start < paragraphStart || start > paragraphEnd) continue;

    const sentences = [...paragraph.matchAll(/[^.!?\n]+(?:[.!?]+|$)/g)].filter((match) => match[0].trim());
    for (let sentenceIndex = 0; sentenceIndex < sentences.length; sentenceIndex += 1) {
      const sentence = sentences[sentenceIndex];
      const sentenceStart = paragraphStart + (sentence.index ?? 0);
      const sentenceEnd = sentenceStart + sentence[0].length;
      if (start >= sentenceStart && start <= sentenceEnd) {
        return `paragraph ${paragraphIndex + 1}, sentence ${sentenceIndex + 1}`;
      }
    }

    return `paragraph ${paragraphIndex + 1}, sentence 1`;
  }

  return "paragraph 1, sentence 1";
}

function buildOccurrenceMap(text: string, values: string[]): Map<string, number[]> {
  const haystack = text.toLowerCase();
  const map = new Map<string, number[]>();

  for (const value of new Set(values.map((entry) => entry.toLowerCase()).filter(Boolean))) {
    const offsets: number[] = [];
    let cursor = 0;
    while (cursor < haystack.length) {
      const index = haystack.indexOf(value, cursor);
      if (index === -1) break;
      offsets.push(index);
      cursor = index + value.length;
    }
    map.set(value, offsets);
  }

  return map;
}

function takeOccurrence(text: string, map: Map<string, number[]>, matchedText: string): { start: number; end: number } {
  const key = matchedText.toLowerCase();
  const offsets = map.get(key) ?? [];
  const start = offsets.length ? offsets.shift()! : Math.max(0, text.toLowerCase().indexOf(key));
  map.set(key, offsets);
  return { start, end: start + matchedText.length };
}

function baseConfidence(match: PatternMatch, layer1Scan: Layer1Scan): PatternFinding["confidence"] {
  if (["chatbot_artifacts", "knowledge_cutoff_disclaimers"].includes(match.id)) return "high";
  if (layer1Scan.ambiguousPatterns.includes(match.id)) return "low";
  return match.severity;
}

function buildFinding(text: string, match: PatternMatch, layer1Scan: Layer1Scan, map: Map<string, number[]>): PatternFinding {
  const offsets = takeOccurrence(text, map, match.matchedText);
  const pattern = AI_PATTERN_MAP[match.id] ?? {
    name: match.id,
    category: match.category,
    severity: match.severity,
    explanation: match.explanation,
    fixSuggestion: match.fixSuggestion,
  };

  return {
    pattern_id: match.id,
    pattern_name: pattern.name,
    category: pattern.category,
    severity: pattern.severity,
    confidence: baseConfidence(match, layer1Scan),
    matched_text: match.matchedText,
    normalized_match: match.matchedText.toLowerCase(),
    location_hint: paragraphSentenceHint(text, offsets.start),
    char_start: offsets.start,
    char_end: offsets.end,
    rule_source: "layer_1",
    explanation: match.explanation,
    fix_suggestion: match.fixSuggestion,
    context_before: text.slice(Math.max(0, offsets.start - 40), offsets.start).trim(),
    context_after: text.slice(offsets.end, Math.min(text.length, offsets.end + 40)).trim(),
  };
}

function mergeLayer2Findings(text: string, findings: PatternFinding[], layer2: DetectionReport["layer_2_analysis"]): PatternFinding[] {
  if (!layer2) return findings;

  const dismissed = new Set(layer2.dismissed_patterns);
  const confirmed = new Set(layer2.confirmed_patterns);
  const merged: PatternFinding[] = findings
    .filter((finding) => !dismissed.has(finding.pattern_id))
    .map((finding) =>
      confirmed.has(finding.pattern_id)
        ? { ...finding, confidence: (finding.confidence === "low" ? "medium" : "high") as PatternFinding["confidence"] }
        : finding,
    );

  for (const additional of layer2.additional_findings) {
    const lower = text.toLowerCase();
    const matched = additional.matched_text.toLowerCase();
    const start = Math.max(0, lower.indexOf(matched));
    const end = start + additional.matched_text.length;
    merged.push({
      pattern_id: additional.pattern_id,
      pattern_name: AI_PATTERN_MAP[additional.pattern_id]?.name ?? additional.pattern_id,
      category: AI_PATTERN_MAP[additional.pattern_id]?.category ?? "style",
      severity: additional.severity,
      confidence: additional.confidence,
      matched_text: additional.matched_text,
      normalized_match: matched,
      location_hint: additional.location_hint ?? paragraphSentenceHint(text, start),
      char_start: start,
      char_end: end,
      rule_source: "layer_2",
      explanation: additional.explanation,
      fix_suggestion: additional.fix_suggestion,
      context_before: text.slice(Math.max(0, start - 40), start).trim(),
      context_after: text.slice(end, Math.min(text.length, end + 40)).trim(),
    });
  }

  return merged;
}

function emptyReport(resolved: ResolvedInput): DetectionReport {
  return {
    overall_score: 0,
    confidence: "high",
    verdict: "clean",
    summary: "No input text was provided. Paste text or pass a readable file path.",
    input: {
      source_type: resolved.sourceType,
      source_path: resolved.sourcePath,
      character_count: 0,
      word_count: 0,
      paragraph_count: 0,
      sentence_count: 0,
    },
    patterns_found: [],
    pattern_counts: buildPatternCounts([]),
    top_signals: [],
    layer_1_scan: {
      score: 0,
      deep_recommended: false,
      rules_triggered: [],
      ambiguous_patterns: [],
      notes: resolved.note ? [resolved.note] : ["No input text was provided."],
    },
    layer_2_analysis: null,
    assumptions: [
      "Verdict describes AI-like pattern density, not definitive authorship.",
      "Human writing can trigger these signals, and edited AI text can avoid them.",
    ],
  };
}

function formatOutput(text: string, report: DetectionReport, format: DetectInput["format"]): string {
  switch (format) {
    case "report":
      return formatReport(report);
    case "json":
      return formatJson(report);
    case "inline":
    default:
      return formatInline(text, report);
  }
}

function autoFixInstructions(report: DetectionReport): string[] {
  const patterns = [...new Set(report.patterns_found.map((finding) => finding.pattern_name))];
  return [
    "Preserve all facts, names, dates, numbers, and claims.",
    "Do not mention AI detection in the rewrite.",
    patterns.length ? `Reduce these flagged patterns: ${patterns.join(", ")}.` : "Reduce the flagged AI-like patterns conservatively.",
  ];
}

function buildInputSummary(resolved: ResolvedInput, report: DetectionReport): string {
  const source = resolved.sourceType === "file" ? `file ${resolved.sourcePath ?? "(unknown path)"}` : "inline text";
  return `Analyzed ${source} (${report.input.word_count} words, ${report.patterns_found.length} findings).`;
}

export interface DetectInput {
  text: string;
  format?: "inline" | "report" | "json";
  autoFix?: boolean;
  chain?: "pipeline";
  voice?: string;
  modelPreset?: string;
}

export async function runDetectWithArtifact(
  input: DetectInput,
  client: OpenCodeClient,
  logger: AgentLogger = makeConsoleLogger("corina"),
): Promise<AgentCapabilityOutput<DetectionReport>> {
  const startMs = Date.now();
  const usage = createUsageAccumulator();
  const resolved = resolveInput(input.text);
  const text = cleanText(resolved.text);

  logger.info("capability_start", {
    capability: "detect",
    input_word_count: countWords(text),
    model_preset: input.modelPreset ?? null,
    input_summary: text.slice(0, 160),
  });

  if (!text) {
    const report = emptyReport(resolved);
    logger.warn("capability_complete", {
      capability: "detect",
      duration_ms: Date.now() - startMs,
      word_count: 0,
      assumptions_count: report.assumptions.length,
      total_tokens: 0,
      total_cost: 0,
      pass: true,
      outcome: "degraded",
    });
    return createCapabilityOutput({
      capability: "detect",
      inputSummary: buildInputSummary(resolved, report),
      artifact: report,
      rendered: formatOutput("", report, input.format),
      assumptions: report.assumptions,
      metrics: { total_tokens: 0, total_cost: 0 },
    });
  }

  const layer1StartMs = Date.now();
  const layer1Scan = detectAiPatterns(text);
  const occurrenceMap = buildOccurrenceMap(text, layer1Scan.patternMatches.map((match) => match.matchedText));
  const layer1Findings = layer1Scan.patternMatches.map((match) => buildFinding(text, match, layer1Scan, occurrenceMap));
  logger.info("layer1_complete", { capability: "detect", pattern_count: layer1Findings.length, duration_ms: Date.now() - layer1StartMs });
  const layer2StartMs = Date.now();
  const layer2 = await runLayer2Analysis(text, layer1Scan, client, input.modelPreset, logger, usage);
  const findings = mergeLayer2Findings(text, layer1Findings, layer2);
  const baseScore = scoreFindings(findings);
  const overallScore = applyLayer2Adjustment(baseScore, layer2.score_adjustment);
  const verdict = verdictFromScore(overallScore);

  logger.info("layer2_complete", { capability: "detect", verdict: verdictFromScore(applyLayer2Adjustment(scoreFindings(layer1Findings), layer2.score_adjustment)), score: applyLayer2Adjustment(scoreFindings(layer1Findings), layer2.score_adjustment), duration_ms: Date.now() - layer2StartMs, ran: layer2.ran });

  const report: DetectionReport = {
    overall_score: overallScore,
    confidence: confidenceFromScore(overallScore, findings.length),
    verdict,
    summary: summaryFromVerdict(verdict),
    input: {
      source_type: resolved.sourceType,
      source_path: resolved.sourcePath,
      character_count: text.length,
      word_count: countWords(text),
      paragraph_count: countParagraphs(text),
      sentence_count: countSentences(text),
    },
    patterns_found: findings,
    pattern_counts: buildPatternCounts(findings),
    top_signals: buildTopSignals(findings),
    layer_1_scan: {
      score: scoreFindings(layer1Findings),
      deep_recommended: true,
      rules_triggered: Object.keys(layer1Scan.counts.byPattern),
      ambiguous_patterns: layer1Scan.ambiguousPatterns,
      notes: [...(layer1Scan.cautions ?? []), ...(layer1Scan.meta?.cautions ?? [])],
    },
    layer_2_analysis: layer2,
    assumptions: [
      "Verdict describes AI-like pattern density, not definitive authorship.",
      "Human writing can trigger these signals, and edited AI text can avoid them.",
    ],
  };

  const validation = validate("DetectionReport", report);
  if (!validation.valid) {
    report.assumptions.push(`DetectionReport validation warning: ${validation.errors.join("; ")}`);
  }

  let rendered = formatOutput(text, report, input.format);
  let chainedTo: string | undefined;
  let chainResult: unknown;
  const assumptions = [...report.assumptions];

  if (input.autoFix) {
    logger.info("chain_start", { capability: "detect", chain_target: "tone" });
    const fixed = await runTonePipelineWithArtifact(
      {
        text,
        voice: input.voice,
        modelPreset: input.modelPreset,
        fixInstructions: autoFixInstructions(report),
      },
      client,
      logger,
    );
    rendered = `${rendered}\n\nAuto-fix\n--------\n${fixed.artifact.final_content}`;
    chainedTo = "tone";
    chainResult = fixed.artifact;
    assumptions.push("Auto-fix rewrite appended using Corina tone capability.");
    logger.info("chain_complete", { capability: "detect", chain_target: "tone", outcome: "success" });
  }

  if (input.chain === "pipeline") {
    logger.info("chain_start", { capability: "detect", chain_target: "pipeline" });
    const fixed = await runPipelineWithArtifact(
      `Rewrite this text to remove AI writing patterns:\n\n${text}`,
      client,
      undefined,
      logger,
    );
    rendered = `${rendered}\n\nChain result (pipeline)\n-----------------------\n${fixed.rendered}`;
    chainedTo = "pipeline";
    chainResult = fixed.artifact;
    assumptions.push("Pipeline rewrite appended because detect was chained to pipeline.");
    logger.info("chain_complete", { capability: "detect", chain_target: "pipeline", outcome: "success" });
  }

  logger.info("capability_complete", {
    capability: "detect",
    duration_ms: Date.now() - startMs,
    word_count: report.input.word_count,
    assumptions_count: assumptions.length,
    total_tokens: usage.total_tokens,
    total_cost: usage.total_cost,
    pass: report.verdict !== "likely_ai",
    outcome: chainResult ? "degraded" : "success",
  });

  return {
    ...createCapabilityOutput({
      capability: "detect",
      inputSummary: buildInputSummary(resolved, report),
      artifact: report,
      rendered,
      chainedTo,
      assumptions,
      metrics: { total_tokens: usage.total_tokens, total_cost: usage.total_cost },
    }),
    ...(chainResult ? { chain_result: chainResult } : {}),
  };
}

export async function runDetect(input: DetectInput, client: OpenCodeClient, logger?: AgentLogger): Promise<string> {
  const output = await runDetectWithArtifact(input, client, logger);
  return output.rendered;
}

export const runDetectPipeline = async (
  input: DetectInput,
  client: OpenCodeClient,
): Promise<{ report: DetectionReport; output: string; fixedText?: string }> => {
  const output = await runDetectWithArtifact(input, client);
  return { report: output.artifact, output: output.rendered };
};
