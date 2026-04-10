import {
  applyLayer2Adjustment,
  confidenceFromScore,
  scoreFindings,
  summaryFromVerdict,
  verdictFromScore,
} from "../../src/detect-scoring.js";
import type { PatternFinding } from "../../src/types.js";

function finding(overrides: Partial<PatternFinding> = {}): PatternFinding {
  return {
    pattern_id: "ai_vocabulary",
    pattern_name: "AI vocabulary",
    category: "language",
    severity: "medium",
    confidence: "medium",
    matched_text: "Additionally",
    normalized_match: "additionally",
    location_hint: "paragraph 1, sentence 1",
    char_start: 0,
    char_end: 12,
    rule_source: "layer_1",
    explanation: "Common AI-style connector.",
    fix_suggestion: "Delete the connector.",
    context_before: "",
    context_after: "the platform",
    ...overrides,
  };
}

describe("detect scoring", () => {
  it("scoreFindings returns 0.0 with no findings", () => {
    expect(scoreFindings([])).toBe(0);
  });

  it("scoreFindings applies weighted severity/confidence math", () => {
    const score = scoreFindings([
      finding({ severity: "high", confidence: "high" }),
      finding({ severity: "medium", confidence: "medium", pattern_id: "promotional_language", category: "content" }),
      finding({ severity: "low", confidence: "low", pattern_id: "vague_attributions", category: "style" }),
    ]);

    expect(score).toBe(0.17);
  });

  it("applies cluster bonus when 3+ categories are represented", () => {
    const score = scoreFindings([
      finding({ severity: "high", confidence: "high", category: "language" }),
      finding({ severity: "medium", confidence: "medium", pattern_id: "promotional_language", category: "content" }),
      finding({ severity: "medium", confidence: "medium", pattern_id: "false_ranges", category: "style" }),
    ]);

    expect(score).toBe(0.2);
  });

  it("maps score to verdict thresholds", () => {
    expect(verdictFromScore(0.05)).toBe("clean");
    expect(verdictFromScore(0.25)).toBe("probably_human");
    expect(verdictFromScore(0.55)).toBe("possibly_ai");
    expect(verdictFromScore(0.8)).toBe("likely_ai");
  });

  it("summaryFromVerdict returns non-empty text for all verdicts", () => {
    for (const verdict of ["clean", "probably_human", "possibly_ai", "likely_ai"]) {
      expect(summaryFromVerdict(verdict)).not.toHaveLength(0);
    }
  });

  it("applyLayer2Adjustment clamps safely and confidenceFromScore returns valid values", () => {
    expect(applyLayer2Adjustment(0.1, -0.3)).toBe(0);
    expect(applyLayer2Adjustment(0.9, 0.3)).toBe(1);
    expect(confidenceFromScore(0.05, 0)).toBe("high");
    expect(confidenceFromScore(0.25, 2)).toBe("medium");
    expect(confidenceFromScore(0.8, 6)).toBe("high");
  });
});
