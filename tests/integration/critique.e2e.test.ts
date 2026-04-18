import { readFileSync } from "node:fs"
import { join } from "node:path"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { beforeAll, describe, expect, it } from "vitest"

import { runCritiqueWithArtifact } from "../../src/critique.js"

const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098"

describe("Critique E2E", { timeout: 600_000 }, () => {
  let client: ReturnType<typeof createOpencodeClient>

  beforeAll(() => {
    client = createOpencodeClient({ baseUrl: OPENCODE_URL })
  })

  describe("quality mode", () => {
    it("flags AI-heavy text in quality mode", async () => {
      const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
      const output = await runCritiqueWithArtifact([text], { mode: "quality" }, client)
      const report = output.artifact

      expect(output.capability).toBe("critique")
      expect(output.should_persist).toBe(false)
      expect(["success", "degraded"]).toContain(output.outcome)
      expect(report.pass).toBe(false)
      expect(
        [report.dimensions.ai_patterns.score, report.dimensions.precision.score, report.dimensions.evidence.score].some(
          (score) => score <= 2,
        ),
      ).toBe(true)
    })

    it("returns structured dimensions", async () => {
      const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
      const output = await runCritiqueWithArtifact([text], { mode: "quality" }, client)
      const dims = output.artifact.dimensions

      expect(dims.ai_patterns.score).toBeGreaterThanOrEqual(1)
      expect(dims.ai_patterns.score).toBeLessThanOrEqual(5)
      expect(dims.tone.score).toBeDefined()
      expect(dims.precision.score).toBeDefined()
    })
  })

  describe("audience mode", () => {
    it("evaluates text from CMO perspective", async () => {
      const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/02-technical.txt"), "utf8")
      const output = await runCritiqueWithArtifact([text], { mode: "audience", audience: "cmo" }, client)
      const report = output.artifact

      expect(report.audience_applied).toBeTruthy()
      expect(report.what_lands.length + report.what_misses.length).toBeGreaterThan(0)
      expect(report.rewrite_brief.length).toBeGreaterThan(0)
    })
  })

  describe("rubric mode", () => {
    it("scores text against journalist rubric", async () => {
      const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
      const output = await runCritiqueWithArtifact([text], { mode: "rubric", rubric: "journalist" }, client)
      const report = output.artifact

      expect(report.rubric_id).toBe("journalist")
      expect(report.dimensions.length).toBeGreaterThan(0)
      const totalPossible = report.dimensions.reduce((sum, dimension) => sum + dimension.max_score, 0)
      expect(report.total_score).toBeLessThanOrEqual(totalPossible)
    })
  })

  describe("compare mode", () => {
    it("ranks 2 versions and identifies a winner", async () => {
      const v1 = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
      const v2 = readFileSync(join(process.cwd(), "tests/fixtures/corpus/05-journalistic.txt"), "utf8")
      const output = await runCritiqueWithArtifact([v1, v2], { mode: "compare" }, client)
      const report = output.artifact

      expect(report.compared_count).toBe(2)
      expect(report.ranking.length).toBe(2)
      expect(report.recommendation_reason).toBeTruthy()
      const winnerScore = report.ranking[0].critique.overall_score
      const loserScore = report.ranking[1].critique.overall_score
      expect(winnerScore).toBeGreaterThanOrEqual(loserScore)
    })
  })

  describe("JSON format output", () => {
    it("returns valid AgentCapabilityOutput JSON", async () => {
      const text = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
      const output = await runCritiqueWithArtifact([text], { mode: "quality", format: "json" }, client)

      expect(output.agent).toBe("corina")
      expect(output.capability).toBe("critique")
      expect(typeof output.should_persist).toBe("boolean")
      expect(output.should_persist).toBe(false)
      expect(output.artifact).toBeDefined()
      expect(output.rendered).toBeTruthy()
      expect(output.timestamp).toBeTruthy()
    })
  })
})
