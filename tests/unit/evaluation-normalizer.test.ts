import {
  deduplicateFindings,
  normalizeEvaluationFinding,
  normalizeExcerpt,
  normalizeModuleOutput,
  validateRuleId,
} from "../../src/evaluation-normalizer.js"
import type { EvaluationFinding } from "../../src/types.js"
import { validate } from "../../src/validators.js"

describe("evaluation normalizer", () => {
  it("leaves 79- and 80-character excerpts unchanged and truncates 81-character excerpts to 80 with ellipsis", () => {
    const chars79 = "a".repeat(79)
    const chars80 = "b".repeat(80)
    const chars81 = "c".repeat(81)

    expect(normalizeExcerpt(chars79)).toBe(chars79)
    expect(normalizeExcerpt(chars80)).toBe(chars80)
    expect(normalizeExcerpt(chars81)).toBe(`${"c".repeat(77)}...`)
    expect(normalizeExcerpt(chars81)).toHaveLength(80)
  })

  it("accepts only supported rule id prefixes with dotted namespaces", () => {
    expect(validateRuleId("prose.ai.filler")).toBe(true)
    expect(validateRuleId("voice.profile.banned_phrase")).toBe(true)
    expect(validateRuleId("evidence.fabrication.number_not_in_brief")).toBe(true)
    expect(validateRuleId("format.style.curly_quotes")).toBe(true)
    expect(validateRuleId("system.runtime.degraded")).toBe(true)

    expect(validateRuleId("prose")).toBe(false)
    expect(validateRuleId("custom.ai.thing")).toBe(false)
    expect(validateRuleId("voice" )).toBe(false)
  })

  it("normalizes a valid raw finding and rejects invalid prefixes", () => {
    expect(normalizeEvaluationFinding({
      rule_id: "prose.ai.filler",
      severity: "major",
      excerpt: "  wordy filler phrase  ",
      explanation: "Too vague.",
      score_impact: -2,
      fix_hint: "Tighten it.",
    }, "prose")).toEqual({
      module: "prose",
      rule_id: "prose.ai.filler",
      severity: "major",
      location: null,
      excerpt: "wordy filler phrase",
      explanation: "Too vague.",
      score_impact: -2,
      fix_hint: "Tighten it.",
      duplicate_key: null,
    })

    expect(normalizeEvaluationFinding({
      rule_id: "custom.ai.thing",
      severity: "major",
      excerpt: "bad",
      explanation: "bad",
      score_impact: -1,
      fix_hint: "fix",
    }, "prose")).toBeNull()
  })

  it("deduplicates by duplicate key or tuple and keeps the exact highest-severity survivor", () => {
    const findings: EvaluationFinding[] = [
      {
        module: "prose",
        rule_id: "prose.ai.filler",
        severity: "minor",
        location: "p1",
        excerpt: "generic phrase",
        explanation: "Minor issue",
        score_impact: -1,
        fix_hint: "Tighten it",
        duplicate_key: null,
      },
      {
        module: "prose",
        rule_id: "prose.ai.filler",
        severity: "major",
        location: "p1",
        excerpt: "generic phrase",
        explanation: "Material issue",
        score_impact: -2,
        fix_hint: "Rewrite it",
        duplicate_key: null,
      },
      {
        module: "voice",
        rule_id: "voice.profile.banned_phrase",
        severity: "blocking",
        location: "p2",
        excerpt: "game-changing",
        explanation: "Explicitly banned",
        score_impact: -3,
        fix_hint: "Remove it",
        duplicate_key: "voice-ban-1",
      },
      {
        module: "voice",
        rule_id: "voice.profile.banned_phrase",
        severity: "minor",
        location: "p2",
        excerpt: "game-changing",
        explanation: "Duplicate weaker copy",
        score_impact: -1,
        fix_hint: "Remove it",
        duplicate_key: "voice-ban-1",
      },
    ] as const

    expect(deduplicateFindings(findings)).toEqual([
      {
        module: "prose",
        rule_id: "prose.ai.filler",
        severity: "major",
        location: "p1",
        excerpt: "generic phrase",
        explanation: "Material issue",
        score_impact: -2,
        fix_hint: "Rewrite it",
        duplicate_key: null,
      },
      {
        module: "voice",
        rule_id: "voice.profile.banned_phrase",
        severity: "blocking",
        location: "p2",
        excerpt: "game-changing",
        explanation: "Explicitly banned",
        score_impact: -3,
        fix_hint: "Remove it",
        duplicate_key: "voice-ban-1",
      },
    ])
  })

  it("returns a degraded module envelope for null raw output", () => {
    const result = normalizeModuleOutput(null, "prose-evaluator")

    expect(result).toEqual({
      module_id: "prose-evaluator",
      status: "degraded",
      skipped: false,
      findings: [],
      summary: "Invalid prose-evaluator output: expected an object.",
      errors: ["Invalid prose-evaluator output: expected an object."],
    })
  })

  it("normalizes valid module output and preserves metrics", () => {
    const result = normalizeModuleOutput({
      module_id: "voice-evaluator",
      status: "ok",
      skipped: false,
      findings: [
        {
          rule_id: "voice.profile.banned_phrase",
          severity: "major",
          location: "p1",
          excerpt: "overheated phrase",
          explanation: "Not in voice.",
          score_impact: -2,
          fix_hint: "Use calmer wording.",
        },
      ],
      summary: "One voice issue found.",
      metrics: {
        total_tokens: 42,
        total_cost: 0.12,
        duration_ms: 900,
        model_id: "gpt-test",
        provider_id: "openai",
      },
    }, "voice-evaluator")

    expect(result).toEqual({
      module_id: "voice-evaluator",
      status: "ok",
      skipped: false,
      findings: [
        {
          module: "voice",
          rule_id: "voice.profile.banned_phrase",
          severity: "major",
          location: "p1",
          excerpt: "overheated phrase",
          explanation: "Not in voice.",
          score_impact: -2,
          fix_hint: "Use calmer wording.",
          duplicate_key: null,
        },
      ],
      summary: "One voice issue found.",
      metrics: {
        total_tokens: 42,
        total_cost: 0.12,
        duration_ms: 900,
        model_id: "gpt-test",
        provider_id: "openai",
      },
    })
  })

  it("validates EvaluationFinding and ModuleOutput schemas with explicit pass/fail cases", () => {
    const validFinding = {
      module: "prose",
      rule_id: "prose.ai.filler",
      severity: "minor",
      location: null,
      excerpt: "short excerpt",
      explanation: "Need tighter wording.",
      score_impact: -1,
      fix_hint: "Trim the filler.",
      duplicate_key: null,
    }
    const invalidFinding = { ...validFinding, rule_id: "custom.ai.thing" }
    const validModule = {
      module_id: "prose-evaluator",
      status: "ok",
      skipped: false,
      findings: [validFinding],
      summary: "One issue found.",
    }
    const invalidModule = { ...validModule, status: "failed" }

    expect(validate("EvaluationFinding", validFinding)).toEqual({ valid: true, errors: [] })
    expect(validate("EvaluationFinding", invalidFinding).valid).toBe(false)
    expect(validate("ModuleOutput", validModule)).toEqual({ valid: true, errors: [] })
    expect(validate("ModuleOutput", invalidModule).valid).toBe(false)
  })
})
