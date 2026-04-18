import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createOpencodeClient } from "@opencode-ai/sdk";
import { beforeAll, describe, expect, it } from "vitest";

import { runConciseWithArtifact } from "../../src/concise.js";

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098";

describe("Concise E2E", { timeout: 600_000 }, () => {
  let client: ReturnType<typeof createOpencodeClient>;

  beforeAll(() => {
    client = createOpencodeClient({ baseUrl: OPENCODE_URL });
  });

  it("returns a persistable concise rewrite envelope", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/03-executive.txt"), "utf8");
    const output = await runConciseWithArtifact({ text, mode: "quick" }, client);

    expect(output.capability).toBe("concise");
    expect(["success", "degraded", "failed"]).toContain(output.outcome);

    if (output.outcome === "failed") {
      expect(output.should_persist).toBe(false);
      expect(output.artifact).toBeNull();
      return;
    }

    expect(output.should_persist).toBe(true);
    expect(output.artifact?.revised_draft).toBeTruthy();
    expect(output.rendered).toBeTruthy();
  });

  it("keeps a canonical artifact on degraded empty-input output", async () => {
    const output = await runConciseWithArtifact({ text: "", mode: "quick" }, client);

    expect(output.outcome).toBe("degraded");
    expect(output.should_persist).toBe(true);
    expect(output.artifact).not.toBeNull();
    expect(output.warnings.length).toBeGreaterThan(0);
  });
});
