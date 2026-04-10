import { tool } from "@opencode-ai/plugin";

import { makeConsoleLogger } from "../../src/logger.js";
import { runConciseWithArtifact } from "../../src/concise.js";
import { createToolRuntimeClient } from "../../src/tool-runtime.js";

const logger = makeConsoleLogger("concise-tool");

export default tool({
  description:
    "Make text more concise without losing substance. Removes fluff, improves information density, and preserves voice. Supports quick mode (short content) and full mode (long-form with paragraph-level control).",
  args: {
    text: tool.schema.string().min(1).describe("Text to make more concise."),
    mode: tool.schema
      .enum(["quick", "full", "auto"])
      .optional()
      .describe("Concision mode. quick=2-pass for short text, full=4-pass for long-form, auto=detect by word count (default)."),
    target_words: tool.schema.number().optional().describe("Optional target word count. Guides compression level."),
    format: tool.schema.string().optional().describe("Output format. Use json for the universal envelope."),
  },
  async execute({ text, mode, target_words, format }, context) {
    const client = createToolRuntimeClient(context);
    const output = await runConciseWithArtifact(
      {
        text,
        mode: mode as "quick" | "full" | "auto" | undefined,
        target_words,
        format: format as "json" | "text" | undefined,
      },
      client,
      logger,
    );

    return format === "json" ? JSON.stringify(output, null, 2) : output.rendered;
  },
});
