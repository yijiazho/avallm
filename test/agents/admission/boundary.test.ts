// test-lane: contract
// Migration phase 7R2A; see docs/agent-architecture-migration.md.

import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitDecisionTrace,
  snapshotDecisionTraceInput,
} from '../../../server/agents/admission/composed-trace.ts'

test('trace admission consumers use the agent-owned closed boundary', () => {
  const owner = readFileSync(
    'server/agents/admission/composed-trace.ts',
    'utf8',
  )
  const externalReply = readFileSync('server/agents/external-reply.ts', 'utf8')
  // Each consumer carries its OWN expected specifier rather than sharing one
  // pattern: they now sit at different depths under server/eval/, and a single
  // relaxed regex would stop pinning the exact path, which is the whole value
  // of the assertion.
  const admissionConsumers = [
    {
      path: 'server/eval/harness/architecture-bench.ts',
      toAgents: '../../agents',
    },
    {
      path: 'server/eval/architecture-report/safety-current.ts',
      toAgents: '../../agents',
    },
    {
      path: 'server/eval/architecture-report/safety-legacy.ts',
      toAgents: '../../agents',
    },
  ].map(({ path, toAgents }) => ({
    source: readFileSync(path, 'utf8'),
    importer: new RegExp(
      `from '${toAgents.replace(/\./g, '\.')}/admission/composed-trace\.ts'`,
    ),
  }))

  assert.match(externalReply, /admitDecisionTrace/)
  assert.doesNotMatch(
    externalReply,
    /validate(?:Composed|External|Finalized|Suppressed).*Trace/,
  )
  assert.doesNotMatch(owner, /from ['"].*(?:external-reply|server\/eval)/)
  for (const { source, importer } of admissionConsumers) {
    assert.match(source, /admit(?:Canonical)?DecisionTrace/)
    assert.doesNotMatch(
      source,
      /validate(?:Composed|Finalized|Suppressed).*Trace/,
    )
    assert.match(source, importer)
  }
})

test('the public trace boundary exposes canonical and closed result states', () => {
  assert.equal(typeof snapshotDecisionTraceInput, 'function')
  assert.equal(typeof admitDecisionTrace, 'function')
})
