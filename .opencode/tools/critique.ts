/**
 * critique — Corina's quality, audience, rubric, and compare tool.
 * Standalone tool file. Loaded by OpenCode from .opencode/tools/ automatically.
 * Logging is handled by the plugin's tool.execute.after hook.
 */
import { tool } from "@opencode-ai/plugin"

import { runCritiqueWithArtifact } from "../../src/critique.js"
import { makeConsoleLogger } from "../../src/logger.js"
import { createToolRuntimeClient } from "../../src/tool-runtime.js"

const logger = makeConsoleLogger("critique-tool")

export default tool({
  description:
    "Critique text quality (quality), evaluate for a specific audience (audience), score against a rubric (rubric), or rank N versions (compare). Returns the shared structured envelope by default, with the critique report in artifact, presentation output in rendered, top-level outcome, and should_persist=false. All params optional — Corina infers missing ones.",
  args: {
    texts: tool.schema.array(tool.schema.string()),
    mode: tool.schema.string().optional(),
    audience: tool.schema.string().optional(),
    rubric: tool.schema.string().optional(),
    chain: tool.schema.string().optional(),
    format: tool.schema.string().optional(),
    modelPreset: tool.schema.string().optional(),
    voice: tool.schema.string().optional(),
  },
  async execute({ texts, mode, audience, rubric, chain, format, modelPreset, voice }, context) {
    const client = createToolRuntimeClient(context)
    return runCritiqueWithArtifact(
      texts,
      { mode: mode as any, audience, rubric, chain: chain as any, format: format as any, modelPreset, voice },
      client,
      logger,
    )
  },
})
