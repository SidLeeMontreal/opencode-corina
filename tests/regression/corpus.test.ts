import { defaultLayer1Evaluator } from 'opencode-eval-harness'
import type { AgentCapabilityOutput } from 'opencode-text-tools'

describe('regression corpus', () => {
  it('flags heavy AI-ism copy in the adversarial corpus sample', () => {
    const output: AgentCapabilityOutput<{ fixture: true }> = {
      agent: 'fixture',
      capability: 'tone',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      input_summary: 'fixture',
      artifact: { fixture: true },
      rendered: 'Our groundbreaking solution unlocks a transformative tapestry of possibilities across the organization.',
    }

    const result = defaultLayer1Evaluator(output, {
      id: 'regression-heavy-ai',
      label: 'heavy ai',
      input: 'input',
      capability: 'tone',
      expected: {
        score_max: 3,
        must_not_contain: ['groundbreaking', 'transformative', 'tapestry'],
      },
      tier: 1,
    })

    expect(result.pass).toBe(false)
    expect(result.score).toBeLessThanOrEqual(3)
    expect(result.flags.some((flag) => flag.includes('Contains banned text'))).toBe(true)
  })
})
