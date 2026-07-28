import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const WALL_CLOCK_SUITES = [
  'test/good-proposal-scorer.test.ts',
  'test/good-vote-scorer.test.ts',
  'test/phase6d-active-language-eval.test.ts',
  'test/phase7a-public-observer.test.ts',
  'test/phase7b1-joint-identity.test.ts',
  'test/phase7c1-role-objectives.test.ts',
  'test/phase7c2-role-policy.test.ts',
  'test/phase7e2a-mordred-native.test.ts',
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
