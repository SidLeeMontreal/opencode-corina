import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { beforeAll, describe, expect, it } from "vitest"

import { runTonePipelineWithArtifact } from "../../src/tone-pipeline.js"

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098"

describe("Tone E2E", { timeout: 600_000 }, () => {
  let client: ReturnType<typeof createOpencodeClient>

  beforeAll(() => {
    client = createOpencodeClient({ baseUrl: OPENCODE_URL })
  })

  it("rewrites corporate AI text in journalist voice", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
    const output = await runTonePipelineWithArtifact({ text, voice: "journalist" }, client)

    expect(output.capability).toBe("tone")
    expect(["success", "degraded", "failed"]).toContain(output.outcome)
    expect(typeof output.should_persist).toBe("boolean")
    expect(output.artifact?.final_content).toBeTruthy()
    expect((output.artifact?.final_content ?? "").length).toBeGreaterThan(50)

    const banned = ["innovative", "leverages", "empower", "cutting-edge", "game-changing"]
    for (const word of banned) {
      expect((output.artifact?.final_content ?? "").toLowerCase()).not.toContain(word)
    }
  })

  it("rewrites executive text in social voice", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/03-executive.txt"), "utf8")
    const output = await runTonePipelineWithArtifact({ text, voice: "social" }, client)

    expect(output.should_persist).toBe(true)
    expect(output.artifact?.final_content).toBeTruthy()
    expect(output.artifact?.voice_applied).toBe("social")
  })

  it("infers voice from text when not specified", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/02-technical.txt"), "utf8")
    const output = await runTonePipelineWithArtifact({ text }, client)

    expect(output.artifact?.final_content).toBeTruthy()
    expect(output.artifact?.voice_applied).toBeTruthy()
  })

  it("applies personal voice from tone description", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
    const output = await runTonePipelineWithArtifact(
      {
        text,
        voice: "personal",
        toneDesc: "Direct, dry, no hype, short sentences. No jargon. Say what you mean.",
      },
      client,
    )

    expect(output.artifact?.final_content).toBeTruthy()
    expect(output.artifact?.voice_applied).toBe("personal")
  })
})
