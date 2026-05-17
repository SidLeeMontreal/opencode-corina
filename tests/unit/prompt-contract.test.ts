import { existsSync, readFileSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

function markdownFiles(dir: string): string[] {
  return readdirSync(join(repoRoot, dir)).filter((entry) => entry.endsWith(".md")).sort()
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8")
}

function extractPromptPath(agentPath: string): string {
  const prompt = readRepoFile(agentPath).match(/^prompt:\s*(.+)$/m)?.[1]?.trim()
  if (!prompt) throw new Error(`${agentPath} is missing a prompt path`)
  return prompt
}

function extractAllowedTasks(corinaPath: string): string[] {
  const text = readRepoFile(corinaPath)
  return [...text.matchAll(/^\s{4}"([^"]+)":\s*allow$/gm)].map((match) => match[1]).sort()
}

describe("prompt contracts", () => {
  it("keeps canonical Corina agents installable with resolvable prompt paths", () => {
    for (const agent of markdownFiles("agents")) {
      const agentPath = `agents/${agent}`
      const prompt = extractPromptPath(agentPath)
      expect(existsSync(resolve(join(repoRoot, "agents"), prompt)), `${agentPath} -> ${prompt}`).toBe(true)
    }
  })

  it("keeps installed OpenCode agents in sync with canonical agents", () => {
    const canonical = markdownFiles("agents")
    const installed = markdownFiles(".opencode/agents")

    expect(installed).toEqual(canonical)

    for (const agent of installed) {
      const agentPath = `.opencode/agents/${agent}`
      const prompt = extractPromptPath(agentPath)
      expect(existsSync(resolve(join(repoRoot, ".opencode", "agents"), prompt)), `${agentPath} -> ${prompt}`).toBe(true)
    }
  })

  it("allows every canonical subagent from Corina's task permissions", () => {
    const expected = markdownFiles("agents")
      .map((entry) => entry.replace(/\.md$/, ""))
      .filter((name) => name !== "corina")
      .sort()

    expect(extractAllowedTasks("agents/corina.md")).toEqual(expected)
  })

  it.each([
    ["tasks/prose-evaluator.md", "<prose_evaluation>", "module_id: \"prose-evaluator\""],
    ["tasks/voice-evaluator.md", "<voice_evaluation>", "voice.*"],
    ["tasks/evidence-evaluator.md", "<evidence_evaluation>", "module_id: \"evidence-evaluator\""],
    ["tasks/format-auditor.md", "<format_evaluation>", "module_id: \"format-auditor\""],
    ["tasks/critic-adjudicator.md", "<critique_result>", "CritiqueArtifact"],
    ["tasks/auditor-adjudicator.md", "<audit_result>", "AuditArtifact"],
    ["tasks/concise-auditor.md", "<concise_audit>", "\"document_overview\""],
    ["tasks/concise-reviser.md", "<concise_revision>", "\"revised_text\""],
    ["tasks/concise-stitcher.md", "<concise_stitch>", "\"stitched_draft\""],
    ["tasks/concise-reconciler.md", "<concise_reconciliation>", "\"reconciled_draft\""],
  ])("%s declares the delimiter and output contract used by the runtime", (promptPath, delimiter, contractText) => {
    const prompt = readRepoFile(`prompts/${promptPath}`)
    expect(prompt).toContain(delimiter)
    expect(prompt).toContain(contractText)
  })

  it("keeps schema-formatted prompts aligned with their parsers", () => {
    expect(readRepoFile("prompts/tasks/detector.md")).toMatch(/Layer2Analysis`? JSON only/)
    expect(readRepoFile("prompts/tasks/tone-validator.md")).toContain("ToneValidationArtifact JSON only")

    const toneWriter = readRepoFile("prompts/tasks/tone-writer.md")
    expect(toneWriter).toContain("## ASSUMPTIONS")
    expect(toneWriter).toContain("## REWRITTEN CONTENT")
  })
})
