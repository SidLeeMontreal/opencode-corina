import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { beforeAll, describe, expect, it } from "vitest"

import { runDetectWithArtifact } from "../../src/detect.js"

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098"

describe("Detect E2E", { timeout: 600_000 }, () => {
  let client: ReturnType<typeof createOpencodeClient>

  beforeAll(() => {
    client = createOpencodeClient({ baseUrl: OPENCODE_URL })
  })

  it("detects AI patterns in corporate slop corpus", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
    const output = await runDetectWithArtifact({ text, format: "json" }, client)

    expect(output.capability).toBe("detect")
    expect(output.should_persist).toBe(false)
    expect(output.artifact?.overall_score).toBeGreaterThan(0.3)
    expect(output.artifact?.patterns_found.length).toBeGreaterThan(3)
    expect(["possibly_ai", "likely_ai"]).toContain(output.artifact?.verdict)
  })

  it("returns clean verdict for journalistic text", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/05-journalistic.txt"), "utf8")
    const output = await runDetectWithArtifact({ text, format: "json" }, client)

    expect(output.outcome).toBe("success")
    expect(output.artifact?.overall_score).toBeLessThan(0.4)
    expect(["clean", "probably_human"]).toContain(output.artifact?.verdict)
  })

  it("returns inline format with FLAG markers for AI text", async () => {
    const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
    const output = await runDetectWithArtifact({ text, format: "inline" }, client)

    expect(output.rendered).toContain("[FLAG:")
    expect(output.rendered).toContain("Verdict:")
  })

  it("handles empty input gracefully", async () => {
    const output = await runDetectWithArtifact({ text: "", format: "report" }, client)

    expect(output.outcome).toBe("degraded")
    expect(output.should_persist).toBe(false)
    expect(output.artifact?.verdict).toBe("clean")
    expect(output.artifact?.overall_score).toBe(0)
    expect(output.artifact?.patterns_found).toHaveLength(0)
  })
})
