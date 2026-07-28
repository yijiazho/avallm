import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  validateComposedTraceHostJoin as validateComposedTraceAtOwner,
  validateSuppressedEvilQuestCardPolicyHostJoin as validateSuppressedPolicyAtOwner,
} from '../server/agents/admission/composed-trace.ts'
import {
  validateComposedTraceHostJoin as validateComposedTraceAtTransport,
  validateSuppressedEvilQuestCardPolicyHostJoin as validateSuppressedPolicyAtTransport,
} from '../server/agents/stdio.ts'

test('composed trace admission consumers import the agent-owned module', () => {
  const owner = readFileSync(
    'server/agents/admission/composed-trace.ts',
    'utf8',
  )
  const stdio = readFileSync('server/agents/stdio.ts', 'utf8')
  const admissionConsumers = [
    'server/eval/architecture-bench.ts',
    'server/eval/architecture-report.ts',
  ].map((path) => readFileSync(path, 'utf8'))

  assert.match(stdio, /from '\.\/admission\/composed-trace\.ts'/)
  assert.doesNotMatch(owner, /from ['"].*(?:stdio|server\/eval)/)
  for (const source of admissionConsumers) {
    assert.match(source, /validateComposedTraceHostJoin/)
    assert.match(source, /validateSuppressedEvilQuestCardPolicyHostJoin/)
    assert.match(
      source,
      /from '\.\.\/agents\/admission\/composed-trace\.ts'/,
    )
  }
})

test('transitional stdio exports preserve exact admission function identity', () => {
  assert.equal(validateComposedTraceAtTransport, validateComposedTraceAtOwner)
  assert.equal(validateSuppressedPolicyAtTransport, validateSuppressedPolicyAtOwner)
})
