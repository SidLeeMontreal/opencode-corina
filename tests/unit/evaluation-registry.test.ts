import {
  buildEvaluationContextFromCritiqueArgs,
  buildEvaluationContextFromWorkflowState,
  selectModules,
} from "../../src/evaluation-registry.js"
import { loadRubric } from "../../src/critique-rubric.js"
import type { EvaluationContext, WorkflowState } from "../../src/types.js"

describe("evaluation registry", () => {
  function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
    return {
      kind: "critic",
      draft_text: "A clean draft.",
      brief_text: "Brief",
      requested_voice: "persuasive",
      requested_format: "article",
      voice_prompt: "voice profile",
      brand_profile: null,
      user_constraints: [],
      mode: "quality",
      audience: null,
      rubric_id: null,
      rubric_text: null,
      metadata: {},
      ...overrides,
    }
  }

  it("selects prose, voice, evidence, then critic adjudicator for persuasive critic runs", () => {
    expect(selectModules(context({ requested_voice: "persuasive" }), "critic").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "evidence-evaluator",
      "critic-adjudicator",
    ])
  })

  it("includes evidence for journalist voice", () => {
    expect(selectModules(context({ requested_voice: "journalist" }), "critic").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "evidence-evaluator",
      "critic-adjudicator",
    ])
  })

  it("excludes evidence for ux voice", () => {
    expect(selectModules(context({ requested_voice: "ux" }), "critic").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "critic-adjudicator",
    ])
  })

  it("keeps voice evaluator when no voice profile is available", () => {
    expect(selectModules(context({ requested_voice: null, voice_prompt: null }), "critic").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "critic-adjudicator",
    ])
  })

  it("includes format auditor for audit slide runs", () => {
    expect(selectModules(context({ kind: "auditor", requested_voice: "ux", requested_format: "slide" }), "auditor").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "format-auditor",
      "auditor-adjudicator",
    ])
  })

  it("excludes format auditor for critic article runs", () => {
    expect(selectModules(context({ kind: "critic", requested_format: "article" }), "critic").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "evidence-evaluator",
      "critic-adjudicator",
    ])
  })

  it("excludes format auditor for unsupported audit format", () => {
    expect(selectModules(context({ kind: "auditor", requested_voice: "ux", requested_format: "other" }), "auditor").map((module) => module.id)).toEqual([
      "prose-evaluator",
      "voice-evaluator",
      "auditor-adjudicator",
    ])
  })

  it("builds critique evaluation context with inferred defaults", () => {
    const result = buildEvaluationContextFromCritiqueArgs({ mode: "quality" }, "According to the report, revenue grew.", "Use sourced claims.")

    expect(result.kind).toBe("critic")
    expect(result.requested_voice).toBe("journalist")
    expect(result.requested_format).toBe("article")
    expect(result.brief_text).toBe("Use sourced claims.")
    expect(result.metadata.pipeline_step).toBe("critique")
  })

  it("maps audience mode into evaluation context", () => {
    const result = buildEvaluationContextFromCritiqueArgs(
      { mode: "audience", audience: "cmo" },
      "Roadmap update for revenue leaders.",
      "Keep it clear.",
    )

    expect(result.mode).toBe("audience")
    expect(result.audience).toBe("cmo")
    expect(result.rubric_id).toBeNull()
    expect(result.rubric_text).toBeNull()
  })

  it("maps rubric mode into evaluation context", () => {
    const rubric = loadRubric("corina")
    const result = buildEvaluationContextFromCritiqueArgs(
      { mode: "rubric", rubric: "corina" },
      "According to the report, revenue grew.",
      "Use sourced claims.",
      rubric,
    )

    expect(result.mode).toBe("rubric")
    expect(result.rubric_id).toBe("corina")
    expect(result.rubric_text).toContain("Pass threshold")
    expect(result.audience).toBeNull()
  })

  it("builds workflow-state evaluation context with forwarded lightweight bridge fields", () => {
    const state: WorkflowState = {
      briefText: "Original brief",
      briefArtifact: undefined,
      draftArtifact: { content: "Draft text", word_count: 2 },
      critiquePasses: 1,
      warnings: [],
      requested_voice: "brand",
      voice_prompt: "Brand voice rules",
      user_constraints: ["No hype", "Straight quotes only"],
    }

    const result = buildEvaluationContextFromWorkflowState(state, "audit")

    expect(result.kind).toBe("auditor")
    expect(result.requested_voice).toBe("brand")
    expect(result.voice_prompt).toBe("Brand voice rules")
    expect(result.user_constraints).toEqual(["No hype", "Straight quotes only"])
    expect(result.metadata.critique_pass).toBe(1)
  })
})
