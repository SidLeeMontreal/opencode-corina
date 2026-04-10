import { aggregateComparison, computeDeltas } from "../../src/critique-compare.js";
import type { CritiqueReport } from "../../src/types.js";

function makeReport(scoreByDimension: [number, number, number, number, number], label: string): CritiqueReport {
  const [ai, tone, precision, evidence, rhythm] = scoreByDimension;
  const overall = ai + tone + precision + evidence + rhythm;
  return {
    status: "ok",
    pass: overall >= 20,
    overall_score: overall,
    pass_threshold: 20,
    dimensions: {
      ai_patterns: { score: ai, issues: [], strengths: [`${label} ai`] },
      corina_tone: { score: tone, issues: [], strengths: [`${label} tone`] },
      precision: { score: precision, issues: [], strengths: [`${label} precision`] },
      evidence: { score: evidence, issues: [], strengths: [`${label} evidence`] },
      rhythm: { score: rhythm, issues: [], strengths: [`${label} rhythm`] },
    },
    issues: [],
    strengths: [`${label} strength`],
    revision_instructions: [],
    fatal_issues: [],
    assumptions: [],
  };
}

describe("critique compare", () => {
  it("aggregateComparison ranks three reports correctly", () => {
    const comparison = aggregateComparison([
      { label: "Version A", score: 18, report: makeReport([4, 4, 4, 3, 3], "A"), itemId: "a", text: "A" },
      { label: "Version B", score: 23, report: makeReport([5, 5, 4, 4, 5], "B"), itemId: "b", text: "B" },
      { label: "Version C", score: 20, report: makeReport([4, 4, 4, 4, 4], "C"), itemId: "c", text: "C" },
    ]);

    expect(comparison.ranking.map((item) => item.label)).toEqual(["Version B", "Version C", "Version A"]);
    expect(comparison.recommended_label).toBe("Version B");
  });

  it("computeDeltas produces correct deltas between adjacent versions", () => {
    const ranked = [
      { label: "v2", score: 22, report: makeReport([5, 4, 5, 4, 4], "v2") },
      { label: "v1", score: 19, report: makeReport([4, 4, 4, 4, 3], "v1") },
    ];

    const deltas = computeDeltas(ranked);

    expect(deltas).toHaveLength(1);
    expect(deltas[0].compared_to).toBe("v1");
    expect(deltas[0].score_delta).toBe(3);
    expect(deltas[0].dimension_deltas.ai_patterns).toBe(1);
    expect(deltas[0].dimension_deltas.precision).toBe(1);
    expect(deltas[0].dimension_deltas.rhythm).toBe(1);
  });

  it("recommendation string is non-empty", () => {
    const comparison = aggregateComparison([{ label: "v1", score: 20, report: makeReport([4, 4, 4, 4, 4], "v1") }]);
    expect(comparison.recommendation_reason.length).toBeGreaterThan(0);
  });

  it("handles equal scores with stable ordering", () => {
    const comparison = aggregateComparison([
      { label: "First", score: 20, report: makeReport([4, 4, 4, 4, 4], "First"), itemId: "first" },
      { label: "Second", score: 20, report: makeReport([4, 4, 4, 4, 4], "Second"), itemId: "second" },
    ]);

    expect(comparison.ranking[0].label).toBe("First");
    expect(comparison.ranking[1].label).toBe("Second");
  });
});
