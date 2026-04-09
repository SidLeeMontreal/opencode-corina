import { inferFormat, inferToneDefaults, inferVoice } from "../../src/tone-defaults.js"

describe("smart defaults", () => {
  it("infers email format from greeting and signoff", () => {
    const text = "Hi Corina,\n\nCan you tighten this note for the client?\n\nBest,\nJF"
    expect(inferFormat(text)).toBe("email")
  })

  it("infers social format from hashtags", () => {
    expect(inferFormat("We shipped it. #buildinpublic #ai")).toBe("social")
  })

  it("infers article format from a title and paragraphs", () => {
    const text = "Why agencies still matter\n\nThe market changed fast. Judgment did not."
    expect(inferFormat(text)).toBe("article")
  })

  it("infers technical voice from code references", () => {
    expect(inferVoice("The API returns JSON and the client calls parseResponse() on success.")).toBe("technical")
  })

  it("defaults voice to persuasive when nothing specific is signaled", () => {
    expect(inferToneDefaults({ text: "We launched last week and want something sharper." }).voice).toBe("persuasive")
  })
})
