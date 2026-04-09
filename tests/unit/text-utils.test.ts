import { countWords, extractFinalText, sanitizeWords } from "../../src/steps.js"

describe("text utilities", () => {
  it("extracts content after a FINAL marker", () => {
    const text = "Thinking out loud\n\n## FINAL\nThis is the part that should survive."
    expect(extractFinalText(text)).toBe("This is the part that should survive.")
  })

  it("returns the whole string when there is no FINAL marker", () => {
    expect(extractFinalText("Plain output only.")).toBe("Plain output only.")
  })

  it("counts words on known strings", () => {
    expect(countWords("one two three")).toBe(3)
    expect(countWords("  spaced   words\ncount too ")).toBe(4)
  })

  it("finds banned words in text", () => {
    expect(sanitizeWords("This innovative approach feels too polished.")).toEqual(["innovative"])
  })

  it("returns an empty array for clean text", () => {
    expect(sanitizeWords("The draft is concrete, direct, and specific.")).toEqual([])
  })
})
