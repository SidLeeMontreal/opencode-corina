import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..', '..')

function createFixtureEnvelope(evalCase, rendered) {
  return {
    agent: 'corina-eval-fixture',
    capability: evalCase.capability,
    ...(evalCase.mode ? { mode: evalCase.mode } : {}),
    version: 'fixture',
    timestamp: new Date().toISOString(),
    input_summary: `Offline fixture output for ${evalCase.id}`,
    artifact: { fixture: true, case_id: evalCase.id },
    rendered,
  }
}

function readCandidate(input) {
  if (typeof input === 'string') return input
  if (typeof input?.candidate === 'string') return input.candidate
  if (typeof input?.candidate_path === 'string') {
    const candidatePath = isAbsolute(input.candidate_path) ? input.candidate_path : resolve(repoRoot, input.candidate_path)
    return readFileSync(candidatePath, 'utf8').trim()
  }
  if (typeof input?.text === 'string') return input.text
  return ''
}

async function loadDistModule(name) {
  return import(pathToFileURL(join(repoRoot, 'dist', `${name}.js`)).href)
}

export async function runCorinaEvalCase(evalCase, context) {
  if (context.offline) {
    return createFixtureEnvelope(evalCase, readCandidate(evalCase.input))
  }

  const input = typeof evalCase.input === 'string' ? { text: evalCase.input } : evalCase.input
  const client = context.client
  if (!client) throw new Error('Live eval requested without an OpenCode client.')

  if (evalCase.capability === 'tone') {
    const mod = await loadDistModule('tone-pipeline')
    return mod.runTonePipelineWithArtifact({
      text: input.text,
      voice: input.voice,
      format: input.format,
      audience: input.audience,
      toneDesc: input.toneDesc,
      toneFile: input.toneFile,
      profile: input.profile,
      modelPreset: input.modelPreset,
    }, client)
  }

  if (evalCase.capability === 'detect') {
    const mod = await loadDistModule('detect')
    return mod.runDetectWithArtifact({
      text: input.text,
      format: input.format ?? 'report',
      autoFix: input.autoFix,
      chain: input.chain,
      voice: input.voice,
      modelPreset: input.modelPreset,
    }, client)
  }

  if (evalCase.capability === 'critique') {
    const mod = await loadDistModule('critique')
    return mod.runCritiqueWithArtifact(
      Array.isArray(input.texts) ? input.texts : [input.text ?? ''],
      {
        mode: evalCase.mode ?? input.mode,
        audience: input.audience,
        rubric: input.rubric,
        chain: input.chain,
        format: 'report',
        modelPreset: input.modelPreset,
        voice: input.voice,
      },
      client,
    )
  }

  if (evalCase.capability === 'pipeline') {
    const mod = await loadDistModule('pipeline')
    return mod.runPipelineWithArtifact(input.text ?? '', client)
  }

  throw new Error(`Unsupported capability: ${evalCase.capability}`)
}

export default runCorinaEvalCase
