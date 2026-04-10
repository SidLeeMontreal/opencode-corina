import { createCapabilityOutput } from "../../src/capability-output.js";
import {
  formatComparisonInline,
  formatCritiqueInline,
  formatJson,
} from "../../src/critique-formatters.js";
import type { ComparisonReport, CritiqueReport } from "../../src/types.js";

const critique: CritiqueReport = {
  status: "ok",
  pass: false,
  overall_score: 18,
  pass_threshold: 20,
  dimensions: {
    ai_patterns: { score: 3, issues: ["AI-ish opener"], strengths: [] },
    tone: { score: 4, issues: [], strengths: ["Grounded tone"] },
    precision: { score: 4, issues: [], strengths: ["Clear verbs"] },
    evidence: { score: 3, issues: ["Unsupported claim"], strengths: [] },
    rhythm: { score: 4, issues: [], strengths: ["Varied cadence"] },
  },
  issues: [
    { id: "issue-1", dimension: "evidence", severity: "high", summary: "Evidence stays abstract.", fix_direction: "Name the source." },
  ],
  strengths: ["Solid cadence"],
  revision_instructions: ["Name the source behind the central claim."],
  fatal_issues: [],
  assumptions: [],
};

const comparison: ComparisonReport = {
  status: "ok",
  compared_count: 2,
  ranking: [
    {
      rank: 1,
      item_id: "v2",
      label: "Version 2",
      critique: { ...critique, overall_score: 21, pass: true },
      strengths_summary: ["Best lead"],
      weaknesses_summary: ["Still needs evidence"],
      deltas_vs_next: null,
    },
    {
      rank: 2,
      item_id: "v1",
      label: "Version 1",
      critique,
      strengths_summary: ["Clear angle"],
      weaknesses_summary: ["Thin support"],
      deltas_vs_next: null,
    },
  ],
  recommended_item_id: "v2",
  recommended_label: "Version 2",
  recommendation_reason: "Recommend Version 2 — clearer lead and higher score.",
  winner_text: "Winner",
  cross_version_patterns: ["evidence: Evidence stays abstract."],
  assumptions: [],
  skipped_inputs: [],
};

describe("critique formatters", () => {
  it("formatCritiqueInline returns string with score and issues", () => {
    const output = formatCritiqueInline(critique);
    expect(output).toContain("Score: 18/25");
    expect(output).toContain("Evidence stays abstract.");
  });

  it("formatComparisonInline includes rank labels", () => {
    const output = formatComparisonInline(comparison);
    expect(output).toContain("1. Version 2");
    expect(output).toContain("2. Version 1");
  });

  it("formatJson returns valid JSON", () => {
    const output = formatJson(
      createCapabilityOutput({
        capability: "critique",
        mode: "quality",
        inputSummary: "One input",
        artifact: critique,
        rendered: "Rendered",
      }),
    );

    expect(JSON.parse(output).capability).toBe("critique");
  });

  it("clean critique returns an appropriate message", () => {
    const output = formatCritiqueInline({ ...critique, issues: [], overall_score: 24, pass: true });
    expect(output).toContain("No major issues detected.");
  });
});
