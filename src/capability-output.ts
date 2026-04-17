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

import type { CorinaToolEnvelope, ToolOutcome } from "./types.js";

const PACKAGE_VERSION = (() => {
  try {
    const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

function buildBaseEnvelope(options: {
  capability: string;
  inputSummary: string;
  rendered: string;
  metrics?: { total_tokens?: number; total_cost?: number };
}) {
  const { capability, inputSummary, rendered, metrics } = options;

  return {
    agent: "corina" as const,
    capability,
    version: PACKAGE_VERSION,
    timestamp: new Date().toISOString(),
    input_summary: inputSummary,
    rendered,
    ...(metrics ? { metrics } : {}),
  };
}

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
    ...buildBaseEnvelope({ capability, inputSummary, rendered, metrics }),
    ...(mode ? { mode } : {}),
    artifact,
    ...(chainedTo ? { chained_to: chainedTo } : {}),
    ...(assumptions?.length ? { assumptions } : {}),
  };
}

export function createToolEnvelope<TArtifact>(options: {
  capability: string;
  outcome: ToolOutcome;
  shouldPersist: boolean;
  artifact: TArtifact | null;
  rendered: string;
  warnings?: string[];
  inputSummary: string;
  metrics?: { total_tokens?: number; total_cost?: number };
  chainedTo?: string;
  chainResult?: unknown;
}): CorinaToolEnvelope<TArtifact> {
  const { capability, outcome, shouldPersist, artifact, rendered, warnings, inputSummary, metrics, chainedTo, chainResult } = options;

  return {
    ...buildBaseEnvelope({ capability, inputSummary, rendered, metrics }),
    outcome,
    should_persist: shouldPersist,
    artifact,
    warnings: warnings ?? [],
    metrics: metrics ?? {},
    ...(chainedTo ? { chained_to: chainedTo } : {}),
    ...(chainResult !== undefined ? { chain_result: chainResult } : {}),
  };
}

export { PACKAGE_VERSION };
