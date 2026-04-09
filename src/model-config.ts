import type { PipelineModelConfig } from "./types.js";

export type { PipelineModelConfig } from "./types.js";
export type { Preset, StepModelConfig } from "opencode-model-resolver";

export const DEFAULT_MODEL_CONFIG: PipelineModelConfig = {
  provider: "github-copilot",
  briefIntake: { preset: "fast" },
  outline: { preset: "balanced" },
  draft: { preset: "quality" },
  critique: { preset: "balanced" },
  revise: { preset: "balanced" },
  audit: { preset: "fast" },
};
