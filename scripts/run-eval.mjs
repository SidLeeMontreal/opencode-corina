import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createOpencodeClient } from '@opencode-ai/sdk'
import { formatEvalReport, materializeSuiteFromJson, runSuite, saveBaseline } from 'opencode-eval-harness'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')
const defaultSuite = join(repoRoot, 'evals', 'suites', 'all.json')

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      index += 1
    }
  }
  return args
}

function usage() {
  console.log(`Usage:
  node scripts/run-eval.mjs --mode auto [--suite ./evals/suites/all.json]
  node scripts/run-eval.mjs --mode judge [--suite ./evals/suites/all.json]
  node scripts/run-eval.mjs --mode compare [--suite ./evals/suites/all.json] [--baseline ./evals/baselines/corina-all.json]

Modes:
  auto    Run offline Tier 1 deterministic eval
  judge   Run live Tier 2 judge eval
  compare Run live Tier 2 eval and compare to baseline
`)
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help || !args.mode) {
    usage()
    process.exit(args.help ? 0 : 1)
  }

  const suitePath = resolve(String(args.suite ?? defaultSuite))
  const mode = String(args.mode)
  const tier = mode === 'auto' ? [1] : [2]
  const suite = await materializeSuiteFromJson(suitePath, tier)
  const baselinePath = typeof args.baseline === 'string'
    ? resolve(String(args.baseline))
    : join(repoRoot, 'evals', 'baselines', `${suite.name}.json`)

  const report = await runSuite(suite, {
    client: mode === 'auto' ? undefined : createOpencodeClient({ baseUrl: process.env.OPENCODE_URL ?? 'http://127.0.0.1:4098' }),
    baselinePath: mode === 'compare' ? baselinePath : undefined,
    offline: mode === 'auto',
    noCache: Boolean(args['no-cache']),
  })

  const format = String(args.format ?? (mode === 'auto' ? 'table' : 'markdown'))
  console.log(formatEvalReport(report, format))

  if (args.saveBaseline || args['save-baseline']) {
    saveBaseline(report, baselinePath)
    console.error(`Saved baseline to ${baselinePath}`)
  }

  if (mode === 'compare' && report.baseline?.gate_failed) process.exit(1)
  if (report.aggregate.failed_cases > 0) process.exit(1)
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
