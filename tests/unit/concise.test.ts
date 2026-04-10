import { detectMode } from "../../src/concise.js"
import { createMockClient } from "../helpers/mock-client.js"

describe("concise", () => {
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

  it("mock client helper supports concise session flows", async () => {
    const client = createMockClient([{ data: { parts: [{ type: "text", text: "<concise_audit>{\"heat_map\":[]}</concise_audit>" }] } }])
    const session = await client.session.create({ body: { title: "test" } })
    const prompt = await client.session.prompt({ path: { id: session.data.id }, body: { agent: "concise-auditor", parts: [{ type: "text", text: "hello" }] } })
    expect(prompt).toBeTruthy()
  })
})
