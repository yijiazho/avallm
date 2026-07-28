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
import {
  toArtifact,
  type GameArtifact,
} from '../server/eval/artifact.ts'
import {
  replayGame,
} from '../server/eval/replay.ts'
import {
  resolvedArchitectureIdentityDigest,
} from '../server/agents/components/resolved-brain.ts'

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
  const manifest = validArtifact.strategyVersions?.resolvedArchitecture
  assert.equal(manifest?.schema, 1)
  assert.equal(manifest?.targetSeat, validArtifact.architecture!.targetSeat)
  assert.ok(
    (manifest?.identity.components.configured.length ?? 0) >= 1,
  )
  assert.equal(
    validArtifact.strategyVersions?.decisionComponents,
    undefined,
  )
  assert.equal(
    Object.hasOwn(manifest?.identity ?? {}, 'migration'),
    false,
  )
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
  assert.equal(
    summary.componentEvidence.trust,
    'descriptor-host-manifest-admitted',
  )
  assert.equal(summary.componentEvidence.promotionEvidenceEligible, true)
  assert.equal(summary.safety.promotionEvidenceEligible, true)
  assert.ok(summary.componentEvidence.decisions > 0)
  assert.ok(summary.componentEvidence.admitted > 0)
  assert.ok(summary.componentEvidence.exact > 0)
  assert.equal(summary.componentEvidence.structural, 0)
  assert.match(
    renderArchitectureReport(report),
    /descriptor-host-manifest-admitted, promotion-eligible/,
  )

  const replayed = replayGame(validArtifact)
  assert.deepEqual(replayed.log, validArtifact.log)
})

test('current identity is authoritative and invalid presence cannot fall back', () => {
  const relabelledMetadata = copyArtifact()
  relabelledMetadata.architecture!.components.scorer = 'forged-scorer-v1'
  const relabelledSummary = architectureReport([
    relabelledMetadata,
  ]).variants[0]
  assert.equal(
    relabelledSummary.components.scorer,
    validArtifact.strategyVersions!.resolvedArchitecture!
      .identity.configuredPipeline.scoring.configuredScorer,
  )
  assert.notEqual(relabelledSummary.components.scorer, 'forged-scorer-v1')
  assert.equal(
    relabelledSummary.safety.promotionEvidenceEligible,
    true,
  )

  const invalidCurrent = copyArtifact()
  const legacy = copyLegacyArtifact()
  invalidCurrent.strategyVersions!.decisionComponents =
    legacy.strategyVersions!.decisionComponents
  ;(invalidCurrent.strategyVersions!.resolvedArchitecture!
    .identity as any).version = 'forged-identity-v1'
  assert.throws(
    () => architectureReport([invalidCurrent]),
    /current architecture manifest is invalid/,
  )

  const historical = copyArtifact()
  delete historical.strategyVersions!.resolvedArchitecture
  const historicalSummary = architectureReport([historical]).variants[0]
  assert.equal(
    historicalSummary.componentEvidence.trust,
    'unverified-composed',
  )
  assert.equal(
    historicalSummary.componentEvidence.promotionEvidenceEligible,
    false,
  )
})

test('current identity digest binds every configured projection group', () => {
  const mutations: readonly Readonly<{
    name: string
    mutate: (identity: any) => void
  }>[] = [
    {
      name: 'execution and base mode',
      mutate(identity) {
        identity.executionMode = 'hybrid'
        identity.base.mode = 'hybrid'
      },
    },
    {
      name: 'base observer',
      mutate(identity) {
        identity.base.observerModel = 'off'
        identity.componentContributions.observerModel = 'off'
      },
    },
    {
      name: 'component graph',
      mutate(identity) {
        identity.components.requested = []
      },
    },
    {
      name: 'belief pipeline',
      mutate(identity) {
        identity.configuredPipeline.belief.model = 'forged-belief-v1'
      },
    },
    {
      name: 'analysis',
      mutate(identity) {
        identity.configuredPipeline.analysis.situation =
          'forged-analysis-v1'
      },
    },
    {
      name: 'candidate generation',
      mutate(identity) {
        identity.configuredPipeline.candidateGeneration.legalCandidates =
          'forged-candidates-v1'
      },
    },
    {
      name: 'forced policy',
      mutate(identity) {
        identity.configuredPipeline.forcedPolicy.policy =
          'forged-forced-v1'
      },
    },
    {
      name: 'configured scorer',
      mutate(identity) {
        identity.configuredPipeline.scoring.configuredScorer =
          'forged-scorer-v1'
      },
    },
    {
      name: 'scorer base chain',
      mutate(identity) {
        identity.configuredPipeline.scoring.configuredBaseChain =
          ['forged-base-v1']
      },
    },
    {
      name: 'scorer fallback',
      mutate(identity) {
        identity.configuredPipeline.scoring.invalidOutputFallback =
          'forged-fallback-v1'
      },
    },
    {
      name: 'planner protocol',
      mutate(identity) {
        identity.configuredPipeline.planning.protocol =
          'forged-planner-v1'
      },
    },
    {
      name: 'decision plan',
      mutate(identity) {
        identity.configuredPipeline.planning.decisionPlan =
          'forged-plan-v1'
      },
    },
    {
      name: 'prompt',
      mutate(identity) {
        identity.configuredPipeline.prompt.prompt = 'forged-prompt-v1'
      },
    },
    {
      name: 'renderer',
      mutate(identity) {
        identity.configuredPipeline.prompt.renderer =
          'forged-renderer-v1'
      },
    },
    {
      name: 'communication intent',
      mutate(identity) {
        identity.configuredPipeline.communication.intent =
          'forged-intent-v1'
      },
    },
    {
      name: 'voice protocol',
      mutate(identity) {
        identity.configuredPipeline.communication.voiceProtocol =
          'forged-voice-v1'
      },
    },
    {
      name: 'coherence intent',
      mutate(identity) {
        identity.configuredPipeline.planCoherence.intent = 'conceal'
      },
    },
  ]
  for (const { name, mutate } of mutations) {
    const artifact = copyArtifact()
    mutate(
      artifact.strategyVersions!.resolvedArchitecture!.identity,
    )
    assert.throws(
      () => architectureReport([artifact]),
      /current architecture manifest is invalid/,
      name,
    )
  }
})

test('current variant grouping compares the exact admitted identity', () => {
  const baseline = copyArtifact()
  const drifted = copyArtifact()
  drifted.id += '-identity-drift'
  drifted.architecture!.caseId += '-identity-drift'
  const manifest = drifted.strategyVersions!.resolvedArchitecture!
  ;(manifest.identity.configuredPipeline.planning as any).protocol =
    'alternate-planner-protocol-v1'
  manifest.identityDigest = resolvedArchitectureIdentityDigest(
    manifest.identity,
  )
  assert.throws(
    () => architectureReport([baseline, drifted]),
    /inconsistent component versions/,
  )
})

test('current run join binds eligibility as well as configured order', () => {
  const artifact = copyArtifact()
  const manifest = artifact.strategyVersions!.resolvedArchitecture!
  const admitted = artifact.decisionTraces!
    .flatMap((trace) => trace.components!.entries)
    .find((entry) => entry.status === 'admitted')!
  const key = `${admitted.component.id}@${admitted.component.version}`
  const identity = manifest.identity as any
  identity.components.eligible =
    identity.components.eligible.filter(
      (entry: { id: string; version: string }) =>
        `${entry.id}@${entry.version}` !== key,
    )
  identity.components.ineligible.push({
    component: structuredClone(admitted.component),
    missingHostRequirements: ['forged-missing-capability'],
    ineligibleDependencies: [],
  })
  manifest.identityDigest = resolvedArchitectureIdentityDigest(
    manifest.identity,
  )
  for (const trace of artifact.decisionTraces!.filter(
    (candidate) => candidate.viewerSeat === manifest.targetSeat,
  )) {
    trace.architectureIdentityDigest = manifest.identityDigest
  }
  const summary = architectureReport([artifact]).variants[0]
  assert.equal(summary.safety.promotionEvidenceEligible, false)
  assert.ok(summary.safety.traceAttributionViolations > 0)
})

test('current artifact writer rejects architecture identity relabeling', () => {
  const descriptor = createComposedAgent({
    seed: validArtifact.seed,
    publicObserver: true,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
    roleObjectives: true,
  }).resolvedBrain().description
  const write = (
    mutate: (trace: NonNullable<GameArtifact['decisionTraces']>[number]) =>
      void,
  ) => {
    const traces = structuredClone(validArtifact.decisionTraces!)
    mutate(traces[0])
    return () => toArtifact(replayGame(validArtifact), {
      agents: validArtifact.players.map((player) => player.agent),
      degraded: structuredClone(validArtifact.degraded),
      steps: validArtifact.steps,
      architecture: structuredClone(validArtifact.architecture!),
      decisionTraces: traces,
      trustedArchitecture: {
        seat: validArtifact.architecture!.targetSeat,
        descriptor,
      },
    })
  }
  assert.throws(
    write((trace) => {
      trace.architectureIdentityDigest = '0'.repeat(64)
    }),
    /trusted architecture does not match traces/,
  )
  assert.throws(
    write((trace) => {
      trace.components!.entries = trace.components!.entries.slice(1)
    }),
    /trusted architecture does not match traces/,
  )
  assert.throws(
    write((trace) => {
      trace.agentMode = 'hybrid'
    }),
    /trusted architecture does not match traces/,
  )
})

function copyArtifact(): GameArtifact {
  return structuredClone(validArtifact)
}

function copyLegacyArtifact(): GameArtifact {
  const artifact = copyArtifact()
  const current = artifact.strategyVersions!.resolvedArchitecture!
  artifact.strategyVersions!.decisionComponents = {
    schema: 1,
    seats: [{
      seat: current.targetSeat,
      plan: {
        version: 'decision-component-plan-v1',
        configured: structuredClone(
          current.identity.components.configured,
        ),
      },
    }],
  }
  delete artifact.strategyVersions!.resolvedArchitecture
  return artifact
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
  const missing = copyLegacyArtifact()
  delete missing.strategyVersions!.decisionComponents
  assertUnverified(missing)

  const wrongSeat = copyLegacyArtifact()
  wrongSeat.strategyVersions!.decisionComponents!.seats[0].seat =
    (wrongSeat.architecture!.targetSeat + 1) % wrongSeat.playerCount
  assertUnverified(wrongSeat)

  const duplicateSeat = copyLegacyArtifact()
  duplicateSeat.strategyVersions!.decisionComponents!.seats.push(
    structuredClone(
      duplicateSeat.strategyVersions!.decisionComponents!.seats[0],
    ),
  )
  assertUnverified(duplicateSeat)

  const wrongVersion = copyLegacyArtifact()
  wrongVersion.strategyVersions!.decisionComponents!.seats[0]
    .plan.configured[0].version = 'forged-v1'
  assertUnverified(wrongVersion, 'legacy-host-manifest-admitted')

  const wrongOrder = copyLegacyArtifact()
  const originalSeat =
    wrongOrder.strategyVersions!.decisionComponents!.seats[0]
  const otherSeat = originalSeat.seat === 0 ? 1 : 0
  wrongOrder.strategyVersions!.decisionComponents!.seats = [
    { seat: Math.max(originalSeat.seat, otherSeat), plan: originalSeat.plan },
    { seat: Math.min(originalSeat.seat, otherSeat), plan: originalSeat.plan },
  ]
  assertUnverified(wrongOrder)

  const erased = copyLegacyArtifact()
  erased.decisionTraces![0].componentPlan!.configured = []
  erased.decisionTraces![0].components!.configured = []
  erased.decisionTraces![0].components!.entries = []
  erased.decisionTraces![0].components!.policyUse = []
  assertUnverified(erased, 'legacy-host-manifest-admitted')

  const relabelled = copyLegacyArtifact()
  relabelled.decisionTraces![0].componentPlan!.configured[0].id =
    'forged-component'
  relabelled.decisionTraces![0].components!.configured[0].id =
    'forged-component'
  relabelled.decisionTraces![0].components!.entries[0].component.id =
    'forged-component'
  relabelled.decisionTraces![0].components!.policyUse[0].component.id =
    'forged-component'
  assertUnverified(relabelled, 'legacy-host-manifest-admitted')

  const removedUse = copyLegacyArtifact()
  removedUse.decisionTraces![0].components!.policyUse.pop()
  assertUnverified(removedUse, 'legacy-host-manifest-admitted')

  const removedDependency = copyLegacyArtifact()
  removedDependency.decisionTraces![0].componentPlan!.configured.shift()
  removedDependency.decisionTraces![0].components!.configured.shift()
  removedDependency.decisionTraces![0].components!.entries.shift()
  removedDependency.decisionTraces![0].components!.policyUse.shift()
  assertUnverified(removedDependency, 'legacy-host-manifest-admitted')

  const downgraded = copyLegacyArtifact()
  for (const trace of downgraded.decisionTraces!) {
    trace.version = DECISION_TRACE_VERSION
    delete trace.componentPlan
    delete trace.components
    delete trace.componentVersions!.decisionComponents
  }
  assertUnverified(downgraded, 'legacy-host-manifest-admitted')
})

test('historical and external traces stay readable without gaining trust', () => {
  const historical = copyLegacyArtifact()
  delete historical.strategyVersions!.decisionComponents
  for (const trace of historical.decisionTraces!) {
    trace.version = DECISION_TRACE_VERSION
    delete trace.componentPlan
    delete trace.components
    delete trace.componentVersions!.decisionComponents
  }
  assertUnverified(historical)

  const externalClaim = copyLegacyArtifact()
  delete externalClaim.strategyVersions!.decisionComponents
  externalClaim.architecture!.components.mode = 'external'
  for (const trace of externalClaim.decisionTraces!) {
    trace.agentMode = 'external'
    assert.equal(trace.version, COMPONENT_DECISION_TRACE_VERSION)
  }
  assertUnverified(externalClaim)
})

test('malformed manifest containers degrade to unverified without executing data', () => {
  const sparse = copyLegacyArtifact()
  sparse.strategyVersions!.decisionComponents!.seats =
    new Array(1) as never
  assertUnverified(sparse)

  const accessor = copyLegacyArtifact()
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

  const proxied = copyLegacyArtifact()
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
