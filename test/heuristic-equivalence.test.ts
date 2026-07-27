import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAgentLibrary } from '../server/agents/defs.ts'
import {
  defaultComponents,
  runArchitectureBench,
} from '../server/eval/architecture-bench.ts'
import {
  heuristicDecide,
} from '../server/agents/heuristic.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

const PHASE3A_HEURISTIC_BANK_HASH =
  '0c6a67ef0c269f0ab5fc46fb8a9d5e55216bd2290f1551a7b6c689a4ad6db52f'
// Captured from a clean worktree at Phase 3A commit
// ee8803b81ec7688db2fc2a2bf311590824c00fcf before the policy rewrite, using
// the exact seed/log/degraded projection below.

test('frozen Phase 3A decision fixtures remain byte-equivalent', () => {
  for (const fixture of readDecisionFixtures()) {
    assert.deepEqual(
      JSON.parse(JSON.stringify(
        heuristicDecide(fixture.req, fixture.view, fixture.source.seed),
      )),
      fixture.baselineDecision,
      fixture.id,
    )
  }
})

test('the complete Phase 3A architecture bank remains behavior-equivalent', async () => {
  const autopilot = loadAgentLibrary().agents.find(
    (candidate) => candidate.id === 'autopilot',
  )!
  const artifacts = await runArchitectureBench({
    variants: [{
      id: 'autopilot-v1',
      agent: autopilot,
      components: defaultComponents(autopilot),
    }],
  })
  const projection = artifacts.map((artifact) => ({
    seed: artifact.seed,
    log: artifact.log,
    degraded: artifact.degraded,
  }))
  const actual = createHash('sha256')
    .update(JSON.stringify(projection))
    .digest('hex')
  assert.equal(actual, PHASE3A_HEURISTIC_BANK_HASH)
})
