import type { DetectionReport, PatternFinding } from "./types.js";

function insertFlags(text: string, findings: PatternFinding[]): string {
  if (!findings.length) return text;

  const sorted = [...findings].sort((left, right) => {
    if (left.char_start !== right.char_start) return right.char_start - left.char_start;
    return right.char_end - left.char_end;
  });

  let annotated = text;
  for (const finding of sorted) {
    const marker = ` [FLAG: ${finding.pattern_id}|${finding.severity}|${finding.confidence}]`;
    annotated = `${annotated.slice(0, finding.char_end)}${marker}${annotated.slice(finding.char_end)}`;
  }

  return annotated;
}

function groupedFindings(findings: PatternFinding[]): string {
  if (!findings.length) return "- No patterns detected";

  const groups = new Map<string, PatternFinding[]>();
  for (const finding of findings) {
    const bucket = groups.get(finding.pattern_id) ?? [];
    bucket.push(finding);
    groups.set(finding.pattern_id, bucket);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([patternId, bucket]) => {
      const first = bucket[0];
      const items = bucket
        .map((finding) => `  - "${finding.matched_text}" · ${finding.location_hint} · ${finding.severity}/${finding.confidence}`)
        .join("\n");
      return `- ${patternId} (${first.pattern_name}, ${bucket.length})\n${items}`;
    })
    .join("\n");
}

function numberedFindings(findings: PatternFinding[]): string {
  if (!findings.length) return "1. No patterns detected.";

  return findings
    .map(
      (finding, index) =>
        `${index + 1}. ${finding.pattern_name}\n   Match: "${finding.matched_text}"\n   Location: ${finding.location_hint}\n   Why: ${finding.explanation}\n   Fix direction: ${finding.fix_suggestion}`,
    )
    .join("\n\n");
}

function uncertaintyFooter(report: DetectionReport): string {
  const notes = report.layer_2_analysis?.reasoning_notes?.length
    ? report.layer_2_analysis.reasoning_notes
    : ["Verdict describes AI-like pattern density, not definitive authorship."];

  return [
    "Uncertainty notes",
    "-----------------",
    ...notes.map((note) => `- ${note}`),
  ].join("\n");
}

export function formatInline(text: string, report: DetectionReport): string {
  const annotated = report.patterns_found.length ? insertFlags(text, report.patterns_found) : "No patterns detected";

  return [
    "Corina Detect",
    `Verdict: ${report.verdict} (${report.overall_score.toFixed(2)}, ${report.confidence} confidence)`,
    "",
    "Annotated text",
    "--------------",
    annotated,
    "",
    "Findings summary",
    "----------------",
    groupedFindings(report.patterns_found),
    "",
    uncertaintyFooter(report),
  ].join("\n").trim();
}

export function formatReport(report: DetectionReport): string {
  const counts = Object.entries(report.pattern_counts.by_category)
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([category, count]) => `- ${category}: ${count}`)
    .join("\n") || "- none";

  return [
    "Corina Detect",
    `Verdict: ${report.verdict} (${report.overall_score.toFixed(2)}, ${report.confidence} confidence)`,
    "",
    "Counts by category",
    "------------------",
    counts,
    "",
    "Findings",
    "--------",
    numberedFindings(report.patterns_found),
    "",
    uncertaintyFooter(report),
    "",
    "Next steps",
    "----------",
    report.patterns_found.length
      ? "- Review the flagged passages in context before revising.\n- Prioritize repeated and high-severity patterns first.\n- Treat this as a diagnostic signal, not proof of authorship."
      : "- No changes are necessary from this scan.\n- If you still want a rewrite pass, run with auto-fix enabled.",
  ].join("\n").trim();
}

export function formatJson(report: DetectionReport): string {
  return JSON.stringify(report, null, 2);
}

export const renderInlineDetection = formatInline;
export const renderReportDetection = formatReport;
export const renderJsonDetection = formatJson;
