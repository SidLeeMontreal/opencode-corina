import { appendFileSync, mkdirSync } from "node:fs";
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

export function writeAuditLog(entry: AuditLogEntry): void {
  try {
    ensureAuditDirOnce();
    appendFileSync(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[opencode-corina] audit log write failed: ${message}`);
  }
}

export { auditLogPath };
