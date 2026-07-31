// test-lane: exhaustive
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadAgentLibrary } from '../../server/agents/defs.ts'
import {
  defaultComponents,
  runArchitectureBench,
} from '../../server/eval/harness/architecture-bench.ts'
import {
  heuristicDecide,
} from '../../server/agents/heuristic.ts'
import { readDecisionFixtures } from '../../server/eval/replay/decision-fixtures.ts'

const PHASE3A_HEURISTIC_BANK_HASH =
  'f1248c779f9b515f8ac201c6ee4a3f8635c2c6af1a8335e0a587c306da66e76c'
// Captured from a clean worktree at Phase 3A commit
// ee8803b81ec7688db2fc2a2bf311590824c00fcf before the policy rewrite, using
// the exact seed/log/degraded projection below. Rehashed when PrivateInfo
// became a role-discriminated union: the private-knowledge evidence payload and
// the engine knowledge event now carry a `kind` discriminant. Decisions are
// byte-identical (the sibling test above still passes); stripping exactly those
// added `kind` fields from the projection reproduces the prior hash
// 0c6a67ef0c269f0ab5fc46fb8a9d5e55216bd2290f1551a7b6c689a4ad6db52f, so this is a
// pure serialization change with no behavior drift.

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
