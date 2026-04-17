import type { PipelineModelConfig } from "./types.js";

export type { PipelineModelConfig } from "./types.js";
export type { Preset, StepModelConfig } from "opencode-model-resolver";

export const DEFAULT_MODEL_CONFIG: PipelineModelConfig = {
  provider: "github-copilot",
  briefIntake: { preset: "writing-fast" },
  // Outline uses JSON schema formatting. Under GitHub Copilot, the writing-analysis
  // preset resolves to Claude Sonnet, which currently returns a 400 Bad Request for
  // this request shape and yields an empty parts payload. Keep outline on the faster
  // GPT-oriented preset so the structured contract remains enforceable.
  outline: { preset: "writing-fast" },
  draft: { preset: "writing-quality" },
  critique: { preset: "writing-analysis" },
  revise: { preset: "writing-analysis" },
  audit: { preset: "writing-fast" },
};
