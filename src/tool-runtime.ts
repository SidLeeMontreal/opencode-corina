import { createOpencodeClient } from "@opencode-ai/sdk";
import type { ToolContext } from "@opencode-ai/plugin";

import type { OpenCodeClient } from "./types.js";

const DEFAULT_OPENCODE_URL = "http://127.0.0.1:4098";

function resolveBaseUrl(): string {
  return process.env["OPENCODE_URL"] ?? process.env["OPENCODE_BASE_URL"] ?? DEFAULT_OPENCODE_URL;
}

export function createToolRuntimeClient(context: ToolContext): OpenCodeClient {
  return createOpencodeClient({
    baseUrl: resolveBaseUrl(),
    directory: context.directory,
  }) as OpenCodeClient;
}

export { DEFAULT_OPENCODE_URL };
