import { formatInline, formatJson, formatReport } from "../../src/detect-formatters.js";
import type { DetectionReport } from "../../src/types.js";

const report: DetectionReport = {
  overall_score: 0.58,
  confidence: "medium",
  verdict: "possibly_ai",
  summary: "Several AI-like patterns appear, but this is not proof of authorship.",
  input: {
    source_type: "text",
    source_path: null,
    character_count: 46,
    word_count: 7,
    paragraph_count: 1,
    sentence_count: 1,
  },
  patterns_found: [
    {
      pattern_id: "ai_vocabulary",
      pattern_name: "AI vocabulary words",
      category: "language",
      severity: "medium",
      confidence: "high",
      matched_text: "showcases",
      normalized_match: "showcases",
      location_hint: "paragraph 1, sentence 1",
      char_start: 13,
      char_end: 22,
      rule_source: "layer_1",
      explanation: "Generic AI-favored verb in promotional exposition.",
      fix_suggestion: "Replace with a plain verb or cut it.",
      context_before: "The platform",
      context_after: "a vibrant ecosystem.",
    },
  ],
  pattern_counts: {
    by_pattern: { ai_vocabulary: 1 },
    by_category: { language: 1 },
    by_severity: { high: 0, medium: 1, low: 0 },
  },
  top_signals: ["AI vocabulary words x1 near paragraph 1, sentence 1"],
  layer_1_scan: {
    score: 0.32,
    deep_recommended: true,
    rules_triggered: ["ai_vocabulary"],
    ambiguous_patterns: [],
    notes: ["Signals: clustered_ai_vocabulary."],
  },
  layer_2_analysis: {
    ran: true,
    score_adjustment: 0.03,
    confirmed_patterns: ["ai_vocabulary"],
    dismissed_patterns: [],
    additional_findings: [],
    reasoning_notes: ["The phrasing is generic and reinforced by surrounding promotion."],
  },
  assumptions: [
    "Verdict describes pattern density, not proven authorship.",
    "Human writing can trigger these signals, and edited AI text can avoid them.",
  ],
};

describe("detect formatters", () => {
  it("formatReport returns string with verdict and findings", () => {
    const output = formatReport(report);

    expect(output).toContain("Verdict: possibly_ai");
    expect(output).toContain("AI vocabulary words");
  });

  it("formatJson returns valid JSON", () => {
    const output = formatJson(report);

    expect(JSON.parse(output).verdict).toBe("possibly_ai");
  });

  it('formatInline on clean text returns "No patterns detected"', () => {
    const cleanOutput = formatInline("Plain human sentence.", {
      ...report,
      verdict: "clean",
      overall_score: 0,
      confidence: "high",
      patterns_found: [],
      pattern_counts: { by_pattern: {}, by_category: {}, by_severity: { high: 0, medium: 0, low: 0 } },
      top_signals: [],
    });

    expect(cleanOutput).toContain("No patterns detected");
  });

  it("formatInline with findings contains [FLAG: markers", () => {
    const output = formatInline("The platform showcases a vibrant ecosystem.", report);

    expect(output).toContain("[FLAG:");
  });
});
