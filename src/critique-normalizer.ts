import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { loadRubric } from "./critique-rubric.js";
import type {
  AgentCapabilityOutput,
  CritiqueArtifactUnion,
  CritiqueMode,
  DetectionReport,
  ResolvedRubric,
  ToneOutputArtifact,
} from "./types.js";
import type { RunCritiqueOptions } from "./critique.js";

export type CritiqueInputSource =
  | { kind: "text"; text: string; sourcePath?: string }
  | { kind: "file"; path: string; text: string }
  | { kind: "tone_output"; output: ToneOutputArtifact }
  | { kind: "detection_report"; output: DetectionReport }
  | { kind: "capability_output"; output: AgentCapabilityOutput<unknown> };

export interface NormalizedCritiqueItem {
  id: string;
  label: string;
  text: string;
  source: CritiqueInputSource;
  sourcePath: string | null;
  toneOutput?: ToneOutputArtifact;
  detectionReport?: DetectionReport;
  capabilityOutput?: AgentCapabilityOutput<unknown>;
}

export interface NormalizedCritiqueInput {
  items: NormalizedCritiqueItem[];
  mode: CritiqueMode;
  inferredAudience?: string;
  resolvedRubric?: ResolvedRubric;
  assumptions: string[];
  warnings: string[];
}

function inferAudienceFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/(api|sdk|typescript|function|endpoint|schema|runtime|compile)/.test(lower)) return "developer";
  if (/(brand|campaign|cmo|marketing|customer|audience|growth)/.test(lower)) return "cmo";
  if (/(reporter|source|lede|newsroom|attribution|editor)/.test(lower)) return "journalist";
  if (/(legal|compliance|contract|liability|regulatory)/.test(lower)) return "legal";
  if (/(architecture|system|throughput|latency|infrastructure)/.test(lower)) return "engineer";
  return "general";
}

function isAgentCapabilityOutput(value: unknown): value is AgentCapabilityOutput<unknown> {
  return Boolean(
    value && typeof value === "object" && "artifact" in (value as Record<string, unknown>) && "capability" in (value as Record<string, unknown>),
  );
}

function isToneOutputArtifact(value: unknown): value is ToneOutputArtifact {
  return Boolean(value && typeof value === "object" && "rewritten_content" in (value as Record<string, unknown>));
}

function isDetectionReport(value: unknown): value is DetectionReport {
  return Boolean(value && typeof value === "object" && "patterns_found" in (value as Record<string, unknown>) && "verdict" in (value as Record<string, unknown>));
}

function extractTextFromUnknownArtifact(value: unknown): { text: string; toneOutput?: ToneOutputArtifact; detectionReport?: DetectionReport } {
  if (isToneOutputArtifact(value)) {
    return { text: value.rewritten_content || value.final_content, toneOutput: value };
  }

  if (isDetectionReport(value)) {
    return {
      text:
        typeof (value as unknown as Record<string, unknown>).source_text === "string"
          ? String((value as unknown as Record<string, unknown>).source_text)
          : "",
      detectionReport: value,
    };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") return { text: record.text };
    if (typeof record.content === "string") return { text: record.content };
    if (typeof record.final_content === "string") return { text: record.final_content };
  }

  return { text: "" };
}

function normalizeRawInput(raw: string, index: number, warnings: string[]): NormalizedCritiqueItem | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    warnings.push(`Input ${index + 1} was empty and skipped.`);
    return null;
  }

  const pathCandidates = [trimmed, resolve(trimmed)];
  for (const candidate of pathCandidates) {
    if (!candidate || !existsSync(candidate)) continue;
    try {
      const content = readFileSync(candidate, "utf8");
      if (candidate.endsWith(".json")) {
        const parsed = JSON.parse(content) as unknown;
        if (isAgentCapabilityOutput(parsed)) {
          const artifact = extractTextFromUnknownArtifact(parsed.artifact);
          return {
            id: `item-${index + 1}`,
            label: basename(candidate),
            text: artifact.text,
            source: { kind: "capability_output", output: parsed },
            sourcePath: candidate,
            toneOutput: artifact.toneOutput,
            detectionReport: artifact.detectionReport,
            capabilityOutput: parsed,
          };
        }
      }

      return {
        id: `item-${index + 1}`,
        label: basename(candidate),
        text: content.trim(),
        source: { kind: "file", path: candidate, text: content.trim() },
        sourcePath: candidate,
      };
    } catch {
      warnings.push(`Could not read input file: ${candidate}`);
      return null;
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isAgentCapabilityOutput(parsed)) {
        const artifact = extractTextFromUnknownArtifact(parsed.artifact);
        return {
          id: `item-${index + 1}`,
          label: `Input ${index + 1}`,
          text: artifact.text,
          source: { kind: "capability_output", output: parsed },
          sourcePath: null,
          toneOutput: artifact.toneOutput,
          detectionReport: artifact.detectionReport,
          capabilityOutput: parsed,
        };
      }
      if (isToneOutputArtifact(parsed)) {
        return {
          id: `item-${index + 1}`,
          label: `Input ${index + 1}`,
          text: parsed.rewritten_content || parsed.final_content,
          source: { kind: "tone_output", output: parsed },
          sourcePath: null,
          toneOutput: parsed,
        };
      }
      if (isDetectionReport(parsed)) {
        const artifactText = extractTextFromUnknownArtifact(parsed).text;
        return {
          id: `item-${index + 1}`,
          label: `Input ${index + 1}`,
          text: artifactText,
          source: { kind: "detection_report", output: parsed },
          sourcePath: null,
          detectionReport: parsed,
        };
      }
    } catch {
      // Treat as plain text.
    }
  }

  return {
    id: `item-${index + 1}`,
    label: `Version ${index + 1}`,
    text: trimmed,
    source: { kind: "text", text: trimmed },
    sourcePath: null,
  };
}

export async function normalizeCritiqueInputs(rawTexts: string[], options: RunCritiqueOptions): Promise<NormalizedCritiqueInput> {
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const items = rawTexts
    .map((raw, index) => normalizeRawInput(raw, index, warnings))
    .filter((item): item is NormalizedCritiqueItem => Boolean(item && item.text.trim()));

  let mode: CritiqueMode = ["quality", "audience", "rubric", "compare"].includes(options.mode ?? "")
    ? (options.mode as CritiqueMode)
    : "quality";

  if (!options.mode) {
    assumptions.push("Mode omitted; defaulted to quality.");
  } else if (mode !== options.mode) {
    assumptions.push(`Unknown mode '${options.mode}' fell back to quality.`);
  }

  if (mode === "compare" && items.length < 2) {
    mode = "quality";
    assumptions.push("Compare mode received fewer than two valid inputs; downgraded to quality.");
  }

  let inferredAudience: string | undefined;
  if (mode === "audience" && !options.audience) {
    inferredAudience = inferAudienceFromText(items.map((item) => item.text).join("\n\n"));
    assumptions.push(`Audience omitted; inferred '${inferredAudience}'.`);
  }

  let resolvedRubric: ResolvedRubric | undefined;
  if (mode === "rubric") {
    const requestedRubric = options.rubric?.trim() || "corina";
    resolvedRubric = loadRubric(requestedRubric);
    if (!options.rubric) {
      assumptions.push("Rubric omitted; defaulted to corina.");
    } else if (resolvedRubric.id !== requestedRubric && !resolvedRubric.source_path.endsWith(`${requestedRubric}.md`)) {
      assumptions.push(`Rubric '${requestedRubric}' could not be resolved cleanly; fell back to '${resolvedRubric.id}'.`);
    }
  }

  return {
    items,
    mode,
    inferredAudience,
    resolvedRubric,
    assumptions,
    warnings,
  };
}
