import {
  buildFallbackArtifact,
  buildHeatMapFromAuditRows,
  buildRendered,
  countWords,
  detectMode,
  extractDelimitedJson,
  normalizeHeatMap,
  normalizeParagraphFunctionMap,
  normalizePreservationCheck,
  normalizeReconciliationLog,
  normalizeRevisionLog,
  replaceParagraphById,
  sortRevisionTargets,
  splitParagraphs,
  summarizeHeatMap,
} from "../../src/concise.js"
import { validate } from "../../src/validators.js"
import { createMockClient } from "../helpers/mock-client.js"

describe("concise", () => {
  describe("detectMode", () => {
    it("detects quick mode at or under 500 words", () => {
      const text = Array.from({ length: 500 }, () => "word").join(" ")
      expect(detectMode(text, "auto")).toBe("quick")
    })

    it("detects full mode above 500 words", () => {
      const text = Array.from({ length: 501 }, () => "word").join(" ")
      expect(detectMode(text, "auto")).toBe("full")
    })

    it("prefers explicit mode overrides", () => {
      const shortText = "short text"
      expect(detectMode(shortText, "full")).toBe("full")
      expect(detectMode(Array.from({ length: 700 }, () => "word").join(" "), "quick")).toBe("quick")
    })
  })

  describe("splitParagraphs", () => {
    it("returns an empty array for an empty string", () => {
      expect(splitParagraphs("")).toEqual([])
    })

    it("returns an empty array for whitespace-only input", () => {
      expect(splitParagraphs("  \n\n\t  ")).toEqual([])
    })

    it("returns a single paragraph with P1 id", () => {
      expect(splitParagraphs("Single paragraph.")).toEqual([{ id: "P1", text: "Single paragraph." }])
    })

    it("splits multiple paragraphs on blank lines", () => {
      expect(splitParagraphs("First.\n\nSecond.\n\nThird.")).toEqual([
        { id: "P1", text: "First." },
        { id: "P2", text: "Second." },
        { id: "P3", text: "Third." },
      ])
    })

    it("trims paragraph text and ignores trailing newlines", () => {
      expect(splitParagraphs("  First.  \n\nSecond.\n\n\n")).toEqual([
        { id: "P1", text: "First." },
        { id: "P2", text: "Second." },
      ])
    })

    it("normalizes windows newlines and mixed blank lines", () => {
      expect(splitParagraphs("First.\r\n\r\n   \r\nSecond.\r\n\r\nThird.")).toEqual([
        { id: "P1", text: "First." },
        { id: "P2", text: "Second." },
        { id: "P3", text: "Third." },
      ])
    })
  })

  describe("countWords", () => {
    it("returns 0 for an empty string", () => {
      expect(countWords("")).toBe(0)
    })

    it("returns 0 for whitespace-only input", () => {
      expect(countWords(" \n\t ")).toBe(0)
    })

    it("counts a single word", () => {
      expect(countWords("hello")).toBe(1)
    })

    it("counts 500 words exactly", () => {
      expect(countWords(Array.from({ length: 500 }, () => "word").join(" "))).toBe(500)
    })

    it("counts 501 words exactly", () => {
      expect(countWords(Array.from({ length: 501 }, () => "word").join(" "))).toBe(501)
    })

    it("collapses repeated whitespace between words", () => {
      expect(countWords("one\n\n two\t\tthree   four")).toBe(4)
    })
  })

  describe("extractDelimitedJson", () => {
    const tags = [
      ["<concise_audit>", "</concise_audit>"],
      ["<concise_revision>", "</concise_revision>"],
      ["<concise_stitch>", "</concise_stitch>"],
      ["<concise_reconciliation>", "</concise_reconciliation>"],
    ] as const

    it("parses valid JSON inside concise_audit delimiters", () => {
      const value = extractDelimitedJson<{ ok: boolean }>(
        '<concise_audit>{"ok":true}</concise_audit>',
        "<concise_audit>",
        "</concise_audit>",
      )

      expect(value).toEqual({ ok: true })
    })

    it("trims whitespace around the delimited payload", () => {
      const value = extractDelimitedJson<{ items: number[] }>(
        '<concise_audit>\n  {"items":[1,2,3]}\n</concise_audit>',
        "<concise_audit>",
        "</concise_audit>",
      )

      expect(value).toEqual({ items: [1, 2, 3] })
    })

    it("parses nested objects and arrays", () => {
      const value = extractDelimitedJson<{ audit: { rows: Array<{ id: string }> } }>(
        '<concise_audit>{"audit":{"rows":[{"id":"R1"},{"id":"R2"}]}}</concise_audit>',
        "<concise_audit>",
        "</concise_audit>",
      )

      expect(value.audit.rows).toHaveLength(2)
      expect(value.audit.rows[1]).toEqual({ id: "R2" })
    })

    it("throws for malformed JSON inside delimiters", () => {
      expect(() =>
        extractDelimitedJson('{"ignored":true}<concise_audit>{oops}</concise_audit>', "<concise_audit>", "</concise_audit>"),
      ).toThrow()
    })

    it("throws when the opening delimiter is missing", () => {
      expect(() => extractDelimitedJson("not valid json", "<concise_audit>", "</concise_audit>")).toThrow()
    })

    it("throws when the closing delimiter is missing", () => {
      expect(() => extractDelimitedJson("<concise_audit>{\"ok\":true}", "<concise_audit>", "</concise_audit>")).toThrow()
    })

    it.each(tags)("parses payloads for %s", (startTag, endTag) => {
      const value = extractDelimitedJson<{ tag: string }>(`${startTag}{"tag":"ok"}${endTag}`, startTag, endTag)
      expect(value).toEqual({ tag: "ok" })
    })
  })

  describe("normalizeHeatMap", () => {
    it("normalizes valid entries", () => {
      expect(normalizeHeatMap([{ tag: "REDUND", severity: "Major", count: 2 }])).toEqual([
        { tag: "REDUND", severity: "Major", count: 2 },
      ])
    })

    it("returns an empty array for empty input arrays", () => {
      expect(normalizeHeatMap([])).toEqual([])
    })

    it("returns an empty array for null input", () => {
      expect(normalizeHeatMap(null)).toEqual([])
    })

    it("drops entries that normalize to UNKNOWN with zero count", () => {
      expect(normalizeHeatMap([{ foo: "bar" }])).toEqual([])
    })

    it("rounds counts and clamps negative values", () => {
      expect(normalizeHeatMap([{ tag: "FLOW", severity: "Moderate", count: 2.6 }, { tag: "PACE", severity: "Minor", count: -5 }])).toEqual([
        { tag: "FLOW", severity: "Moderate", count: 3 },
        { tag: "PACE", severity: "Minor", count: 0 },
      ])
    })

    it("downgrades unknown severities to Minor", () => {
      expect(normalizeHeatMap([{ tag: "REDUND", severity: "Critical", count: 1 }])).toEqual([
        { tag: "REDUND", severity: "Minor", count: 1 },
      ])
    })
  })

  describe("buildHeatMapFromAuditRows", () => {
    it("aggregates counts by tag and severity", () => {
      const rows = [
        { id: "1", paragraph: "P1", excerpt: "a", tags: ["REDUND"], severity: "Major", scope: "Local", note: "n1" },
        { id: "2", paragraph: "P2", excerpt: "b", tags: ["REDUND"], severity: "Major", scope: "Bridge", note: "n2" },
      ] as const

      expect(buildHeatMapFromAuditRows([...rows])).toEqual([{ tag: "REDUND", severity: "Major", count: 2 }])
    })

    it("counts multiple tags from a single row", () => {
      const rows = [
        { id: "1", paragraph: "P1", excerpt: "a", tags: ["REDUND", "FLOW"], severity: "Moderate", scope: "Local", note: "n1" },
      ] as const

      expect(buildHeatMapFromAuditRows([...rows])).toEqual([
        { tag: "REDUND", severity: "Moderate", count: 1 },
        { tag: "FLOW", severity: "Moderate", count: 1 },
      ])
    })

    it("keeps different severities separate for the same tag", () => {
      const rows = [
        { id: "1", paragraph: "P1", excerpt: "a", tags: ["FLOW"], severity: "Minor", scope: "Local", note: "n1" },
        { id: "2", paragraph: "P2", excerpt: "b", tags: ["FLOW"], severity: "Major", scope: "Global", note: "n2" },
      ] as const

      expect(buildHeatMapFromAuditRows([...rows])).toEqual([
        { tag: "FLOW", severity: "Minor", count: 1 },
        { tag: "FLOW", severity: "Major", count: 1 },
      ])
    })

    it("returns an empty array for no rows", () => {
      expect(buildHeatMapFromAuditRows([])).toEqual([])
    })

    it("counts duplicate tags within a single row as separate occurrences", () => {
      const rows = [
        { id: "1", paragraph: "P1", excerpt: "a", tags: ["FLOW", "FLOW"], severity: "Minor", scope: "Local", note: "n1" },
      ] as const

      expect(buildHeatMapFromAuditRows([...rows])).toEqual([{ tag: "FLOW", severity: "Minor", count: 2 }])
    })
  })

  describe("summarizeHeatMap", () => {
    it("returns none for an empty heat map", () => {
      expect(summarizeHeatMap([])).toBe("none")
    })

    it("formats a single entry", () => {
      expect(summarizeHeatMap([{ tag: "REDUND", severity: "Moderate", count: 1 }])).toBe("REDUND Moderate:1")
    })

    it("formats multiple entries in order", () => {
      expect(
        summarizeHeatMap([
          { tag: "REDUND", severity: "Moderate", count: 1 },
          { tag: "FLOW", severity: "Major", count: 2 },
        ]),
      ).toBe("REDUND Moderate:1, FLOW Major:2")
    })
  })

  describe("normalizeRevisionLog", () => {
    it("normalizes valid revision log entries", () => {
      expect(
        normalizeRevisionLog([
          {
            id: "R7",
            original_excerpt: "really very important",
            tags: ["REDUND"],
            solution_move: "Merge or delete",
            new_text: "important",
            scope: "Next bridge",
          },
        ]),
      ).toEqual([
        {
          id: "R7",
          original_excerpt: "really very important",
          tags: ["REDUND"],
          solution_move: "Merge or delete",
          new_text: "important",
          scope: "Next bridge",
        },
      ])
    })

    it("fills missing optional fields with defaults", () => {
      expect(normalizeRevisionLog([{}])).toEqual([
        {
          id: "R1",
          original_excerpt: "",
          tags: [],
          solution_move: "Preserve the grain",
          new_text: "",
          scope: "Target",
        },
      ])
    })

    it("filters non-string tags and invalid scopes", () => {
      expect(normalizeRevisionLog([{ tags: ["REDUND", 4, null], scope: "Elsewhere" }])).toEqual([
        {
          id: "R1",
          original_excerpt: "",
          tags: ["REDUND"],
          solution_move: "Preserve the grain",
          new_text: "",
          scope: "Target",
        },
      ])
    })

    it("returns an empty array for an empty array", () => {
      expect(normalizeRevisionLog([])).toEqual([])
    })

    it.each([null, "bad", { nope: true }])("returns an empty array for invalid input %p", (value) => {
      expect(normalizeRevisionLog(value)).toEqual([])
    })
  })

  describe("normalizePreservationCheck", () => {
    it("keeps all true booleans", () => {
      expect(
        normalizePreservationCheck({
          facts: true,
          nuance: true,
          argument_function: true,
          evidence: true,
          tone_voice: true,
          chronology: true,
        }),
      ).toEqual({
        facts: true,
        nuance: true,
        argument_function: true,
        evidence: true,
        tone_voice: true,
        chronology: true,
      })
    })

    it("keeps all false booleans", () => {
      expect(
        normalizePreservationCheck({
          facts: false,
          nuance: false,
          argument_function: false,
          evidence: false,
          tone_voice: false,
          chronology: false,
        }),
      ).toEqual({
        facts: false,
        nuance: false,
        argument_function: false,
        evidence: false,
        tone_voice: false,
        chronology: false,
      })
    })

    it("defaults missing fields to true", () => {
      expect(normalizePreservationCheck({ facts: false })).toEqual({
        facts: false,
        nuance: true,
        argument_function: true,
        evidence: true,
        tone_voice: true,
        chronology: true,
      })
    })

    it("uses payload notes when present", () => {
      expect(normalizePreservationCheck({ notes: "Checked carefully." })).toEqual({
        facts: true,
        nuance: true,
        argument_function: true,
        evidence: true,
        tone_voice: true,
        chronology: true,
        notes: "Checked carefully.",
      })
    })

    it("falls back to the provided note for invalid input", () => {
      expect(normalizePreservationCheck(null, "Fallback note.")).toEqual({
        facts: true,
        nuance: true,
        argument_function: true,
        evidence: true,
        tone_voice: true,
        chronology: true,
        notes: "Fallback note.",
      })
    })
  })

  describe("normalizeParagraphFunctionMap", () => {
    const paragraphs = [
      { id: "P1", text: "Intro." },
      { id: "P2", text: "Body." },
      { id: "P3", text: "End." },
    ]

    it("normalizes valid entries", () => {
      expect(
        normalizeParagraphFunctionMap(
          [
            {
              paragraph: "P2",
              function: "pivot",
              compression_priority: "High",
              revision_risk: "Low risk",
              preservation_constraints: "Keep the numbers.",
            },
          ],
          paragraphs,
        ),
      ).toEqual([
        {
          paragraph: "P2",
          function: "pivot",
          compression_priority: "High",
          revision_risk: "Low risk",
          preservation_constraints: "Keep the numbers.",
        },
      ])
    })

    it("defaults missing compression priority and revision risk to current safe defaults", () => {
      expect(normalizeParagraphFunctionMap([{ paragraph: "P2", function: "body" }], paragraphs)).toEqual([
        {
          paragraph: "P2",
          function: "body",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve key meaning and continuity.",
        },
      ])
    })

    it("returns paragraph-derived defaults when entries are empty", () => {
      expect(normalizeParagraphFunctionMap([], paragraphs)).toEqual([
        {
          paragraph: "P1",
          function: "opening",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
        },
        {
          paragraph: "P2",
          function: "body",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
        },
        {
          paragraph: "P3",
          function: "conclusion",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
        },
      ])
    })

    it.each([null, "bad", {}])("builds a fallback map from paragraphs for invalid input %p", (value) => {
      expect(normalizeParagraphFunctionMap(value, paragraphs)).toHaveLength(3)
      expect(normalizeParagraphFunctionMap(value, paragraphs)[0].paragraph).toBe("P1")
    })

    it("filters non-object entries before normalizing", () => {
      expect(normalizeParagraphFunctionMap([null, "bad", { paragraph: "P3" }], paragraphs)).toEqual([
        {
          paragraph: "P3",
          function: "body",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve key meaning and continuity.",
        },
      ])
    })
  })

  describe("normalizeReconciliationLog", () => {
    it("normalizes valid entries", () => {
      expect(
        normalizeReconciliationLog([
          {
            id: "RC7",
            location: "P2→P3 bridge",
            issue_type: "Transition",
            what_changed: "Added a connective sentence.",
            reason: "Needed to preserve continuity.",
          },
        ]),
      ).toEqual([
        {
          id: "RC7",
          location: "P2→P3 bridge",
          issue_type: "Transition",
          what_changed: "Added a connective sentence.",
          reason: "Needed to preserve continuity.",
        },
      ])
    })

    it("fills missing fields with defaults", () => {
      expect(normalizeReconciliationLog([{}])).toEqual([
        {
          id: "RC1",
          location: "document",
          issue_type: "Repair",
          what_changed: "No substantive change recorded.",
          reason: "Required to preserve continuity or substance.",
        },
      ])
    })

    it("returns an empty array for an empty array", () => {
      expect(normalizeReconciliationLog([])).toEqual([])
    })

    it.each([null, "bad", { nope: true }])("returns a safe empty array for invalid input %p", (value) => {
      expect(normalizeReconciliationLog(value)).toEqual([])
    })
  })

  describe("buildRendered", () => {
    it("renders quick mode output", () => {
      const rendered = buildRendered("quick", "Tighter draft.", 100, 60, [])
      expect(rendered).toContain("## Concise Draft (mode: quick, -40% words)")
      expect(rendered).toContain("Tighter draft.")
    })

    it("renders full mode output", () => {
      const rendered = buildRendered("full", "Rebuilt draft.", 120, 90, [])
      expect(rendered).toContain("## Concise Draft (mode: full, -25% words)")
      expect(rendered).toContain("Rebuilt draft.")
    })

    it("shows a 100 percent compression ratio label when word count is unchanged", () => {
      const rendered = buildRendered("quick", "Same size.", 20, 20, [])
      expect(rendered).toContain("Compression: 20 → 20 words (100%)")
    })

    it("uses none when the heat map is empty", () => {
      const rendered = buildRendered("quick", "Draft.", 20, 10, [])
      expect(rendered).toContain("Heat Map: none")
    })

    it("formats multiple heat-map entries", () => {
      const rendered = buildRendered("quick", "Draft.", 20, 10, [
        { tag: "REDUND", severity: "Moderate", count: 1 },
        { tag: "FLOW", severity: "Major", count: 2 },
      ])
      expect(rendered).toContain("Heat Map: REDUND Moderate:1, FLOW Major:2")
    })

    it("handles zero original words without dividing by zero", () => {
      const rendered = buildRendered("quick", "", 0, 0, [])
      expect(rendered).toContain("## Concise Draft (mode: quick, -0% words)")
      expect(rendered).toContain("Compression: 0 → 0 words (0%)")
    })
  })

  describe("replaceParagraphById", () => {
    const text = "Para one.\n\nPara two.\n\nPara three."

    it("replaces P1 in a three-paragraph text", () => {
      expect(replaceParagraphById(text, "P1", "New one.")).toBe("New one.\n\nPara two.\n\nPara three.")
    })

    it("replaces the middle paragraph", () => {
      expect(replaceParagraphById(text, "P2", "New two.")).toBe("Para one.\n\nNew two.\n\nPara three.")
    })

    it("replaces the last paragraph", () => {
      expect(replaceParagraphById(text, "P3", "New three.")).toBe("Para one.\n\nPara two.\n\nNew three.")
    })

    it("returns text unchanged for an unknown paragraph id", () => {
      expect(replaceParagraphById(text, "P9", "Nope.")).toBe(text)
    })

    it("trims the replacement paragraph and preserves surrounding paragraphs exactly", () => {
      expect(replaceParagraphById(text, "P2", "  Trimmed two.  ")).toBe("Para one.\n\nTrimmed two.\n\nPara three.")
    })

    it("returns the trimmed replacement when the source text has no paragraphs", () => {
      expect(replaceParagraphById("   ", "P1", "  New draft.  ")).toBe("New draft.")
    })
  })

  describe("sortRevisionTargets", () => {
    const entries = [
      { paragraph: "P4", function: "body", compression_priority: "None", revision_risk: "Low risk", preservation_constraints: "n" },
      { paragraph: "P2", function: "body", compression_priority: "Medium", revision_risk: "Low risk", preservation_constraints: "m" },
      { paragraph: "P3", function: "body", compression_priority: "Low", revision_risk: "Low risk", preservation_constraints: "l" },
      { paragraph: "P1", function: "body", compression_priority: "High", revision_risk: "Low risk", preservation_constraints: "h" },
    ] as const

    it("puts high priority paragraphs first", () => {
      expect(sortRevisionTargets([...entries])[0].paragraph).toBe("P1")
    })

    it("puts medium before low", () => {
      const sorted = sortRevisionTargets([...entries])
      expect(sorted.map((entry) => entry.paragraph)).toEqual(["P1", "P2", "P3", "P4"])
    })

    it("keeps none entries last instead of excluding them", () => {
      const sorted = sortRevisionTargets([...entries])
      expect(sorted.at(-1)?.compression_priority).toBe("None")
    })

    it("returns an empty array for empty input", () => {
      expect(sortRevisionTargets([])).toEqual([])
    })

    it("does not mutate the original array", () => {
      const original = [...entries]
      const sorted = sortRevisionTargets(original)
      expect(sorted).not.toBe(original)
      expect(original.map((entry) => entry.paragraph)).toEqual(["P4", "P2", "P3", "P1"])
    })
  })

  describe("buildFallbackArtifact", () => {
    it("returns a valid quick ConciseArtifact shape", () => {
      const artifact = buildFallbackArtifact("Original text here.", "quick", "No safe compression gain found.")
      expect(artifact.mode).toBe("quick")
      expect(artifact.heat_map).toEqual([])
      expect(artifact.revision_log).toEqual([])
    })

    it("preserves the original text as revised_draft", () => {
      const artifact = buildFallbackArtifact("  Keep this exactly.  ", "quick", "reason")
      expect(artifact.revised_draft).toBe("Keep this exactly.")
    })

    it("sets compression_ratio to 1 for unchanged text", () => {
      const artifact = buildFallbackArtifact("same words", "quick", "reason")
      expect(artifact.compression_ratio).toBe(1)
    })

    it("populates unresolved issues from the reason", () => {
      const artifact = buildFallbackArtifact("same words", "quick", "Could not safely compress.")
      expect(artifact.unresolved_issues).toEqual(["Could not safely compress."])
      expect(artifact.preservation_check.notes).toBe("Could not safely compress.")
    })

    it("includes full-mode extras", () => {
      const artifact = buildFallbackArtifact("First.\n\nSecond.", "full", "reason")
      expect(artifact.paragraph_function_map).toEqual([
        {
          paragraph: "P1",
          function: "opening",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
        },
        {
          paragraph: "P2",
          function: "conclusion",
          compression_priority: "Low",
          revision_risk: "Medium risk",
          preservation_constraints: "Preserve core meaning, names, numbers, chronology, and tone.",
        },
      ])
      expect(artifact.reconciliation_log).toEqual([])
    })

    it("passes ConciseArtifact schema validation", () => {
      const artifact = buildFallbackArtifact("Original text here.", "quick", "No safe compression gain found.")
      const result = validate("ConciseArtifact", artifact)
      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  it("mock client helper supports concise session flows", async () => {
    const client = createMockClient([{ data: { parts: [{ type: "text", text: '<concise_audit>{"heat_map":[]}</concise_audit>' }] } }])
    const session = await client.session.create({ body: { title: "test" } })
    const prompt = await client.session.prompt({ path: { id: session.data.id }, body: { agent: "concise-auditor", parts: [{ type: "text", text: "hello" }] } })
    expect(prompt).toBeTruthy()
  })
})
