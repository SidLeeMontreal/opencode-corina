import { validate } from "../../src/validators.js"

describe("tone schemas", () => {
  it("passes a valid ToneInputArtifact", () => {
    const result = validate("ToneInputArtifact", {
      original_text: "Automation can improve customer service when the workflow is well defined.",
      source_path: null,
      voice: "journalist",
      format: "article",
      audience: "CMOs",
      brand_profile: null,
      tone_description: null,
      personal_tone_profile: null,
      preservation_instructions: ["Preserve names and numbers."],
      detected_source_format: "article",
      source_metrics: {
        character_count: 74,
        word_count: 10,
        paragraph_count: 1,
        heading_count: 0,
      },
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("passes a valid ToneOutputArtifact", () => {
    const result = validate("ToneOutputArtifact", {
      rewritten_content: "Automation can speed up routine service work when the workflow is clear.",
      final_content: "Automation can speed up routine service work when the workflow is clear.",
      voice_applied: "journalist",
      format_applied: "article",
      changes_summary: ["Applied journalist voice rules."],
      humanizer_score: {
        score: 100,
        remaining_flags: [],
      },
      preservation_check: {
        meaning_preserved: true,
        flagged_drift: [],
      },
      validator_notes: ["No key AI patterns found."],
      assumptions: ["Voice inferred as journalist."],
      validation_score: 96,
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("passes valid detection schemas", () => {
    const layer2 = validate("Layer2Analysis", {
      ran: true,
      score_adjustment: 0.04,
      confirmed_patterns: ["ai_vocabulary"],
      dismissed_patterns: [],
      additional_findings: [],
      reasoning_notes: ["Confirmed by surrounding promotional phrasing."],
    })

    const report = validate("DetectionReport", {
      overall_score: 0.58,
      confidence: "medium",
      verdict: "possibly_ai",
      summary: "Several AI-like patterns appear, but this is not proof of authorship.",
      input: {
        source_type: "text",
        source_path: null,
        character_count: 120,
        word_count: 20,
        paragraph_count: 1,
        sentence_count: 2,
      },
      patterns_found: [
        {
          pattern_id: "ai_vocabulary",
          pattern_name: "AI vocabulary words",
          category: "language",
          severity: "medium",
          confidence: "high",
          matched_text: "Additionally",
          normalized_match: "additionally",
          location_hint: "paragraph 1, sentence 1",
          char_start: 0,
          char_end: 12,
          rule_source: "layer_1",
          explanation: "Generic connector.",
          fix_suggestion: "Delete it.",
          context_before: "",
          context_after: "the platform...",
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
        score_adjustment: 0.04,
        confirmed_patterns: ["ai_vocabulary"],
        dismissed_patterns: [],
        additional_findings: [],
        reasoning_notes: ["Confirmed by surrounding promotional phrasing."],
      },
      assumptions: ["Verdict describes pattern density, not proven authorship."],
    })

    expect(layer2.valid).toBe(true)
    expect(layer2.errors).toEqual([])
    expect(report.valid).toBe(true)
    expect(report.errors).toEqual([])
  })
})
