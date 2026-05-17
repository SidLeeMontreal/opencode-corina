import {
  buildContextBlock,
  contextDeltaFromBriefArtifact,
  contextDeltaFromCritiqueArtifact,
  initializePipelineExecutionContext,
  mergePipelineExecutionContextDelta,
} from "../../src/execution-context.js";
import type { BriefArtifact, CritiqueArtifact } from "../../src/types.js";

describe("execution context", () => {
  it("initializes a minimal draft context", () => {
    const context = initializePipelineExecutionContext({
      runId: "run-1",
      capability: "draft",
      requestedOperation: "draft article",
      userIntentSummary: "Write an article about operational AI governance.",
    });

    expect(context.run_id).toBe("run-1");
    expect(context.capability).toBe("draft");
    expect(context.content.scope).toBe("full_document");
    expect(context.findings).toEqual([]);
  });

  it("serializes stable empty sections instead of omitting context", () => {
    const context = initializePipelineExecutionContext({
      runId: "run-1",
      capability: "draft",
      userIntentSummary: "Write a concise memo.",
    });

    const block = buildContextBlock(context);

    expect(block).toContain("=== PIPELINE CONTEXT ===");
    expect(block).toContain("Capability: draft");
    expect(block).toContain("User constraints: none");
    expect(block).toContain("Prior findings:\n- none");
    expect(block).toContain("=== END PIPELINE CONTEXT ===");
  });

  it("sorts and caps findings deterministically", () => {
    const context = initializePipelineExecutionContext({
      runId: "run-1",
      capability: "draft",
      findings: [
        { step: "draft", type: "risk", severity: "low", summary: "Small issue" },
        { step: "audit", type: "blocker", severity: "fatal", summary: "Blocking issue" },
        { step: "critique", type: "revision", severity: "major", summary: "Major issue" },
      ],
    });

    const block = buildContextBlock(context, { maxFindings: 2 });

    expect(block).toContain("- audit: [fatal] Blocking issue");
    expect(block).toContain("- critique: [major] Major issue");
    expect(block).not.toContain("Small issue");
  });

  it("merges deltas with de-duplicated list fields", () => {
    const context = initializePipelineExecutionContext({
      runId: "run-1",
      capability: "draft",
      userConstraints: ["No first person"],
      voice: {
        name: null,
        tone_description: null,
        key_rules: ["No hype"],
        banned_patterns: [],
      },
    });

    const merged = mergePipelineExecutionContextDelta(context, {
      user_constraints: ["No first person", "Keep dates"],
      voice: {
        name: "journalist",
        key_rules: ["No hype", "Precise claims"],
      },
      step_history: ["brief_intake", "brief_intake"],
    });

    expect(merged.user_constraints).toEqual(["No first person", "Keep dates"]);
    expect(merged.voice.name).toBe("journalist");
    expect(merged.voice.key_rules).toEqual(["No hype", "Precise claims"]);
    expect(merged.step_history).toEqual(["brief_intake"]);
  });

  it("derives context from brief artifacts", () => {
    const brief: BriefArtifact = {
      objective: "Explain why AI governance fails when legal owns it alone.",
      audience: "CTOs",
      tone: "analytical",
      format: "article",
      constraints: ["No first person"],
      missing_info: ["Need preferred length"],
      success_rubric: ["Concrete examples"],
    };

    const delta = contextDeltaFromBriefArtifact(brief);

    expect(delta.user_intent_summary).toBe(brief.objective);
    expect(delta.content?.audience).toBe("CTOs");
    expect(delta.user_constraints).toEqual(["No first person"]);
    expect(delta.findings?.[0]?.type).toBe("missing_info");
  });

  it("derives compact findings from critique artifacts", () => {
    const critique: CritiqueArtifact = {
      pass: false,
      overall_score: 18,
      dimensions: {
        ai_patterns: { score: 4, issues: [], strengths: [] },
        tone: { score: 4, issues: [], strengths: [] },
        precision: { score: 4, issues: [], strengths: [] },
        evidence: { score: 3, issues: ["Weak proof"], strengths: [] },
        rhythm: { score: 3, issues: [], strengths: [] },
      },
      revision_instructions: ["Add evidence to paragraph 3."],
      fatal_issues: ["Invented statistic."],
    };

    const delta = contextDeltaFromCritiqueArtifact(critique, 1);

    expect(delta.findings).toEqual([
      expect.objectContaining({ severity: "fatal", summary: "Invented statistic." }),
      expect.objectContaining({ severity: "major", summary: "Add evidence to paragraph 3." }),
    ]);
    expect(delta.step_history).toEqual(["critique_pass_1"]);
  });
});
