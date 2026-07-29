import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitDecisionTrace,
  MAX_DECISION_TRACE_JSON_BYTES,
  type DecisionTraceAdmissionResult,
} from '../server/agents/admission/composed-trace.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  projectResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
} from '../server/agents/components/resolved-brain.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import {
  decisionTraceIdForRequest,
} from '../server/agents/trace.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

function resultKind(result: DecisionTraceAdmissionResult): string {
  switch (result.kind) {
    case 'trusted-exact':
      return `${result.lifecycle}:trusted`
    case 'external-diagnostic':
      return `${result.lifecycle}:external`
    case 'artifact-diagnostic':
      return `${result.lifecycle}:artifact`
    case 'rejected':
      return `${result.lifecycle}:${result.reason}`
    default: {
      const exhaustive: never = result
      return exhaustive
    }
  }
}

function minimalExternalTrace(
  fixture: ReturnType<typeof readDecisionFixtures>[number],
) {
  const decision = { kind: 'vote' as const, vote: 'approve' as const }
  return {
    decision,
    trace: {
      version: 'decision-trace-v1' as const,
      decisionId: decisionTraceIdForRequest(fixture.req, 0),
      viewerSeat: fixture.req.seat,
      request: fixture.req,
      beliefModelVersion: 'external',
      beliefThroughSeq: 0,
      quality: 'constraints-only' as const,
      degradation: [] as string[],
      topHypotheses: [],
      factCodes: [],
      reasonCodes: [],
      action: decision,
    },
  }
}

test('external admission snapshots hostile input before any trace field read', () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const external = minimalExternalTrace(fixture)
  let reads = 0
  const hostile = Object.create(null)
  Object.defineProperty(hostile, 'version', {
    enumerable: true,
    get() {
      reads++
      return external.trace.version
    },
  })
  const rejected = admitDecisionTrace({
    kind: 'pre-apply-external',
    req: fixture.req,
    decision: external.decision,
    trace: hostile,
    hostView: fixture.view,
  })
  assert.equal(resultKind(rejected), 'pre-apply-external:trace-json-unsafe')
  assert.equal(reads, 0)

  const oversized = admitDecisionTrace({
    kind: 'pre-apply-external',
    req: fixture.req,
    decision: external.decision,
    trace: { value: 'x'.repeat(MAX_DECISION_TRACE_JSON_BYTES + 1) },
    hostView: fixture.view,
  })
  assert.equal(resultKind(oversized), 'pre-apply-external:trace-too-large')
})

test('external diagnostics retain only the canonical detached snapshot', () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const external = minimalExternalTrace(fixture)
  const withTransportUndefined = external.trace as typeof external.trace & {
    beliefTeamAssessments?: undefined
  }
  withTransportUndefined.beliefTeamAssessments = undefined
  const admitted = admitDecisionTrace({
    kind: 'pre-apply-external',
    req: fixture.req,
    decision: external.decision,
    trace: external.trace,
  })
  assert.equal(admitted.kind, 'external-diagnostic')
  assert.equal(admitted.promotionEvidenceEligible, false)
  if (admitted.kind !== 'external-diagnostic') return
  assert.notEqual(admitted.trace, external.trace)
  assert.equal(Object.isFrozen(admitted.trace), true)
  assert.equal(
    Object.hasOwn(admitted.trace, 'beliefTeamAssessments'),
    false,
  )
  external.trace.beliefModelVersion = 'mutated-after-admission'
  assert.equal(admitted.trace.beliefModelVersion, 'external')
})

test('only an out-of-band identity can produce trusted exact evidence', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const agent = createComposedAgent({ seed: fixture.source.seed })
  const output = normalizeAgentOutput(
    await agent.decide(fixture.req, fixture.view),
  )
  const diagnostic = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
  })
  assert.equal(diagnostic.kind, 'artifact-diagnostic')
  assert.equal(diagnostic.promotionEvidenceEligible, false)

  const trusted = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: output.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
    expectedComponentPlan: output.trace!.componentPlan!,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true,
  })
  assert.equal(trusted.kind, 'trusted-exact')
  assert.equal(trusted.promotionEvidenceEligible, true)
  if (trusted.kind === 'trusted-exact') {
    assert.equal(
      resolvedArchitectureIdentityDigest(trusted.identity),
      output.trace!.architectureIdentityDigest,
    )
  }
})

test('self-reported identity cannot mint trust or survive a wrong witness', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const agent = createComposedAgent({ seed: fixture.source.seed })
  const output = normalizeAgentOutput(
    await agent.decide(fixture.req, fixture.view),
  )
  const forged = structuredClone(output.trace!)
  forged.architectureIdentityDigest = '0'.repeat(64)
  const withoutWitness = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: forged,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
  })
  assert.equal(withoutWitness.kind, 'artifact-diagnostic')

  const wrongWitness = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: forged,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
    expectedComponentPlan: output.trace!.componentPlan!,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true,
  })
  assert.equal(
    resultKind(wrongWitness),
    'finalized-artifact:trusted-identity-host-join-failed',
  )
})
