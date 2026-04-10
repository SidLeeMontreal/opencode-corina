import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createOpencodeClient } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";

import { runCritiqueWithArtifact } from "../../src/critique.js";

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098";
const AI_SLOP_CORPUS = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8");

describe("Live chaining", { timeout: 600_000 }, () => {
  it("critique --chain tone passes output to tone pipeline", async () => {
    const client = createOpencodeClient({ baseUrl: OPENCODE_URL });
    const result = await runCritiqueWithArtifact(
      [AI_SLOP_CORPUS],
      { mode: "quality", chain: "tone", format: "json" },
      client,
    );

    expect(result.chained_to).toBe("tone");
    expect(result.chain_result).toBeDefined();
    expect(result.rendered).toContain("Chain result");
  });
});
