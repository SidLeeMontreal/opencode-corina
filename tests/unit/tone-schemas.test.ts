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
})
