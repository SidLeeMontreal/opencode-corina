import { describe, expect, it } from "vitest";

import { runConciseWithArtifact } from "../../src/concise.js";
import { runCritiqueWithArtifact } from "../../src/critique.js";
import { runDetectWithArtifact } from "../../src/detect.js";
import { runTonePipelineWithArtifact } from "../../src/tone-pipeline.js";
import { createMockClient } from "../helpers/mock-client.js";

function createBrokenClient() {
  return {
    session: {
      async create() {
        throw new Error("session create failed");
      },
    },
  };
}

describe("public tool envelope behavior", () => {
  it("returns a persistable tone envelope on success", async () => {
    const client = createMockClient([
      { data: { parts: [{ type: "text", text: "## ASSUMPTIONS\n- Preserved named entities.\n## REWRITTEN CONTENT\nA cleaner rewritten version." }] } },
      {
        data: {
          info: {
            structured: {
              pass: true,
              validation_score: 97,
              voice_checks: ["Applied requested voice."],
              preservation_checks: ["Meaning preserved."],
              entity_gaps: [],
              ai_patterns_found: [],
              format_match: true,
              validator_notes: ["Validator passed."],
              correction_instructions: [],
            },
          },
        },
      },
    ]);

    const output = await runTonePipelineWithArtifact({ text: "Original draft.", voice: "journalist" }, client as never);

    expect(output.capability).toBe("tone");
    expect(output.outcome).toBe("success");
    expect(output.should_persist).toBe(true);
    expect(output.artifact?.final_content).toBe("A cleaner rewritten version.");
    expect(output.warnings).toEqual([]);
  });

  it("returns a degraded tone envelope for empty input", async () => {
    const output = await runTonePipelineWithArtifact({ text: "" }, createMockClient() as never);

    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(true);
    expect(output.artifact).not.toBeNull();
    expect(output.warnings.length).toBeGreaterThan(0);
  });

  it("returns a failed tone envelope instead of throwing", async () => {
    const output = await runTonePipelineWithArtifact({ text: "Hello world.", voice: "journalist" }, createBrokenClient() as never);

    expect(output.outcome).toBe("failed");
    expect(output.should_persist).toBe(false);
    expect(output.artifact).toBeNull();
  });

  it("returns a non-persistable degraded critique envelope for empty input", async () => {
    const output = await runCritiqueWithArtifact([], { mode: "quality" }, createMockClient() as never);

    expect(output.capability).toBe("critique");
    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(false);
    expect(output.artifact).not.toBeNull();
  });

  it("degrades critique when live evaluators fail but a fallback report still exists", async () => {
    const output = await runCritiqueWithArtifact(["Need a critique."], { mode: "quality" }, createBrokenClient() as never);

    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(false);
    expect(output.artifact).not.toBeNull();
  });

  it("returns a non-persistable degraded detect envelope for empty input", async () => {
    const output = await runDetectWithArtifact({ text: "", format: "report" }, createMockClient() as never);

    expect(output.capability).toBe("detect");
    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(false);
    expect(output.artifact).not.toBeNull();
  });

  it("returns a failed detect envelope instead of throwing", async () => {
    const output = await runDetectWithArtifact({ text: "Additionally, this showcases a transformative platform." }, createBrokenClient() as never);

    expect(output.outcome).toBe("failed");
    expect(output.should_persist).toBe(false);
    expect(output.artifact).toBeNull();
  });

  it("returns a persistable concise envelope on success", async () => {
    const client = createMockClient([
      { data: { parts: [{ type: "text", text: '<concise_audit>{"heat_map":[],"audit_rows":[],"unresolved_issues":[]}</concise_audit>' }] } },
      {
        data: {
          parts: [
            {
              type: "text",
              text: '<concise_revision>{"revised_text":"Shorter final draft.","revision_log":[],"preservation_check":{"facts":true,"nuance":true,"argument_function":true,"evidence":true,"tone_voice":true,"chronology":true},"unresolved_issues":[]}</concise_revision>',
            },
          ],
        },
      },
    ]);

    const output = await runConciseWithArtifact({ text: "This is a slightly longer original draft that can be tightened.", mode: "quick" }, client as never);

    expect(output.capability).toBe("concise");
    expect(output.outcome).toBe("success");
    expect(output.should_persist).toBe(true);
    expect(output.artifact?.revised_draft).toBe("Shorter final draft.");
  });

  it("returns a persistable degraded concise envelope for empty input", async () => {
    const output = await runConciseWithArtifact({ text: "", mode: "quick" }, createMockClient() as never);

    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(true);
    expect(output.artifact).not.toBeNull();
  });

  it("degrades concise when rewrite passes fail but a fallback artifact still exists", async () => {
    const output = await runConciseWithArtifact({ text: "Need to tighten this paragraph.", mode: "quick" }, createBrokenClient() as never);

    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(true);
    expect(output.artifact).not.toBeNull();
  });
});
