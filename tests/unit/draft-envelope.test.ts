import { describe, expect, it } from "vitest"

import { createToolEnvelope } from "../../src/capability-output.js"

describe("draft public envelope", () => {
  it("marks successful drafted content as persistable canonical output", () => {
    const output = createToolEnvelope({
      capability: "draft",
      outcome: "success",
      shouldPersist: true,
      artifact: {
        final_content: "Canonical final draft.",
        audit: {
          approved_for_delivery: true,
          ai_patterns_remaining: [],
          banned_words_remaining: [],
          style_violations: [],
          publishability_note: "ok",
          final_content: "Canonical final draft.",
        },
      },
      rendered: "Canonical final draft.",
      warnings: [],
      inputSummary: "Pipeline brief provided (12 words).",
      metrics: { total_tokens: 10, total_cost: 0 },
    })

    expect(output.agent).toBe("corina")
    expect(output.capability).toBe("draft")
    expect(output.outcome).toBe("success")
    expect(output.should_persist).toBe(true)
    expect(output.artifact?.final_content).toBe("Canonical final draft.")
    expect(output.rendered).toBe("Canonical final draft.")
    expect(output.warnings).toEqual([])
  })

  it("surfaces degraded draft output without changing the canonical artifact", () => {
    const output = createToolEnvelope({
      capability: "draft",
      outcome: "degraded",
      shouldPersist: true,
      artifact: {
        final_content: "Canonical draft body.",
        audit: {
          approved_for_delivery: false,
          ai_patterns_remaining: ["Generic opener"],
          banned_words_remaining: [],
          style_violations: [],
          publishability_note: "Needs another pass.",
          final_content: null,
          degraded: true,
        },
      },
      rendered: "Canonical draft body.\n\n[Corina warning]\nNeeds another pass.",
      warnings: ["Needs another pass."],
      inputSummary: "Pipeline brief provided (12 words).",
      metrics: {},
    })

    expect(output.outcome).toBe("degraded")
    expect(output.should_persist).toBe(true)
    expect(output.artifact?.final_content).toBe("Canonical draft body.")
    expect(output.rendered).toContain("[Corina warning]")
    expect(output.warnings).toEqual(["Needs another pass."])
  })

  it("returns artifact null on failed draft output", () => {
    const output = createToolEnvelope({
      capability: "draft",
      outcome: "failed",
      shouldPersist: false,
      artifact: null,
      rendered: "Corina draft failed: OutlineArtifact validation failed.",
      warnings: ["Corina draft failed: OutlineArtifact validation failed."],
      inputSummary: "Pipeline brief provided (12 words).",
      metrics: {},
    })

    expect(output.outcome).toBe("failed")
    expect(output.should_persist).toBe(false)
    expect(output.artifact).toBeNull()
    expect(output.rendered).toContain("draft failed")
    expect(output.warnings).toHaveLength(1)
  })
})
