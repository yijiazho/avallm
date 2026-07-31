// test-lane: perf
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

// The suites whose assertWallClockBelow budgets are dormant outside this lane.
// Spelled as repo-relative paths because they are handed to a child process,
// not imported, so nothing typechecks them: a stale entry here is a budget that
// silently stops being measured rather than a build failure.
const WALL_CLOCK_SUITES = [
  'test/eval/active-language.test.ts',
  'test/agents/role-score-layers/good-proposal.test.ts',
  'test/agents/role-score-layers/good-vote.test.ts',
  'test/agents/belief/identity.test.ts',
  'test/agents/analysis/mordred-blindness-native.test.ts',
  'test/agents/analysis/observer.test.ts',
  'test/agents/analysis/role-objectives.test.ts',
  'test/agents/analysis/role-policy.test.ts',
]

test('architecture wall-clock budgets pass in the isolated perf lane', () => {
  const childEnv = { ...process.env, AVALON_PERF_ASSERTIONS: '1' }
  delete childEnv.NODE_TEST_CONTEXT
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=1', ...WALL_CLOCK_SUITES],
    {
      encoding: 'utf8',
      env: childEnv,
    },
  )
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n'),
  )
})
