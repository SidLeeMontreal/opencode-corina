import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createOpencodeClient } from "@opencode-ai/sdk"
import { detectAiPatterns, detectBannedWords, detectEmDashes, detectFillerPhrases, detectRuleOfThree } from "opencode-text-tools"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")
const OPENCODE_URL = process.env.OPENCODE_URL ?? "http://127.0.0.1:4098"

function usage() {
  console.log(`Usage:
  node scripts/run-eval.mjs --mode auto --input tests/fixtures/corpus/01-corporate-ai.txt
  node scripts/run-eval.mjs --mode judge --input tests/fixtures/corpus/01-corporate-ai.txt --voice journalist
  node scripts/run-eval.mjs --mode compare --input tests/fixtures/corpus/01-corporate-ai.txt --voices journalist,executive,persuasive`)
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith("--")) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith("--")) {
      args[key] = true
      continue
    }
    args[key] = next
    i += 1
  }
  return args
}

function readInput(inputPath) {
  return readFileSync(join(repoRoot, inputPath), "utf8").trim()
}

function mapScore({ aiPatterns, bannedWords, fillerPhrases, emDashes, ruleOfThree }) {
  const severity = aiPatterns + bannedWords + fillerPhrases + emDashes + ruleOfThree
  if (aiPatterns >= 10 || bannedWords >= 4 || severity >= 12) return 0
  if (severity >= 7) return 1
  if (severity >= 5) return 2
  if (severity >= 3) return 3
  if (severity >= 1) return 4
  return 5
}

export function scanText(text) {
  const aiScan = detectAiPatterns(text)
  const bannedScan = detectBannedWords(text)
  const fillerScan = detectFillerPhrases(text)
  const emDashScan = detectEmDashes(text)
  const ruleOfThreeScan = detectRuleOfThree(text)

  const aiMatches = Object.keys(aiScan.counts.byPattern)
  const bannedMatches = bannedScan.found
  const fillerMatches = [...new Set(fillerScan.map((match) => match.matchedText.toLowerCase()))]
  const emDashes = emDashScan.count
  const ruleOfThree = ruleOfThreeScan.length
  const score = mapScore({
    aiPatterns: aiMatches.length,
    bannedWords: bannedMatches.length,
    fillerPhrases: fillerMatches.length,
    emDashes,
    ruleOfThree,
  })

  return {
    score,
    flags: [
      ...aiMatches.map((pattern) => `AI pattern: ${pattern}`),
      ...bannedMatches.map((word) => `Banned word: ${word}`),
      ...fillerMatches.map((phrase) => `Filler phrase: ${phrase}`),
      ...(emDashes ? [`Em dashes: ${emDashes}`] : []),
      ...(ruleOfThree ? [`Rule-of-three patterns: ${ruleOfThree}`] : []),
    ],
    counts: {
      aiPatterns: aiMatches.length,
      bannedWords: bannedMatches.length,
      emDashes,
      ruleOfThree,
      fillerPhrases: fillerMatches.length,
    },
    matches: {
      aiPatterns: aiMatches,
      bannedWords: bannedMatches,
      fillerPhrases: fillerMatches,
    },
  }
}

function printAutoReport(inputPath, result) {
  console.log(`Corina auto eval\n`)
  console.log(`Input: ${inputPath}`)
  console.log(`Score: ${result.score}/5`)
  console.log(``)
  console.log(`Counts:`)
  console.log(`- AI patterns: ${result.counts.aiPatterns}`)
  console.log(`- Banned words: ${result.counts.bannedWords}`)
  console.log(`- Em dashes: ${result.counts.emDashes}`)
  console.log(`- Rule-of-three patterns: ${result.counts.ruleOfThree}`)
  console.log(`- Filler phrases: ${result.counts.fillerPhrases}`)
  console.log(``)
  console.log(`Flags:`)
  if (result.flags.length === 0) {
    console.log(`- none`)
    return
  }
  for (const flag of result.flags) {
    console.log(`- ${flag}`)
  }
}

function unwrapData(response) {
  if (response && typeof response === "object" && "data" in response) {
    return response.data
  }
  return response
}

function extractText(parts) {
  if (!Array.isArray(parts)) return ""
  return parts
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
}

function parseStructuredOutput(result) {
  const data = unwrapData(result)
  const candidates = [
    data?.info?.structured,
    data?.info?.structured_output,
    data?.info?.structuredOutput,
    data?.info?.metadata?.structured_output,
    data?.structured_output,
    data?.structuredOutput,
  ]
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return candidate
  }
  const text = extractText(data?.parts)
  if (!text) throw new Error("Structured response did not include structured output or JSON text.")
  return JSON.parse(text)
}

async function promptSession(client, sessionId, body) {
  try {
    return await client.session.prompt({ path: { id: sessionId }, body })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("sessionID") && !message.includes("id")) throw error
    return client.session.prompt({ path: { sessionID: sessionId }, body })
  }
}

async function deleteSession(client, sessionId) {
  try {
    await client.session.delete({ path: { id: sessionId } })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("sessionID") && !message.includes("id")) throw error
    await client.session.delete({ path: { sessionID: sessionId } })
  }
}

async function loadBuiltModule(relativePath) {
  const target = pathToFileURL(join(repoRoot, "dist", relativePath)).href
  return import(target)
}

function buildRewriteBrief(sourceText, voice = "persuasive") {
  return [
    `Rewrite the source text in a ${voice} voice.`,
    "Preserve all factual claims, names, dates, and numbers.",
    "Remove AI-sounding language and keep the result natural.",
    "Output a clean standalone draft.",
    "",
    "SOURCE TEXT:",
    sourceText,
  ].join("\n")
}

async function runRewrite(client, sourceText, voice) {
  const { runPipeline } = await loadBuiltModule("pipeline.js")
  return runPipeline(buildRewriteBrief(sourceText, voice), client)
}

async function runJudge(client, sourceText, outputText, voice = "persuasive") {
  const schema = JSON.parse(readFileSync(join(repoRoot, "schemas", "CritiqueArtifact.json"), "utf8"))
  const persona = readFileSync(join(homedir(), ".config", "opencode", "prompts", "corina-critic.txt"), "utf8").trim()
  const sessionResponse = await client.session.create({ body: { title: `Corina eval judge (${voice})` } })
  const session = unwrapData(sessionResponse)

  try {
    await promptSession(client, session.id, {
      agent: "corina-critic",
      noReply: true,
      parts: [{ type: "text", text: persona }],
    })

    const result = await promptSession(client, session.id, {
      agent: "corina-critic",
      parts: [
        {
          type: "text",
          text: [
            "Evaluate the rewritten text and return a CritiqueArtifact.",
            "Score the output strictly for AI residue, tone control, precision, evidence handling, and rhythm.",
            "Treat voice adherence to the requested target as part of corina_tone.",
            "Return JSON only.",
            "",
            `REQUESTED VOICE: ${voice}`,
            "",
            "SOURCE TEXT:",
            sourceText,
            "",
            "REWRITTEN OUTPUT:",
            outputText,
          ].join("\n"),
        },
      ],
      format: {
        type: "json_schema",
        schema,
        retryCount: 2,
      },
    })

    return parseStructuredOutput(result)
  } finally {
    await deleteSession(client, session.id)
  }
}

function excerpt(text, length = 100) {
  return text.replace(/\s+/g, " ").trim().slice(0, length)
}

function escapeCell(text) {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.mode || !args.input) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const mode = String(args.mode)
  const inputPath = String(args.input)
  const inputText = readInput(inputPath)

  if (mode === "auto") {
    const result = scanText(inputText)
    printAutoReport(inputPath, result)
    return result
  }

  const client = createOpencodeClient({ baseUrl: OPENCODE_URL })

  if (mode === "judge") {
    const voice = String(args.voice ?? "persuasive")
    const output = await runRewrite(client, inputText, voice)
    const critique = await runJudge(client, inputText, output, voice)
    console.log(`Corina judge eval\n`)
    console.log(`Input: ${inputPath}`)
    console.log(`Voice: ${voice}`)
    console.log(`Output excerpt: ${excerpt(output, 160)}`)
    console.log(``)
    console.log(JSON.stringify(critique, null, 2))
    return critique
  }

  if (mode === "compare") {
    const voices = String(args.voices ?? "journalist,executive,persuasive")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)

    const rows = []
    for (const voice of voices) {
      const output = await runRewrite(client, inputText, voice)
      const result = scanText(output)
      rows.push({ voice, excerpt: excerpt(output), aiIsmCount: result.counts.aiPatterns, score: result.score })
    }

    console.log("| voice | output excerpt (100 chars) | AI-ism count | score |")
    console.log("| --- | --- | ---: | ---: |")
    for (const row of rows) {
      console.log(`| ${escapeCell(row.voice)} | ${escapeCell(row.excerpt)} | ${row.aiIsmCount} | ${row.score} |`)
    }
    return rows
  }

  throw new Error(`Unknown mode: ${mode}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
