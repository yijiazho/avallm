// Migration phase 7R3B2A; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  componentEnvelope,
  decisionComponentPlan,
  runDecisionComponents,
} from '../server/agents/components/kernel.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  projectResolvedArchitectureIdentity,
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import type {
  ComponentToken,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import {
  createDecisionLayerRegistry,
} from '../server/agents/policy/decision-layer/registry.ts'
import {
  createDecisionLayerAdmissionAuthority,
} from '../server/agents/policy/decision-layer/admission-replay.ts'
import {
  canonicalizeJson,
} from '../server/agents/components/canonical-json.ts'
import {
  runDecisionLayers,
} from '../server/agents/policy/decision-layer/runner.ts'
import {
  projectLayerRun,
} from '../server/agents/policy/layer-registry-common.ts'
import {
  decisionLayerToken,
  type DecisionLayerDefinition,
  type DecisionLayerRunInput,
} from '../server/agents/policy/decision-layer/types.ts'
import {
  EMPTY_SCORE_LAYER_REGISTRY,
} from '../server/agents/policy/score-layer/registry.ts'
import {
  candidateTeams,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  FORCED_POLICY_VERSION,
  type ForcedPolicyResult,
} from '../server/agents/policy/types.ts'
import {
  analyzeSituation,
} from '../server/agents/analysis/situation.ts'
import {
  exactBelief,
} from '../server/agents/belief/exact.ts'
import {
  createComposedAgent,
} from '../server/agents/composed.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import {
  readDecisionFixtures,
} from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

interface NativeFixturePayload {
  readonly keep: readonly string[]
  readonly select: string
}

const FIXTURE_COMPONENT: ComponentToken<NativeFixturePayload> =
  Object.freeze({
    id: 'test-native-decision-layer-input',
    version: 'v1',
    kind: 'decision-rule',
    privacy: 'private',
  })

const FIXTURE_DEPENDENCY_ROOT: ComponentToken<{ readonly root: true }> =
  Object.freeze({
    id: 'test-native-decision-layer-root',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  })

const FIXTURE_DEPENDENCY_MIDDLE:
ComponentToken<{ readonly middle: true }> = Object.freeze({
  id: 'test-native-decision-layer-middle',
  version: 'v1',
  kind: 'projection',
  privacy: 'private',
})

const UNUSED_COMPONENT: ComponentToken<{ readonly unused: true }> =
  Object.freeze({
    id: 'test-native-decision-layer-unused',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  })

const NARROW_LAYER = decisionLayerToken(
  'test-native-narrow',
  'v1',
)
const SELECT_LAYER = decisionLayerToken(
  'test-native-select',
  'v1',
)

function proposalFixture(): {
  request: DecisionRequest
  view: PlayerView
} {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.req.kind === 'propose',
  )
  assert.ok(fixture)
  return {
    request: structuredClone(fixture.req),
    view: structuredClone(fixture.view),
  }
}

const FIXTURE_DEFINITION:
DecisionComponentDefinition<NativeFixturePayload> = {
  token: FIXTURE_COMPONENT,
  source: 'native',
  dependencies: [FIXTURE_DEPENDENCY_MIDDLE],
  requiredHostInputs: [],
  hostRequirements: [],
  maxPayloadBytes: 1_024,
  degradationCode: 'test-native-decision-layer-input-failed',
  applies: (context) => context.privacy === 'private',
  execute(context) {
    if (context.privacy !== 'private') {
      throw new Error('fixture component requires private context')
    }
    const ids = legalCandidates(context.request, context.view)
      .map((candidate) => candidate.id)
    return {
      status: 'produced',
      envelope: componentEnvelope(FIXTURE_COMPONENT, {
        keep: ids.slice(0, Math.min(2, ids.length)),
        select: ids[0],
      }),
    }
  },
  validateDetached(payload) {
    const value = payload as Partial<NativeFixturePayload>
    return Array.isArray(value.keep)
      && value.keep.every((entry) => typeof entry === 'string')
      && typeof value.select === 'string'
      ? {
          admitted: true,
          payload: value as NativeFixturePayload,
          verification: 'exact',
          promotionEligible: true,
        }
      : {
          admitted: false,
          degradationCode: 'test-native-decision-layer-input-failed',
        }
  },
  admitHost({ payload }) {
    return {
      admitted: true,
      payload,
      verification: 'exact',
      promotionEligible: true,
    }
  },
}

function literalDefinition<Payload>(
  token: ComponentToken<Payload>,
  payload: Payload,
  dependencies: readonly ComponentToken[] = [],
): DecisionComponentDefinition<Payload> {
  return {
    token,
    source: 'native',
    dependencies,
    requiredHostInputs: [],
    hostRequirements: [],
    maxPayloadBytes: 1_024,
    degradationCode: `${token.id}-failed`,
    applies: (context) => context.privacy === 'private',
    execute: () => ({
      status: 'produced',
      envelope: componentEnvelope(token, payload),
    }),
    validateDetached: (value) => ({
      admitted: true,
      payload: value as Payload,
      verification: 'exact',
      promotionEligible: true,
    }),
    admitHost: ({ payload: admitted }) => ({
      admitted: true,
      payload: admitted,
      verification: 'exact',
      promotionEligible: true,
    }),
  }
}

const ROOT_DEFINITION = literalDefinition(
  FIXTURE_DEPENDENCY_ROOT,
  { root: true } as const,
)
const MIDDLE_DEFINITION = literalDefinition(
  FIXTURE_DEPENDENCY_MIDDLE,
  { middle: true } as const,
  [FIXTURE_DEPENDENCY_ROOT],
)
const UNUSED_DEFINITION = literalDefinition(
  UNUSED_COMPONENT,
  { unused: true } as const,
)

const NARROW_DEFINITION: DecisionLayerDefinition = {
  token: NARROW_LAYER,
  requiredComponents: [FIXTURE_COMPONENT],
  degradationCode: 'test-native-narrow-failed',
  applies: ({ prior }) =>
    prior.selectedCandidateId === undefined
    && prior.survivorCandidateIds.length > 1,
  execute({ components, surface }) {
    const payload = components.require(FIXTURE_COMPONENT)
    return {
      status: 'applied',
      surface: surface.create({
        survivorCandidateIds: payload.keep,
        reasonCodes: ['TEST_NATIVE_NARROW'],
      }),
    }
  },
}

const SELECT_DEFINITION: DecisionLayerDefinition = {
  token: SELECT_LAYER,
  requiredComponents: [FIXTURE_COMPONENT],
  degradationCode: 'test-native-select-failed',
  applies: ({ prior }) => prior.selectedCandidateId === undefined,
  execute({ components, surface }) {
    const payload = components.require(FIXTURE_COMPONENT)
    return {
      status: 'applied',
      surface: surface.create({
        survivorCandidateIds: [payload.select],
        selectedCandidateId: payload.select,
        reasonCodes: ['TEST_NATIVE_SELECT'],
      }),
    }
  },
}

async function nativeFixtureInput(): Promise<
  DecisionLayerRunInput & {
    readonly identityOrder: readonly { id: string; version: string }[]
    readonly configuredComponents:
      readonly { id: string; version: string }[]
  }
> {
  const { request, view } = proposalFixture()
  const componentRegistry = createDecisionComponentRegistry([
    ROOT_DEFINITION,
    MIDDLE_DEFINITION,
    FIXTURE_DEFINITION,
    UNUSED_DEFINITION,
  ])
  const layerRegistry = createDecisionLayerRegistry([
    NARROW_DEFINITION,
    SELECT_DEFINITION,
  ])
  const brain = resolveComposedBrain({
    requestedComponents: [UNUSED_COMPONENT],
    decisionLayerOrder: [NARROW_LAYER, SELECT_LAYER],
    configuredPipeline: testConfiguredPipeline(),
  }, componentRegistry, EMPTY_SCORE_LAYER_REGISTRY, layerRegistry)
  const componentRun = await runDecisionComponents(
    brain,
    request,
    view,
  )
  const candidates = legalCandidates(request, view)
  const universalForced: ForcedPolicyResult = Object.freeze({
    version: FORCED_POLICY_VERSION,
    applied: false,
    reasonCodes: Object.freeze([]),
    allowedCandidateIds: Object.freeze(
      candidates.map((candidate) => candidate.id),
    ),
  })
  return {
    order: brain.decisionLayerOrder,
    request,
    view,
    analysis: analyzeSituation(view, {
      belief: exactBelief(view),
      candidateTeams: candidateTeams(candidates, view)
        .map((candidate) => candidate.team),
    }),
    candidates,
    universalForced,
    componentDefinitions: brain.eligibleDefinitions,
    componentRun,
    identityOrder: brain.description.decisionLayerOrder,
    configuredComponents: brain.description.components.configured,
  }
}

test('resolved order drives monotone narrowing, selection, and causal use', async () => {
  const input = await nativeFixtureInput()
  const run = runDecisionLayers(input)
  assert.deepEqual(input.identityOrder, [NARROW_LAYER, SELECT_LAYER])
  assert.deepEqual(input.configuredComponents, [
    FIXTURE_DEPENDENCY_ROOT,
    FIXTURE_DEPENDENCY_MIDDLE,
    FIXTURE_COMPONENT,
    UNUSED_COMPONENT,
  ].map(({ id, version }) => ({ id, version })))
  assert.deepEqual(run.configured, [NARROW_LAYER, SELECT_LAYER])
  assert.deepEqual(
    run.journal.map((entry) => entry.status),
    ['applied', 'applied'],
  )
  assert.equal(run.surface.survivorCandidateIds.length, 1)
  assert.equal(
    run.surface.selectedCandidateId,
    run.surface.survivorCandidateIds[0],
  )
  assert.deepEqual(run.surface.reasonCodes, ['TEST_NATIVE_SELECT'])
  assert.equal(run.operations.layersVisited, 2)
  assert.equal(run.operations.layersExecuted, 2)
  assert.equal(run.operations.surfaceBuildAttempts, 2)
  assert.deepEqual(
    run.journal[0].componentReads,
    [FIXTURE_COMPONENT].map(({ id, version }) => ({ id, version })),
  )
  assert.deepEqual(
    run.journal[0].status === 'applied'
      ? run.journal[0].attributedComponents
      : [],
    [
      FIXTURE_DEPENDENCY_ROOT,
      FIXTURE_DEPENDENCY_MIDDLE,
      FIXTURE_COMPONENT,
    ].map(({ id, version }) => ({ id, version })),
  )
  for (const token of [
    FIXTURE_DEPENDENCY_ROOT,
    FIXTURE_DEPENDENCY_MIDDLE,
    FIXTURE_COMPONENT,
  ]) {
    const use = run.componentRun.policyUse.find(
      (entry) => entry.component.id === token.id,
    )
    assert.deepEqual(use?.stages, ['strategic-decision'])
  }
  assert.equal(
    run.componentRun.policyUse.find(
      (entry) => entry.component.id === UNUSED_COMPONENT.id,
    )?.used,
    false,
  )
  assert.deepEqual(run.operations, {
    universalCandidateIdsVisited: 10,
    legalCandidatesVisited: 10,
    layersVisited: 2,
    layersSuppressed: 0,
    applicabilityEvaluations: 2,
    layersExecuted: 2,
    componentLookupAttempts: 2,
    componentPayloadIndexEntriesVisited: 4,
    componentPayloadReads: 1,
    componentPayloadsMaterialized: 1,
    componentDefinitionIndexEntriesVisited: 4,
    decisionLayerComponentRequirementsIndexed: 2,
    componentClosureRootsVisited: 2,
    componentDependencyEdgesVisited: 4,
    componentClosureComponentsEmitted: 6,
    componentAttributionUnionTokensVisited: 6,
    componentAttributionTokensVisited: 3,
    componentAttributionEntriesVisited: 4,
    componentAttributionPolicyUseEntriesVisited: 4,
    surfaceBuildAttempts: 2,
    surfacePriorSurvivorsVisited: 12,
    surfaceDraftSurvivorsVisited: 3,
    surfaceReasonsVisited: 2,
    surfaceBytesConstructed: 360,
  })
})

test('construction rejects registry substitution and invalid ordered identity', () => {
  const layerRegistry = createDecisionLayerRegistry([
    NARROW_DEFINITION,
    SELECT_DEFINITION,
  ])
  assert.throws(
    () => layerRegistry.resolve([NARROW_LAYER, NARROW_LAYER]),
    /repeats/,
  )
  assert.throws(
    () => layerRegistry.resolve([
      decisionLayerToken('test-native-unknown', 'v1'),
    ]),
    /unknown decision layer/,
  )

  const substitutedComponent = {
    ...FIXTURE_DEFINITION,
    token: {
      ...FIXTURE_COMPONENT,
      kind: 'objective',
    },
  } as any
  assert.throws(
    () => resolveComposedBrain({
      requestedComponents: [],
      decisionLayerOrder: [NARROW_LAYER],
      configuredPipeline: testConfiguredPipeline(),
    }, createDecisionComponentRegistry([
      ROOT_DEFINITION,
      MIDDLE_DEFINITION,
      substitutedComponent,
    ]), EMPTY_SCORE_LAYER_REGISTRY, layerRegistry),
    /substitutes component tag/,
  )

  const cycleA: ComponentToken<{ readonly value: 'a' }> = Object.freeze({
    id: 'test-decision-layer-cycle-a',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  })
  const cycleB: ComponentToken<{ readonly value: 'b' }> = Object.freeze({
    id: 'test-decision-layer-cycle-b',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  })
  assert.throws(
    () => createDecisionComponentRegistry([
      literalDefinition(cycleA, { value: 'a' } as const, [cycleB]),
      literalDefinition(cycleB, { value: 'b' } as const, [cycleA]),
    ]),
    /cycle/,
  )
  const unknownDependency = literalDefinition(
    cycleA,
    { value: 'a' } as const,
    [{
      id: 'test-decision-layer-missing',
      version: 'v1',
    } as any],
  )
  assert.throws(
    () => createDecisionComponentRegistry([unknownDependency]),
    /requires missing/,
  )
})

test('generic exact replay rejects order, journal, selection, and budget drift', async () => {
  const input = await nativeFixtureInput()
  const run = runDecisionLayers(input)
  const claimed = projectLayerRun(run)
  const authority = createDecisionLayerAdmissionAuthority()
  const registry = createDecisionLayerRegistry([
    NARROW_DEFINITION,
    SELECT_DEFINITION,
  ])
  const replay = (
    candidate: typeof claimed,
    componentRun = run.componentRun,
  ) => {
    const canonical = canonicalizeJson(candidate, 4_194_304)
    assert.equal(canonical.ok, true)
    if (!canonical.ok) return undefined
    const admitted = authority.admitCanonical(canonical.payload)
    if (!admitted) return undefined
    return authority.replay({
      ...input,
      registry,
      configured: input.order.order,
      componentRun,
      claimed: admitted,
    })
  }
  assert.ok(replay(structuredClone(claimed)))
  assert.equal(authority.replay({
    ...input,
    registry,
    configured: input.order.order,
    componentRun: run.componentRun,
    claimed: structuredClone(claimed) as any,
  }), undefined)
  let hostileReads = 0
  const hostileCanonicalClaim = {
    get configured() {
      hostileReads++
      throw new Error('must not execute')
    },
    journal: [],
    operations: {},
    surface: {},
    version: 'decision-layer-run-v1',
  }
  Object.freeze(hostileCanonicalClaim)
  assert.equal(
    authority.admitCanonical(hostileCanonicalClaim as any),
    undefined,
  )
  assert.equal(hostileReads, 0)
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  assert.equal(
    authority.admitCanonical(revoked.proxy as any),
    undefined,
  )

  const mutations = [
    (value: any) => value.configured.reverse(),
    (value: any) => {
      value.journal[0].status = 'inapplicable'
    },
    (value: any) => {
      value.surface.selectedCandidateId = 'proposal:forged'
    },
    (value: any) => {
      value.operations.layersExecuted++
    },
    (value: any) => {
      value.journal.reverse()
    },
  ]
  for (const mutate of mutations) {
    const hostile = structuredClone(claimed) as any
    mutate(hostile)
    assert.equal(replay(hostile), undefined)
  }

  const withStages = (
    source: typeof run.componentRun,
    componentId: string,
    stages: readonly string[],
  ) => ({
    ...structuredClone(source),
    policyUse: structuredClone(source.policyUse).map((entry) =>
      entry.component.id === componentId
        ? {
            ...entry,
            used: stages.length > 0,
            stages: [...stages],
          }
        : entry),
  })
  const nonTerminalStage = withStages(
    run.componentRun,
    FIXTURE_COMPONENT.id,
    ['strategic-decision', 'candidate-score'],
  )
  assert.ok(replay(structuredClone(claimed), nonTerminalStage))
  const wrongPosition = withStages(
    run.componentRun,
    FIXTURE_COMPONENT.id,
    ['candidate-score', 'strategic-decision'],
  )
  assert.equal(
    replay(structuredClone(claimed), wrongPosition),
    undefined,
  )
  const duplicateStage = withStages(
    run.componentRun,
    FIXTURE_COMPONENT.id,
    ['strategic-decision', 'strategic-decision'],
  )
  assert.equal(
    replay(structuredClone(claimed), duplicateStage),
    undefined,
  )

  const extra = withStages(
    run.componentRun,
    UNUSED_COMPONENT.id,
    ['strategic-decision'],
  )
  assert.equal(replay(structuredClone(claimed), extra), undefined)
  const missing = withStages(
    run.componentRun,
    FIXTURE_COMPONENT.id,
    [],
  )
  assert.equal(replay(structuredClone(claimed), missing), undefined)
  const rewritten = withStages(
    run.componentRun,
    FIXTURE_COMPONENT.id,
    ['strategic-decision-rewritten'],
  )
  assert.equal(replay(structuredClone(claimed), rewritten), undefined)
})

test('factory provenance, dependency admission, and universal dominance fail closed', async () => {
  const input = await nativeFixtureInput()
  const forgedLayer: DecisionLayerDefinition = {
    ...NARROW_DEFINITION,
    token: decisionLayerToken('test-native-forged-surface', 'v1'),
    execute({ prior }) {
      return {
        status: 'applied',
        surface: {
          ...prior,
          survivorCandidateIds: ['proposal:forged'],
        } as any,
      }
    },
  }
  const forged = runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([forgedLayer]).resolve([
      forgedLayer.token,
    ]),
  })
  assert.equal(forged.journal[0].status, 'degraded')
  assert.equal(
    forged.journal[0].status === 'degraded'
      ? forged.journal[0].failureCode
      : undefined,
    'invalid-surface',
  )

  const unavailableRun = structuredClone(input.componentRun)
  const rootIndex = unavailableRun.entries.findIndex(
    (entry) => entry.component.id === FIXTURE_DEPENDENCY_ROOT.id,
  )
  assert.notEqual(rootIndex, -1)
  ;(unavailableRun.entries[rootIndex] as any) = {
    component: unavailableRun.entries[rootIndex].component,
    kind: unavailableRun.entries[rootIndex].kind,
    privacy: unavailableRun.entries[rootIndex].privacy,
    status: 'inapplicable',
  }
  const unavailable = runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([NARROW_DEFINITION]).resolve([
      NARROW_LAYER,
    ]),
    componentRun: unavailableRun,
  })
  assert.equal(unavailable.journal[0].status, 'degraded')
  assert.equal(
    unavailable.journal[0].status === 'degraded'
      ? unavailable.journal[0].failureCode
      : undefined,
    'dependency-unavailable',
  )

  const selectedId = input.universalForced.allowedCandidateIds[0]
  let appliesCalls = 0
  let executeCalls = 0
  const adversarialLayer: DecisionLayerDefinition = {
    token: decisionLayerToken('test-native-after-selection', 'v1'),
    requiredComponents: [FIXTURE_COMPONENT],
    degradationCode: 'test-native-after-selection-failed',
    applies() {
      appliesCalls++
      return true
    },
    execute({ components, surface, prior }) {
      executeCalls++
      components.require(FIXTURE_COMPONENT)
      return {
        status: 'applied',
        surface: surface.create({
          survivorCandidateIds: prior.survivorCandidateIds,
          selectedCandidateId: prior.selectedCandidateId,
          reasonCodes: ['TEST_FORGED_RELABEL'],
        }),
      }
    },
  }
  const dominated = runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([adversarialLayer]).resolve([
      adversarialLayer.token,
    ]),
    universalForced: {
      ...input.universalForced,
      applied: true,
      selectedCandidateId: selectedId,
      allowedCandidateIds: [selectedId],
    },
  })
  assert.deepEqual(
    dominated.journal.map((entry) => entry.status),
    ['suppressed'],
  )
  assert.equal(
    dominated.journal[0].status === 'suppressed'
      ? dominated.journal[0].suppressionCode
      : undefined,
    'universal-policy-selected',
  )
  assert.equal(appliesCalls, 0)
  assert.equal(executeCalls, 0)
  assert.equal(dominated.operations.applicabilityEvaluations, 0)
  assert.equal(dominated.operations.layersExecuted, 0)
  assert.equal(dominated.operations.layersSuppressed, 1)
  assert.deepEqual(dominated.surface.reasonCodes, [])
  assert.equal(dominated.surface.selectedCandidateId, selectedId)
  assert.equal(
    dominated.componentRun.policyUse.find(
      (entry) => entry.component.id === FIXTURE_COMPONENT.id,
    )?.used,
    false,
  )
  const suppressionAuthority = createDecisionLayerAdmissionAuthority()
  const suppressionRegistry =
    createDecisionLayerRegistry([adversarialLayer])
  const suppressionClaim = projectLayerRun(dominated)
  const admittedSuppression = canonicalizeJson(
    suppressionClaim,
    4_194_304,
  )
  assert.equal(admittedSuppression.ok, true)
  assert.ok(admittedSuppression.ok)
  const suppressionCapability = suppressionAuthority.admitCanonical(
    admittedSuppression.payload,
  )
  assert.ok(suppressionCapability)
  assert.ok(suppressionAuthority.replay({
    ...input,
    registry: suppressionRegistry,
    configured: [adversarialLayer.token],
    universalForced: {
      ...input.universalForced,
      applied: true,
      selectedCandidateId: selectedId,
      allowedCandidateIds: [selectedId],
    },
    componentRun: dominated.componentRun,
    claimed: suppressionCapability,
  }))
  const rewrittenSuppression = structuredClone(suppressionClaim) as any
  rewrittenSuppression.journal[0].status = 'inapplicable'
  delete rewrittenSuppression.journal[0].suppressionCode
  const canonicalRewrite = canonicalizeJson(
    rewrittenSuppression,
    4_194_304,
  )
  assert.ok(canonicalRewrite.ok)
  const rewriteCapability = suppressionAuthority.admitCanonical(
    canonicalRewrite.payload,
  )
  assert.ok(rewriteCapability)
  assert.equal(suppressionAuthority.replay({
    ...input,
    registry: suppressionRegistry,
    configured: [adversarialLayer.token],
    universalForced: {
      ...input.universalForced,
      applied: true,
      selectedCandidateId: selectedId,
      allowedCandidateIds: [selectedId],
    },
    componentRun: dominated.componentRun,
    claimed: rewriteCapability,
  }), undefined)

  const terminal = runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([
      NARROW_DEFINITION,
      SELECT_DEFINITION,
      adversarialLayer,
    ]).resolve([
      NARROW_LAYER,
      SELECT_LAYER,
      adversarialLayer.token,
    ]),
  })
  assert.deepEqual(
    terminal.journal.map((entry) => entry.status),
    ['applied', 'applied', 'suppressed'],
  )
  assert.equal(
    terminal.journal[2].status === 'suppressed'
      ? terminal.journal[2].suppressionCode
      : undefined,
    'prior-strategic-selection',
  )
  assert.equal(appliesCalls, 0)
  assert.equal(executeCalls, 0)
  assert.deepEqual(terminal.surface.reasonCodes, ['TEST_NATIVE_SELECT'])
})

test('surface laws reject reuse, widening, reordering, and invalid bounded reasons', async () => {
  const input = await nativeFixtureInput()
  const cases: readonly [
    string,
    (
      prior: readonly string[],
    ) => {
      survivorCandidateIds: readonly string[]
      reasonCodes: readonly string[]
    },
  ][] = [
    ['widen', (prior) => ({
      survivorCandidateIds: [...prior, 'proposal:forged'],
      reasonCodes: ['TEST_WIDEN'],
    })],
    ['reorder', (prior) => ({
      survivorCandidateIds: [...prior].reverse(),
      reasonCodes: ['TEST_REORDER'],
    })],
    ['duplicate-survivor', (prior) => ({
      survivorCandidateIds: [prior[0], prior[0]],
      reasonCodes: ['TEST_DUPLICATE'],
    })],
    ['duplicate-reason', (prior) => ({
      survivorCandidateIds: prior,
      reasonCodes: ['TEST_REASON', 'TEST_REASON'],
    })],
    ['invalid-reason', (prior) => ({
      survivorCandidateIds: prior,
      reasonCodes: ['not_canonical'],
    })],
    ['oversized-reason', (prior) => ({
      survivorCandidateIds: prior,
      reasonCodes: [`X${'Y'.repeat(128)}`],
    })],
  ]
  for (const [label, draft] of cases) {
    const token = decisionLayerToken(`test-surface-${label}`, 'v1')
    const definition: DecisionLayerDefinition = {
      token,
      requiredComponents: [],
      degradationCode: `test-surface-${label}-failed`,
      applies: () => true,
      execute({ prior, surface }) {
        return {
          status: 'applied',
          surface: surface.create(draft(prior.survivorCandidateIds)),
        }
      },
    }
    const run = runDecisionLayers({
      ...input,
      order: createDecisionLayerRegistry([definition]).resolve([token]),
    })
    assert.equal(run.journal[0].status, 'degraded', label)
    assert.equal(
      run.journal[0].status === 'degraded'
        ? run.journal[0].failureCode
        : undefined,
      'execution-failed',
      label,
    )
  }

  let retainedFactory: any
  const captureToken = decisionLayerToken('test-surface-capture', 'v1')
  const capture: DecisionLayerDefinition = {
    token: captureToken,
    requiredComponents: [],
    degradationCode: 'test-surface-capture-failed',
    applies: () => true,
    execute({ surface }) {
      retainedFactory = surface
      return { status: 'degraded' }
    },
  }
  runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([capture]).resolve([captureToken]),
  })
  const reuseToken = decisionLayerToken('test-surface-reuse', 'v1')
  const reuse: DecisionLayerDefinition = {
    token: reuseToken,
    requiredComponents: [],
    degradationCode: 'test-surface-reuse-failed',
    applies: () => true,
    execute({ prior }) {
      return {
        status: 'applied',
        surface: retainedFactory.create({
          survivorCandidateIds: prior.survivorCandidateIds,
          reasonCodes: ['TEST_REUSE'],
        }),
      }
    },
  }
  const reused = runDecisionLayers({
    ...input,
    order: createDecisionLayerRegistry([reuse]).resolve([reuseToken]),
  })
  assert.equal(reused.journal[0].status, 'degraded')
  assert.equal(
    reused.journal[0].status === 'degraded'
      ? reused.journal[0].failureCode
      : undefined,
    'invalid-surface',
  )
})

test('production empty seam is neutral and exact host replay rejects rewrites', async () => {
  const { request, view } = proposalFixture()
  const seed = 'phase7r3b2a-empty-production'
  let captured: any
  const agent = createComposedAgent({
    seed,
    onDecisionTrace: (trace) => {
      captured = trace
    },
  })
  const output = await agent.decide(request, view)
  assert.ok('decision' in output)
  const trace = output.trace ?? captured
  assert.ok(trace)
  assert.deepEqual(trace.decisionLayerRun.configured, [])
  assert.deepEqual(trace.decisionLayerRun.journal, [])
  assert.deepEqual(
    trace.decisionLayerRun.surface.survivorCandidateIds,
    trace.forcedPolicyResult.allowedCandidateIds,
  )
  assert.equal(
    trace.decisionLayerRun.surface.selectedCandidateId,
    trace.forcedPolicyResult.selectedCandidateId,
  )
  assert.deepEqual(trace.decisionLayerRun.operations, {
    universalCandidateIdsVisited: 10,
    legalCandidatesVisited: 10,
    layersVisited: 0,
    layersSuppressed: 0,
    applicabilityEvaluations: 0,
    layersExecuted: 0,
    componentLookupAttempts: 0,
    componentPayloadIndexEntriesVisited: 0,
    componentPayloadReads: 0,
    componentPayloadsMaterialized: 0,
    componentDefinitionIndexEntriesVisited: 0,
    decisionLayerComponentRequirementsIndexed: 0,
    componentClosureRootsVisited: 0,
    componentDependencyEdgesVisited: 0,
    componentClosureComponentsEmitted: 0,
    componentAttributionUnionTokensVisited: 0,
    componentAttributionTokensVisited: 0,
    componentAttributionEntriesVisited: 0,
    componentAttributionPolicyUseEntriesVisited: 0,
    surfaceBuildAttempts: 0,
    surfacePriorSurvivorsVisited: 0,
    surfaceDraftSurvivorsVisited: 0,
    surfaceReasonsVisited: 0,
    surfaceBytesConstructed: 0,
  })

  const brain = agent.resolvedBrain()
  const exactInput = {
    trace,
    req: request,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: seed,
    expectedComponentPlan: decisionComponentPlan(brain),
    expectedArchitectureIdentity:
      projectResolvedArchitectureIdentity(brain.description),
    expectComponentTrace: true,
  }
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    ...exactInput,
  }).kind, 'trusted-exact')
  const rewrite = structuredClone(trace)
  rewrite.decisionLayerRun.operations.layersVisited++
  const rewriteAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    ...exactInput,
    trace: rewrite,
  })
  assert.equal(rewriteAdmission.kind, 'rejected')
  if (rewriteAdmission.kind === 'rejected') {
    assert.equal(
      rewriteAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
  const invalidDiagnostic = structuredClone(trace)
  delete invalidDiagnostic.decisionLayerRun.operations.layersVisited
  const diagnostic = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: invalidDiagnostic,
    req: request,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: seed,
  })
  assert.deepEqual(
    diagnostic.kind === 'rejected'
      ? [diagnostic.lifecycle, diagnostic.reason]
      : [diagnostic.kind],
    ['finalized-artifact', 'finalized-diagnostic-invalid'],
  )

  let unsafeReads = 0
  const unsafe = structuredClone(trace)
  Object.defineProperty(unsafe.decisionLayerRun, 'configured', {
    enumerable: true,
    get() {
      unsafeReads++
      throw new Error('whole-trace ingress must reject before reading')
    },
  })
  const unsafeAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    ...exactInput,
    trace: unsafe,
  })
  assert.equal(unsafeAdmission.kind, 'rejected')
  if (unsafeAdmission.kind === 'rejected') {
    assert.equal(unsafeAdmission.reason, 'trace-json-unsafe')
  }
  assert.equal(unsafeReads, 0)
})
