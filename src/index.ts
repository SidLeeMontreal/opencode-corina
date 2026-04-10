import type { Plugin, PluginModule } from "@opencode-ai/plugin";

import { writeAuditLog } from "./audit-log.js";
import { makeOpenCodeLogger } from "./logger.js";

export const CorinaPlugin: Plugin = async ({ client }) => {
  const logger = makeOpenCodeLogger(client, "corina");

  return {
    "server.connected": async () => {
      logger.info("plugin_loaded", { plugin: "opencode-corina", version: "0.1.0" });
    },
    "tool.execute.after": async (input, output) => {
      const trackedTools = ["write", "tone", "detect", "critique", "concise"];
      if (!trackedTools.includes(input.tool)) {
        return;
      }

      const outcome = "error" in (output as Record<string, unknown>) && (output as { error?: unknown }).error ? "failed" : "success";

      logger.info("tool_complete", {
        tool: input.tool,
        session_id: input.sessionID,
        outcome,
      });

      writeAuditLog({
        timestamp: new Date().toISOString(),
        event: "capability_complete",
        capability: input.tool,
        session_id: input.sessionID,
        outcome,
      });
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
