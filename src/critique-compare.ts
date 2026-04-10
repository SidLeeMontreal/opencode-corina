import type { ComparisonDelta, ComparisonReport, CritiqueDimensionKey, CritiqueReport, RankedVersion } from "./types.js";

export interface VersionScore {
  label: string;
  score: number;
  report: CritiqueReport;
  itemId?: string;
  text?: string;
}

export interface DeltaAnalysis extends ComparisonDelta {}

const DIMENSIONS: CritiqueDimensionKey[] = ["ai_patterns", "corina_tone", "precision", "evidence", "rhythm"];

function buildDimensionDeltas(current: CritiqueReport, next: CritiqueReport): Record<CritiqueDimensionKey, number> {
  return {
    ai_patterns: current.dimensions.ai_patterns.score - next.dimensions.ai_patterns.score,
    corina_tone: current.dimensions.corina_tone.score - next.dimensions.corina_tone.score,
    precision: current.dimensions.precision.score - next.dimensions.precision.score,
    evidence: current.dimensions.evidence.score - next.dimensions.evidence.score,
    rhythm: current.dimensions.rhythm.score - next.dimensions.rhythm.score,
  };
}

function summarizeDimensionDeltas(deltas: Record<CritiqueDimensionKey, number>): string[] {
  return DIMENSIONS.filter((dimension) => deltas[dimension] !== 0).map((dimension) => {
    const direction = deltas[dimension] > 0 ? "stronger" : "weaker";
    return `${dimension} is ${Math.abs(deltas[dimension])} point${Math.abs(deltas[dimension]) === 1 ? "" : "s"} ${direction}.`;
  });
}

function compareVersions(left: VersionScore, right: VersionScore): number {
  if (right.score !== left.score) return right.score - left.score;
  if (left.report.fatal_issues.length !== right.report.fatal_issues.length) {
    return left.report.fatal_issues.length - right.report.fatal_issues.length;
  }
  if (right.report.dimensions.precision.score !== left.report.dimensions.precision.score) {
    return right.report.dimensions.precision.score - left.report.dimensions.precision.score;
  }
  if (right.report.dimensions.evidence.score !== left.report.dimensions.evidence.score) {
    return right.report.dimensions.evidence.score - left.report.dimensions.evidence.score;
  }
  return 0;
}

export function computeDeltas(ranked: VersionScore[]): DeltaAnalysis[] {
  const deltas: DeltaAnalysis[] = [];

  for (let index = 0; index < ranked.length - 1; index += 1) {
    const current = ranked[index];
    const next = ranked[index + 1];
    const dimensionDeltas = buildDimensionDeltas(current.report, next.report);

    deltas.push({
      compared_to: next.label,
      score_delta: current.score - next.score,
      dimension_deltas: dimensionDeltas,
      summary: summarizeDimensionDeltas(dimensionDeltas),
    });
  }

  return deltas;
}

function buildRecommendation(ranking: RankedVersion[]): string {
  if (!ranking.length) return "No comparable versions were available.";
  const winner = ranking[0];
  const reasons = [
    `Highest score: ${winner.critique.overall_score}/${winner.critique.pass_threshold + 5}`,
    winner.critique.fatal_issues.length ? `${winner.critique.fatal_issues.length} fatal issue(s)` : "No fatal issues",
    `Precision ${winner.critique.dimensions.precision.score}/5`,
    `Evidence ${winner.critique.dimensions.evidence.score}/5`,
  ];
  return `Recommend ${winner.label} — ${reasons.join(", ")}.`;
}

export function aggregateComparison(reports: VersionScore[]): ComparisonReport {
  if (!reports.length) {
    return {
      status: "no_input",
      compared_count: 0,
      ranking: [],
      recommended_item_id: null,
      recommended_label: null,
      recommendation_reason: "No valid inputs were available for comparison.",
      winner_text: null,
      cross_version_patterns: [],
      assumptions: ["Comparison ran with no usable critique reports."],
      skipped_inputs: [],
    };
  }

  const stable = reports.map((report, index) => ({ ...report, itemId: report.itemId ?? `item-${index + 1}`, originalIndex: index }));
  const ranked = stable.sort((left, right) => {
    const result = compareVersions(left, right);
    return result !== 0 ? result : left.originalIndex - right.originalIndex;
  });

  const deltas = computeDeltas(ranked);
  const ranking: RankedVersion[] = ranked.map((version, index) => ({
    rank: index + 1,
    item_id: version.itemId ?? `item-${index + 1}`,
    label: version.label,
    critique: version.report,
    strengths_summary: version.report.strengths.slice(0, 3),
    weaknesses_summary: version.report.issues.slice(0, 3).map((issue) => issue.summary),
    deltas_vs_next: deltas[index] ?? null,
  }));

  const crossVersionPatterns = Array.from(
    new Set(
      ranking
        .flatMap((version) => version.critique.issues)
        .map((issue) => `${issue.dimension}: ${issue.summary}`),
    ),
  ).slice(0, 5);

  return {
    status: "ok",
    compared_count: ranking.length,
    ranking,
    recommended_item_id: ranking[0]?.item_id ?? null,
    recommended_label: ranking[0]?.label ?? null,
    recommendation_reason: buildRecommendation(ranking),
    winner_text: ranked[0]?.text ?? null,
    cross_version_patterns: crossVersionPatterns,
    assumptions: [],
    skipped_inputs: [],
  };
}
