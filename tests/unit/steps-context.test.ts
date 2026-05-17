import { createMockClient } from "../helpers/mock-client.js";
import { runBriefIntake, runDraft, runOutline, runRevise } from "../../src/steps.js";
import type { BriefArtifact, CritiqueArtifact, DraftArtifact, OutlineArtifact } from "../../src/types.js";

const contextBlock = [
  "=== PIPELINE CONTEXT ===",
  "Capability: draft | Requested operation: draft article",
  "User constraints: No first person",
  "=== END PIPELINE CONTEXT ===",
].join("\n");

function lastTaskPrompt(client: ReturnType<typeof createMockClient>): string {
  const session = [...client.sessions.values()].at(-1);
  const prompt = session?.prompts.at(-1);
  const part = Array.isArray(prompt?.parts) ? prompt.parts[0] : null;
  return typeof part === "object" && part !== null && "text" in part ? String(part.text) : "";
}

describe("step context injection", () => {
  const brief: BriefArtifact = {
    objective: "Explain AI governance.",
    audience: "CTOs",
    tone: "analytical",
    format: "article",
    constraints: ["No first person"],
    missing_info: [],
    success_rubric: ["Specific examples"],
  };

  const outline: OutlineArtifact = {
    thesis: "AI governance works when ownership is shared.",
    structure: [{ section: "Intro", intent: "Frame the problem" }],
    risks: [],
    editorial_intent: "Direct and evidence-led.",
  };

  const draft: DraftArtifact = {
    content: "Draft body.",
    word_count: 2,
  };

  const critique: CritiqueArtifact = {
    pass: false,
    overall_score: 18,
    dimensions: {
      ai_patterns: { score: 4, issues: [], strengths: [] },
      tone: { score: 4, issues: [], strengths: [] },
      precision: { score: 4, issues: [], strengths: [] },
      evidence: { score: 3, issues: ["Needs evidence"], strengths: [] },
      rhythm: { score: 3, issues: [], strengths: [] },
    },
    revision_instructions: ["Add evidence."],
    fatal_issues: [],
  };

  it("prepends context to brief intake prompts", async () => {
    const client = createMockClient([{ data: { info: { structured: brief }, parts: [] } }]);

    await runBriefIntake(client as never, "Write an article.", undefined, undefined, undefined, contextBlock);

    const prompt = lastTaskPrompt(client);
    expect(prompt.startsWith(contextBlock)).toBe(true);
    expect(prompt).toContain("RAW BRIEF:");
  });

  it("prepends context to outline prompts", async () => {
    const client = createMockClient([{ data: { info: { structured: outline }, parts: [] } }]);

    await runOutline(client as never, brief, undefined, undefined, undefined, contextBlock);

    const prompt = lastTaskPrompt(client);
    expect(prompt.startsWith(contextBlock)).toBe(true);
    expect(prompt).toContain("BRIEF ARTIFACT:");
  });

  it("prepends context to draft prompts", async () => {
    const client = createMockClient([{ data: { parts: [{ type: "text", text: "## FINAL\nDraft body." }] } }]);

    await runDraft(client as never, brief, outline, undefined, undefined, undefined, contextBlock);

    const prompt = lastTaskPrompt(client);
    expect(prompt.startsWith(contextBlock)).toBe(true);
    expect(prompt).toContain("OUTLINE ARTIFACT:");
  });

  it("prepends context to revise prompts", async () => {
    const client = createMockClient([{ data: { parts: [{ type: "text", text: "## FINAL\nRevised body." }] } }]);

    await runRevise(client as never, draft, critique, undefined, undefined, undefined, contextBlock);

    const prompt = lastTaskPrompt(client);
    expect(prompt.startsWith(contextBlock)).toBe(true);
    expect(prompt).toContain("CRITIQUE ARTIFACT:");
  });
});
