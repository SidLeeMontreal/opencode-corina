/**
 * write — Corina's gated editorial pipeline tool.
 * Standalone tool file. Loaded by OpenCode from .opencode/tools/ automatically.
 * Logging is handled by the plugin's tool.execute.after hook.
 */
import { tool } from "@opencode-ai/plugin"
import type { StepModelConfig } from "opencode-model-resolver"

import { runPipelineWithArtifact } from "../../src/pipeline.js"
import { makeConsoleLogger } from "../../src/logger.js"
import { createToolRuntimeClient } from "../../src/tool-runtime.js"
import type { PipelineModelConfig } from "../../src/types.js"

const logger = makeConsoleLogger("write-tool")

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
    "Run Corina's gated editorial pipeline and return the final draft. Optionally override every pipeline step with a uniform modelPreset: fast, balanced, or quality.",
  args: {
    brief: tool.schema.string().min(1).describe("Writing brief or request for Corina's editorial pipeline."),
    modelPreset: tool.schema
      .enum(["fast", "balanced", "quality"])
      .optional()
      .describe("Optional uniform model preset override for all pipeline steps."),
    format: tool.schema.string().optional().describe("Optional output format. Use json for the universal envelope."),
  },
  async execute({ brief, modelPreset, format }, context) {
    const client = createToolRuntimeClient(context)
    const output = await runPipelineWithArtifact(brief, client, buildUniformModelConfig(modelPreset), logger)
    return format === "json" ? JSON.stringify(output, null, 2) : output.rendered
  },
})
