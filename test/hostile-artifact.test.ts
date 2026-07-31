// Migration phase 7R2B4; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createComposedAgent,
} from '../server/agents/composed.ts'
import {
  componentPayload,
  DECISION_COMPONENT_PLAN_VERSION,
  MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  validateDecisionComponentPlan,
  type DecisionComponentPlan,
} from '../server/agents/components/kernel.ts'
import {
  GOOD_ROLE_OBJECTIVE_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  DECISION_TRACE_VERSION,
} from '../server/agents/trace.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../server/agents/analysis/role-objective-types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../server/agents/analysis/role-utility.ts'
import {
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  seededRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import {
  ARCHITECTURE_BANK,
} from '../server/eval/architecture-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../server/eval/architecture-report.ts'
import type {
  GameArtifact,
} from '../server/eval/artifact.ts'

const merlinCase = ARCHITECTURE_BANK.find(
  (candidate) => candidate.targetRole === 'merlin',
)!

function rolePolicyVariant(
  id: string,
  external = false,
): ArchitectureVariant {
  return {
    id,
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      beliefVisibility: 'none',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      identityModel: 'joint-identity-projection-v1',
      decisionComponents: 'decision-component-run-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      roleObjective: ROLE_OBJECTIVE_MODEL_VERSION,
      roleUtility: ROLE_UTILITY_PROJECTION_VERSION,
      policy: 'composed-policy-v1',
      scorer: ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      planner: 'planner-off',
      prompt: 'composed-typed-context-v4',
      renderer: 'composed-policy-renderer-v4',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
    },
    createTargetAgent(context) {
      const composed = createComposedAgent({
        seed: context.seed,
        scorer: seededRoleObjectiveScorer,
        roleObjectives: true,
        publicObserver: true,
        privateIdentity: {
          roleQueries: [{ roles: ['merlin'] }],
          hiddenTeam: true,
        },
        onDecisionTrace: context.onDecisionTrace,
      })
      if (!external) return composed
      const { resolvedBrain: _resolvedBrain, ...selfDescribed } = composed
      return selfDescribed
    },
  }
}

/**
 * The same comparison without role components. A variant that declares a role
 * objective can no longer produce a readable v1 artifact, because the retired
 * flat payload that used to carry the proof is refused at ingress, so the
 * descriptor-less v1 path is exercised through a role-free variant.
 */
function roleFreeVariant(id: string): ArchitectureVariant {
  const base = rolePolicyVariant(id)
  const {
    roleObjective: _roleObjective,
    roleUtility: _roleUtility,
    ...components
  } = base.components
  return {
    ...base,
    components: {
      ...components,
      scorer: 'compatibility-scorer-v1',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }],
        hiddenTeam: true,
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
}

let roleFreeFixture: Promise<GameArtifact> | undefined

async function roleFreeArtifact(): Promise<GameArtifact> {
  roleFreeFixture ??= runArchitectureBench({
    variants: [roleFreeVariant('phase7r2b4-hostile-artifact-role-free')],
    cases: [merlinCase],
    bankId: 'phase7r2b4-hostile-artifact-role-free',
  }).then(([artifact]) => artifact)
  return structuredClone(await roleFreeFixture)
}

let trustedFixture: Promise<GameArtifact> | undefined

async function trustedArtifact(): Promise<GameArtifact> {
  trustedFixture ??= runArchitectureBench({
    variants: [rolePolicyVariant('phase7r2b4-hostile-artifact')],
    cases: [merlinCase],
    bankId: 'phase7r2b4-hostile-artifact',
  }).then(([artifact]) => artifact)
  return structuredClone(await trustedFixture)
}

function asLegacyArtifact(artifact: GameArtifact): GameArtifact {
  const legacy = structuredClone(artifact)
  const current = legacy.strategyVersions!.resolvedArchitecture!
  legacy.strategyVersions!.decisionComponents = {
    schema: 1,
    seats: [{
      seat: current.targetSeat,
      plan: {
        version: DECISION_COMPONENT_PLAN_VERSION,
        configured: structuredClone(
          current.identity.components.configured,
        ),
      },
    }],
  }
  delete legacy.strategyVersions!.resolvedArchitecture
  return legacy
}

/**
 * A descriptor-less v1 artifact. It carries no role components at all: the
 * retired flat role projections are refused at canonical ingress, and a v1
 * trace cannot declare a role component version without one. Descriptor-less
 * v1 artifacts themselves remain diagnostically readable.
 */
function asDescriptorlessV1Artifact(
  artifact: GameArtifact,
): GameArtifact {
  const legacy = asLegacyArtifact(artifact)
  delete legacy.strategyVersions!.decisionComponents
  for (const trace of legacy.decisionTraces!) {
    trace.version = DECISION_TRACE_VERSION
    delete trace.componentPlan
    delete trace.components
    delete trace.decisionLayerRun
    delete trace.componentVersions!.decisionComponents
  }
  return legacy
}

/** A stored v1 artifact that still presents a retired flat role projection. */
function withRetiredFlatRolePayload(
  artifact: GameArtifact,
): GameArtifact {
  const legacy = structuredClone(artifact)
  const trace = legacy.decisionTraces!.find(
    (candidate) => componentPayload(
      candidate.components!,
      GOOD_ROLE_OBJECTIVE_COMPONENT,
    ) !== undefined,
  )!
  ;(trace as unknown as Record<string, unknown>).privateRoleObjective =
    structuredClone(componentPayload(
      trace.components!,
      GOOD_ROLE_OBJECTIVE_COMPONENT,
    ))
  return legacy
}

function summary(artifact: GameArtifact) {
  return architectureReport([artifact]).variants[0]
}

function assertDiagnosticRejection(artifact: GameArtifact): void {
  const result = summary(artifact)
  assert.equal(result.safety.promotionEvidenceEligible, false)
  assert.equal(
    result.componentEvidence.promotionEvidenceEligible,
    false,
  )
}

test('trusted target-seat manifest drives the generic evaluation view', async () => {
  const artifact = await trustedArtifact()
  const targetSeat = artifact.architecture!.targetSeat
  const manifest = artifact.strategyVersions!.resolvedArchitecture!
  assert.equal(manifest.schema, 1)
  assert.equal(manifest.targetSeat, targetSeat)
  const plan = {
    version: DECISION_COMPONENT_PLAN_VERSION,
    configured: manifest.identity.components.configured,
  }
  assert.ok(validateDecisionComponentPlan(plan))
  assert.ok(artifact.decisionTraces!.every(
    (trace) =>
      trace.viewerSeat === targetSeat
      && trace.version === COMPONENT_DECISION_TRACE_VERSION
      && JSON.stringify(trace.componentPlan)
        === JSON.stringify(plan),
  ))

  const result = summary(artifact)
  assert.equal(result.safety.traceAttributionViolations, 0)
  assert.equal(result.safety.hiddenInformationViolations, 0)
  assert.equal(result.safety.promotionEvidenceEligible, true)
  assert.equal(
    result.componentEvidence.trust,
    'descriptor-host-manifest-admitted',
  )
  assert.equal(
    result.componentEvidence.promotionEvidenceEligible,
    true,
  )
  assert.deepEqual(
    result.decisionComponents,
    plan.configured.map(
      (component) => `${component.id}@${component.version}`,
    ),
  )
})

test('manifest faults remain readable and make component evidence ineligible', async () => {
  const baseline = asLegacyArtifact(await trustedArtifact())
  const targetSeat = baseline.architecture!.targetSeat
  const plan = baseline.strategyVersions!.decisionComponents!
    .seats[0].plan
  const otherSeat = (targetSeat + 1) % baseline.playerCount
  const mutations: readonly [
    string,
    (artifact: GameArtifact) => void,
  ][] = [
    ['missing', (artifact) => {
      delete artifact.strategyVersions!.decisionComponents
    }],
    ['malformed schema', (artifact) => {
      ;(artifact.strategyVersions!.decisionComponents as any).schema = 2
    }],
    ['empty', (artifact) => {
      ;(artifact.strategyVersions!.decisionComponents as any).seats = []
    }],
    ['duplicate seat', (artifact) => {
      artifact.strategyVersions!.decisionComponents!.seats = [
        { seat: targetSeat, plan: structuredClone(plan) },
        { seat: targetSeat, plan: structuredClone(plan) },
      ]
    }],
    ['wrong seat', (artifact) => {
      ;(artifact.strategyVersions!.decisionComponents!.seats[0] as any)
        .seat = otherSeat
    }],
    ['wrong plan version', (artifact) => {
      ;(artifact.strategyVersions!.decisionComponents!.seats[0].plan as any)
        .version = 'decision-component-plan-v999'
    }],
    ['out-of-order seats', (artifact) => {
      artifact.strategyVersions!.decisionComponents!.seats = [
        { seat: targetSeat, plan: structuredClone(plan) },
        { seat: otherSeat, plan: structuredClone(plan) },
      ]
    }],
    ['duplicate component identity', (artifact) => {
      const configured = artifact.strategyVersions!.decisionComponents!
        .seats[0].plan.configured as any[]
      configured.push(structuredClone(configured[0]))
    }],
    ['transparent manifest proxy', (artifact) => {
      artifact.strategyVersions!.decisionComponents = new Proxy(
        artifact.strategyVersions!.decisionComponents!,
        {},
      )
    }],
    ['transparent seats proxy', (artifact) => {
      const manifest = artifact.strategyVersions!.decisionComponents!
      manifest.seats = new Proxy(manifest.seats, {})
    }],
    ['transparent seat-entry proxy', (artifact) => {
      const manifest = artifact.strategyVersions!.decisionComponents!
      manifest.seats[0] = new Proxy(manifest.seats[0], {})
    }],
  ]
  for (const [label, mutate] of mutations) {
    const artifact = structuredClone(baseline)
    mutate(artifact)
    assert.doesNotThrow(
      () => assertDiagnosticRejection(artifact),
      label,
    )
  }
})

test('trusted manifest rejects coherent and partial trace graph rewrites', async () => {
  const baseline = asLegacyArtifact(await trustedArtifact())
  const applicable = (artifact: GameArtifact) =>
    artifact.decisionTraces!.find((trace) =>
      trace.components?.policyUse.some((use) => use.used))!
  const mutations: readonly [
    string,
    (artifact: GameArtifact) => void,
  ][] = [
    ['coherent graph erase', (artifact) => {
      const trace = applicable(artifact)
      trace.componentPlan!.configured = []
      trace.components!.configured = []
      trace.components!.entries = []
      trace.components!.policyUse = []
    }],
    ['coherent relabel', (artifact) => {
      const trace = applicable(artifact)
      const original = trace.componentPlan!.configured[0]
      const rewrite = (ref: { id: string; version: string }) => {
        if (ref.id === original.id && ref.version === original.version) {
          ref.id = 'forged-native-component'
        }
      }
      trace.componentPlan!.configured.forEach(rewrite)
      trace.components!.configured.forEach(rewrite)
      trace.components!.entries.forEach((entry) => {
        rewrite(entry.component)
        if (entry.status === 'admitted') {
          rewrite(entry.envelope.component)
        }
      })
      trace.components!.policyUse.forEach((use) => rewrite(use.component))
    }],
    ['policy-use deletion', (artifact) => {
      applicable(artifact).components!.policyUse.pop()
    }],
    ['causal stage deletion', (artifact) => {
      const use = applicable(artifact).components!.policyUse.find(
        (entry) => entry.used && entry.stages.length > 0,
      )!
      use.stages = use.stages.slice(0, -1)
      use.used = use.stages.length > 0
    }],
    ['dependency deletion', (artifact) => {
      const trace = applicable(artifact)
      const dependency = trace.componentPlan!.configured[0]
      trace.componentPlan!.configured =
        trace.componentPlan!.configured.filter(
          (entry) => entry.id !== dependency.id,
        )
      trace.components!.configured = trace.components!.configured.filter(
        (entry) => entry.id !== dependency.id,
      )
      trace.components!.entries = trace.components!.entries.filter(
        (entry) => entry.component.id !== dependency.id,
      )
      trace.components!.policyUse = trace.components!.policyUse.filter(
        (entry) => entry.component.id !== dependency.id,
      )
    }],
    ['v2 to v1 downgrade', (artifact) => {
      const trace = applicable(artifact)
      trace.version = DECISION_TRACE_VERSION
      delete trace.componentPlan
      delete trace.components
      delete trace.componentVersions!.decisionComponents
    }],
    ['trace and manifest mismatch', (artifact) => {
      artifact.strategyVersions!.decisionComponents!.seats[0].plan = {
        version: DECISION_COMPONENT_PLAN_VERSION,
        configured: [],
      }
    }],
  ]
  for (const [label, mutate] of mutations) {
    const artifact = structuredClone(baseline)
    mutate(artifact)
    assert.doesNotThrow(
      () => assertDiagnosticRejection(artifact),
      label,
    )
  }
})

test('historical traces stay diagnostic without gaining trusted promotion', async () => {
  const baseline = asLegacyArtifact(await trustedArtifact())

  const preB4 = structuredClone(baseline)
  delete preB4.strategyVersions!.decisionComponents
  const preB4Summary = summary(preB4)
  assert.equal(preB4Summary.safety.promotionEvidenceEligible, false)
  assert.equal(
    preB4Summary.componentEvidence.promotionEvidenceEligible,
    false,
  )
  assert.equal(preB4Summary.decisionComponents, undefined)

  const legacy = asDescriptorlessV1Artifact(
    await roleFreeArtifact(),
  )
  const legacySummary = summary(legacy)
  assert.equal(legacySummary.safety.traceAttributionViolations, 0)
  assert.equal(legacySummary.safety.promotionEvidenceEligible, false)
  assert.equal(
    legacySummary.componentEvidence.promotionEvidenceEligible,
    false,
  )
  assert.equal(legacySummary.decisionComponents, undefined)
})

test('a retired flat role projection is refused at canonical ingress', async () => {
  const clean = await trustedArtifact()
  assert.equal(summary(clean).safety.traceAttributionViolations, 0)

  // The seven retired flat role payloads have no writer. A stored or external
  // trace presenting one is refused rather than reconstructed, so role
  // projections cannot re-enter through a historical shape.
  const forged = withRetiredFlatRolePayload(clean)
  const forgedSummary = summary(forged)
  assert.ok(forgedSummary.safety.traceAttributionViolations > 0)
  assert.equal(forgedSummary.safety.promotionEvidenceEligible, false)
})

test('descriptor-less v1 report admission requires exact generic replay', async () => {
  const cleanArtifact = asDescriptorlessV1Artifact(
    await roleFreeArtifact(),
  )
  const clean = summary(cleanArtifact)
  assert.equal(clean.safety.traceAttributionViolations, 0)
  assert.equal(clean.safety.promotionEvidenceEligible, false)

  const mismatchedArtifact = structuredClone(cleanArtifact)
  const trace = mismatchedArtifact.decisionTraces!.find(
    (candidate) => candidate.forcedPolicyResult !== undefined,
  )!
  trace.forcedPolicyResult!.reasonCodes = ['HAMMER_TEAM_AUTOMATIC']
  const mismatch = summary(mismatchedArtifact)
  assert.ok(mismatch.safety.traceAttributionViolations > 0)
  assert.equal(mismatch.safety.promotionEvidenceEligible, false)
})

test('external self-described v2 graph cannot mint a trusted manifest', async () => {
  const [artifact] = await runArchitectureBench({
    variants: [
      rolePolicyVariant('phase7r2b4-external-self-claim', true),
    ],
    cases: [merlinCase],
    bankId: 'phase7r2b4-external-self-claim',
  })
  assert.equal(
    artifact.strategyVersions?.decisionComponents,
    undefined,
  )
  assert.ok(artifact.decisionTraces!.some(
    (trace) => trace.version === COMPONENT_DECISION_TRACE_VERSION,
  ))
  assertDiagnosticRejection(artifact)

  const forgedChoice = structuredClone(artifact)
  const trace = forgedChoice.decisionTraces!.find(
    (candidate) => (candidate.candidateScores?.length ?? 0) > 1,
  )!
  trace.chosenCandidateId = trace.candidateScores!.find(
    (candidate) => candidate.candidateId !== trace.chosenCandidateId,
  )!.candidateId
  assert.ok(
    summary(forgedChoice).safety.traceAttributionViolations > 0,
  )
})

test('host-declared composed evidence cannot disappear into an eligible comparison', async () => {
  const baseline = await trustedArtifact()
  baseline.architecture!.variant = 'baseline'
  const candidate = structuredClone(baseline)
  candidate.architecture!.variant = 'candidate'
  delete candidate.decisionTraces
  delete candidate.strategyVersions!.decisionComponents

  const report = architectureReport([baseline, candidate])
  const candidateSummary = report.variants.find(
    (entry) => entry.id === 'candidate',
  )!
  assert.ok(candidateSummary.safety.traceAttributionViolations > 0)
  assert.equal(candidateSummary.safety.promotionEvidenceEligible, false)
  assert.equal(
    candidateSummary.componentEvidence?.promotionEvidenceEligible,
    false,
  )
  assert.equal(report.comparisons[0].promotionEvidenceEligible, false)
  assert.match(
    renderArchitectureReport(report),
    /promotion-evidence ineligible/,
  )
})

test('generic component telemetry in a public event is a hidden-information violation', async () => {
  const artifact = await trustedArtifact()
  const event = artifact.log.find(
    (candidate) => candidate.visibility === 'public',
  )!
  ;(event.payload as Record<string, unknown>).componentPlan = {
    secret: 'private',
  }
  const result = summary(artifact)
  assert.ok(result.safety.hiddenInformationViolations > 0)
  assert.equal(result.safety.promotionEvidenceEligible, false)
})

test('retired private D3 field names remain public-log leak tombstones', async () => {
  const artifact = await trustedArtifact()
  const baseline = summary(artifact)
  const event = artifact.log.find(
    (candidate) => candidate.visibility === 'public',
  )!
  ;(event.payload as Record<string, unknown>).privateEvilQuestCardPolicy = {
    configuredEvilQuestCardPolicy: 'retired',
    orderedVisibleEvilAboard: [0],
    visibleEvilAboardCount: 1,
    sourceFingerprint: 'private',
  }
  const result = summary(artifact)
  assert.equal(
    result.safety.hiddenInformationViolations,
    baseline.safety.hiddenInformationViolations + 1,
  )
  assert.equal(result.safety.promotionEvidenceEligible, false)
})

test('noncomponent comparisons still require clean safety evidence', async () => {
  const heuristic = (id: string) => ({
    id,
    name: id,
    version: 1,
    engine: { type: 'heuristic' as const },
  })
  const artifacts = await runArchitectureBench({
    variants: [
      {
        id: 'baseline',
        agent: heuristic('phase7r2b4-raw-baseline'),
        components: {},
      },
      {
        id: 'candidate',
        agent: heuristic('phase7r2b4-raw-candidate'),
        components: {},
      },
    ],
    cases: [merlinCase],
    bankId: 'phase7r2b4-noncomponent-safety',
  })
  const event = artifacts[1].log.find(
    (candidate) => candidate.visibility === 'public',
  )!
  ;(event.payload as Record<string, unknown>).policyUse = ['private']

  const report = architectureReport(artifacts)
  const candidate = report.variants.find(
    (entry) => entry.id === 'candidate',
  )!
  assert.equal(candidate.componentEvidence, undefined)
  assert.ok(candidate.safety.hiddenInformationViolations > 0)
  assert.equal(report.comparisons[0].promotionEvidenceEligible, false)
  assert.match(
    renderArchitectureReport(report),
    /promotion-evidence ineligible/,
  )
})

test('forged generic degradation is rejected before report aggregation', async () => {
  const artifact = await trustedArtifact()
  const trace = artifact.decisionTraces!.find(
    (candidate) => candidate.components!.entries.length > 0,
  )!
  const entry = trace.components!.entries[0] as any
  trace.components!.entries[0] = {
    component: structuredClone(entry.component),
    kind: entry.kind,
    privacy: entry.privacy,
    status: 'degraded',
    degradationCode: 'host-admission-failed',
    failureCode: 'host-admission-failed',
  }
  const result = summary(artifact)
  assert.equal(result.componentEvidence?.degraded, 0)
  assert.ok(result.safety.traceAttributionViolations > 0)
  assert.equal(result.safety.promotionEvidenceEligible, false)
})

test('legacy privacy scans canonical host rejections without admitting evidence', async () => {
  const baselineArtifact = asLegacyArtifact(await trustedArtifact())
  const baseline = summary(baselineArtifact)
  const artifact = structuredClone(baselineArtifact)
  const trace = artifact.decisionTraces!.find(
    (candidate) => candidate.action.kind === 'propose',
  )!
  assert.equal(trace.action.kind, 'propose')
  if (trace.action.kind !== 'propose') return
  trace.action.pitch = trace.beliefModelVersion
  ;(trace as unknown as Record<string, unknown>).topHypotheses = {
    malformed: true,
  }

  const result = summary(artifact)
  assert.ok(result.safety.hiddenInformationViolations > 0)
  assert.ok(result.safety.traceAttributionViolations > 0)
  assert.equal(
    result.safety.hiddenInformationChecks,
    baseline.safety.hiddenInformationChecks + 1,
  )
  assert.equal(
    result.componentEvidence.decisions,
    baseline.componentEvidence.decisions - 1,
  )
})

test('unsafe trace shapes are rejected without privacy inspection', async () => {
  const baselineArtifact = await trustedArtifact()
  const baseline = summary(baselineArtifact)
  const hostileIndex = 0

  for (const kind of ['accessor', 'proxy'] as const) {
    const artifact = await trustedArtifact()
    const original = artifact.decisionTraces![hostileIndex]
    const secret = 'unsafe-trace-secret'
    let reads = 0
    const readKeys: string[] = []
    const hostile = kind === 'accessor'
      ? Object.defineProperty(Object.create(null), 'action', {
          enumerable: true,
          get() {
            reads++
            return { kind: 'propose', team: [], pitch: secret }
          },
        })
      : new Proxy({
          ...original,
          beliefModelVersion: secret,
          action: { kind: 'propose', team: [], pitch: secret },
        }, {
          get(target, key, receiver) {
            reads++
            readKeys.push(String(key))
            return Reflect.get(target, key, receiver)
          },
        })
    artifact.decisionTraces![hostileIndex] = hostile

    const result = summary(artifact)
    assert.equal(reads, 0, `${kind}: ${readKeys.join(', ')}`)
    assert.ok(result.safety.traceAttributionViolations > 0, kind)
    assert.equal(result.safety.hiddenInformationViolations, 0, kind)
    assert.equal(
      result.safety.hiddenInformationChecks,
      baseline.safety.hiddenInformationChecks,
      kind,
    )
    assert.equal(
      result.componentEvidence.decisions,
      baseline.componentEvidence.decisions - 1,
      kind,
    )
  }
})

test('plan validator rejects hostile bounds and object shapes', async () => {
  const artifact = asLegacyArtifact(await trustedArtifact())
  const plan = artifact.strategyVersions!.decisionComponents!
    .seats[0].plan
  assert.ok(validateDecisionComponentPlan(plan))

  const duplicate = structuredClone(plan)
  duplicate.configured.push(structuredClone(duplicate.configured[0]))
  assert.equal(validateDecisionComponentPlan(duplicate), false)

  const sparse = structuredClone(plan)
  sparse.configured = new Array(1)
  assert.equal(validateDecisionComponentPlan(sparse), false)

  assert.equal(validateDecisionComponentPlan(new Proxy(plan, {
    ownKeys() {
      throw new Error('proxy trap must be contained')
    },
  })), false)

  let accessorInvoked = false
  const accessorPlan = {
    version: DECISION_COMPONENT_PLAN_VERSION,
  } as Record<string, unknown>
  Object.defineProperty(accessorPlan, 'configured', {
    enumerable: true,
    get() {
      accessorInvoked = true
      return []
    },
  })
  assert.equal(validateDecisionComponentPlan(accessorPlan), false)
  assert.equal(accessorInvoked, false)

  const oversized: DecisionComponentPlan = {
    version: DECISION_COMPONENT_PLAN_VERSION,
    configured: Array.from({ length: 2_000 }, (_, index) => ({
      id: `component-${index}`,
      version: 'v1',
    })),
  }
  assert.ok(
    Buffer.byteLength(JSON.stringify(oversized), 'utf8')
      > MAX_DECISION_COMPONENT_PLAN_JSON_BYTES,
  )
  assert.equal(validateDecisionComponentPlan(oversized), false)
})
