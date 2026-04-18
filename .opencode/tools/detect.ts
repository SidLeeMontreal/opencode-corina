/**
 * detect — Corina's AI-pattern detection tool.
 * Standalone tool file. Loaded by OpenCode from .opencode/tools/ automatically.
 * Logging is handled by the plugin's tool.execute.after hook.
 */
import { tool } from "@opencode-ai/plugin"

import { runDetectWithArtifact } from "../../src/detect.js"
import { makeConsoleLogger } from "../../src/logger.js"
import { createToolRuntimeClient } from "../../src/tool-runtime.js"

const logger = makeConsoleLogger("detect-tool")

export default tool({
  description:
    "Detect AI-writing patterns in text. Returns annotated analysis, confidence scores, severity flags, and actionable fix suggestions. Never rewrites — diagnostic only. All params optional except text.",
  args: {
    text: tool.schema.string().describe("Text to analyze or a readable file path."),
    format: tool.schema.string().optional(),
    autoFix: tool.schema.boolean().optional(),
    chain: tool.schema.string().optional(),
    voice: tool.schema.string().optional(),
    modelPreset: tool.schema.string().optional(),
  },
  async execute({ text, format, autoFix, chain, voice, modelPreset }, context) {
    const client = createToolRuntimeClient(context)
    return runDetectWithArtifact({ text, format: format as any, autoFix, chain: chain as any, voice, modelPreset }, client, logger)
  },
})
