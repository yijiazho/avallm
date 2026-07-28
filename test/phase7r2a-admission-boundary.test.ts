import { readFileSync, readdirSync } from 'node:fs'
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

test('trace admission is agent-owned and evaluation does not depend on stdio', () => {
  const owner = readFileSync(
    'server/agents/admission/composed-trace.ts',
    'utf8',
  )
  const stdio = readFileSync('server/agents/stdio.ts', 'utf8')
  const evaluationSources = readdirSync('server/eval', {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => readFileSync(
      `${entry.parentPath}/${entry.name}`,
      'utf8',
    ))

  assert.match(stdio, /from '\.\/admission\/composed-trace\.ts'/)
  assert.doesNotMatch(owner, /from ['"].*(?:stdio|server\/eval)/)
  for (const source of evaluationSources) {
    assert.doesNotMatch(source, /from ['"].*agents\/stdio\.ts'/)
  }
})

test('transitional stdio exports preserve exact admission function identity', () => {
  assert.equal(validateComposedTraceAtTransport, validateComposedTraceAtOwner)
  assert.equal(validateSuppressedPolicyAtTransport, validateSuppressedPolicyAtOwner)
})
