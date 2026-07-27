import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  assertFreshArchitectureOutput,
  runArchitectureBench,
  spendDelta,
} from '../server/eval/architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../server/eval/architecture-report.ts'
import type { AgentDef } from '../server/agents/defs.ts'
import type { SpendEntry } from '../server/llm/openrouter.ts'

const heuristic = (id: string): AgentDef => ({
  id,
  name: id,
  version: 1,
  engine: { type: 'heuristic' },
})

test('architecture bench compares variants on an identical fixed deal and table', async () => {
  const artifacts = await runArchitectureBench({
    variants: [
      {
        id: 'baseline',
        agent: heuristic('baseline-agent'),
        components: { experiment: 'baseline' },
      },
      {
        id: 'candidate',
        agent: heuristic('candidate-agent'),
        components: { experiment: 'candidate' },
      },
    ],
    cases: [{
      id: 'test-5p-merlin',
      seed: 'architecture-v1-5-merlin',
      playerCount: 5,
      roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
      talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
      targetRole: 'merlin',
      expectedTargetSeat: 4,
    }],
    bankId: 'test-bank',
  })
  assert.equal(artifacts.length, 2)
  const [baseline, candidate] = artifacts
  assert.equal(baseline.seed, candidate.seed)
  assert.deepEqual(
    baseline.players.map((p) => p.role),
    candidate.players.map((p) => p.role),
  )
  assert.deepEqual(baseline.log, candidate.log)
  assert.equal(baseline.architecture?.targetSeat, 4)
  assert.equal(candidate.architecture?.targetSeat, 4)

  const report = architectureReport(artifacts)
  assert.equal(report.bank, 'test-bank')
  assert.equal(report.variants.length, 2)
  assert.equal(report.comparisons.length, 1)
  assert.equal(report.comparisons[0].matchedCases, 1)
  assert.equal(report.comparisons[0].wins, 0)
  assert.equal(report.comparisons[0].degraded, 0)
  assert.match(renderArchitectureReport(report), /1 matched/)
  assert.match(renderArchitectureReport(report), /belief=exact-constraints-v1/)
  assert.match(renderArchitectureReport(report), /policy=heuristic-policy-v2/)
  assert.match(renderArchitectureReport(report), /experiment=baseline/)

  assert.throws(
    () => architectureReport([...artifacts, baseline]),
    /duplicate architecture result/,
  )
  const mismatched = structuredClone(candidate)
  mismatched.players[0].name = 'Different table'
  assert.throws(
    () => architectureReport([baseline, mismatched]),
    /not matched on deal and table configuration/,
  )
})

test('architecture bench refuses an LLM variant without explicit paid approval', async () => {
  const llm: AgentDef = {
    id: 'paid',
    name: 'paid',
    version: 1,
    engine: { type: 'llm', model: 'deepseek-flash' },
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [{
        id: 'paid',
        agent: llm,
        components: {},
      }],
      cases: [],
    }),
    /allowPaid: true/,
  )
})

test('architecture bench rejects component labels that disagree with runtime resolution', async () => {
  await assert.rejects(
    runArchitectureBench({
      variants: [{
        id: 'mislabelled',
        agent: heuristic('mislabelled'),
        components: { belief: 'none' },
      }],
      cases: [],
    }),
    /labels belief=none.*runtime uses belief=exact-constraints-v1/,
  )
})

test('architecture bench CLI refuses a non-empty output corpus before a rerun', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'avalon-architecture-output-'))
  const output = path.join(directory, 'architecture.jsonl')
  try {
    assert.doesNotThrow(() => assertFreshArchitectureOutput(output))
    fs.writeFileSync(output, '')
    assert.doesNotThrow(() => assertFreshArchitectureOutput(output))
    fs.writeFileSync(output, '{"existing":true}\n')
    assert.throws(
      () => assertFreshArchitectureOutput(output),
      /refusing to append architecture results to an existing corpus/,
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('spendDelta records only calls made during one architecture game', () => {
  const entry = (calls: number, cost: number): SpendEntry => ({
    calls,
    cost,
    prompt: calls * 100,
    completion: calls * 10,
    reasoning: 0,
    reasoningLeakCalls: 0,
    providerViolationCalls: 0,
    model: 'model/slug',
    providers: { provider: calls },
  })
  assert.deepEqual(
    spendDelta(
      { 'agent/vote': entry(2, 0.02) },
      { 'agent/vote': entry(5, 0.05), 'agent/propose': entry(1, 0.03) },
    )['agent/vote'].calls,
    3,
  )
  const delta = spendDelta(
    { 'agent/vote': entry(2, 0.02) },
    { 'agent/vote': entry(5, 0.05), 'agent/propose': entry(1, 0.03) },
  )
  assert.ok(Math.abs(delta['agent/vote'].cost - 0.03) < 1e-12)
  assert.deepEqual(delta['agent/propose'], entry(1, 0.03))
})
