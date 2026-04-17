import { voicePromptRelativePath } from "../../src/prompt-loader.js";

describe("voicePromptRelativePath", () => {
  it("maps voice id email to commercial-email prompt file", () => {
    expect(voicePromptRelativePath("email")).toBe("voices/commercial-email.md");
  });

  it("defaults to voices/${voice}.md", () => {
    expect(voicePromptRelativePath("journalist")).toBe("voices/journalist.md");
  });
});
