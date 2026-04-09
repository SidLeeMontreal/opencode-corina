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
        ai_patterns: { score: 5, issues: [] },
        corina_tone: { score: 4, issues: [] },
        precision: { score: 4, issues: [] },
        evidence: { score: 4, issues: [] },
        rhythm: { score: 5, issues: [] },
      },
      revision_instructions: [],
      fatal_issues: [],
    })

    expect(result.valid).toBe(true)
  })

  it("fails when a critique score is out of range", () => {
    const result = validate("CritiqueArtifact", {
      pass: false,
      overall_score: 22,
      dimensions: {
        ai_patterns: { score: 6, issues: ["Too polished"] },
        corina_tone: { score: 4, issues: [] },
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
})
