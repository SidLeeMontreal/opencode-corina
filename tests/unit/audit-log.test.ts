import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { flushAuditLogs, writeCapabilityAudit, writeChainAudit } from "../../src/audit-log.js"

describe("audit-log helpers", () => {
  const originalXdg = process.env.XDG_DATA_HOME

  afterEach(() => {
    process.env.XDG_DATA_HOME = originalXdg
  })

  function setupAuditPath() {
    const tempRoot = mkdtempSync(join(tmpdir(), "corina-audit-"))
    process.env.XDG_DATA_HOME = tempRoot
    const filePath = join(tempRoot, "opencode", "corina-audit.jsonl")

    return {
      filePath,
      cleanup: () => rmSync(tempRoot, { recursive: true, force: true }),
    }
  }

  it("writes canonical capability audit payloads", async () => {
    const audit = setupAuditPath()

    try {
      writeCapabilityAudit({
        capability: "detect",
        mode: "inline",
        session_id: "sess-123",
        input_summary: "Detection input provided (42 words, source=text).",
        outcome: "degraded",
        duration_ms: 321,
        total_tokens: 77,
        total_cost: 0.12,
        assumptions_count: 2,
      })
      await flushAuditLogs()

      const entry = JSON.parse(readFileSync(audit.filePath, "utf8").trim()) as Record<string, unknown>
      expect(entry).toMatchObject({
        event: "capability_complete",
        capability: "detect",
        mode: "inline",
        session_id: "sess-123",
        input_summary: "Detection input provided (42 words, source=text).",
        outcome: "degraded",
        duration_ms: 321,
        total_tokens: 77,
        total_cost: 0.12,
        assumptions_count: 2,
      })
      expect(typeof entry.timestamp).toBe("string")
    } finally {
      audit.cleanup()
    }
  })

  it("writes canonical chain audit payloads", async () => {
    const audit = setupAuditPath()

    try {
      writeChainAudit({
        capability: "critique",
        mode: "quality",
        session_id: "sess-456",
        chain_target: "tone",
        outcome: "success",
        duration_ms: 654,
        total_tokens: 144,
        total_cost: 0.34,
        assumptions_count: 1,
      })
      await flushAuditLogs()

      const entry = JSON.parse(readFileSync(audit.filePath, "utf8").trim()) as Record<string, unknown>
      expect(entry).toMatchObject({
        event: "chain_complete",
        capability: "critique",
        mode: "quality",
        session_id: "sess-456",
        chain_target: "tone",
        outcome: "success",
        duration_ms: 654,
        total_tokens: 144,
        total_cost: 0.34,
        assumptions_count: 1,
      })
      expect(typeof entry.timestamp).toBe("string")
    } finally {
      audit.cleanup()
    }
  })
})
