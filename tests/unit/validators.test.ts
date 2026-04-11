import { validate } from "../../src/validators.js"

describe("validators", () => {
  it("passes a valid BriefArtifact", () => {
    const result = validate("BriefArtifact", {
      objective: "Write a sharp intro for a CMO white paper.",
      audience: "CMOs at consumer brands",
      tone: "analytical",
      format: "white paper",
      constraints: ["No hype"],
      missing_info: [],
      success_rubric: ["Clear argument"],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("fails when a required brief field is missing", () => {
    const result = validate("BriefArtifact", {
      audience: "CMOs at consumer brands",
      tone: "analytical",
      format: "white paper",
      constraints: [],
      missing_info: [],
      success_rubric: ["Clear argument"],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.join(" ")).toContain("objective")
  })

  it("passes a valid CritiqueArtifact", () => {
    const result = validate("CritiqueArtifact", {
      pass: true,
      overall_score: 22,
      dimensions: {
        ai_patterns: { score: 6, issues: [] },
        tone: { score: 5, issues: [] },
        precision: { score: 5, issues: [] },
        evidence: { score: 4, issues: [] },
        rhythm: { score: 6, issues: [] },
      },
      revision_instructions: [],
      fatal_issues: [],
    })

    expect(result.valid).toBe(true)
  })

  it("fails when a critique score is out of range", () => {
    const result = validate("CritiqueArtifact", {
      pass: false,
      overall_score: 31,
      dimensions: {
        ai_patterns: { score: 7, issues: ["Too polished"] },
        tone: { score: 4, issues: [] },
        precision: { score: 4, issues: [] },
        evidence: { score: 4, issues: [] },
        rhythm: { score: 5, issues: [] },
      },
      revision_instructions: ["Tighten phrasing"],
      fatal_issues: [],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.join(" ")).toContain("score")
  })

  it("passes a valid AuditArtifact", () => {
    const result = validate("AuditArtifact", {
      approved_for_delivery: false,
      ai_patterns_remaining: ["tapestry"],
      banned_words_remaining: ["innovative"],
      style_violations: ["Too promotional"],
      publishability_note: "Needs another pass before delivery.",
      final_content: null,
    })

    expect(result.valid).toBe(true)
  })

  it("allows approval with empty issue arrays", () => {
    const result = validate("AuditArtifact", {
      approved_for_delivery: true,
      ai_patterns_remaining: [],
      banned_words_remaining: [],
      style_violations: [],
      publishability_note: "Approved for delivery.",
      final_content: "Clean final copy.",
    })

    expect(result.valid).toBe(true)
  })

  it("passes a valid ConciseArtifact", () => {
    const result = validate("ConciseArtifact", {
      mode: "quick",
      original_word_count: 20,
      revised_word_count: 14,
      compression_ratio: 0.7,
      revised_draft: "A tighter version of the draft.",
      heat_map: [{ tag: "REDUND", severity: "Moderate", count: 1 }],
      revision_log: [
        {
          id: "R1",
          original_excerpt: "really very important",
          tags: ["REDUND"],
          solution_move: "Merge or delete",
          new_text: "important",
          scope: "Target",
        },
      ],
      preservation_check: {
        facts: true,
        nuance: true,
        argument_function: true,
        evidence: true,
        tone_voice: true,
        chronology: true,
      },
      unresolved_issues: [],
    })

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })
})
