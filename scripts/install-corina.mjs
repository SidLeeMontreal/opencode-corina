#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { dirname, join, resolve } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(join(__dirname, ".."))
const installRoot = resolve(process.env.CORINA_INSTALL_ROOT || repoRoot)
const sourceDir = join(repoRoot, "agents")
const targetDir = join(installRoot, ".opencode", "agents")

mkdirSync(targetDir, { recursive: true })
mkdirSync(join(installRoot, ".corina-local", "prompts"), { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true, force: true })

for (const entry of readdirSync(targetDir)) {
  if (!entry.endsWith(".md")) continue
  const filePath = join(targetDir, entry)
  const content = readFileSync(filePath, "utf8").replaceAll("../prompts/", "../../prompts/")
  writeFileSync(filePath, content)
}

const relativeTarget = installRoot === repoRoot ? ".opencode/agents" : `${installRoot}/.opencode/agents`

console.log(`✅ Corina agents installed in ${relativeTarget}`)
console.log("   Restart your OpenCode server from the repo root.")
console.log("   Local prompt overrides: .corina-local/prompts/")
