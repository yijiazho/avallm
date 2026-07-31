// Migration phase 7R2C3; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  createComposedAgent,
  type ComposedAgentOptions,
} from '../server/agents/composed.ts'
import {
  CANDIDATE_PLANNER_PROTOCOL_VERSION,
  NO_PLANNER_VERSION,
  NO_VOICE_VERSION,
  PLAN_VOICE_PROTOCOL_VERSION,
} from '../server/agents/communication/planner-voice-adapter.ts'
import {
  RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
  admitResolvedArchitectureIdentity,
  trustedArchitectureIdentityDebug,
  revalidatedArchitectureIdentity,
  resolveComposedBrain,
  type ResolvedConfiguredPipeline,
} from '../server/agents/components/resolved-brain.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  ACTOR_TARGET_TREATMENT_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../server/agents/belief/types.ts'
import {
  boundedLanguageLikelihoodFactor,
} from '../server/agents/belief/language-factor.ts'
import {
  SITUATION_ANALYSIS_VERSION,
} from '../server/agents/analysis/types.ts'
import {
  LEGAL_CANDIDATE_VERSION,
  FORCED_POLICY_VERSION,
} from '../server/agents/policy/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
  compatibilityCandidateScores,
} from '../server/agents/policy/score.ts'
import {
  DECISION_PLAN_VERSION,
  COMMUNICATION_INTENT_VERSION,
} from '../server/agents/policy/plan.ts'
import {
  COMPOSED_PROMPT_VERSION,
  COMPOSED_RENDERER_VERSION,
} from '../server/agents/communication/composed-renderer.ts'
import {
  PLAN_MEMORY_VERSION,
} from '../server/agents/cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
} from '../server/agents/cognition/coherence.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import {
  projectBaseTraceComponentVersions,
} from '../server/agents/trace.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

const DEFAULT_PIPELINE: ResolvedConfiguredPipeline = {
  belief: {
    model: EXACT_BELIEF_MODEL_VERSION,
    factors: 'off',
    languageInterpreter: 'off',
    languageFactor: boundedLanguageLikelihoodFactor.version,
  },
  analysis: {
    situation: SITUATION_ANALYSIS_VERSION,
  },
  candidateGeneration: {
    legalCandidates: LEGAL_CANDIDATE_VERSION,
  },
  forcedPolicy: {
    policy: FORCED_POLICY_VERSION,
  },
  scoring: {
    configuredScorer: CANDIDATE_SCORER_VERSION,
    configuredBaseChain: [],
    invalidOutputFallback: CANDIDATE_SCORER_VERSION,
  },
  planning: {
    protocol: CANDIDATE_PLANNER_PROTOCOL_VERSION,
    decisionPlan: DECISION_PLAN_VERSION,
  },
  prompt: {
    prompt: COMPOSED_PROMPT_VERSION,
    renderer: COMPOSED_RENDERER_VERSION,
  },
  communication: {
    intent: COMMUNICATION_INTENT_VERSION,
    voiceProtocol: PLAN_VOICE_PROTOCOL_VERSION,
  },
  planCoherence: {
    memory: 'off',
    model: 'off',
    intent: 'maintain',
  },
}

function assertDataOnly(value: unknown): void {
  assert.notEqual(typeof value, 'function')
  if (Array.isArray(value)) {
    for (const entry of value) assertDataOnly(entry)
    return
  }
  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) assertDataOnly(entry)
  }
}

test('runtime and persisted identity share one codec and omit migration', () => {
  const descriptor = createComposedAgent({
    seed: 'phase7r2c3-identity-codec',
    decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
  }).resolvedBrain().description
  const runtime = revalidatedArchitectureIdentity(descriptor)
  const persisted = admitResolvedArchitectureIdentity(
    JSON.parse(JSON.stringify(runtime)),
  )
  assert.deepEqual(persisted, runtime)
  assert.equal(Object.hasOwn(runtime, 'migration'), false)
  assert.equal(Object.isFrozen(runtime), true)

  const relabelled = structuredClone(runtime) as any
  relabelled.version = 'forged-architecture-identity-v1'
  assert.equal(admitResolvedArchitectureIdentity(relabelled), undefined)

  const invalidBaseFields: readonly Readonly<{
    field: string
    value: string
  }>[] = [
    { field: 'version', value: 'forged-brain-v1' },
    { field: 'mode', value: 'raw-llm' },
    { field: 'belief', value: 'forged-belief-v1' },
    { field: 'beliefVisibility', value: 'external' },
    { field: 'policy', value: 'forged-policy-v1' },
    { field: 'communication', value: 'forged-voice-v1' },
    { field: 'languageEvidence', value: 'external' },
    { field: 'observerModel', value: 'external' },
  ]
  for (const { field, value } of invalidBaseFields) {
    const candidate = structuredClone(runtime) as any
    candidate.base[field] = value
    assert.equal(
      admitResolvedArchitectureIdentity(candidate),
      undefined,
      field,
    )
  }

  const leakedMigration = {
    ...structuredClone(runtime),
    migration: { compatibility: { secret: true } },
  }
  assert.equal(admitResolvedArchitectureIdentity(leakedMigration), undefined)

  let invoked = false
  const accessor = structuredClone(runtime) as unknown as Record<string, unknown>
  Object.defineProperty(accessor, 'configuredPipeline', {
    enumerable: true,
    get() {
      invoked = true
      throw new Error('must not execute')
    },
  })
  assert.equal(admitResolvedArchitectureIdentity(accessor), undefined)
  assert.equal(invoked, false)
})

test('identity codec rejects impossible component graph partitions', () => {
  const identity = revalidatedArchitectureIdentity(
    createComposedAgent({
      seed: 'phase7r2c3-identity-graph-codec',
      decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
    }).resolvedBrain().description,
  )
  const mutations: readonly Readonly<{
    name: string
    mutate: (candidate: any) => void
  }>[] = [
    {
      name: 'requested outside configured',
      mutate(candidate) {
        candidate.components.requested.push({
          id: 'forged-request',
          version: 'forged-request-v1',
        })
      },
    },
    {
      name: 'eligible also ineligible',
      mutate(candidate) {
        candidate.components.ineligible.push({
          component: structuredClone(candidate.components.eligible[0]),
          missingHostRequirements: ['forged-missing-capability'],
          ineligibleDependencies: [],
        })
      },
    },
    {
      name: 'configured left unpartitioned',
      mutate(candidate) {
        candidate.components.eligible = []
      },
    },
    {
      name: 'duplicate ineligible component',
      mutate(candidate) {
        const component = structuredClone(
          candidate.components.eligible[0],
        )
        candidate.components.eligible = []
        const entry = {
          component,
          missingHostRequirements: ['missing-capability'],
          ineligibleDependencies: [],
        }
        candidate.components.ineligible = [
          structuredClone(entry),
          structuredClone(entry),
        ]
      },
    },
    {
      name: 'self ineligible dependency',
      mutate(candidate) {
        const component = structuredClone(
          candidate.components.eligible[0],
        )
        candidate.components.eligible = []
        candidate.components.ineligible = [{
          component,
          missingHostRequirements: [],
          ineligibleDependencies: [structuredClone(component)],
        }]
      },
    },
    {
      name: 'duplicate missing host requirement',
      mutate(candidate) {
        const component = structuredClone(
          candidate.components.eligible[0],
        )
        candidate.components.eligible = []
        candidate.components.ineligible = [{
          component,
          missingHostRequirements: [
            'missing-capability',
            'missing-capability',
          ],
          ineligibleDependencies: [],
        }]
      },
    },
    {
      name: 'ineligible dependency follows its consumer',
      mutate(candidate) {
        const consumer = structuredClone(
          candidate.components.eligible[0],
        )
        const dependency = {
          id: 'later-dependency',
          version: 'later-dependency-v1',
        }
        candidate.components.configured = [consumer, dependency]
        candidate.components.eligible = []
        candidate.components.ineligible = [
          {
            component: consumer,
            missingHostRequirements: [],
            ineligibleDependencies: [structuredClone(dependency)],
          },
          {
            component: dependency,
            missingHostRequirements: ['missing-capability'],
            ineligibleDependencies: [],
          },
        ]
      },
    },
  ]
  for (const { name, mutate } of mutations) {
    const candidate = structuredClone(identity)
    mutate(candidate)
    assert.equal(
      admitResolvedArchitectureIdentity(candidate),
      undefined,
      name,
    )
  }
})

test('resolved architecture descriptor is deterministic across a configuration matrix', () => {
  const matrix: readonly Readonly<{
    name: string
    options: Omit<ComposedAgentOptions, 'seed'>
    expected: ResolvedConfiguredPipeline
  }>[] = [
    {
      name: 'default',
      options: {},
      expected: DEFAULT_PIPELINE,
    },
    {
      name: 'configured factors, scorer fallback, and coherence',
      options: {
        beliefModel: {
          version: 'matrix-belief-v1',
          factorsVersion: 'matrix-factors-v1',
          infer() {
            throw new Error('descriptor construction must not run belief')
          },
        },
        languageInterpreter: {
          interpreterVersion: 'matrix-language-v1',
          async interpret() {
            throw new Error('descriptor construction must not interpret')
          },
        },
        languageFactor: {
          id: 'language',
          version: 'matrix-language-factor-v1',
          logLikelihood() {
            throw new Error('descriptor construction must not score language')
          },
        },
        scorer: {
          version: 'matrix-scorer-v1',
          baseScorer: {
            version: 'matrix-base-scorer-v1',
            score() {
              throw new Error('descriptor construction must not score')
            },
          },
          score() {
            throw new Error('descriptor construction must not score')
          },
        },
        planner: {
          version: 'matrix-planner-adapter-a',
          async choose() {
            throw new Error('descriptor construction must not plan')
          },
        },
        voice: {
          version: 'matrix-voice-adapter-a',
          async speak() {
            throw new Error('descriptor construction must not speak')
          },
        },
        planMemory: true,
        coherenceIntent: 'conceal',
      },
      expected: {
        ...DEFAULT_PIPELINE,
        belief: {
          model: 'matrix-belief-v1',
          factors: 'matrix-factors-v1',
          languageInterpreter: 'matrix-language-v1',
          languageFactor: 'matrix-language-factor-v1',
        },
        scoring: {
          configuredScorer: 'matrix-scorer-v1',
          configuredBaseChain: ['matrix-base-scorer-v1'],
          invalidOutputFallback: CANDIDATE_SCORER_VERSION,
        },
        planCoherence: {
          memory: PLAN_MEMORY_VERSION,
          model: COHERENCE_MODEL_VERSION,
          intent: 'conceal',
        },
      },
    },
  ]

  for (const entry of matrix) {
    const first = createComposedAgent({
      seed: `descriptor-${entry.name}`,
      ...entry.options,
    }).resolvedBrain().description
    const second = createComposedAgent({
      seed: `descriptor-${entry.name}`,
      ...entry.options,
    }).resolvedBrain().description

    assert.deepEqual(first, second, entry.name)
    assert.deepEqual(first.configuredPipeline, entry.expected, entry.name)
    if (entry.name !== 'default') {
      assert.equal(
        first.configuredPipeline.scoring.configuredBaseChain.includes(
          CANDIDATE_SCORER_VERSION,
        ),
        false,
        'descriptor must not invent a scorer outside the configured chain',
      )
    }
    assert.equal(first.version, RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION)
    assert.ok(Object.isFrozen(first))
    assert.ok(Object.isFrozen(first.componentContributions))
    assert.ok(Object.isFrozen(first.configuredPipeline))
    assert.ok(Object.isFrozen(first.configuredPipeline.belief))
    assert.ok(Object.isFrozen(first.configuredPipeline.scoring))
    assert.ok(Object.isFrozen(
      first.configuredPipeline.scoring.configuredBaseChain,
    ))
  }
})

test('private debug projection is a pure descriptor projection', () => {
  const descriptor = createComposedAgent({
    seed: 'descriptor-projections',
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
  }).resolvedBrain().description
  const debug = trustedArchitectureIdentityDebug(descriptor)

  assert.deepEqual(Object.keys(debug), [
    'version',
    'base',
    'components',
    'componentContributions',
    'requiredHostInputs',
    'scoreLayerOrder',
    'decisionLayerOrder',
    'configuredPipeline',
  ])
  assert.equal('migration' in debug, false)
  assert.ok(Object.isFrozen(debug))
})

test('descriptor snapshots caller pipeline data and owns no implementations', () => {
  const pipeline = testConfiguredPipeline()
  const descriptor = resolveComposedBrain({
    configuredPipeline: pipeline,
  }, createDecisionComponentRegistry([])).description

  const mutableBelief = pipeline.belief as { model: string }
  const mutableFallbacks =
    pipeline.scoring.configuredBaseChain as string[]
  mutableBelief.model = 'mutated'
  mutableFallbacks[0] = 'mutated'
  assert.equal(descriptor.configuredPipeline.belief.model, 'test-belief-v1')
  assert.deepEqual(
    descriptor.configuredPipeline.scoring.configuredBaseChain,
    ['test-fallback-v1'],
  )
  assertDataOnly(descriptor)
})

test('configured pipeline rejects every invalid scalar and fallback shape', () => {
  const stringPaths = [
    ['belief', 'model'],
    ['belief', 'factors'],
    ['belief', 'languageInterpreter'],
    ['belief', 'languageFactor'],
    ['analysis', 'situation'],
    ['candidateGeneration', 'legalCandidates'],
    ['forcedPolicy', 'policy'],
    ['scoring', 'configuredScorer'],
    ['scoring', 'invalidOutputFallback'],
    ['planning', 'protocol'],
    ['planning', 'decisionPlan'],
    ['prompt', 'prompt'],
    ['prompt', 'renderer'],
    ['communication', 'intent'],
    ['communication', 'voiceProtocol'],
    ['planCoherence', 'memory'],
    ['planCoherence', 'model'],
    ['planCoherence', 'intent'],
  ] as const
  const registry = createDecisionComponentRegistry([])
  const resolve = (pipeline: unknown) =>
    resolveComposedBrain({
      configuredPipeline: pipeline as ResolvedConfiguredPipeline,
    }, registry)
  const replace = (
    path: readonly [string, string],
    value: unknown,
  ): unknown => {
    const pipeline = structuredClone(
      testConfiguredPipeline(),
    ) as unknown as Record<string, Record<string, unknown>>
    pipeline[path[0]][path[1]] = value
    return pipeline
  }

  for (const path of stringPaths) {
    assert.throws(() => resolve(replace(path, '')))
  }
  assert.throws(() => resolve(replace(['belief', 'model'], {})))
  assert.throws(() => resolve(replace(
    ['belief', 'model'],
    () => 'mutable implementation',
  )))
  const sparse = structuredClone(
    testConfiguredPipeline(),
  ) as unknown as Record<string, Record<string, unknown>>
  sparse.scoring.configuredBaseChain = new Array(1)
  assert.throws(() => resolve(sparse))
  assert.throws(() => resolve(replace(
    ['scoring', 'configuredBaseChain'],
    ['valid-v1', {}],
  )))
  assert.throws(() => resolve(replace(
    ['scoring', 'configuredBaseChain'],
    { 0: 'valid-v1', length: 1 },
  )))
})

test('invalid scorer output uses only the named hard fallback', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  let baseCalls = 0
  const agent = createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: 'invalid-custom-scorer-v1',
      baseScorer: {
        version: 'declared-base-scorer-v1',
        score() {
          baseCalls++
          throw new Error('an arbitrary base scorer must not be attempted')
        },
      },
      score() {
        return []
      },
    },
  })
  const descriptor = agent.resolvedBrain().description
  assert.deepEqual(descriptor.configuredPipeline.scoring, {
    configuredScorer: 'invalid-custom-scorer-v1',
    configuredBaseChain: ['declared-base-scorer-v1'],
    invalidOutputFallback: CANDIDATE_SCORER_VERSION,
  })

  const output = await agent.decide(source.req, source.view)
  assert.equal(baseCalls, 0)
  assert.equal(
    output.trace!.componentVersions!.configuredScorer,
    'invalid-custom-scorer-v1',
  )
  assert.equal(
    output.trace!.componentVersions!.scorer,
    CANDIDATE_SCORER_VERSION,
  )
  assert.ok(output.trace!.degradation.includes('scorer-invalid-output'))
})

test('mutable planner and voice adapters never mutate the lifetime descriptor', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const agent = createComposedAgent({
    seed: source.source.seed,
    planner: {
      version: 'planner-a',
      async choose(input) {
        return { candidateId: input.structuredCandidateId }
      },
    },
    voice: {
      version: 'voice-a',
      async speak() {
        return { text: 'A' }
      },
    },
  })
  const descriptor = agent.resolvedBrain().description
  const before = JSON.stringify(descriptor)

  agent.setPlanner({
    version: 'planner-b',
    async choose(input) {
      return { candidateId: input.structuredCandidateId }
    },
  })
  agent.setVoice({
    version: 'voice-b',
    async speak() {
      return { text: 'B' }
    },
  })
  const output = await agent.decide(source.req, source.view)

  assert.equal(agent.resolvedBrain().description, descriptor)
  assert.equal(JSON.stringify(descriptor), before)
  assert.equal(
    descriptor.configuredPipeline.planning.protocol,
    CANDIDATE_PLANNER_PROTOCOL_VERSION,
  )
  assert.equal(
    descriptor.configuredPipeline.communication.voiceProtocol,
    PLAN_VOICE_PROTOCOL_VERSION,
  )
  assert.equal(output.trace!.componentVersions!.planner, 'planner-b')
  assert.equal(output.trace!.componentVersions!.voice, 'voice-b')
  assert.notEqual(
    output.trace!.componentVersions!.planner,
    NO_PLANNER_VERSION,
  )
  assert.notEqual(
    output.trace!.componentVersions!.voice,
    NO_VOICE_VERSION,
  )
})

test('custom compatibility bridge preserves deterministic trace bytes and property order', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: CANDIDATE_SCORER_VERSION,
      score: compatibilityCandidateScores,
    },
  }).decide(source.req, source.view)

  assert.deepEqual(output.decision, {
    kind: 'propose',
    team: [0, 4],
  })
  assert.equal(
    createHash('sha256')
      .update(JSON.stringify(output.trace))
      .digest('hex'),
    '1293840883e793642315a3cb7c8d2f33ff3757bbcfd9c91224a78c932c62d04f',
  )
  assert.equal(output.trace!.scoreLayerRun, undefined)
  assert.deepEqual(output.trace!.decisionFrame, {
    version: 'decision-frame-v1',
    committedMechanicalAction: output.decision,
    voice: { version: NO_VOICE_VERSION, applied: false },
  })
  assert.deepEqual(Object.keys(output.trace!.componentVersions!), [
    'brain',
    'belief',
    'beliefVisibility',
    'factors',
    'languageEvidence',
    'observerModel',
    'decisionComponents',
    'analysis',
    'candidates',
    'forcedPolicy',
    'policy',
    'scorer',
    'planner',
    'prompt',
    'renderer',
    'voice',
  ])
})

test('exact default singleton truthfully reports deterministic native shadow identity', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const firstAgent = createComposedAgent({ seed: source.source.seed })
  const secondAgent = createComposedAgent({ seed: source.source.seed })
  const first = await firstAgent.decide(source.req, source.view)
  const second = await secondAgent.decide(source.req, source.view)
  assert.deepEqual(first.decision, second.decision)
  assert.equal(
    first.trace!.architectureIdentityDigest,
    second.trace!.architectureIdentityDigest,
  )
  assert.deepEqual(firstAgent.resolvedBrain().description.scoreLayerOrder, [{
    id: 'compatibility-score',
    version: CANDIDATE_SCORER_VERSION,
  }])
  assert.notEqual(
    first.trace!.architectureIdentityDigest,
    '073a48e094753e0af6f37559ded67bc1a655afb9acef8df9e44393d7f35dff06',
  )
})

test('base trace projection fails closed on descriptor and run drift', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const agent = createComposedAgent({
    seed: source.source.seed,
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: false,
    },
  })
  const output = await agent.decide(source.req, source.view)
  const versions = output.trace!.componentVersions!
  const run = output.trace!.components!
  const projection = projectBaseTraceComponentVersions(
    agent.resolvedBrain().description,
    run,
    {
      belief: versions.belief,
      factors: versions.factors,
      scorer: versions.scorer,
      planner: versions.planner,
      voice: versions.voice,
      compatibilityObserverProduced: false,
    },
  )

  assert.deepEqual(Object.keys(projection.prefix), [
    'brain',
    'belief',
    'beliefVisibility',
    'factors',
    'languageEvidence',
    'observerModel',
  ])
  assert.deepEqual(Object.keys(projection.suffix), [
    'decisionComponents',
    'analysis',
    'candidates',
    'forcedPolicy',
    'policy',
    'scorer',
    'planner',
    'prompt',
    'renderer',
    'voice',
  ])
  assert.doesNotMatch(
    JSON.stringify(projection),
    /roleQueries|hiddenTeam|merlin/,
  )

  assert.throws(
    () => projectBaseTraceComponentVersions(
      agent.resolvedBrain().description,
      {
        ...run,
        configured: [
          ...run.configured,
          { id: 'forged-component', version: 'forged-v1' },
        ],
      },
      {
        belief: versions.belief,
        factors: versions.factors,
        scorer: versions.scorer,
        planner: versions.planner,
        voice: versions.voice,
        compatibilityObserverProduced: false,
      },
    ),
    /does not match the architecture descriptor/,
  )
})

test('descriptor owns component observer attribution across inapplicable paths', async () => {
  const fixtures = readDecisionFixtures()
  const quest = fixtures.find((entry) => entry.req.kind === 'quest')!
  const genericAgent = createComposedAgent({
    seed: quest.source.seed,
    decisionComponents: [ACTOR_TARGET_TREATMENT_COMPONENT],
  })
  const generic = await genericAgent.decide(quest.req, quest.view)
  assert.equal(
    genericAgent.resolvedBrain().description
      .componentContributions.observerModel,
    'exact-public-observer-v1',
  )
  assert.equal(
    generic.trace!.components!.entries[0].status,
    'inapplicable',
  )
  assert.equal(
    generic.trace!.componentVersions!.observerModel,
    'exact-public-observer-v1',
  )

  const servant = fixtures.find(
    (entry) =>
      entry.view.role === 'servant'
      && (entry.req.kind === 'propose' || entry.req.kind === 'vote'),
  )!
  const legacyAgent = createComposedAgent({
    seed: servant.source.seed,
    roleObjectives: true,
  })
  const legacy = await legacyAgent.decide(servant.req, servant.view)
  const descriptor = legacyAgent.resolvedBrain().description
  assert.notEqual(descriptor.base.observerModel, 'off')
  assert.equal(descriptor.componentContributions.observerModel, 'off')
  assert.equal(Object.hasOwn(legacy.trace!, 'privateRoleObjective'), false)
  assert.equal(legacy.trace!.componentVersions!.observerModel, 'off')
})
