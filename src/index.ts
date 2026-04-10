import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

import { writeAuditLog } from "./audit-log.js";
import { runDetect } from "./detect.js";
import { runPipeline } from "./pipeline.js";
import { runTonePipeline } from "./tone-pipeline.js";
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
      corina_tone: tool({
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
        execute: async (args, toolCtx) => {
          const output = await runTonePipeline(args, input.client);
          writeAuditLog({
            timestamp: new Date().toISOString(),
            event: "corina_tone",
            sessionId: toolCtx.sessionID,
            briefPreview: args.text.slice(0, 160),
            outcome: "completed",
            metadata: {
              voice: args.voice,
              format: args.format,
              modelPreset: args.modelPreset,
              validationScore: output.validation_score,
            },
          });
          return output.final_content;
        },
      }),
      corina_detect: tool({
        description:
          "Detect AI-writing patterns in text. Returns annotated analysis, confidence scores, severity flags, and actionable fix suggestions. Never rewrites — diagnostic only. All params optional except text.",
        args: {
          text: tool.schema.string().describe("Text to analyze or a readable file path."),
          format: tool.schema.string().optional(),
          autoFix: tool.schema.boolean().optional(),
          voice: tool.schema.string().optional(),
          modelPreset: tool.schema.string().optional(),
        },
        execute: async ({ text, format, autoFix, voice, modelPreset }, toolCtx) => {
          const output = await runDetect({ text, format: format as any, autoFix, voice, modelPreset }, input.client);
          writeAuditLog({
            timestamp: new Date().toISOString(),
            event: "corina_detect",
            sessionId: toolCtx.sessionID,
            briefPreview: text.slice(0, 160),
            outcome: "completed",
            metadata: {
              format,
              autoFix,
              voice,
              modelPreset,
              outputLength: output.length,
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
