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
  replayDecisionLayersForAdmission,
  validateDecisionLayerRun,
} from '../server/agents/policy/decision-layer/admission-replay.ts'
import {
  runDecisionLayers,
} from '../server/agents/policy/decision-layer/runner.ts'
import {
  projectDecisionLayerRun,
} from '../server/agents/policy/decision-layer/projection.ts'
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
  validateComposedTraceHostJoin,
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
  dependencies: [],
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
    FIXTURE_DEFINITION,
  ])
  const layerRegistry = createDecisionLayerRegistry([
    NARROW_DEFINITION,
    SELECT_DEFINITION,
  ])
  const brain = resolveComposedBrain({
    requestedComponents: [],
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
    componentRun,
    identityOrder: brain.description.decisionLayerOrder,
    configuredComponents: brain.description.components.configured,
  }
}

test('resolved order drives monotone narrowing, selection, and causal use', async () => {
  const input = await nativeFixtureInput()
  const run = runDecisionLayers(input)
  assert.deepEqual(input.identityOrder, [NARROW_LAYER, SELECT_LAYER])
  assert.deepEqual(input.configuredComponents, [FIXTURE_COMPONENT].map(
    ({ id, version }) => ({ id, version }),
  ))
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
  const use = run.componentRun.policyUse.find(
    (entry) => entry.component.id === FIXTURE_COMPONENT.id,
  )
  assert.deepEqual(use?.stages, ['strategic-decision'])
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
      privacy: 'public',
    },
  } as any
  assert.throws(
    () => resolveComposedBrain({
      requestedComponents: [],
      decisionLayerOrder: [NARROW_LAYER],
      configuredPipeline: testConfiguredPipeline(),
    }, createDecisionComponentRegistry([
      substitutedComponent,
    ]), EMPTY_SCORE_LAYER_REGISTRY, layerRegistry),
    /substitutes component tag/,
  )
})

test('generic exact replay rejects order, journal, selection, and budget drift', async () => {
  const input = await nativeFixtureInput()
  const run = runDecisionLayers(input)
  const claimed = projectDecisionLayerRun(run)
  const registry = createDecisionLayerRegistry([
    NARROW_DEFINITION,
    SELECT_DEFINITION,
  ])
  const replay = (candidate: typeof claimed) =>
    replayDecisionLayersForAdmission({
      ...input,
      registry,
      configured: input.order.order,
      componentRun: input.componentRun,
      claimed: candidate,
    })
  assert.ok(validateDecisionLayerRun(structuredClone(claimed)))
  assert.ok(replay(structuredClone(claimed)))

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
  ;(unavailableRun.entries[0] as any) = {
    component: unavailableRun.entries[0].component,
    kind: unavailableRun.entries[0].kind,
    privacy: unavailableRun.entries[0].privacy,
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
  const dominated = runDecisionLayers({
    ...input,
    universalForced: {
      ...input.universalForced,
      applied: true,
      selectedCandidateId: selectedId,
      allowedCandidateIds: [selectedId],
    },
  })
  assert.deepEqual(
    dominated.journal.map((entry) => entry.status),
    ['inapplicable', 'inapplicable'],
  )
  assert.equal(dominated.surface.selectedCandidateId, selectedId)
  assert.equal(
    dominated.componentRun.policyUse.find(
      (entry) => entry.component.id === FIXTURE_COMPONENT.id,
    )?.used,
    false,
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
  assert.equal(validateComposedTraceHostJoin(exactInput), true)
  const rewrite = structuredClone(trace)
  rewrite.decisionLayerRun.operations.layersVisited++
  assert.equal(validateComposedTraceHostJoin({
    ...exactInput,
    trace: rewrite,
  }), false)
})
