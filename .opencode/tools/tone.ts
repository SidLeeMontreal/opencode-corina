/**
 * tone — Corina's voice and format rewrite tool.
 * Standalone tool file. Loaded by OpenCode from .opencode/tools/ automatically.
 * Logging is handled by the plugin's tool.execute.after hook.
 */
import { tool } from "@opencode-ai/plugin"

import { makeConsoleLogger } from "../../src/logger.js"
import { runTonePipelineWithArtifact } from "../../src/tone-pipeline.js"
import { createToolRuntimeClient } from "../../src/tool-runtime.js"

const logger = makeConsoleLogger("tone-tool")

export default tool({
  description:
    "Rewrite content in a specified voice and format using Corina. Supports 11 voices: journalist, technical, persuasive, social, ux, seo, accessibility, executive, brand, email, personal. All params optional — Corina infers missing ones.",
  args: {
    text: tool.schema.string().min(1),
    voice: tool.schema.string().optional(),
    format: tool.schema.string().optional(),
    audience: tool.schema.string().optional(),
    toneDesc: tool.schema.string().optional(),
    toneFile: tool.schema.string().optional(),
    profile: tool.schema.string().optional(),
    modelPreset: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const client = createToolRuntimeClient(context)
    const toneArgs = args.format === "json" ? { ...args, format: undefined } : args
    return runTonePipelineWithArtifact(toneArgs, client, logger)
  },
})
