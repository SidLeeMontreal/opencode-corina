/**
 * Append-only JSONL audit sink for plugin events (`AuditLogEntry`).
 * File: `$XDG_DATA_HOME/opencode/corina-audit.jsonl`, or `~/.local/share/...` when unset.
 * Appends are serialized (one queue) so lines stay ordered under concurrent hooks; I/O errors
 * are logged and never thrown — audit failures must not break the plugin.
 */
import { mkdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

import type { AuditLogEntry } from "./types.js";

function resolveAuditLogPath(): string {
  const xdg = process.env["XDG_DATA_HOME"]?.trim();
  const dataRoot =
    xdg && xdg.length > 0 ? resolve(xdg) : join(homedir(), ".local", "share");
  return join(dataRoot, "opencode", "corina-audit.jsonl");
}

let ensuredAuditDir: string | null = null;

function ensureAuditDirOnce(auditLogPath: string): void {
  const targetDir = dirname(auditLogPath);
  if (ensuredAuditDir === targetDir) {
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  ensuredAuditDir = targetDir;
}

/** Serializes appends so JSONL line order matches invocation order under concurrent hooks. */
let appendQueue: Promise<void> = Promise.resolve();

export function writeAuditLog(entry: AuditLogEntry): void {
  const auditLogPath = resolveAuditLogPath();
  const line = `${JSON.stringify(entry)}\n`;
  appendQueue = appendQueue.then(async () => {
    try {
      ensureAuditDirOnce(auditLogPath);
      await appendFile(auditLogPath, line, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[opencode-corina] audit log write failed: ${message}`);
    }
  });
}

/** Awaits queued writes that were scheduled before this call. Use during graceful shutdown (after stopping new audit producers) or in tests. */
export async function flushAuditLogs(): Promise<void> {
  await appendQueue;
}

function timestampedAuditEntry(entry: Omit<AuditLogEntry, "timestamp">): AuditLogEntry {
  return {
    timestamp: new Date().toISOString(),
    ...entry,
  };
}

export function writeCapabilityAudit(input: {
  capability: string;
  mode?: string;
  session_id?: string;
  input_summary?: string;
  outcome: "success" | "degraded" | "failed";
  duration_ms?: number;
  total_tokens?: number;
  total_cost?: number;
  assumptions_count?: number;
}): void {
  writeAuditLog(
    timestampedAuditEntry({
      event: "capability_complete",
      ...input,
    }),
  );
}

export function writeChainAudit(input: {
  capability: string;
  mode?: string;
  session_id?: string;
  chain_target: string;
  outcome: "success" | "degraded" | "failed";
  duration_ms?: number;
  total_tokens?: number;
  total_cost?: number;
  assumptions_count?: number;
}): void {
  writeAuditLog(
    timestampedAuditEntry({
      event: "chain_complete",
      ...input,
    }),
  );
}

export { resolveAuditLogPath };
