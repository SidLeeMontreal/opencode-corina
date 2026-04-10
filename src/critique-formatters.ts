import type {
  AgentCapabilityOutput,
  AudienceCritiqueReport,
  ComparisonReport,
  CritiqueReport,
  RubricReport,
} from "./types.js";

export function formatCritiqueInline(report: CritiqueReport): string {
  const issues = report.issues.length
    ? report.issues.slice(0, 3).map((issue, index) => `${index + 1}. ${issue.summary}`).join("\n")
    : "No major issues detected.";

  return [
    "Corina Critique — Quality",
    `Score: ${report.overall_score}/${report.pass_threshold + 5} — ${report.pass ? "Pass" : "Fail"}`,
    "",
    "Dimensions",
    `- AI patterns: ${report.dimensions.ai_patterns.score}/5`,
    `- Corina tone: ${report.dimensions.tone.score}/5`,
    `- Precision: ${report.dimensions.precision.score}/5`,
    `- Evidence: ${report.dimensions.evidence.score}/5`,
    `- Rhythm: ${report.dimensions.rhythm.score}/5`,
    "",
    "Top issues",
    issues,
  ].join("\n");
}

export function formatCritiqueReport(report: CritiqueReport): string {
  return [
    formatCritiqueInline(report),
    "",
    "Strengths",
    ...(report.strengths.length ? report.strengths.map((item) => `- ${item}`) : ["- No notable strengths recorded."]),
    "",
    "Revision directions",
    ...(report.revision_instructions.length
      ? report.revision_instructions.map((item) => `- ${item}`)
      : ["- No revision directions recorded."]),
    ...(report.fatal_issues.length ? ["", "Fatal issues", ...report.fatal_issues.map((item) => `- ${item}`)] : []),
  ].join("\n");
}

export function formatAudienceInline(report: AudienceCritiqueReport): string {
  return [
    "Corina Critique — Audience",
    `Audience: ${report.audience_applied}${report.audience_inferred ? " (inferred)" : ""}`,
    `Resonance score: ${report.resonance_score}/5`,
    "",
    `What lands: ${report.what_lands.length ? report.what_lands.join("; ") : "Nothing specific landed strongly."}`,
    `What misses: ${report.what_misses.length ? report.what_misses.join("; ") : "No major misses recorded."}`,
    `Missing: ${report.missing_for_audience.length ? report.missing_for_audience.join("; ") : "No major missing elements noted."}`,
  ].join("\n");
}

export function formatRubricInline(report: RubricReport): string {
  const dimensionLines = report.dimensions.map((dimension) => `- ${dimension.label}: ${dimension.score}/${dimension.max_score}`);
  const weakPoints = report.weakest_dimensions.length ? report.weakest_dimensions.join(", ") : "None called out.";

  return [
    `Corina Critique — Rubric (${report.rubric_name})`,
    `Score: ${report.total_score}/${report.max_total_score}`,
    "",
    "Dimensions",
    ...dimensionLines,
    "",
    `Weakest dimensions: ${weakPoints}`,
    `Assessment: ${report.overall_assessment}`,
  ].join("\n");
}

export function formatComparisonInline(report: ComparisonReport): string {
  const ranking = report.ranking.length
    ? report.ranking.map((item) => `${item.rank}. ${item.label} — ${item.critique.overall_score}/${item.critique.pass_threshold + 5}`).join("\n")
    : "No ranked versions.";

  return [
    "Corina Critique — Compare",
    ranking,
    "",
    `Recommendation: ${report.recommendation_reason}`,
  ].join("\n");
}

export function formatJson(output: AgentCapabilityOutput<unknown>): string {
  return JSON.stringify(output, null, 2);
}
