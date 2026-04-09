import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

import { writeAuditLog } from "./audit-log.js";
import { runPipeline } from "./pipeline.js";
import type { PipelineModelConfig } from "./types.js";

function buildUniformModelConfig(modelPreset?: "fast" | "balanced" | "quality"): Partial<PipelineModelConfig> | undefined {
  if (!modelPreset) {
    return undefined;
  }

  const presetConfig: StepModelConfig = { preset: modelPreset };
  return {
    briefIntake: presetConfig,
    outline: presetConfig,
    draft: presetConfig,
    critique: presetConfig,
    revise: presetConfig,
    audit: presetConfig,
  };
}

export const CorinaPlugin: Plugin = async (input) => {
  return {
    tool: {
      corina_write: tool({
        description:
          "Run Corina's gated editorial pipeline and return the final draft. Optionally override every pipeline step with a uniform modelPreset: fast, balanced, or quality.",
        args: {
          brief: tool.schema.string().min(1).describe("Writing brief or request for Corina's editorial pipeline."),
          modelPreset: tool.schema
            .enum(["fast", "balanced", "quality"])
            .optional()
            .describe("Optional uniform model preset override for all pipeline steps."),
        },
        execute: async ({ brief, modelPreset }, toolCtx) => {
          const output = await runPipeline(brief, input.client, buildUniformModelConfig(modelPreset));
          writeAuditLog({
            timestamp: new Date().toISOString(),
            event: "corina_write",
            sessionId: toolCtx.sessionID,
            briefPreview: brief.slice(0, 160),
            outcome: "completed",
            metadata: {
              outputLength: output.length,
              modelPreset,
            },
          });
          return output;
        },
      }),
    },
    event: async ({ event }) => {
      if (event.type !== "session.idle") {
        return;
      }

      const sessionId =
        typeof event.properties === "object" && event.properties !== null && "sessionID" in event.properties
          ? String((event.properties as { sessionID?: string }).sessionID ?? "")
          : undefined;

      writeAuditLog({
        timestamp: new Date().toISOString(),
        event: "session.idle",
        sessionId,
        outcome: "idle",
      });
    },
  };
};

export const server = CorinaPlugin;

const pluginModule: PluginModule = {
  id: "opencode-corina",
  server,
};

export default pluginModule;
