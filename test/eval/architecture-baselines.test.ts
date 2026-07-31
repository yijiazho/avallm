// test-lane: eval
// Migration phase 0; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  buildHeuristicBaseline,
  HEURISTIC_BASELINE_FILE,
  OBSERVED_LLM_BASELINE_FILE,
  OBSERVED_LLM_BASELINE_SCHEMA,
} from '../../server/eval/banks/architecture-baselines.ts'
import type { ObservedPromptBaseline } from '../../server/eval/banks/architecture-baselines.ts'

test('committed Phase 0 heuristic baseline matches the fixed bank', async () => {
  const committed = JSON.parse(fs.readFileSync(HEURISTIC_BASELINE_FILE, 'utf8'))
  assert.deepEqual(await buildHeuristicBaseline(), committed)
})

test('committed observed LLM baseline records role, kind, model, cost, and degradation', () => {
  const baseline = JSON.parse(
    fs.readFileSync(OBSERVED_LLM_BASELINE_FILE, 'utf8'),
  ) as ObservedPromptBaseline
  assert.equal(baseline.schema, OBSERVED_LLM_BASELINE_SCHEMA)
  assert.equal(baseline.architecture.belief, 'none')
  assert.ok(baseline.games > 0)
  assert.ok(baseline.byRole.length > 0)
  assert.deepEqual(
    baseline.byDecisionKind.map((item) => item.id),
    ['discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate'],
  )
  assert.ok(baseline.byModel.length > 0)
  assert.ok(baseline.cost > 0)
  assert.ok(baseline.calls > 0)
  assert.equal(
    baseline.degraded,
    baseline.byDecisionKind.reduce((sum, item) => sum + item.degraded, 0),
  )
  assert.ok(baseline.source.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)))
})
