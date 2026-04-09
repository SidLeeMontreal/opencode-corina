import { readFileSync } from "node:fs"
import { join } from "node:path"

import { scanText } from "../../scripts/run-eval.mjs"

describe("regression corpus", () => {
  it("flags heavy AI-ism copy in the corporate corpus sample", () => {
    const path = join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt")
    const text = readFileSync(path, "utf8")
    const result = scanText(text)

    expect(result.counts.aiPatterns).toBeGreaterThan(3)
    expect(result.score).toBeLessThanOrEqual(3)
  })
})
