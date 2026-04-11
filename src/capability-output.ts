/**
 * Builds the standard `AgentCapabilityOutput` envelope for Corina tools (agent id, capability,
 * timestamps, artifact vs rendered text, optional chain/metrics).
 * `version` is read from this package's `package.json` beside the compiled module at load time;
 * if that read fails, it falls back to `"0.0.0"`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { AgentCapabilityOutput } from "opencode-text-tools";

const PACKAGE_VERSION = (() => {
  try {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

export function createCapabilityOutput<T>(options: {
  capability: string;
  mode?: string;
  inputSummary: string;
  artifact: T;
  rendered: string;
  chainedTo?: string;
  assumptions?: string[];
  metrics?: { total_tokens?: number; total_cost?: number };
}): AgentCapabilityOutput<T> {
  const { capability, mode, inputSummary, artifact, rendered, chainedTo, assumptions, metrics } = options;

  return {
    agent: "corina",
    capability,
    ...(mode ? { mode } : {}),
    version: PACKAGE_VERSION,
    timestamp: new Date().toISOString(),
    input_summary: inputSummary,
    artifact,
    rendered,
    ...(chainedTo ? { chained_to: chainedTo } : {}),
    ...(assumptions?.length ? { assumptions } : {}),
    ...(metrics ? { metrics } : {}),
  };
}
