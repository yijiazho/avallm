// Migration phase 7R2A; see docs/agent-architecture-migration.md.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitDecisionTrace,
  snapshotDecisionTraceInput,
} from '../server/agents/admission/composed-trace.ts'

test('trace admission consumers use the agent-owned closed boundary', () => {
  const owner = readFileSync(
    'server/agents/admission/composed-trace.ts',
    'utf8',
  )
  const externalReply = readFileSync('server/agents/external-reply.ts', 'utf8')
  const admissionConsumers = [
    'server/eval/architecture-bench.ts',
    'server/eval/architecture-report.ts',
  ].map((path) => readFileSync(path, 'utf8'))

  assert.match(externalReply, /admitDecisionTrace/)
  assert.doesNotMatch(
    externalReply,
    /validate(?:Composed|External|Finalized|Suppressed).*Trace/,
  )
  assert.doesNotMatch(owner, /from ['"].*(?:external-reply|server\/eval)/)
  for (const source of admissionConsumers) {
    assert.match(source, /admit(?:Canonical)?DecisionTrace/)
    assert.doesNotMatch(
      source,
      /validate(?:Composed|Finalized|Suppressed).*Trace/,
    )
    assert.match(
      source,
      /from '\.\.\/agents\/admission\/composed-trace\.ts'/,
    )
  }
})

test('the public trace boundary exposes canonical and closed result states', () => {
  assert.equal(typeof snapshotDecisionTraceInput, 'function')
  assert.equal(typeof admitDecisionTrace, 'function')
})
