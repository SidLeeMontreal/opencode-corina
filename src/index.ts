import type { Plugin, PluginModule } from "@opencode-ai/plugin";

import { writeAuditLog } from "./audit-log.js";
import { makeOpenCodeLogger } from "./logger.js";

export const CorinaPlugin: Plugin = async ({ client }) => {
  const logger = makeOpenCodeLogger(client, "corina");

  return {
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
