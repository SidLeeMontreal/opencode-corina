import type { Plugin, PluginModule } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import type { StepModelConfig } from "opencode-model-resolver";

import { writeAuditLog } from "./audit-log.js";
import { runCritiqueWithArtifact } from "./critique.js";
import { runDetectWithArtifact } from "./detect.js";
import { makeOpenCodeLogger } from "./logger.js";
import { runPipelineWithArtifact } from "./pipeline.js";
import { runTonePipelineWithArtifact } from "./tone-pipeline.js";
import type { AgentCapabilityOutput, AuditLogEntry, PipelineModelConfig } from "./types.js";

// Helpers
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

function outputMetrics(output: AgentCapabilityOutput<unknown>): { total_tokens?: number; total_cost?: number } {
  const metrics = (output as AgentCapabilityOutput<unknown> & { metrics?: { total_tokens?: number; total_cost?: number } }).metrics;
  return {
    total_tokens: metrics?.total_tokens,
    total_cost: metrics?.total_cost,
  };
}

function assumptionsCount(output: AgentCapabilityOutput<unknown>): number | undefined {
  const assumptions = (output as AgentCapabilityOutput<unknown> & { assumptions?: string[] }).assumptions;
  return assumptions?.length;
}

function writeCapabilityAudit(entry: Omit<AuditLogEntry, "timestamp" | "event">): void {
  writeAuditLog({
    timestamp: new Date().toISOString(),
    event: "capability_complete",
    ...entry,
  });
}

export const CorinaPlugin: Plugin = async ({ client }) => {
  const logger = makeOpenCodeLogger(client, "corina");

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
          format: tool.schema.string().optional().describe("Optional output format. Use json for the universal envelope."),
        },
        execute: async ({ brief, modelPreset, format }, toolCtx) => {
          const output = await runPipelineWithArtifact(brief, client, buildUniformModelConfig(modelPreset), logger);
          const renderedOutput = format === "json" ? JSON.stringify(output, null, 2) : output.rendered;
          const metrics = outputMetrics(output);
          writeCapabilityAudit({
            capability: "pipeline",
            session_id: toolCtx.sessionID,
            input_summary: brief.slice(0, 160),
            mode: modelPreset,
            outcome: "success",
            assumptions_count: assumptionsCount(output),
            total_tokens: metrics.total_tokens,
            total_cost: metrics.total_cost,
          });
          return renderedOutput;
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
          const wantsJson = args.format === "json";
          const toneArgs = wantsJson ? { ...args, format: undefined } : args;
          const output = await runTonePipelineWithArtifact(toneArgs, client, logger);
          const renderedOutput = wantsJson ? JSON.stringify(output, null, 2) : output.rendered;
          const metrics = outputMetrics(output);
          writeCapabilityAudit({
            capability: "tone",
            session_id: toolCtx.sessionID,
            input_summary: args.text.slice(0, 160),
            mode: args.voice,
            outcome: output.artifact.validation_score >= 70 ? "success" : "degraded",
            assumptions_count: assumptionsCount(output),
            total_tokens: metrics.total_tokens,
            total_cost: metrics.total_cost,
          });
          return renderedOutput;
        },
      }),
      corina_detect: tool({
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
        execute: async ({ text, format, autoFix, chain, voice, modelPreset }, toolCtx) => {
          const output = await runDetectWithArtifact({ text, format: format as any, autoFix, chain: chain as any, voice, modelPreset }, client, logger);
          const renderedOutput = format === "json" ? JSON.stringify(output, null, 2) : output.rendered;
          const metrics = outputMetrics(output);
          writeCapabilityAudit({
            capability: "detect",
            session_id: toolCtx.sessionID,
            input_summary: text.slice(0, 160),
            mode: modelPreset,
            outcome: output.artifact.verdict === "likely_ai" ? "degraded" : "success",
            assumptions_count: assumptionsCount(output),
            total_tokens: metrics.total_tokens,
            total_cost: metrics.total_cost,
          });
          if (chain || autoFix) {
            writeAuditLog({
              timestamp: new Date().toISOString(),
              event: "chain_complete",
              capability: "detect",
              session_id: toolCtx.sessionID,
              input_summary: text.slice(0, 160),
              outcome: "success",
              chain_target: autoFix ? "tone" : chain,
              assumptions_count: assumptionsCount(output),
              total_tokens: metrics.total_tokens,
              total_cost: metrics.total_cost,
            });
          }
          return renderedOutput;
        },
      }),
      corina_critique: tool({
        description:
          "Critique text quality (quality), evaluate for a specific audience (audience), score against a rubric (rubric), or rank N versions (compare). All modes return typed artifacts. All params optional — Corina infers missing ones.",
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
        async execute({ texts, mode, audience, rubric, chain, format, modelPreset, voice }, toolCtx) {
          const output = await runCritiqueWithArtifact(
            texts,
            { mode: mode as any, audience, rubric, chain: chain as any, format: format as any, modelPreset, voice },
            client,
            logger,
          );
          const renderedOutput = format === "json" ? JSON.stringify(output, null, 2) : output.rendered;
          const metrics = outputMetrics(output);
          writeCapabilityAudit({
            capability: "critique",
            session_id: toolCtx.sessionID,
            input_summary: texts.join(" | ").slice(0, 160),
            mode,
            outcome: "success",
            assumptions_count: assumptionsCount(output),
            total_tokens: metrics.total_tokens,
            total_cost: metrics.total_cost,
            chain_target: chain,
          });
          if (chain) {
            writeAuditLog({
              timestamp: new Date().toISOString(),
              event: "chain_complete",
              capability: "critique",
              session_id: toolCtx.sessionID,
              input_summary: texts.join(" | ").slice(0, 160),
              outcome: "success",
              chain_target: chain,
              assumptions_count: assumptionsCount(output),
              total_tokens: metrics.total_tokens,
              total_cost: metrics.total_cost,
            });
          }
          return renderedOutput;
        },
      }),
    },
    "server.connected": async () => {
      logger.info("plugin_loaded", { plugin: "opencode-corina", version: "0.1.0" });
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
        event: "session_idle",
        capability: "corina",
        session_id: sessionId,
        outcome: "success",
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
