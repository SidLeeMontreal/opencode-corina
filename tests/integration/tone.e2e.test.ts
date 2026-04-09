import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runTonePipeline } from "../../src/tone-pipeline.js"
import { createMockClient } from "../helpers/mock-client.js"

describe("tone pipeline", () => {
  it("rewrites the corporate AI corpus in journalist voice", async () => {
    const source = readFileSync(join(process.cwd(), "tests/fixtures/corpus/01-corporate-ai.txt"), "utf8")
    const client = createMockClient([
      {
        data: {
          parts: [
            {
              type: "text",
              text:
                "## VOICE APPLIED\njournalist | article | general readers\n\n## ASSUMPTIONS\n- None\n\n## REWRITTEN CONTENT\nCompanies are using automation to handle more customer interactions without adding the same amount of manual effort. In practice, that can speed up response times and tailor messages more closely to user behavior, but the impact depends on how the system is trained and where it is deployed.",
            },
          ],
        },
      },
      {
        data: {
          structured_output: {
            pass: true,
            validation_score: 95,
            voice_checks: [
              "Leads with the most concrete claim.",
              "Uses declarative, reportable phrasing.",
              "Avoids promotional framing.",
            ],
            preservation_checks: ["Named entities, numbers, and dates from the source remain present or were not applicable."],
            entity_gaps: [],
            ai_patterns_found: [],
            format_match: true,
            validator_notes: ["Journalist voice is visible and format matches article."],
            correction_instructions: [],
          },
        },
      },
    ])

    const output = await runTonePipeline({ text: source, voice: "journalist" }, client as never)

    expect(output.final_content).toBeTruthy()
    expect(output.final_content).not.toContain("innovative")
    expect(output.final_content).not.toContain("pivotal")
    expect(output.final_content).not.toContain("tapestry")
    expect(output.voice_applied).toBe("journalist")
  })
})
