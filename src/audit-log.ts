import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

import type { AuditLogEntry } from "./types.js";

const auditLogPath = join(homedir(), ".local", "share", "opencode", "corina-audit.jsonl");

export function writeAuditLog(entry: AuditLogEntry): void {
  mkdirSync(dirname(auditLogPath), { recursive: true });
  appendFileSync(auditLogPath, `${JSON.stringify(entry)}\n`, "utf8");
}

export { auditLogPath };
