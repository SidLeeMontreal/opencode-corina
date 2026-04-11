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

const auditLogPath = resolveAuditLogPath();

let auditDirEnsured = false;

function ensureAuditDirOnce(): void {
  if (auditDirEnsured) {
    return;
  }
  mkdirSync(dirname(auditLogPath), { recursive: true });
  auditDirEnsured = true;
}

/** Serializes appends so JSONL line order matches invocation order under concurrent hooks. */
let appendQueue: Promise<void> = Promise.resolve();

export function writeAuditLog(entry: AuditLogEntry): void {
  const line = `${JSON.stringify(entry)}\n`;
  appendQueue = appendQueue.then(async () => {
    try {
      ensureAuditDirOnce();
      await appendFile(auditLogPath, line, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[opencode-corina] audit log write failed: ${message}`);
    }
  });
}

export { auditLogPath };
