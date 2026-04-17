/**
 * draft — Corina's gated editorial drafting tool.
 * Standalone tool file. Loaded by OpenCode from .opencode/tools/ automatically.
 */
import { tool } from "@opencode-ai/plugin"
import type { StepModelConfig } from "opencode-model-resolver"

import { runDraftWithArtifact } from "../../src/pipeline.js"
import { makeConsoleLogger } from "../../src/logger.js"
import { createToolRuntimeClient } from "../../src/tool-runtime.js"
import type { PipelineModelConfig } from "../../src/types.js"

const logger = makeConsoleLogger("draft-tool")

function buildUniformModelConfig(modelPreset?: "fast" | "balanced" | "quality"): Partial<PipelineModelConfig> | undefined {
  if (!modelPreset) return undefined
  const presetConfig: StepModelConfig = { preset: modelPreset }
  return {
    briefIntake: presetConfig,
    outline: presetConfig,
    draft: presetConfig,
    critique: presetConfig,
    revise: presetConfig,
    audit: presetConfig,
  }
}

export default tool({
  description:
    "Draft human-readable content through Corina's editorial pipeline. Returns a structured envelope by default where artifact is canonical output, rendered is presentation output, and should_persist indicates whether callers should persist artifact.final_content. This tool drafts content and does not write files.",
  args: {
    brief: tool.schema.string().min(1).describe("Writing brief or request for Corina's editorial drafting pipeline."),
    modelPreset: tool.schema
      .enum(["fast", "balanced", "quality"])
      .optional()
      .describe("Optional uniform model preset override for all pipeline steps."),
  },
  async execute({ brief, modelPreset }, context) {
    const client = createToolRuntimeClient(context)
    return runDraftWithArtifact(brief, client, buildUniformModelConfig(modelPreset), logger)
  },
})
