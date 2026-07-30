// Migration phase 7R3A1; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createScoreLayerRegistry,
  ScoreLayerRegistryError,
} from '../server/agents/policy/score-layer/registry.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import {
  MAX_SCORE_LAYER_SURFACE_JSON_BYTES,
} from '../server/agents/policy/score-layer/runner.ts'
import {
  createScoreLayerComponentRuntime,
  scoreLayerReadJournal,
  type ScoreLayerComponentWork,
} from '../server/agents/policy/score-layer/components.ts'
import {
  scoreLayerToken,
  type ScoreLayerDefinition,
  type ScoreLayerRef,
  type ScoreLayerRootDefinition,
  type ScoreLayerRunCompletion,
  type ScoreLayerRunLease,
  type ScoreLayerRunPreparation,
  type ScoreLayerSurface,
  type ScoreLayerSurfaceDraft,
  type ScoreLayerRowDraft,
  type ScoreLayerToken,
  type ScoreLayerTransformDefinition,
} from '../server/agents/policy/score-layer/types.ts'
import type {
  DecisionComponentRun,
} from '../server/agents/components/kernel.ts'
import type {
  ComponentToken,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import type {
  ForcedPolicyResult,
  PolicyCandidate,
} from '../server/agents/policy/types.ts'
import {
  FORCED_POLICY_VERSION,
} from '../server/agents/policy/types.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import type {
  SituationAnalysis,
} from '../server/agents/analysis/types.ts'
import {
  SITUATION_ANALYSIS_VERSION,
} from '../server/agents/analysis/types.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  canonicalDecisionFrame,
  prepareNativeScoreLayers,
  type PreparedNativeScoreLayers,
  withDecisionAnalysis,
  withLegalCandidates,
  withNativeScoreLayers,
  withResolvedComponents,
  withResolvedDecisionLayers,
  withUniversalForcedPolicy,
} from '../server/agents/policy/decision-frame.ts'
import { detachTrustedPolicyData } from '../server/agents/policy/trusted-data.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import { assertScoreLayerRunContract } from './support/score-layer-contract.ts'
import {
  prepareScoreLayerRunForTest,
  runPreparedScoreLayersForTest,
} from './support/score-layer-runner.ts'

const token = (id: string): ScoreLayerToken => scoreLayerToken(id, 'v1')

const ROOT = token('root')
const RERANK = token('rerank')
const RESELECT = token('reselect')
const INVALID = token('invalid')

const BASE_COMPONENT: ComponentToken<{ base: number }> = Object.freeze({
  id: 'score-test-base',
  version: 'v1',
  kind: 'objective',
  privacy: 'private',
})
const READ_COMPONENT: ComponentToken<{ value: number }> = Object.freeze({
  id: 'score-test-projection',
  version: 'v1',
  kind: 'projection',
  privacy: 'private',
})
const MISSING_COMPONENT: ComponentToken<{ missing: true }> = Object.freeze({
  id: 'score-test-missing',
  version: 'v1',
  kind: 'projection',
  privacy: 'private',
})

const candidates = detachTrustedPolicyData([
  { id: 'a' },
  { id: 'b' },
  { id: 'c' },
] as unknown as readonly PolicyCandidate[])

function scores(
  viable: readonly boolean[],
  marker?: string,
): readonly ScoreLayerRowDraft[] {
  return candidates.map((candidate, index) => ({
    candidateId: candidate.id,
    value: viable[index] ? 10 - index : -100,
    viable: viable[index],
    reasonCodes: [
      `REASON_${index}`,
      ...(marker ? [marker] : []),
    ],
  }))
}

function componentDefinition(
  component: ComponentToken,
  dependencies: readonly ComponentToken[] = [],
): DecisionComponentDefinition {
  return {
    token: component,
    source: 'native',
    dependencies,
    requiredHostInputs: [],
    hostRequirements: [],
    maxPayloadBytes: 128,
    degradationCode: `${component.id}-failed`,
    applies: () => true,
    execute: () => ({ status: 'suppressed', reasonCode: 'test-only' }),
    validateDetached: () => ({
      admitted: false,
      degradationCode: 'test-only',
    }),
    admitHost: () => ({
      admitted: false,
      degradationCode: 'test-only',
    }),
  }
}

const componentDefinitions = Object.freeze([
  componentDefinition(BASE_COMPONENT),
  componentDefinition(READ_COMPONENT, [BASE_COMPONENT]),
])

function admittedEntry(
  component: ComponentToken,
  payload: object,
): DecisionComponentRun['entries'][number] {
  return Object.freeze({
    component: Object.freeze({ id: component.id, version: component.version }),
    kind: component.kind,
    privacy: component.privacy,
    status: 'admitted',
    envelope: Object.freeze({
      component: Object.freeze({
        id: component.id,
        version: component.version,
      }),
      kind: component.kind,
      privacy: component.privacy,
      payload: Object.freeze(payload),
    }),
    verification: 'exact',
    promotionEligible: true,
    payloadBytes: 16,
  })
}

const componentRun: DecisionComponentRun = Object.freeze({
  version: 'decision-component-run-v1',
  configured: Object.freeze([
    Object.freeze({
      id: BASE_COMPONENT.id,
      version: BASE_COMPONENT.version,
    }),
    Object.freeze({
      id: READ_COMPONENT.id,
      version: READ_COMPONENT.version,
    }),
  ]),
  entries: Object.freeze([
    admittedEntry(BASE_COMPONENT, { base: 3 }),
    admittedEntry(READ_COMPONENT, { value: 7 }),
  ]),
  policyUse: Object.freeze([BASE_COMPONENT, READ_COMPONENT].map(
    (component) => Object.freeze({
      component: Object.freeze({
        id: component.id,
        version: component.version,
      }),
      used: false,
      stages: Object.freeze([]),
    }),
  )),
})

function rootDefinition(
  execute: (
    context: Parameters<ScoreLayerRootDefinition['execute']>[0],
  ) => Readonly<{
    status: 'generated'
    surface: ScoreLayerSurfaceDraft
  }>,
  requiredComponents: readonly ComponentToken[] = [],
): ScoreLayerRootDefinition {
  return {
    kind: 'root',
    token: ROOT,
    requiredComponents,
    analysisRequirements: () => [],
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    execute(context) {
      const result = execute(context)
      return {
        status: 'generated',
        surface: context.surface.create(result.surface),
      }
    },
  }
}

function transformDefinition(
  layer: ScoreLayerToken,
  predecessor: ScoreLayerRef,
  execute: (
    context: Parameters<ScoreLayerTransformDefinition['execute']>[0],
  ) =>
    | Readonly<{ status: 'applied'; surface: ScoreLayerSurfaceDraft }>
    | Readonly<{ status: 'degraded' }>,
  requiredComponents: readonly ComponentToken[] = [],
): ScoreLayerTransformDefinition {
  return {
    kind: 'transform',
    token: layer,
    predecessor,
    requiredComponents,
    degradationCode: `${layer.id}-failed`,
    analysisRequirements: () => [],
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    applies: () => true,
    execute(context) {
      const result = execute(context)
      return result.status === 'applied'
        ? {
            status: 'applied',
            surface: context.surface.create(result.surface),
          }
        : result
    },
  }
}

const request = detachTrustedPolicyData({ kind: 'vote' } as DecisionRequest)
const view = detachTrustedPolicyData({
  seat: 0,
  alignment: 'good',
} as PlayerView)
const analysis = detachTrustedPolicyData({} as SituationAnalysis)
const forced = detachTrustedPolicyData({
  version: FORCED_POLICY_VERSION,
  applied: false,
  reasonCodes: [],
  allowedCandidateIds: ['a', 'b'],
} as ForcedPolicyResult)

function surface(
  viable: readonly boolean[],
  survivorCandidateIds: readonly string[] = ['a', 'b'],
  marker?: string,
) {
  return {
    version: 'score-layer-surface-v1' as const,
    scores: scores(viable, marker),
    survivorCandidateIds,
  }
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

interface ScoreLayerTestRunInput
extends ScoreLayerRunPreparation, ScoreLayerRunCompletion {
  readonly lease: ScoreLayerRunLease
}

function runScoreLayers(input: ScoreLayerTestRunInput) {
  return runPreparedScoreLayersForTest(input.lease, {
    analysis: input.analysis,
    candidates: input.candidates,
    forced: input.forced,
    componentRun: input.componentRun,
    deterministicSeed: input.deterministicSeed,
    compatibilityCandidateId: input.compatibilityCandidateId,
    hypotheticalTeamCandidates: input.hypotheticalTeamCandidates,
  })
}

function runInput(
  definitions: readonly ScoreLayerDefinition[],
): ScoreLayerTestRunInput {
  const registry = createScoreLayerRegistry(definitions)
  const chain = registry.resolve({
    terminal: definitions.at(-1)!.token,
  })
  const preparation: ScoreLayerRunPreparation = {
    chain,
    componentDefinitions,
    request,
    view,
  }
  return {
    ...preparation,
    lease: prepareScoreLayerRunForTest(preparation),
    analysis,
    candidates,
    forced,
    componentRun,
    deterministicSeed: 'score-layer-test-seed',
    compatibilityCandidateId: 'a',
    hypotheticalTeamCandidates: null,
  }
}

function prepareLease(
  chain: ScoreLayerRunPreparation['chain'],
  suppliedRequest = request,
  suppliedView = view,
): ScoreLayerRunLease {
  return prepareScoreLayerRunForTest({
    chain,
    componentDefinitions,
    request: suppliedRequest,
    view: suppliedView,
  })
}

test('terminal resolution derives one immutable canonical single-root chain', () => {
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const left = transformDefinition(token('left'), ROOT, () => ({
    status: 'degraded',
  }))
  const right = transformDefinition(token('right'), ROOT, () => ({
    status: 'degraded',
  }))
  const registry = createScoreLayerRegistry([right, root, left])
  const chain = registry.resolve({ terminal: right.token })
  assert.deepEqual(chain.order.map((entry) => entry.id), ['root', 'right'])
  assert.ok(Object.isFrozen(chain))
  assert.throws(
    () => registry.resolve({
      terminal: right.token,
      declaredOrder: [ROOT, left.token, right.token],
    }),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'misordered-chain',
  )
  assert.throws(
    () => createScoreLayerRegistry([
      root,
      {
        ...root,
        token: token('second-root'),
      },
    ]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'multiple-roots',
  )
})

test('registry indexing refuses split versions and exposes a stable order', () => {
  // Both behaviors come from the indexing helper the two layer families share.
  // Only its duplicate-identity refusal was pinned, so the version split and
  // the stable exposure order could each be deleted with the suite green.
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  assert.throws(
    () => createScoreLayerRegistry([
      root,
      { ...root, token: scoreLayerToken(root.token.id, 'v2') },
    ]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'conflicting-version',
  )
  const exposed = createScoreLayerRegistry([
    transformDefinition(RESELECT, root.token, () => ({ status: 'degraded' })),
    transformDefinition(RERANK, root.token, () => ({ status: 'degraded' })),
    root,
  ]).definitions()
  assert.deepEqual(
    exposed.map((definition) => definition.token.id),
    [...exposed.map((definition) => definition.token.id)].sort(),
  )
})

test('construction rejects duplicate, unknown, missing, and cyclic layers', () => {
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const transform = (layer: ScoreLayerToken, predecessor: ScoreLayerRef) =>
    transformDefinition(layer, predecessor, () => ({
      status: 'degraded',
    }))
  assert.throws(
    () => createScoreLayerRegistry([root, root]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'duplicate-identity',
  )
  assert.throws(
    () => createScoreLayerRegistry([
      root,
      transform(RERANK, token('missing')),
    ]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'missing-predecessor',
  )
  assert.throws(
    () => createScoreLayerRegistry([
      root,
      transform(RERANK, RESELECT),
      transform(RESELECT, RERANK),
    ]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'dependency-cycle',
  )
  const registry = createScoreLayerRegistry([root])
  assert.throws(
    () => registry.resolve({ terminal: token('unknown') }),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'unknown-terminal',
  )
  assert.throws(
    () => createScoreLayerRegistry([{
      ...root,
      token: { id: 7, version: 'v1' },
    } as unknown as ScoreLayerDefinition]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'invalid-definition',
  )
  assert.throws(
    () => createScoreLayerRegistry([{
      ...root,
      requiredComponents: [{
        id: 'numeric-component',
        version: 7,
        kind: 'projection',
        privacy: 'private',
      }],
    } as unknown as ScoreLayerDefinition]),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'invalid-definition',
  )
  assert.throws(
    () => registry.resolve({
      terminal: { id: 7, version: 'v1' } as unknown as ScoreLayerRef,
    }),
    (error: unknown) =>
      error instanceof ScoreLayerRegistryError
      && error.code === 'invalid-definition',
  )
})

test('registry resolves a long predecessor chain in one global cycle pass', () => {
  const length = 4_000
  const definitions: ScoreLayerDefinition[] = [
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
  ]
  let predecessor: ScoreLayerRef = ROOT
  for (let index = 1; index < length; index++) {
    const layer = token(`long-${index}`)
    definitions.push(transformDefinition(
      layer,
      predecessor,
      () => ({ status: 'degraded' }),
    ))
    predecessor = layer
  }
  const registry = createScoreLayerRegistry(definitions)
  const chain = registry.resolve({ terminal: predecessor })
  assert.equal(chain.definitions.length, length)
  assert.equal(chain.order[0].id, ROOT.id)
  assert.equal(chain.order.at(-1)?.id, predecessor.id)
})

test('brain construction joins every layer component dependency to one eligible exact tag', () => {
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }), [READ_COMPONENT])
  const scoreRegistry = createScoreLayerRegistry([root])
  const resolve = (
    components: readonly DecisionComponentDefinition[],
    requestedComponents: readonly ComponentToken[],
    layer = root,
  ) => resolveComposedBrain({
    configuredPipeline: testConfiguredPipeline(),
    requestedComponents,
    scoreLayerTerminal: layer.token,
  }, createDecisionComponentRegistry(components), scoreRegistry)

  const brain = resolve(componentDefinitions, [])
  assert.deepEqual(
    brain.configuredDefinitions.map((entry) => entry.token.id),
    [BASE_COMPONENT.id, READ_COMPONENT.id],
  )
  assert.throws(
    () => resolve([componentDefinitions[0]], []),
    /requires missing registry component score-test-projection@v1/,
  )
  const ineligibleRead: DecisionComponentDefinition = {
    ...componentDefinitions[1],
    hostRequirements: ['score-test-capability'],
  }
  assert.throws(
    () => resolve(
      [componentDefinitions[0], ineligibleRead],
      [],
    ),
    /requires construction-ineligible component score-test-projection@v1/,
  )
  const substitutedTag: ComponentToken<{ value: number }> = {
    ...READ_COMPONENT,
    kind: 'objective',
  }
  const substitutedRoot = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }), [substitutedTag])
  const substitutedRegistry = createScoreLayerRegistry([substitutedRoot])
  assert.throws(
    () => resolveComposedBrain({
      configuredPipeline: testConfiguredPipeline(),
      scoreLayerTerminal: substitutedRoot.token,
    }, createDecisionComponentRegistry(componentDefinitions), substitutedRegistry),
    /substitutes component tag score-test-projection@v1/,
  )
  const substitutedPrivacyTag: ComponentToken<{ value: number }> = {
    ...READ_COMPONENT,
    privacy: 'public',
  }
  const privacyRoot = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }), [substitutedPrivacyTag])
  const privacyRegistry = createScoreLayerRegistry([privacyRoot])
  assert.throws(
    () => resolveComposedBrain({
      configuredPipeline: testConfiguredPipeline(),
      scoreLayerTerminal: privacyRoot.token,
    }, createDecisionComponentRegistry(componentDefinitions), privacyRegistry),
    /substitutes component tag score-test-projection@v1/,
  )
})

test('analysis requirements remain layer-owned and seat/request dependent', () => {
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const vote = {
    ...transformDefinition(RERANK, ROOT, () => ({
      status: 'degraded',
    })),
    analysisRequirements: ({ request, view }) =>
      request.kind === 'vote' && view.alignment === 'good'
        ? [{ id: 'future-opaque-profile', version: 'v47' }]
        : [],
  }
  const registry = createScoreLayerRegistry([root, vote])
  const chain = registry.resolve({ terminal: vote.token })
  assert.deepEqual(
    prepareLease(chain).requirements,
    [{ id: 'future-opaque-profile', version: 'v47' }],
  )
  assert.deepEqual(
    prepareLease(
      chain,
      request,
      detachTrustedPolicyData({ ...view, alignment: 'evil' }),
    ).requirements,
    [],
  )
})

test('analysis preparation is one-shot and disables only failing transforms', () => {
  let applies = 0
  let executes = 0
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const disabled = {
    ...transformDefinition(RERANK, ROOT, () => {
      executes++
      return { status: 'degraded' as const }
    }),
    analysisRequirements: () => {
      throw new Error('test preparation failure')
    },
    applies: () => {
      applies++
      return true
    },
  }
  const input = runInput([root, disabled])
  const run = runScoreLayers(input)
  assert.deepEqual(
    run.journal.map((entry) => entry.status === 'degraded'
      ? [entry.status, entry.failureCode, entry.degradationCode]
      : [entry.status]),
    [
      ['generated'],
      ['degraded', 'analysis-requirement-failed', 'rerank-failed'],
    ],
  )
  assert.equal(applies, 0)
  assert.equal(executes, 0)
  assert.equal(run.operations.analysisRequirementEvaluations, 2)
  assert.equal(run.operations.analysisRequirementFailures, 1)
  assert.equal(run.operations.applicabilityEvaluations, 0)
  assert.equal(run.operations.layersExecuted, 1)
  assert.throws(
    () => runScoreLayers(input),
    /run lease was already consumed/,
  )

  const hugeRef = {
    ...transformDefinition(RERANK, ROOT, () => ({
      status: 'degraded' as const,
    })),
    analysisRequirements: () => [{
      id: 'x'.repeat(100_000),
      version: 'v1',
    }],
  }
  const hugeInput = runInput([root, hugeRef])
  const hugeRun = runScoreLayers(hugeInput)
  assert.equal(hugeRun.operations.analysisRequirementFailures, 1)
  assert.equal(hugeRun.operations.analysisRefsVisited, 1)
  assert.equal(hugeRun.operations.analysisAdmissionEvaluations, 1)
  assert.equal(hugeRun.journal[1].analysisAdmission, 'not-run')

  const brokenRoot = {
    ...root,
    analysisRequirements: () => [{ id: 'INVALID', version: 'v1' }],
  }
  const registry = createScoreLayerRegistry([brokenRoot])
  const chain = registry.resolve({ terminal: brokenRoot.token })
  assert.throws(
    () => prepareLease(chain),
    /root analysis preparation failed/,
  )
})

test('preparation uses no module-global provenance or downstream parser', () => {
  const preparationSource = readFileSync(
    new URL(
      '../server/agents/policy/score-layer/preparation.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const runnerSource = readFileSync(
    new URL(
      '../server/agents/policy/score-layer/runner.ts',
      import.meta.url,
    ),
    'utf8',
  )
  assert.doesNotMatch(preparationSource, /\b(?:WeakMap|WeakSet)\b/)
  assert.doesNotMatch(preparationSource, /\b(?:PROVENANCE|CONSUMED)\b/)
  assert.doesNotMatch(runnerSource, /\bcanonicalRunInputs\b/)
  assert.doesNotMatch(runnerSource, /\bstructuredClone\b/)
})

test('family-owned admission proves requested analysis before applicability', () => {
  const PROFILE = Object.freeze({
    id: 'test-analysis-profile',
    version: 'v1',
  })
  let applies = 0
  let executes = 0
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const mismatched = {
    ...transformDefinition(RERANK, ROOT, () => {
      executes++
      return { status: 'degraded' as const }
    }),
    analysisRequirements: () => [PROFILE],
    admitAnalysis: () => false,
    applies: () => {
      applies++
      return true
    },
  }
  const input = runInput([root, mismatched])
  const run = runScoreLayers(input)

  assert.deepEqual(
    run.journal.map((entry) => entry.status === 'degraded'
      ? [
          entry.status,
          entry.analysisAdmission,
          entry.failureCode,
          entry.degradationCode,
        ]
      : [entry.status, entry.analysisAdmission]),
    [
      ['generated', 'admitted'],
      [
        'degraded',
        'failed',
        'analysis-admission-failed',
        'rerank-failed',
      ],
    ],
  )
  assert.equal(applies, 0)
  assert.equal(executes, 0)
  assert.equal(run.operations.analysisRequirementEvaluations, 2)
  assert.equal(run.operations.analysisRequirementFailures, 0)
  assert.equal(run.operations.analysisRefsVisited, 2)
  assert.equal(run.operations.analysisAdmissionEvaluations, 2)
  assert.equal(run.operations.analysisAdmissionFailures, 1)
  assert.equal(run.operations.applicabilityEvaluations, 0)

  const admittedRoot = {
    ...root,
    analysisRequirements: () => [PROFILE],
    admitAnalysis: ({
      analysis: supplied,
      requirements,
      candidates: suppliedCandidates,
      hypotheticalTeamCandidates,
    }) =>
      supplied.modelVersion === 'test-analysis-profile-v1'
      && requirements.length === 1
      && requirements[0].id === PROFILE.id
      && suppliedCandidates === candidates
      && hypotheticalTeamCandidates === null,
  }
  const admittedInput = runInput([admittedRoot])
  const admittedRun = runScoreLayers({
    ...admittedInput,
    analysis: detachTrustedPolicyData({
      modelVersion: 'test-analysis-profile-v1',
    } as SituationAnalysis),
  })
  assert.equal(admittedRun.journal[0].analysisAdmission, 'admitted')
  assert.equal(admittedRun.operations.analysisAdmissionEvaluations, 1)
  assert.equal(admittedRun.operations.analysisAdmissionFailures, 0)

  const failedRootInput = runInput([{
    ...admittedRoot,
    admitAnalysis: () => {
      throw new Error('profile mismatch')
    },
  }])
  assert.throws(
    () => runScoreLayers(failedRootInput),
    /root analysis admission failed/,
  )
})

test('applies is the sole transform inapplicability authority', () => {
  let skippedExecution = 0
  const skipped = {
    ...transformDefinition(RERANK, ROOT, () => {
      skippedExecution++
      return { status: 'degraded' as const }
    }),
    applies: () => false,
  }
  const skippedRun = runScoreLayers(runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    skipped,
  ]))
  assert.equal(skippedExecution, 0)
  assert.equal(skippedRun.journal[1].status, 'inapplicable')

  const forged = {
    ...transformDefinition(RERANK, ROOT, () => ({
      status: 'degraded' as const,
    })),
    execute: () => ({ status: 'inapplicable' }),
  } as unknown as ScoreLayerTransformDefinition
  const forgedRun = runScoreLayers(runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    forged,
  ]))
  assert.equal(forgedRun.journal[1].status, 'degraded')
  assert.equal(
    forgedRun.journal[1].status === 'degraded'
      ? forgedRun.journal[1].failureCode
      : undefined,
    'malformed-result',
  )
})

test('layers may reselect within hard survivors and accepted reads attribute dependency closure', () => {
  const calls = [0, 0, 0, 0]
  const input = runInput([
    rootDefinition((context) => {
      calls[0]++
      assert.ok(Object.isFrozen(context))
      assert.ok(Object.isFrozen(context.candidates))
      assert.equal(context.request, request)
      assert.equal(context.view, view)
      assert.equal(context.analysis, analysis)
      assert.equal(context.candidates, candidates)
      assert.notEqual(context.forced, forced)
      assert.ok(Object.isFrozen(context.forced.allowedCandidateIds))
      assert.equal(context.deterministicSeed, 'score-layer-test-seed')
      assert.equal(context.compatibilityCandidateId, 'a')
      assert.equal(context.components.require(READ_COMPONENT).value, 7)
      assert.equal(context.components.get(READ_COMPONENT)?.value, 7)
      return {
        status: 'generated',
        surface: surface([true, false, false]),
      }
    }, [READ_COMPONENT]),
    transformDefinition(RERANK, ROOT, (context) => {
      calls[1]++
      assert.ok(Object.isFrozen(context.prior))
      assert.equal(context.components.get(READ_COMPONENT)?.value, 7)
      return {
        status: 'applied',
        surface: surface([false, true, false]),
      }
    }, [READ_COMPONENT]),
    transformDefinition(RESELECT, RERANK, () => {
      calls[2]++
      return {
        status: 'applied',
        surface: surface([true, false, false], ['a']),
      }
    }),
    transformDefinition(INVALID, RESELECT, () => {
      calls[3]++
      return {
        status: 'applied',
        surface: surface([false, false, true], ['a', 'c']),
      }
    }),
  ])
  const run = runScoreLayers(input)

  assertScoreLayerRunContract(input, run, [
    surface([true, false, false]),
    surface([false, true, false]),
    surface([true, false, false], ['a']),
  ])
  assert.deepEqual(
    run.journal.map((entry) => [
      entry.layer.id,
      entry.status,
      ...(entry.status === 'degraded' ? [entry.failureCode] : []),
    ]),
    [
      ['root', 'generated'],
      ['rerank', 'applied'],
      ['reselect', 'applied'],
      ['invalid', 'degraded', 'execution-failed'],
    ],
  )
  assert.deepEqual(run.surface, surface([true, false, false], ['a']))
  assert.deepEqual(run.operations, {
    analysisRequirementEvaluations: 4,
    analysisRequirementFailures: 0,
    analysisRefsVisited: 0,
    analysisAdmissionEvaluations: 4,
    analysisAdmissionFailures: 0,
    forcedCandidateIdsVisited: 2,
    candidateBoundaryIdsVisited: 2,
    legalCandidatesVisited: 6,
    applicabilityEvaluations: 3,
    layersExecuted: 4,
    componentLookupAttempts: 3,
    componentPayloadIndexEntriesVisited: 2,
    componentPayloadReads: 1,
    componentPayloadsMaterialized: 1,
    componentDefinitionIndexEntriesVisited: 2,
    scoreLayerComponentRequirementsIndexed: 2,
    componentClosureRootsVisited: 2,
    componentDependencyEdgesVisited: 2,
    componentClosureComponentsEmitted: 4,
    componentAttributionUnionTokensVisited: 4,
    componentAttributionTokensVisited: 2,
    componentAttributionEntriesVisited: 2,
    componentAttributionPolicyUseEntriesVisited: 2,
    surfaceBuildAttempts: 4,
    surfacePriorSurvivorsVisited: 6,
    surfaceDraftSurvivorsVisited: 7,
    surfaceRowsVisited: 9,
    surfaceReasonsVisited: 9,
    surfaceBytesConstructed:
      jsonBytes(surface([true, false, false]))
      + jsonBytes(surface([false, true, false]))
      + jsonBytes(surface([true, false, false], ['a'])),
  })
  assert.deepEqual(
    run.journal[0].status === 'generated'
      ? run.journal[0].attributedComponents.map((entry) => entry.id)
      : [],
    [BASE_COMPONENT.id, READ_COMPONENT.id],
  )
  assert.deepEqual(
    run.componentRun.policyUse.map((entry) => [
      entry.component.id,
      entry.used,
      entry.stages,
    ]),
    [
      [BASE_COMPONENT.id, true, ['candidate-score']],
      [READ_COMPONENT.id, true, ['candidate-score']],
    ],
  )
  assert.deepEqual(calls, [1, 1, 1, 1])
})

test('component indexing and batch attribution scale with graph plus emitted closure', () => {
  const graphSize = 48
  const componentTokens: ComponentToken<{ value: number }>[] = []
  const definitions: DecisionComponentDefinition[] = []
  for (let index = 0; index < graphSize; index++) {
    const component: ComponentToken<{ value: number }> = Object.freeze({
      id: `stress-${String(index).padStart(2, '0')}`,
      version: 'v1',
      kind: 'projection',
      privacy: 'private',
    })
    componentTokens.push(component)
    definitions.push(componentDefinition(
      component,
      index === 0 ? [] : [componentTokens[index - 1]],
    ))
  }
  const terminal = componentTokens.at(-1)!
  const stressRun: DecisionComponentRun = Object.freeze({
    version: 'decision-component-run-v1',
    configured: Object.freeze(componentTokens.map((component) =>
      Object.freeze({ id: component.id, version: component.version }))),
    entries: Object.freeze(componentTokens.map((component, index) =>
      admittedEntry(component, { value: index }))),
    policyUse: Object.freeze(componentTokens.map((component) =>
      Object.freeze({
        component: Object.freeze({
          id: component.id,
          version: component.version,
        }),
        used: false,
        stages: Object.freeze([]),
      }))),
  })
  const STRESS_ONE = token('stress-one')
  const STRESS_TWO = token('stress-two')
  const scoreDefinitions = [
    rootDefinition((context) => {
      assert.equal(context.components.require(terminal).value, graphSize - 1)
      return {
        status: 'generated',
        surface: surface([true, false, false], ['a', 'b'], 'stress-root-v1'),
      }
    }, [terminal]),
    transformDefinition(STRESS_ONE, ROOT, (context) => {
      assert.equal(context.components.require(terminal).value, graphSize - 1)
      return {
        status: 'applied',
        surface: surface([true, false, false], ['a', 'b'], 'stress-one-v1'),
      }
    }, [terminal]),
    transformDefinition(STRESS_TWO, STRESS_ONE, (context) => {
      assert.equal(context.components.require(terminal).value, graphSize - 1)
      return {
        status: 'applied',
        surface: surface([true, false, false], ['a', 'b'], 'stress-two-v1'),
      }
    }, [terminal]),
  ]
  const base = runInput(scoreDefinitions)
  const preparation: ScoreLayerRunPreparation = {
    ...base,
    componentDefinitions: Object.freeze(definitions),
  }
  const input: ScoreLayerTestRunInput = {
    ...preparation,
    lease: prepareScoreLayerRunForTest(preparation),
    componentRun: stressRun,
  }
  const run = runScoreLayers(input)

  assertScoreLayerRunContract(input, run, [
    surface([true, false, false], ['a', 'b'], 'stress-root-v1'),
    surface([true, false, false], ['a', 'b'], 'stress-one-v1'),
    surface([true, false, false], ['a', 'b'], 'stress-two-v1'),
  ])
  assert.equal(run.operations.componentLookupAttempts, 3)
  assert.equal(run.operations.componentPayloadIndexEntriesVisited, graphSize)
  assert.equal(run.operations.componentPayloadReads, 1)
  assert.equal(run.operations.componentPayloadsMaterialized, 1)
  assert.equal(
    run.operations.componentDefinitionIndexEntriesVisited,
    graphSize,
  )
  assert.equal(run.operations.scoreLayerComponentRequirementsIndexed, 3)
  assert.equal(run.operations.componentClosureRootsVisited, 3)
  assert.equal(
    run.operations.componentDependencyEdgesVisited,
    (graphSize - 1) * 3,
  )
  assert.equal(
    run.operations.componentClosureComponentsEmitted,
    graphSize * 3,
  )
  assert.equal(
    run.operations.componentAttributionUnionTokensVisited,
    graphSize * 3,
  )
  assert.equal(run.operations.componentAttributionTokensVisited, graphSize)
  assert.equal(
    run.operations.componentAttributionEntriesVisited,
    graphSize,
  )
  assert.equal(
    run.operations.componentAttributionPolicyUseEntriesVisited,
    graphSize,
  )
  assert.ok(run.componentRun.policyUse.every((entry) =>
    entry.used && entry.stages[0] === 'candidate-score'))
})

test('component closure is stack-safe for a very deep dependency chain', () => {
  const graphSize = 12_000
  const componentTokens: ComponentToken<{ value: number }>[] = []
  const definitions: DecisionComponentDefinition[] = []
  for (let index = 0; index < graphSize; index++) {
    const component: ComponentToken<{ value: number }> = Object.freeze({
      id: `deep-${String(index).padStart(5, '0')}`,
      version: 'v1',
      kind: 'projection',
      privacy: 'private',
    })
    componentTokens.push(component)
    definitions.push(componentDefinition(
      component,
      index === 0 ? [] : [componentTokens[index - 1]],
    ))
  }
  const terminal = componentTokens.at(-1)!
  const componentRun: DecisionComponentRun = Object.freeze({
    version: 'decision-component-run-v1',
    configured: Object.freeze(componentTokens.map((component) =>
      Object.freeze({ id: component.id, version: component.version }))),
    entries: Object.freeze(componentTokens.map((component, index) =>
      admittedEntry(component, { value: index }))),
    policyUse: Object.freeze(componentTokens.map((component) =>
      Object.freeze({
        component: Object.freeze({
          id: component.id,
          version: component.version,
        }),
        used: false,
        stages: Object.freeze([]),
      }))),
  })
  const layer = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false], ['a', 'b'], 'deep-root-v1'),
  }), [terminal])
  const operations: ScoreLayerComponentWork = {
    componentLookupAttempts: 0,
    componentPayloadIndexEntriesVisited: 0,
    componentPayloadReads: 0,
    componentPayloadsMaterialized: 0,
    componentDefinitionIndexEntriesVisited: 0,
    scoreLayerComponentRequirementsIndexed: 0,
    componentClosureRootsVisited: 0,
    componentDependencyEdgesVisited: 0,
    componentClosureComponentsEmitted: 0,
    componentAttributionUnionTokensVisited: 0,
    componentAttributionTokensVisited: 0,
    componentAttributionEntriesVisited: 0,
    componentAttributionPolicyUseEntriesVisited: 0,
  }
  const runtime = createScoreLayerComponentRuntime(
    definitions,
    componentRun,
    [layer],
    operations,
  )
  const journal = scoreLayerReadJournal()
  assert.equal(
    runtime.reader(layer, journal).require(terminal).value,
    graphSize - 1,
  )
  const refs = runtime.attribute(journal.reads)

  assert.equal(refs.length, graphSize)
  assert.equal(refs[0].id, componentTokens[0].id)
  assert.equal(refs.at(-1)!.id, terminal.id)
  assert.equal(
    operations.componentDependencyEdgesVisited,
    graphSize - 1,
  )
  assert.equal(operations.componentClosureComponentsEmitted, graphSize)
  assert.equal(
    operations.componentAttributionUnionTokensVisited,
    graphSize,
  )
})

test('sparse layer reads scan component entries and policy use only once', () => {
  const componentCount = 64
  const layerCount = 24
  const componentTokens = Array.from(
    { length: componentCount },
    (_, index): ComponentToken<{ value: number }> => Object.freeze({
      id: `sparse-component-${String(index).padStart(2, '0')}`,
      version: 'v1',
      kind: 'projection',
      privacy: 'private',
    }),
  )
  const definitions = componentTokens.map((component) =>
    componentDefinition(component))
  const sparseRun: DecisionComponentRun = Object.freeze({
    version: 'decision-component-run-v1',
    configured: Object.freeze(componentTokens.map((component) =>
      Object.freeze({ id: component.id, version: component.version }))),
    entries: Object.freeze(componentTokens.map((component, index) =>
      admittedEntry(component, { value: index }))),
    policyUse: Object.freeze(componentTokens.map((component) =>
      Object.freeze({
        component: Object.freeze({
          id: component.id,
          version: component.version,
        }),
        used: false,
        stages: Object.freeze([]),
      }))),
  })

  const scoreDefinitions: ScoreLayerDefinition[] = [
    rootDefinition((context) => {
      assert.equal(context.components.require(componentTokens[0]).value, 0)
      return {
        status: 'generated',
        surface: surface([true, false, false], ['a', 'b'], 'sparse-0-v1'),
      }
    }, [componentTokens[0]]),
  ]
  let predecessor: ScoreLayerRef = ROOT
  for (let index = 1; index < layerCount; index++) {
    const layer = token(`sparse-layer-${index}`)
    const component = componentTokens[index]
    scoreDefinitions.push(transformDefinition(
      layer,
      predecessor,
      (context) => {
        assert.equal(context.components.require(component).value, index)
        return {
          status: 'applied',
          surface: surface(
            [true, false, false],
            ['a', 'b'],
            `sparse-${index}-v1`,
          ),
        }
      },
      [component],
    ))
    predecessor = layer
  }
  const base = runInput(scoreDefinitions)
  const preparation: ScoreLayerRunPreparation = {
    ...base,
    componentDefinitions: Object.freeze(definitions),
  }
  const input: ScoreLayerTestRunInput = {
    ...preparation,
    lease: prepareScoreLayerRunForTest(preparation),
    componentRun: sparseRun,
  }
  const run = runScoreLayers(input)

  assertScoreLayerRunContract(
    input,
    run,
    Array.from({ length: layerCount }, (_, index) =>
      surface(
        [true, false, false],
        ['a', 'b'],
        `sparse-${index}-v1`,
      )),
  )
  assert.equal(run.operations.componentLookupAttempts, layerCount)
  assert.equal(
    run.operations.componentPayloadIndexEntriesVisited,
    componentCount,
  )
  assert.equal(run.operations.componentPayloadReads, layerCount)
  assert.equal(run.operations.componentPayloadsMaterialized, layerCount)
  assert.equal(
    run.operations.componentDefinitionIndexEntriesVisited,
    componentCount,
  )
  assert.equal(
    run.operations.scoreLayerComponentRequirementsIndexed,
    layerCount,
  )
  assert.equal(run.operations.componentClosureRootsVisited, layerCount)
  assert.equal(run.operations.componentDependencyEdgesVisited, 0)
  assert.equal(
    run.operations.componentClosureComponentsEmitted,
    layerCount,
  )
  assert.equal(
    run.operations.componentAttributionUnionTokensVisited,
    layerCount,
  )
  assert.equal(
    run.operations.componentAttributionTokensVisited,
    layerCount,
  )
  assert.equal(
    run.operations.componentAttributionEntriesVisited,
    componentCount,
  )
  assert.equal(
    run.operations.componentAttributionPolicyUseEntriesVisited,
    componentCount,
  )
  assert.equal(
    run.componentRun.policyUse.filter((entry) => entry.used).length,
    layerCount,
  )
  assert.ok(run.journal.every((entry) =>
    entry.status === 'generated' || entry.status === 'applied'
      ? entry.attributedComponents.length === 1
      : false))
})

test('undeclared and missing reads fail or remain unattributed with definition-owned degradation', () => {
  const SNOOP = token('snoop')
  const MISSING = token('missing')
  const MISSING_AGAIN = token('missing-again')
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(SNOOP, ROOT, (context) => {
      context.components.get(READ_COMPONENT)
      return {
        status: 'applied',
        surface: surface([true, false, false], ['a', 'b'], 'snoop-v1'),
      }
    }),
    transformDefinition(MISSING, SNOOP, (context) => {
      assert.equal(context.components.get(MISSING_COMPONENT), undefined)
      return {
        status: 'applied',
        surface: surface([true, false, false], ['a', 'b'], 'missing-v1'),
      }
    }, [MISSING_COMPONENT]),
    transformDefinition(MISSING_AGAIN, MISSING, (context) => {
      assert.equal(context.components.get(MISSING_COMPONENT), undefined)
      return {
        status: 'applied',
        surface: surface(
          [true, false, false],
          ['a', 'b'],
          'missing-again-v1',
        ),
      }
    }, [MISSING_COMPONENT]),
  ])
  const run = runScoreLayers(input)
  assertScoreLayerRunContract(input, run, [
    surface([true, false, false]),
    surface([true, false, false], ['a', 'b'], 'missing-v1'),
    surface([true, false, false], ['a', 'b'], 'missing-again-v1'),
  ])
  assert.deepEqual(
    run.journal.map((entry) => entry.status === 'degraded'
      ? [entry.failureCode, entry.degradationCode]
      : [entry.status]),
    [
      ['generated'],
      ['execution-failed', 'snoop-failed'],
      ['applied'],
      ['applied'],
    ],
  )
  assert.ok(run.componentRun.policyUse.every((entry) => !entry.used))
  assert.deepEqual(run.operations, {
    analysisRequirementEvaluations: 4,
    analysisRequirementFailures: 0,
    analysisRefsVisited: 0,
    analysisAdmissionEvaluations: 4,
    analysisAdmissionFailures: 0,
    forcedCandidateIdsVisited: 2,
    candidateBoundaryIdsVisited: 2,
    legalCandidatesVisited: 6,
    applicabilityEvaluations: 3,
    layersExecuted: 4,
    componentLookupAttempts: 3,
    componentPayloadIndexEntriesVisited: 2,
    componentPayloadReads: 1,
    componentPayloadsMaterialized: 0,
    componentDefinitionIndexEntriesVisited: 2,
    scoreLayerComponentRequirementsIndexed: 2,
    componentClosureRootsVisited: 0,
    componentDependencyEdgesVisited: 0,
    componentClosureComponentsEmitted: 0,
    componentAttributionUnionTokensVisited: 0,
    componentAttributionTokensVisited: 0,
    componentAttributionEntriesVisited: 0,
    componentAttributionPolicyUseEntriesVisited: 0,
    surfaceBuildAttempts: 3,
    surfacePriorSurvivorsVisited: 6,
    surfaceDraftSurvivorsVisited: 6,
    surfaceRowsVisited: 9,
    surfaceReasonsVisited: 15,
    surfaceBytesConstructed:
      jsonBytes(surface([true, false, false]))
      + jsonBytes(surface([true, false, false], ['a', 'b'], 'missing-v1'))
      + jsonBytes(surface(
        [true, false, false],
        ['a', 'b'],
        'missing-again-v1',
      )),
  })
})

test('late-row invalidity is counted exactly and total root failures are programming errors', () => {
  const LATE = token('late-invalid')
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(LATE, ROOT, () => ({
      status: 'applied',
      surface: {
        scores: scores([true, false, true]),
        survivorCandidateIds: ['a'],
      },
    })),
  ])
  const run = runScoreLayers(input)
  assert.equal(run.operations.surfaceRowsVisited, 6)
  assert.equal(run.journal[1].status, 'degraded')

  const brokenRoot = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([false, false, false]),
    })),
  ])
  assert.throws(
    () => runScoreLayers(brokenRoot),
    /total score layer root failed/,
  )
  assert.throws(
    () => runScoreLayers(brokenRoot),
    /run lease was already consumed/,
  )
})

test('candidate identity and order are invariant across transforms', () => {
  const ORDER = token('wrong-order')
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(ORDER, ROOT, () => ({
      status: 'applied',
      surface: {
        scores: [...scores([true, false, false])].reverse(),
        survivorCandidateIds: ['a', 'b'],
      },
    })),
  ])
  const run = runScoreLayers(input)
  assert.equal(run.journal[1].status, 'degraded')
  assert.equal(run.operations.surfaceRowsVisited, 4)
  assert.deepEqual(run.surface, surface([true, false, false]))
})

test('forced survivors join once to the exact canonical legal candidate surface', () => {
  const definition = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const inputWith = (
    allowedCandidateIds: readonly string[],
    selectedCandidateId?: string,
  ): ScoreLayerTestRunInput => ({
    ...runInput([definition]),
    forced: detachTrustedPolicyData({
      version: FORCED_POLICY_VERSION,
      applied: false,
      reasonCodes: [],
      allowedCandidateIds,
      ...(selectedCandidateId === undefined
        ? {}
        : { selectedCandidateId }),
    } as ForcedPolicyResult),
  })

  assert.throws(
    () => runScoreLayers(inputWith(['a', 'unknown'])),
    /unknown candidate/,
  )
  assert.throws(
    () => runScoreLayers(inputWith(['a', 'a'])),
    /unique strings/,
  )
  assert.throws(
    () => runScoreLayers(inputWith(['b', 'a'])),
    /canonical legal order/,
  )
  assert.throws(
    () => runScoreLayers(inputWith(['a', 'b'], 'c')),
    /outside the allowed candidates/,
  )
  assert.throws(
    () => runScoreLayers(inputWith([])),
    /must retain a legal candidate/,
  )
})

test('a transform cannot revive a surface captured before an intervening narrowing layer', () => {
  const NARROW = token('narrow')
  const REVIVE = token('revive')
  let capturedRootSurface: ScoreLayerSurface | undefined
  const root: ScoreLayerRootDefinition = {
    kind: 'root',
    token: ROOT,
    requiredComponents: [],
    analysisRequirements: () => [],
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    execute(context) {
      capturedRootSurface = context.surface.create(
        surface([true, false, false]),
      )
      return { status: 'generated', surface: capturedRootSurface }
    },
  }
  const narrow = transformDefinition(NARROW, ROOT, () => ({
    status: 'applied',
    surface: surface([true, false, false], ['a'], 'narrow-v1'),
  }))
  const revive: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token: REVIVE,
    predecessor: NARROW,
    requiredComponents: [],
    degradationCode: 'revive-failed',
    analysisRequirements: () => [],
    admitAnalysis: ({ requirements }) => requirements.length === 0,
    applies: () => true,
    execute: () => ({
      status: 'applied',
      surface: capturedRootSurface!,
    }),
  }
  const input = runInput([root, narrow, revive])
  const run = runScoreLayers(input)

  assert.deepEqual(
    run.journal.map((entry) => entry.status === 'degraded'
      ? [entry.status, entry.failureCode]
      : [entry.status]),
    [
      ['generated'],
      ['applied'],
      ['degraded', 'invalid-score-surface'],
    ],
  )
  assert.deepEqual(
    run.surface,
    surface([true, false, false], ['a'], 'narrow-v1'),
  )
  assert.equal(run.operations.surfaceBuildAttempts, 2)
  assert.equal(
    run.operations.surfaceBytesConstructed,
    jsonBytes(surface([true, false, false]))
      + jsonBytes(surface([true, false, false], ['a'], 'narrow-v1')),
  )
})

test('factory attempts and constructed bytes distinguish an unused surface from a retry', () => {
  const RETRY = token('retry')
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    {
      ...transformDefinition(RETRY, ROOT, () => ({
        status: 'degraded',
      })),
      execute(context) {
        context.surface.create(
          surface([true, false, false], ['a', 'b'], 'unused-v1'),
        )
        context.surface.create(
          surface([true, false, false], ['a', 'b'], 'retry-v1'),
        )
        return { status: 'degraded' }
      },
    },
  ])
  const run = runScoreLayers(input)

  assert.equal(run.journal[1].status, 'degraded')
  assert.equal(run.operations.surfaceBuildAttempts, 3)
  assert.equal(
    run.operations.surfaceBytesConstructed,
    jsonBytes(surface([true, false, false]))
      + jsonBytes(surface(
        [true, false, false],
        ['a', 'b'],
        'unused-v1',
      )),
  )
})

test('trusted lease execution does not reparse substituted wrapper fields', () => {
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(RERANK, ROOT, (context) => ({
      status: 'applied',
      surface: context.prior,
    })),
  ])
  const transform = input.chain.definitions[1]
  assert.equal(transform.kind, 'transform')
  if (transform.kind !== 'transform') return
  const forgedTransform: ScoreLayerTransformDefinition = {
    ...transform,
    predecessor: token('unrelated-root'),
  }
  const run = runScoreLayers({
    ...input,
    chain: {
      ...input.chain,
      definitions: [input.chain.definitions[0], forgedTransform],
    },
    componentDefinitions: [...input.componentDefinitions].reverse(),
  })
  assert.deepEqual(run.configured, input.chain.order)
})

test('trusted lease snapshots its preparation wrapper references', () => {
  const root = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }))
  const registry = createScoreLayerRegistry([root])
  const chain = registry.resolve({ terminal: root.token })
  const preparation: {
    chain: ScoreLayerRunPreparation['chain']
    componentDefinitions: ScoreLayerRunPreparation['componentDefinitions']
    request: ScoreLayerRunPreparation['request']
    view: ScoreLayerRunPreparation['view']
  } = {
    chain,
    componentDefinitions,
    request,
    view,
  }
  const lease = prepareScoreLayerRunForTest(preparation)
  const replacementRoot = {
    ...root,
    token: token('replacement-root'),
  }
  preparation.chain = createScoreLayerRegistry([replacementRoot]).resolve({
    terminal: replacementRoot.token,
  })
  preparation.componentDefinitions = []
  preparation.request = detachTrustedPolicyData(
    { kind: 'discuss' } as DecisionRequest,
  )
  preparation.view = detachTrustedPolicyData({
    seat: 9,
    alignment: 'evil',
  } as PlayerView)

  const run = runPreparedScoreLayersForTest(lease, {
    analysis,
    candidates,
    forced,
    componentRun,
    deterministicSeed: 'preparation-snapshot-test',
    compatibilityCandidateId: 'a',
    hypotheticalTeamCandidates: null,
  })

  assert.deepEqual(run.configured, chain.order)
  assert.equal(run.journal[0].layer.id, root.token.id)
})

test('wrong-length typed outputs do not visit excess candidate rows', () => {
  const HUGE = token('huge')
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(HUGE, ROOT, () => ({
      status: 'applied',
      surface: {
        scores: Array.from({ length: 100_000 }, (_, index) => ({
          candidateId: String(index),
          value: 0,
          viable: false,
          reasonCodes: [],
        })),
        survivorCandidateIds: ['a'],
      },
    })),
  ])
  const run = runScoreLayers(input)
  assertScoreLayerRunContract(input, run, [
    surface([true, false, false]),
  ])
  assert.equal(run.operations.surfaceRowsVisited, 3)
  assert.equal(run.journal[1].status, 'degraded')
})

test('typed surface bounds reject huge reason arrays and strings before iteration', () => {
  const BOUNDED = token('bounded')
  const execute = (draft: ScoreLayerSurfaceDraft) => runScoreLayers(runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: surface([true, false, false]),
    })),
    transformDefinition(BOUNDED, ROOT, () => ({
      status: 'applied',
      surface: draft,
    })),
  ]))

  const hugeReasons = surface([true, false, false], ['a'])
  hugeReasons.scores[0] = {
    ...hugeReasons.scores[0],
    reasonCodes: Array(100_000).fill('A'),
  }
  const hugeRun = execute(hugeReasons)
  assert.equal(hugeRun.journal[1].status, 'degraded')
  assert.equal(hugeRun.operations.surfaceRowsVisited, 4)
  assert.equal(hugeRun.operations.surfaceReasonsVisited, 3)

  const hugeString = surface([true, false, false], ['a'])
  hugeString.scores[0] = {
    ...hugeString.scores[0],
    reasonCodes: ['v'.repeat(100_000)],
  }
  const hugeStringRun = execute(hugeString)
  assert.equal(hugeStringRun.journal[1].status, 'degraded')
  assert.equal(hugeStringRun.operations.surfaceRowsVisited, 4)
  assert.equal(hugeStringRun.operations.surfaceReasonsVisited, 4)
})

test('surface factory emits one canonical property order', () => {
  const oddRows = scores([true, false, false]).map((row) => ({
    reasonCodes: row.reasonCodes,
    viable: row.viable,
    value: row.value,
    candidateId: row.candidateId,
  }))
  const input = runInput([
    rootDefinition(() => ({
      status: 'generated',
      surface: {
        survivorCandidateIds: ['a', 'b'],
        scores: oddRows,
      },
    })),
  ])
  const run = runScoreLayers(input)
  assert.deepEqual(
    Object.keys(run.surface),
    ['version', 'scores', 'survivorCandidateIds'],
  )
  assert.deepEqual(
    Object.keys(run.surface.scores[0]),
    ['candidateId', 'value', 'viable', 'reasonCodes'],
  )
  assert.equal(
    run.operations.surfaceBytesConstructed,
    Buffer.byteLength(JSON.stringify(run.surface), 'utf8'),
  )
})

test('aggregate surface bytes are rejected incrementally before the cap is retained', () => {
  const BULK = token('bulk')
  const manyCandidates = Object.freeze(Array.from(
    { length: 252 },
    (_, index) => ({ id: `candidate-${index}` }),
  )) as unknown as readonly PolicyCandidate[]
  const survivorIds = manyCandidates.map((candidate) => candidate.id)
  const rootSurface = {
    version: 'score-layer-surface-v1' as const,
    scores: manyCandidates.map((candidate) => ({
      candidateId: candidate.id,
      value: 1,
      viable: true,
      reasonCodes: ['ROOT'],
    })),
    survivorCandidateIds: survivorIds,
  }
  const definitions = [
    rootDefinition(() => ({
      status: 'generated',
      surface: rootSurface,
    })),
    transformDefinition(BULK, ROOT, () => ({
      status: 'applied',
      surface: {
        scores: manyCandidates.map((candidate) => ({
          candidateId: candidate.id,
          value: 2,
          viable: true,
          reasonCodes: Array(32).fill('R'.repeat(256)),
        })),
        survivorCandidateIds: survivorIds,
      },
    })),
  ]
  const base = runInput(definitions)
  const emptyComponentRun: DecisionComponentRun = Object.freeze({
    version: 'decision-component-run-v1',
    configured: Object.freeze([]),
    entries: Object.freeze([]),
    policyUse: Object.freeze([]),
  })
  const preparation: ScoreLayerRunPreparation = {
    ...base,
    componentDefinitions: Object.freeze([]),
  }
  const input: ScoreLayerTestRunInput = {
    ...preparation,
    lease: prepareScoreLayerRunForTest(preparation),
    analysis: base.analysis,
    candidates: manyCandidates,
    forced: detachTrustedPolicyData({
      version: FORCED_POLICY_VERSION,
      applied: false,
      reasonCodes: [],
      allowedCandidateIds: survivorIds,
    } as ForcedPolicyResult),
    componentRun: emptyComponentRun,
    deterministicSeed: base.deterministicSeed,
    compatibilityCandidateId: base.compatibilityCandidateId,
    hypotheticalTeamCandidates: base.hypotheticalTeamCandidates,
  }
  const run = runScoreLayers(input)

  assert.equal(run.journal[1].status, 'degraded')
  assert.deepEqual(run.surface, rootSurface)
  assert.equal(run.operations.surfaceBuildAttempts, 2)
  assert.equal(
    run.operations.surfaceBytesConstructed,
    jsonBytes(rootSurface),
  )
  assert.ok(
    run.operations.surfaceBytesConstructed
      < MAX_SCORE_LAYER_SURFACE_JSON_BYTES,
  )
  assert.ok(run.operations.surfaceRowsVisited < manyCandidates.length * 2)
  assert.ok(
    run.operations.surfaceReasonsVisited
      < manyCandidates.length * 33,
  )
})

test('custom scoring source remains isolated from native score-layer types', () => {
  const source = readFileSync(
    new URL(
      '../server/agents/policy/decision-frame.ts',
      import.meta.url,
    ),
    'utf8',
  )
  const customStart = source.indexOf('export function withCustomScoring(')
  const customEnd = source.indexOf(
    'export function projectScoredFrameForCompatibility(',
  )
  const nativeStart = source.indexOf('export function withNativeScoreLayers(')
  const nativeEnd = source.indexOf('export function selectDecisionCandidate(')
  assert.ok(customStart >= 0 && customEnd > customStart)
  assert.ok(nativeStart >= 0 && nativeEnd > nativeStart)
  const customSource = source.slice(customStart, customEnd)
  const nativeSource = source.slice(nativeStart, nativeEnd)

  assert.match(customSource, /finalizeScoredDecisionFrame\(/)
  assert.match(customSource, /authority: 'custom'/)
  assert.doesNotMatch(customSource, /structuredChoice\(/)
  assert.doesNotMatch(customSource, /NativeViableCandidate|ScoreLayerRow/)
  assert.match(nativeSource, /Immutable<NativeViableCandidate>/)
  assert.doesNotMatch(nativeSource, /structuredChoice\(/)

  const kernelSource = readFileSync(
    new URL('../server/agents/components/kernel.ts', import.meta.url),
    'utf8',
  )
  const payloadStart = kernelSource.indexOf(
    'export function componentPayload<',
  )
  const payloadEnd = kernelSource.indexOf(
    'export interface DecisionComponentPolicyAttributionWork',
  )
  const attributionStart = kernelSource.indexOf(
    'export function attributeComponentPolicyUse(',
  )
  const attributionEnd = kernelSource.indexOf(
    'export function publicDecisionComponentRun(',
  )
  const payloadSource = kernelSource.slice(payloadStart, payloadEnd)
  const attributionSource = kernelSource.slice(
    attributionStart,
    attributionEnd,
  )
  assert.match(payloadSource, /run\.entries\.find\(/)
  assert.doesNotMatch(payloadSource, /indexDecisionComponentPayloads/)
  assert.match(attributionSource, /run\.entries\.find\(/)
  assert.match(attributionSource, /run\.policyUse\.map\(/)
  assert.doesNotMatch(
    attributionSource,
    /attributeComponentPolicyUseBatch/,
  )
})

test('native frame seam installs one honestly admitted root score authority', async () => {
  const fixture = readDecisionFixtures()[0]
  const nativeRoot = {
    ...rootDefinition((context) => {
      const allowed = new Set(context.forced.allowedCandidateIds)
      return {
        status: 'generated',
        surface: {
          scores: context.candidates.map((candidate, index) => ({
            candidateId: candidate.id,
            value: candidate.id === context.compatibilityCandidateId
              ? 1_000
              : -index,
            viable: allowed.has(candidate.id),
            reasonCodes: ['FRAME_SEAM'],
          })),
          survivorCandidateIds: context.forced.allowedCandidateIds,
        },
      }
    }),
    analysisRequirements: () => [{
      id: 'situation-analysis',
      version: SITUATION_ANALYSIS_VERSION,
    }],
    admitAnalysis: ({
      analysis: supplied,
      requirements,
      candidates: suppliedCandidates,
    }) =>
      supplied.modelVersion === SITUATION_ANALYSIS_VERSION
      && requirements.length === 1
      && requirements[0].id === 'situation-analysis'
      && requirements[0].version === SITUATION_ANALYSIS_VERSION
      && suppliedCandidates.length > 0,
  }
  const scoreRegistry = createScoreLayerRegistry([nativeRoot])
  const brain = resolveComposedBrain({
    configuredPipeline: testConfiguredPipeline(),
    scoreLayerTerminal: nativeRoot.token,
    scoreLayerOrder: [nativeRoot.token],
  }, createDecisionComponentRegistry([]), scoreRegistry)
  const canonical = canonicalDecisionFrame(fixture.req, fixture.view)
  const legal = withLegalCandidates(canonical)
  const lease = prepareNativeScoreLayers(legal, brain)
  assert.ok(Object.isFrozen(lease))
  assert.deepEqual(lease.requirements, [{
    id: 'situation-analysis',
    version: SITUATION_ANALYSIS_VERSION,
  }])
  const analyzed = withDecisionAnalysis(
    legal,
    reconstructCognition(fixture.view),
    'candidate-teams',
  )
  const forcedFrame = withUniversalForcedPolicy(analyzed)
  const components = await withResolvedComponents(forcedFrame, brain)
  const decisionLayers = withResolvedDecisionLayers(components, brain)
  const compatibilityCandidateId = legal.legalCandidates[0].id
  // The preparation is deliberately plain frozen data. Its execution authority
  // is the branded run capability it carries, not the record itself.
  assert.deepEqual(Object.keys(lease), [
    'version',
    'requirements',
    'brain',
    'request',
    'view',
    'legalCandidates',
    'run',
  ])
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, {
      version: 'native-score-layer-preparation-v1',
      requirements: lease.requirements,
    } as unknown as PreparedNativeScoreLayers, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /does not belong to this decision frame/,
  )
  assert.throws(
    () => withNativeScoreLayers({
      ...decisionLayers,
      request: detachTrustedPolicyData(
        structuredClone(decisionLayers.request),
      ),
    }, lease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /does not belong to this decision frame/,
  )
  assert.throws(
    () => withNativeScoreLayers({
      ...decisionLayers,
      view: detachTrustedPolicyData(structuredClone(decisionLayers.view)),
    }, lease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /does not belong to this decision frame/,
  )
  const foreignCanonical = canonicalDecisionFrame(fixture.req, fixture.view)
  const foreignLegal = withLegalCandidates(foreignCanonical)
  const foreignLease = prepareNativeScoreLayers(foreignLegal, brain)
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, foreignLease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /does not belong to this decision frame/,
  )
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: '',
      compatibilityCandidateId,
    }),
    /nonempty bounded seed/,
  )
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: '   ',
      compatibilityCandidateId,
    }),
    /nonempty bounded seed/,
  )
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: 'x'.repeat(1_025),
      compatibilityCandidateId,
    }),
    /nonempty bounded seed/,
  )
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId: 'not-a-legal-candidate',
    }),
    /legal compatibility candidate/,
  )
  const parallelLease = prepareNativeScoreLayers(legal, brain)
  const parallelComponents = await withResolvedComponents(forcedFrame, brain)
  const parallelDecisionLayers = withResolvedDecisionLayers(
    parallelComponents,
    brain,
  )
  const [native, parallelNative] = await Promise.all([
    Promise.resolve().then(() => withNativeScoreLayers(
      decisionLayers,
      lease,
      {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
      },
    )),
    Promise.resolve().then(() => withNativeScoreLayers(
      parallelDecisionLayers,
      parallelLease,
      {
        deterministicSeed: fixture.source.seed,
        compatibilityCandidateId,
      },
    )),
  ])
  assert.equal(
    parallelNative.structuredCandidateId,
    native.structuredCandidateId,
  )
  // A preparation is bound to its candidate coordinates, not to one component
  // frame instance. Scoring a different component run of the same coordinates
  // is therefore permitted, and it agrees exactly, which is why the former
  // frame-instance binding was removed rather than reproduced statelessly.
  const crossRun = withNativeScoreLayers(
    parallelDecisionLayers,
    prepareNativeScoreLayers(legal, brain),
    { deterministicSeed: fixture.source.seed, compatibilityCandidateId },
  )
  assert.equal(crossRun.structuredCandidateId, native.structuredCandidateId)
  assert.deepEqual(crossRun.scores, native.scores)
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /run lease was already consumed/,
  )

  assert.equal(native.stage, 'native-score-layers-resolved')
  assert.equal(native.structuredCandidateId, compatibilityCandidateId)
  assert.equal(native.scores, native.scoreLayerRun.surface.scores)
  assert.ok(native.viableCandidates.every(Object.isFrozen))
  assert.throws(() => {
    const entry = native.viableCandidates[0] as unknown as {
      candidate: null
    }
    entry.candidate = null
  })
  assert.equal(
    native.survivorCandidateIds,
    native.scoreLayerRun.surface.survivorCandidateIds,
  )
  assert.deepEqual(
    brain.description.scoreLayerOrder,
    [{ id: ROOT.id, version: ROOT.version }],
  )
})

test('native component binding is brain-local, exact, one-shot, and concurrent-safe', async () => {
  const fixture = readDecisionFixtures()[0]
  const nativeRoot = rootDefinition((context) => {
    const allowed = new Set(context.forced.allowedCandidateIds)
    return {
      status: 'generated',
      surface: {
        scores: context.candidates.map((candidate, index) => ({
          candidateId: candidate.id,
          value: -index,
          viable: allowed.has(candidate.id),
          reasonCodes: ['BINDING_LAW'],
        })),
        survivorCandidateIds: context.forced.allowedCandidateIds,
      },
    }
  })
  const scoreRegistry = createScoreLayerRegistry([nativeRoot])
  const emptyRegistry = createDecisionComponentRegistry([])
  const config = {
    configuredPipeline: testConfiguredPipeline(),
    scoreLayerTerminal: nativeRoot.token,
    scoreLayerOrder: [nativeRoot.token],
  }
  const brainA = resolveComposedBrain(config, emptyRegistry, scoreRegistry)
  const brainB = resolveComposedBrain(config, emptyRegistry, scoreRegistry)
  assert.notEqual(brainA, brainB)
  assert.deepEqual(brainA.description.components, brainB.description.components)
  assert.deepEqual(brainA.description.components.configured, [])

  const canonical = canonicalDecisionFrame(fixture.req, fixture.view)
  const legal = withLegalCandidates(canonical)
  const analyzed = withDecisionAnalysis(
    legal,
    reconstructCognition(fixture.view),
    'candidate-teams',
  )
  const forcedFrame = withUniversalForcedPolicy(analyzed)
  const compatibilityCandidateId = legal.legalCandidates[0].id
  const lease = prepareNativeScoreLayers(legal, brainA)

  const components = await withResolvedComponents(forcedFrame, brainA)
  const decisionLayers = withResolvedDecisionLayers(components, brainA)

  // Brain agreement is now proven from the run itself rather than from binding
  // state: a preparation from one brain cannot score another brain's run.
  const foreignComponents = await withResolvedComponents(forcedFrame, brainB)
  const foreignDecisionLayers = withResolvedDecisionLayers(
    foreignComponents,
    brainB,
  )
  assert.throws(
    () => withNativeScoreLayers(
      foreignDecisionLayers,
      prepareNativeScoreLayers(legal, brainA),
      { deterministicSeed: fixture.source.seed, compatibilityCandidateId },
    ),
    /belongs to a different brain/,
  )

  const scored = withNativeScoreLayers(decisionLayers, lease, {
    deterministicSeed: fixture.source.seed,
    compatibilityCandidateId,
  })
  assert.equal(scored.stage, 'native-score-layers-resolved')
  assert.throws(
    () => withNativeScoreLayers(decisionLayers, lease, {
      deterministicSeed: fixture.source.seed,
      compatibilityCandidateId,
    }),
    /run lease was already consumed/,
  )

  const componentRoot = rootDefinition(() => ({
    status: 'generated',
    surface: surface([true, false, false]),
  }), [BASE_COMPONENT])
  const componentScoreRegistry = createScoreLayerRegistry([componentRoot])
  const overlappingRegistry = createDecisionComponentRegistry([
    componentDefinition(BASE_COMPONENT),
  ])
  const componentConfig = {
    configuredPipeline: testConfiguredPipeline(),
    scoreLayerTerminal: componentRoot.token,
    scoreLayerOrder: [componentRoot.token],
  }
  const componentBrainA = resolveComposedBrain(
    componentConfig,
    overlappingRegistry,
    componentScoreRegistry,
  )
  const componentBrainB = resolveComposedBrain(
    componentConfig,
    overlappingRegistry,
    componentScoreRegistry,
  )
  assert.deepEqual(
    componentBrainA.description.components,
    componentBrainB.description.components,
  )
  assert.deepEqual(
    componentBrainA.description.components.configured.map((entry) => entry.id),
    [BASE_COMPONENT.id],
  )
  const componentFrame = await withResolvedComponents(
    forcedFrame,
    componentBrainA,
  )
  assert.equal(componentFrame.stage, 'components-resolved')
  // Two brains whose configured component graphs differ are distinguishable
  // from the run alone, so scoring rejects the crossed pairing.
  const componentDecisionLayers = withResolvedDecisionLayers(
    componentFrame,
    componentBrainA,
  )
  assert.throws(
    () => withNativeScoreLayers(
      componentDecisionLayers,
      prepareNativeScoreLayers(legal, componentBrainB),
      {
        deterministicSeed: fixture.source.seed,
        compatibilityCandidateId: legal.legalCandidates[0].id,
      },
    ),
    /belongs to a different brain/,
  )
})
