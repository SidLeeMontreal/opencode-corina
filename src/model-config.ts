import type { PipelineModelConfig } from "./types.js";

export type { PipelineModelConfig } from "./types.js";
export type { Preset, StepModelConfig } from "opencode-model-resolver";

export const DEFAULT_MODEL_CONFIG: PipelineModelConfig = {
  provider: "github-copilot",
  briefIntake: { preset: "writing-fast" },
  outline: { preset: "writing-analysis" },
  draft: { preset: "writing-quality" },
  critique: { preset: "writing-analysis" },
  revise: { preset: "writing-analysis" },
  audit: { preset: "writing-fast" },
};
