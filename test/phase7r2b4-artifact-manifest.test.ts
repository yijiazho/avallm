import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createComposedAgent,
} from '../server/agents/composed.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
} from '../server/agents/trace.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import {
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../server/eval/architecture-report.ts'
import type {
  GameArtifact,
} from '../server/eval/artifact.ts'
import {
  replayGame,
} from '../server/eval/replay.ts'

const architectureCase = ARCHITECTURE_BANK.find(
  (candidate) => candidate.targetRole === 'merlin',
)!

const variant: ArchitectureVariant = {
  id: 'phase7r2b4-manifest',
  paid: false,
  components: {
    mode: 'compatibility',
    brain: 'brain-spec-v1',
    belief: 'exact-constraints-v1',
    factors: 'off',
    languageEvidence: 'off',
    observerModel: 'exact-public-observer-v1',
    identityModel: 'joint-identity-projection-v1',
    roleObjective: 'merlin-percival-objectives-v1',
    policy: 'composed-policy-v1',
    scorer: 'compatibility-scorer-v1',
    planner: 'planner-off',
    voice: 'voice-off',
  },
  createTargetAgent: (context) => createComposedAgent({
    seed: context.seed,
    publicObserver: true,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
    roleObjectives: true,
    onDecisionTrace: context.onDecisionTrace,
  }),
}

let validArtifact: GameArtifact

test('B4 artifact manifest is host assigned, generic, bounded, and reportable', async () => {
  ;[validArtifact] = await runArchitectureBench({
    variants: [variant],
    cases: [architectureCase],
    bankId: 'phase7r2b4-manifest',
  })
  const manifest = validArtifact.strategyVersions?.decisionComponents
  assert.equal(manifest?.schema, 1)
  assert.deepEqual(
    manifest?.seats.map((entry) => entry.seat),
    [validArtifact.architecture!.targetSeat],
  )
  assert.ok((manifest?.seats[0].plan.configured.length ?? 0) >= 1)
  assert.ok(Buffer.byteLength(JSON.stringify(manifest), 'utf8') < 65_536)
  assert.ok(
    (validArtifact.telemetry?.decisionLatency?.samples.length ?? 0) > 0,
  )
  assert.doesNotMatch(
    JSON.stringify(validArtifact.log),
    /decisionComponents|componentPlan|policyUse|componentEvidence/,
  )

  const report = architectureReport([validArtifact])
  const summary = report.variants[0]
  assert.equal(summary.componentEvidence.trust, 'trusted-host-manifest')
  assert.equal(summary.componentEvidence.promotionEvidenceEligible, true)
  assert.equal(summary.safety.promotionEvidenceEligible, true)
  assert.ok(summary.componentEvidence.decisions > 0)
  assert.ok(summary.componentEvidence.admitted > 0)
  assert.ok(summary.componentEvidence.exact > 0)
  assert.equal(summary.componentEvidence.structural, 0)
  assert.match(
    renderArchitectureReport(report),
    /trusted-host-manifest, promotion-eligible/,
  )

  const replayed = replayGame(validArtifact)
  assert.deepEqual(replayed.log, validArtifact.log)
})

function copyArtifact(): GameArtifact {
  return structuredClone(validArtifact)
}

function assertUnverified(
  artifact: GameArtifact,
  trust = 'unverified-composed',
): void {
  let report: ReturnType<typeof architectureReport> | undefined
  assert.doesNotThrow(() => {
    report = architectureReport([artifact])
  })
  assert.ok(report)
  assert.equal(report.variants[0].componentEvidence.trust, trust)
  assert.equal(
    report.variants[0].componentEvidence.promotionEvidenceEligible,
    false,
  )
  assert.equal(report.variants[0].safety.promotionEvidenceEligible, false)
}

test('stored report rejects manifest and generic-trace trust rewrites', () => {
  const missing = copyArtifact()
  delete missing.strategyVersions!.decisionComponents
  assertUnverified(missing)

  const wrongSeat = copyArtifact()
  wrongSeat.strategyVersions!.decisionComponents!.seats[0].seat =
    (wrongSeat.architecture!.targetSeat + 1) % wrongSeat.playerCount
  assertUnverified(wrongSeat)

  const duplicateSeat = copyArtifact()
  duplicateSeat.strategyVersions!.decisionComponents!.seats.push(
    structuredClone(
      duplicateSeat.strategyVersions!.decisionComponents!.seats[0],
    ),
  )
  assertUnverified(duplicateSeat)

  const wrongVersion = copyArtifact()
  wrongVersion.strategyVersions!.decisionComponents!.seats[0]
    .plan.configured[0].version = 'forged-v1'
  assertUnverified(wrongVersion, 'trusted-host-manifest')

  const wrongOrder = copyArtifact()
  const originalSeat =
    wrongOrder.strategyVersions!.decisionComponents!.seats[0]
  const otherSeat = originalSeat.seat === 0 ? 1 : 0
  wrongOrder.strategyVersions!.decisionComponents!.seats = [
    { seat: Math.max(originalSeat.seat, otherSeat), plan: originalSeat.plan },
    { seat: Math.min(originalSeat.seat, otherSeat), plan: originalSeat.plan },
  ]
  assertUnverified(wrongOrder)

  const erased = copyArtifact()
  erased.decisionTraces![0].componentPlan!.configured = []
  erased.decisionTraces![0].components!.configured = []
  erased.decisionTraces![0].components!.entries = []
  erased.decisionTraces![0].components!.policyUse = []
  assertUnverified(erased, 'trusted-host-manifest')

  const relabelled = copyArtifact()
  relabelled.decisionTraces![0].componentPlan!.configured[0].id =
    'forged-component'
  relabelled.decisionTraces![0].components!.configured[0].id =
    'forged-component'
  relabelled.decisionTraces![0].components!.entries[0].component.id =
    'forged-component'
  relabelled.decisionTraces![0].components!.policyUse[0].component.id =
    'forged-component'
  assertUnverified(relabelled, 'trusted-host-manifest')

  const removedUse = copyArtifact()
  removedUse.decisionTraces![0].components!.policyUse.pop()
  assertUnverified(removedUse, 'trusted-host-manifest')

  const removedDependency = copyArtifact()
  removedDependency.decisionTraces![0].componentPlan!.configured.shift()
  removedDependency.decisionTraces![0].components!.configured.shift()
  removedDependency.decisionTraces![0].components!.entries.shift()
  removedDependency.decisionTraces![0].components!.policyUse.shift()
  assertUnverified(removedDependency, 'trusted-host-manifest')

  const downgraded = copyArtifact()
  for (const trace of downgraded.decisionTraces!) {
    trace.version = DECISION_TRACE_VERSION
    delete trace.componentPlan
    delete trace.components
    delete trace.componentVersions!.decisionComponents
  }
  assertUnverified(downgraded, 'trusted-host-manifest')
})

test('historical and external traces stay readable without gaining trust', () => {
  const historical = copyArtifact()
  delete historical.strategyVersions!.decisionComponents
  for (const trace of historical.decisionTraces!) {
    trace.version = DECISION_TRACE_VERSION
    delete trace.componentPlan
    delete trace.components
    delete trace.componentVersions!.decisionComponents
  }
  assertUnverified(historical)

  const externalClaim = copyArtifact()
  delete externalClaim.strategyVersions!.decisionComponents
  externalClaim.architecture!.components.mode = 'external'
  for (const trace of externalClaim.decisionTraces!) {
    trace.agentMode = 'external'
    assert.equal(trace.version, COMPONENT_DECISION_TRACE_VERSION)
  }
  assertUnverified(externalClaim)
})

test('malformed manifest containers degrade to unverified without executing data', () => {
  const sparse = copyArtifact()
  sparse.strategyVersions!.decisionComponents!.seats =
    new Array(1) as never
  assertUnverified(sparse)

  const accessor = copyArtifact()
  let accessorInvoked = false
  Object.defineProperty(
    accessor.strategyVersions!,
    'decisionComponents',
    {
      enumerable: true,
      get() {
        accessorInvoked = true
        throw new Error('must stay data')
      },
    },
  )
  assertUnverified(accessor)
  assert.equal(accessorInvoked, false)

  const proxied = copyArtifact()
  proxied.strategyVersions!.decisionComponents = new Proxy(
    proxied.strategyVersions!.decisionComponents!,
    {
      getPrototypeOf() {
        throw new Error('must reject proxy')
      },
    },
  )
  assertUnverified(proxied)
})
