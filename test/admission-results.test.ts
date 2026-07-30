// Migration phase 7R3B1B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  admitCanonicalDecisionTrace,
  admitDecisionTrace,
  MAX_DECISION_TRACE_JSON_BYTES,
  snapshotDecisionTraceInput,
  type CanonicalDecisionTraceCandidate,
  type DecisionTraceAdmissionResult,
} from '../server/agents/admission/composed-trace.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  projectResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
} from '../server/agents/components/resolved-brain.ts'
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

test('removed quest-policy flats are closed-ingress tombstones', () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const external = minimalExternalTrace(fixture)
  const cases = [
    { privateEvilQuestCardPolicy: { mode: 'removed' } },
    { componentVersions: { evilQuestCardPolicy: 'removed-policy' } },
    {
      componentVersions: {
        configuredEvilQuestCardPolicy: 'unknown-policy',
      },
    },
  ]
  for (const removed of cases) {
    const rejected = admitDecisionTrace({
      kind: 'pre-apply-external',
      req: fixture.req,
      decision: external.decision,
      trace: { ...external.trace, ...removed },
      hostView: fixture.view,
    })
    assert.equal(
      resultKind(rejected),
      'pre-apply-external:removed-flat-field',
    )
  }
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
  const output = await agent.decide(fixture.req, fixture.view)
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
  const output = await agent.decide(fixture.req, fixture.view)
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

test('canonical admission rejects forged wrappers without reading their trace', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const agent = createComposedAgent({ seed: fixture.source.seed })
  const output = await agent.decide(fixture.req, fixture.view)
  let reads = 0
  const accessorForgery = Object.freeze({
    kind: 'canonical-decision-trace-candidate',
    get trace() {
      reads++
      return output.trace!
    },
    bytes: 1,
  }) as unknown as CanonicalDecisionTraceCandidate
  const rejectedAccessor = admitCanonicalDecisionTrace({
    kind: 'finalized-artifact',
    trace: accessorForgery,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
  })
  assert.equal(
    resultKind(rejectedAccessor),
    'finalized-artifact:canonical-candidate-untrusted',
  )
  assert.equal(reads, 0)

  const mutableTrace = structuredClone(output.trace!)
  const mutableForgery = {
    kind: 'canonical-decision-trace-candidate',
    trace: mutableTrace,
    bytes: 1,
  } as unknown as CanonicalDecisionTraceCandidate
  const rejectedMutable = admitCanonicalDecisionTrace({
    kind: 'finalized-artifact',
    trace: mutableForgery,
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
    resultKind(rejectedMutable),
    'finalized-artifact:canonical-candidate-untrusted',
  )
  mutableTrace.beliefModelVersion = 'mutated-forgery'
  assert.equal(rejectedMutable.kind, 'rejected')
})

test('authentic canonical candidates are reusable, detached, and deeply frozen', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const agent = createComposedAgent({ seed: fixture.source.seed })
  const output = await agent.decide(fixture.req, fixture.view)
  const sourceTrace = structuredClone(output.trace!)
  const originalBeliefModelVersion = sourceTrace.beliefModelVersion
  const expectedPlan = sourceTrace.componentPlan!
  const snapshot = snapshotDecisionTraceInput(sourceTrace)
  assert.equal(snapshot.kind, 'canonical-decision-trace-candidate')
  if (snapshot.kind !== 'canonical-decision-trace-candidate') return

  sourceTrace.beliefModelVersion = 'mutated-after-snapshot'
  const input = {
    kind: 'finalized-artifact' as const,
    trace: snapshot,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: fixture.source.seed,
    expectedComponentPlan: expectedPlan,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
    expectComponentTrace: true as const,
  }
  const first = admitCanonicalDecisionTrace(input)
  const second = admitCanonicalDecisionTrace(input)
  assert.equal(first.kind, 'trusted-exact')
  assert.equal(second.kind, 'trusted-exact')
  if (first.kind !== 'trusted-exact' || second.kind !== 'trusted-exact') return
  assert.equal(first.trace, snapshot.trace)
  assert.equal(second.trace, snapshot.trace)
  assert.equal(first.trace.beliefModelVersion, originalBeliefModelVersion)
  assert.equal(Object.isFrozen(first.trace), true)
  assert.equal(Object.isFrozen(first.trace.components), true)
  assert.equal(Object.isFrozen(first.trace.components?.entries), true)
  assert.equal(Object.isFrozen(first.trace.components?.entries[0]), true)
})

// A seat is only meaningful against a table, and admission used to check the
// integers without the table: the private seat guard here asked for "integer
// and non-negative" and nothing else, so `team: [0, 9999]` was an admitted
// trace at a five-handed fixture. The seat lists now run through the shared
// canonicalSeats, bounded by the host's own rolesInPlay.
test('an out-of-table seat is refused everywhere a trace names seats', () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  assert.equal(fixture.view.playerCount, 5)
  const external = minimalExternalTrace(fixture)
  // rolesInPlay is the field both host-view arms carry, and its length is the
  // table. The partial arm is used here because a full PlayerView also drags
  // in the v1 role dependency host join, which this deliberately bare trace
  // cannot satisfy either way.
  const partialHostView = { rolesInPlay: fixture.view.rolesInPlay }
  const assessment = (team: readonly number[]) => ({
    candidateId: `legal-candidates-v2:propose:${team.join(',')}`,
    beliefModelVersion: external.trace.beliefModelVersion,
    beliefThroughSeq: external.trace.beliefThroughSeq,
    probabilitySemantics: 'uniform-feasible-joint' as const,
    team: [...team],
    cleanProbability: 1,
    evilCountDistribution: [1, ...team.map(() => 0)],
    knownFailsAboard: [] as number[],
  })
  const relevantTeam = (team: readonly number[]) => ({
    team: [...team],
    cleanProbability: 1,
    evilCountDistribution: [1, ...team.map(() => 0)],
    knownFailsAboard: [] as number[],
  })
  const hypothesis = (evilSeats: readonly number[]) => ({
    worldKey: evilSeats.join('.'),
    probability: 1,
    evilSeats: [...evilSeats],
  })
  const carriers = [
    {
      label: 'beliefTeamAssessments',
      legal: { beliefTeamAssessments: [assessment([0, 1])] },
      hostile: { beliefTeamAssessments: [assessment([0, 9999])] },
    },
    {
      label: 'relevantTeam',
      legal: { relevantTeam: relevantTeam([0, 1]) },
      hostile: { relevantTeam: relevantTeam([0, 9999]) },
    },
    {
      label: 'topHypotheses',
      legal: { topHypotheses: [hypothesis([0, 1])] },
      hostile: { topHypotheses: [hypothesis([0, 9999])] },
    },
  ]
  for (const carrier of carriers) {
    assert.equal(
      resultKind(admitDecisionTrace({
        kind: 'pre-apply-external',
        req: fixture.req,
        decision: external.decision,
        trace: { ...external.trace, ...carrier.legal },
        hostView: partialHostView,
      })),
      'pre-apply-external:external',
      `${carrier.label} in range`,
    )
    assert.equal(
      resultKind(admitDecisionTrace({
        kind: 'pre-apply-external',
        req: fixture.req,
        decision: external.decision,
        trace: { ...external.trace, ...carrier.hostile },
        hostView: partialHostView,
      })),
      'pre-apply-external:external-detached-invalid',
      `${carrier.label} out of table`,
    )
  }

  // The documented remaining gap, pinned so it cannot widen quietly. A trace
  // declares no table size of its own, so a caller that supplies no host view
  // at all leaves admission with nothing trustworthy to bound against. The
  // canonical shape still holds: descending, repeated, sparse, and fractional
  // seats are refused here exactly as they are above.
  assert.equal(
    resultKind(admitDecisionTrace({
      kind: 'pre-apply-external',
      req: fixture.req,
      decision: external.decision,
      trace: {
        ...external.trace,
        beliefTeamAssessments: [assessment([0, 9999])],
      },
    })),
    'pre-apply-external:external',
  )
  for (const team of [[1, 0], [1, 1], [0, 0.5]]) {
    assert.equal(
      resultKind(admitDecisionTrace({
        kind: 'pre-apply-external',
        req: fixture.req,
        decision: external.decision,
        trace: { ...external.trace, beliefTeamAssessments: [assessment(team)] },
      })),
      'pre-apply-external:external-detached-invalid',
      `unbounded still canonical: ${team.join(',')}`,
    )
  }
})
