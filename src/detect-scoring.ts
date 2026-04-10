import type { DetectionConfidence, DetectionVerdict, Layer2Analysis, PatternFinding } from "./types.js";

const SEVERITY_WEIGHT: Record<PatternFinding["severity"], number> = {
  high: 0.08,
  medium: 0.05,
  low: 0.02,
};

const CONFIDENCE_FACTOR: Record<PatternFinding["confidence"], number> = {
  high: 1,
  medium: 0.65,
  low: 0.35,
};

const STRUCTURAL_PATTERNS = new Set([
  "formulaic_challenges_section",
  "em_dash_overuse",
  "boldface_overuse",
  "inline_header_lists",
  "title_case_headings",
  "emoji_headings_bullets",
  "curly_quotes",
  "hyphenated_word_pairs",
  "fragmented_headers",
  "synonym_cycling",
  "rhythm_uniformity",
]);

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function scoreFindings(findings: PatternFinding[]): number {
  let score = findings.reduce((total, finding) => {
    return total + SEVERITY_WEIGHT[finding.severity] * CONFIDENCE_FACTOR[finding.confidence];
  }, 0);

  const categories = new Set(findings.map((finding) => finding.category));
  if (categories.size >= 3) {
    score += 0.05;
  }

  const structuralCount = findings.filter((finding) => STRUCTURAL_PATTERNS.has(finding.pattern_id)).length;
  if (structuralCount >= 2) {
    score += 0.05;
  }

  return Number(clampScore(score).toFixed(2));
}

export function applyLayer2Adjustment(score: number, adjustment: number): number {
  return Number(clampScore(score + adjustment).toFixed(2));
}

export function verdictFromScore(score: number): DetectionVerdict {
  if (score <= 0.14) return "clean";
  if (score <= 0.39) return "probably_human";
  if (score <= 0.69) return "possibly_ai";
  return "likely_ai";
}

export function confidenceFromScore(score: number, findingCount: number): DetectionConfidence {
  if (findingCount === 0) return "high";
  if (score >= 0.7 || findingCount >= 6) return "high";
  if (score >= 0.25 || findingCount >= 2) return "medium";
  return "low";
}

export function summaryFromVerdict(verdict: string): string {
  switch (verdict) {
    case "clean":
      return "No clear AI-like pattern density was detected in this text.";
    case "probably_human":
      return "A few weak AI-like signals appear, but the evidence is limited and plausibly human.";
    case "possibly_ai":
      return "Several AI-like patterns appear, but this remains a diagnostic judgment, not authorship proof.";
    case "likely_ai":
      return "A dense cluster of AI-like patterns appears, which suggests strongly AI-shaped prose without proving authorship.";
    default:
      return "Pattern density was assessed conservatively, not as proof of authorship.";
  }
}

export function toPatternId(id: string): string {
  return id.replace(/-/g, "_");
}

export function fromLayer1PatternId(id: string): string {
  return id.replace(/_/g, "_");
}

export function deriveReportConfidence(findings: PatternFinding[], layer2: Layer2Analysis | null): DetectionConfidence {
  const base = confidenceFromScore(applyLayer2Adjustment(scoreFindings(findings), layer2?.score_adjustment ?? 0), findings.length);
  if (!layer2?.ran && base === "high" && findings.length > 0) {
    return "medium";
  }
  return base;
}

export function buildPatternCounts(findings: PatternFinding[]) {
  return findings.reduce(
    (acc, finding) => {
      acc.by_pattern[finding.pattern_id] = (acc.by_pattern[finding.pattern_id] ?? 0) + 1;
      acc.by_category[finding.category] = (acc.by_category[finding.category] ?? 0) + 1;
      acc.by_severity[finding.severity] += 1;
      return acc;
    },
    {
      by_pattern: {} as Record<string, number>,
      by_category: {} as Record<string, number>,
      by_severity: { high: 0, medium: 0, low: 0 },
    },
  );
}

export function buildTopSignals(findings: PatternFinding[]): string[] {
  const buckets = new Map<string, { count: number; name: string; location: string }>();

  for (const finding of findings) {
    const current = buckets.get(finding.pattern_id);
    buckets.set(finding.pattern_id, {
      count: (current?.count ?? 0) + 1,
      name: finding.pattern_name,
      location: current?.location ?? finding.location_hint,
    });
  }

  return [...buckets.values()]
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 3)
    .map((entry) => `${entry.name} x${entry.count} near ${entry.location}`);
}

export const deriveVerdict = verdictFromScore;
export const summarizeVerdict = summaryFromVerdict;
