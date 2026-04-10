#!/usr/bin/env node
import { mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const sourceDir = join(repoRoot, "agents")
const targetDir = join(repoRoot, ".opencode", "agents")

mkdirSync(targetDir, { recursive: true })
mkdirSync(join(repoRoot, ".corina-local", "prompts"), { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true, force: true })

for (const entry of readdirSync(targetDir)) {
  if (!entry.endsWith(".md")) continue
  const filePath = join(targetDir, entry)
  const content = readFileSync(filePath, "utf8").replaceAll("../prompts/", "../../prompts/")
  writeFileSync(filePath, content)
}

console.log("✅ Corina agents installed in .opencode/agents/")
console.log("   Restart your OpenCode server from the repo root.")
console.log("   Local prompt overrides: .corina-local/prompts/")
