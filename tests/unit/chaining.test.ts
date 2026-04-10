import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/detect-layer2.js", () => ({
  runLayer2Analysis: vi.fn(async () => ({
    ran: true,
    score_adjustment: 0,
    confirmed_patterns: [],
    dismissed_patterns: [],
    reasoning_notes: [],
    additional_findings: [],
  })),
}));

vi.mock("../../src/pipeline.js", () => ({
  runPipelineWithArtifact: vi.fn(async () => ({
    agent: "corina",
    capability: "pipeline",
    version: "test",
    timestamp: new Date().toISOString(),
    input_summary: "mock pipeline",
    artifact: {
      final_content: "Rewritten to remove AI patterns.",
      audit: {
        approved_for_delivery: true,
        ai_patterns_remaining: [],
        banned_words_remaining: [],
        style_violations: [],
        publishability_note: "ok",
        final_content: "Rewritten to remove AI patterns.",
      },
    },
    rendered: "Rewritten to remove AI patterns.",
  })),
}));

import { buildBriefFromCritique, inferVoiceFromAudience } from "../../src/critique.js";
import { runDetectWithArtifact } from "../../src/detect.js";
import type { CritiqueReport } from "../../src/types.js";
import { createMockClient } from "../helpers/mock-client.js";

const sampleCritique: CritiqueReport = {
  status: "ok",
  pass: false,
  overall_score: 12,
  pass_threshold: 20,
  dimensions: {
    ai_patterns: { score: 2, issues: ["Too many AI clichés"], strengths: [] },
    corina_tone: { score: 3, issues: ["Too polished"], strengths: [] },
    precision: { score: 2, issues: ["Claims are vague"], strengths: [] },
    evidence: { score: 2, issues: ["Missing support"], strengths: [] },
    rhythm: { score: 3, issues: ["Sentence lengths feel uniform"], strengths: [] },
  },
  issues: [
    {
      id: "issue-1",
      dimension: "ai_patterns",
      severity: "high",
      summary: "The draft sounds generic.",
      fix_direction: "Replace abstract phrasing with concrete observations.",
    },
    {
      id: "issue-2",
      dimension: "evidence",
      severity: "medium",
      summary: "Claims need proof.",
      fix_direction: "Add a source or specific example.",
    },
  ],
  strengths: ["Clear topic."],
  revision_instructions: ["Keep the central claim, but make it more specific."],
  fatal_issues: ["Reads like boilerplate."],
  assumptions: [],
};

describe("Live chaining helpers", () => {
  it("buildBriefFromCritique produces a usable brief with critique issues", () => {
    const brief = buildBriefFromCritique("Original draft text.", sampleCritique);

    expect(brief).toContain("Original draft text.");
    expect(brief).toContain("The draft sounds generic.");
    expect(brief).toContain("Add a source or specific example.");
    expect(brief.length).toBeGreaterThan(80);
  });

  it("infers tone voice from audience", () => {
    expect(inferVoiceFromAudience("cmo")).toBe("executive");
    expect(inferVoiceFromAudience("developer")).toBe("technical");
    expect(inferVoiceFromAudience("general")).toBe("persuasive");
  });

  it("records chained_to when detect chains into pipeline", async () => {
    const client = createMockClient();

    const output = await runDetectWithArtifact(
      {
        text: "Additionally, this innovative platform showcases a transformative approach across every touchpoint.",
        chain: "pipeline",
        format: "report",
      },
      client as never,
    );

    expect(output.chained_to).toBe("pipeline");
    expect(output.chain_result).toBeDefined();
    expect(output.rendered).toContain("Chain result (pipeline)");
  });

  it("omits chain_result when no chain is requested", async () => {
    const client = createMockClient();

    const output = await runDetectWithArtifact(
      {
        text: "This paragraph is plain and specific. It says what happened and why it matters.",
        format: "report",
      },
      client as never,
    );

    expect(output.chained_to).toBeUndefined();
    expect(output.chain_result).toBeUndefined();
  });
});
