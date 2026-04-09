import { buildPersonalVoiceProfile, inferFormat, inferVoice } from "../../src/tone-defaults.js"

describe("tone defaults", () => {
  it("infers journalist voice from reported-source language", () => {
    expect(inferVoice("According to the report, Apple said revenue grew in 2025.")).toBe("journalist")
  })

  it("infers technical voice from code references", () => {
    expect(inferVoice("The API returns JSON and the client calls parseResponse() on success.")).toBe("technical")
  })

  it("infers email format from greeting and signoff", () => {
    const text = "Hi Corina,\n\nCan you tighten this note for the client?\n\nBest,\nJF"
    expect(inferFormat(text)).toBe("email")
  })

  it("infers slide format from bullet-heavy terse content", () => {
    const text = "Q2 plan\n- Reduce churn\n- Improve onboarding\n- Ship reporting"
    expect(inferFormat(text)).toBe("slide")
  })

  it("builds a structured personal voice profile", () => {
    const profile = buildPersonalVoiceProfile(
      "Warm but sharp. Short to medium sentences. Slightly dry humor. No jargon. No hype. Professional, but not stiff.",
    )

    expect(profile.sentence_length).toBe("short")
    expect(profile.vocabulary_register).toBe("professional")
    expect(profile.personality_markers).toContain("warm")
    expect(profile.personality_markers).toContain("humorous")
    expect(profile.avoid).toContain("jargon")
    expect(profile.avoid).toContain("hype")
  })
})
