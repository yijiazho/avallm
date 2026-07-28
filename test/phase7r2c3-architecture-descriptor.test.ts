import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CANDIDATE_PLANNER_PROTOCOL_VERSION,
  NO_PLANNER_VERSION,
  NO_VOICE_VERSION,
  PLAN_VOICE_PROTOCOL_VERSION,
  createComposedAgent,
  type ComposedAgentOptions,
} from '../server/agents/composed.ts'
import {
  RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
  RESOLVED_COMPOSED_BRAIN_VERSION,
  projectPrivateArchitectureDebug,
  projectResolvedArchitecturePrivate,
  projectPrivateResolvedComposedBrainLegacy,
  resolveComposedBrain,
  type CompatibilityValue,
  type ResolvedConfiguredPipeline,
} from '../server/agents/components/resolved-brain.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
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
import { brainComponents } from '../server/agents/brain.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
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
          id: 'matrix-language',
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
    assert.ok(Object.isFrozen(first.configuredPipeline))
    assert.ok(Object.isFrozen(first.configuredPipeline.belief))
    assert.ok(Object.isFrozen(first.configuredPipeline.scoring))
    assert.ok(Object.isFrozen(
      first.configuredPipeline.scoring.configuredBaseChain,
    ))
    assert.ok(Object.isFrozen(first.migration))
    assert.ok(Object.isFrozen(first.migration.compatibility))
  }
})

test('private debug and exact legacy shapes are pure descriptor projections', () => {
  const descriptor = createComposedAgent({
    seed: 'descriptor-projections',
    privateIdentity: {
      roleQueries: ['merlin'],
      hiddenTeam: false,
    },
  }).resolvedBrain().description
  const debug = projectPrivateArchitectureDebug(descriptor)
  const privateProjection =
    projectResolvedArchitecturePrivate(descriptor)
  const legacy = projectPrivateResolvedComposedBrainLegacy(descriptor)

  assert.equal(privateProjection, descriptor)
  assert.deepEqual(Object.keys(debug), [
    'version',
    'base',
    'components',
    'requiredHostInputs',
    'scoreLayerOrder',
    'decisionLayerOrder',
    'configuredPipeline',
  ])
  assert.equal('migration' in debug, false)
  assert.equal('baseComponentVersions' in descriptor, false)
  assert.deepEqual(Object.keys(legacy), [
    'version',
    'base',
    'baseComponentVersions',
    'components',
    'requiredHostInputs',
    'scoreLayerOrder',
    'decisionLayerOrder',
    'compatibility',
  ])
  assert.equal(legacy.version, RESOLVED_COMPOSED_BRAIN_VERSION)
  assert.deepEqual(
    legacy.baseComponentVersions,
    brainComponents(descriptor.base),
  )
  assert.deepEqual(Object.keys(descriptor.migration.compatibility), [
    'requests',
  ])
  assert.deepEqual(descriptor.migration.compatibility.requests, {
    evilQuestCardPolicy: null,
    morganaCounterfeitObjectives: false,
    privateIdentity: {
      hiddenTeam: false,
      roleQueries: ['merlin'],
    },
    publicObserver: false,
    roleObjectiveRouter: false,
    roleObjectives: false,
  })
  assert.deepEqual(Object.keys(legacy.compatibility), [
    'beliefModel',
    'languageFactorVersion',
    'languageInterpreterVersion',
    'requests',
    'scorerVersions',
  ])
  const legacyRequests = legacy.compatibility.requests as Readonly<
    Record<string, CompatibilityValue>
  >
  assert.deepEqual(Object.keys(legacyRequests), [
    'coherenceIntent',
    'evilQuestCardPolicy',
    'morganaCounterfeitObjectives',
    'planMemory',
    'privateIdentity',
    'publicObserver',
    'roleObjectiveRouter',
    'roleObjectives',
  ])
  const expectedCompatibility = {
    beliefModel: {
      factorsVersion: 'off',
      version: EXACT_BELIEF_MODEL_VERSION,
    },
    languageFactorVersion: boundedLanguageLikelihoodFactor.version,
    languageInterpreterVersion: 'off',
    requests: {
      coherenceIntent: 'maintain',
      evilQuestCardPolicy: null,
      morganaCounterfeitObjectives: false,
      planMemory: false,
      privateIdentity: {
        hiddenTeam: false,
        roleQueries: ['merlin'],
      },
      publicObserver: false,
      roleObjectiveRouter: false,
      roleObjectives: false,
    },
    scorerVersions: [CANDIDATE_SCORER_VERSION],
  }
  assert.deepEqual(legacy.compatibility, expectedCompatibility)
  assert.equal(
    JSON.stringify(legacy.compatibility),
    JSON.stringify(expectedCompatibility),
  )
  assert.ok(Object.isFrozen(debug))
  assert.ok(Object.isFrozen(legacy))
  assert.ok(Object.isFrozen(legacy.baseComponentVersions))
})

test('descriptor snapshots caller pipeline data and owns no implementations', () => {
  const pipeline = testConfiguredPipeline()
  const descriptor = resolveComposedBrain({
    configuredPipeline: pipeline,
    compatibility: {
      nested: {
        values: ['original'],
      },
    },
  }, createDecisionComponentRegistry([])).description

  const mutableBelief = pipeline.belief as { model: string }
  const mutableFallbacks =
    pipeline.scoring.configuredBaseChain as string[]
  mutableBelief.model = 'mutated'
  mutableFallbacks[0] = 'mutated'
  const nested = descriptor.migration.compatibility.nested as {
    readonly values: readonly string[]
  }
  assert.equal(descriptor.configuredPipeline.belief.model, 'test-belief-v1')
  assert.deepEqual(
    descriptor.configuredPipeline.scoring.configuredBaseChain,
    ['test-fallback-v1'],
  )
  assert.deepEqual(nested.values, ['original'])
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

test('reserved migration metadata cannot duplicate the canonical pipeline', () => {
  const registry = createDecisionComponentRegistry([])
  for (const key of [
    'beliefModel',
    'languageInterpreterVersion',
    'languageFactorVersion',
    'scorerVersions',
  ]) {
    assert.throws(
      () => resolveComposedBrain({
        configuredPipeline: testConfiguredPipeline(),
        compatibility: { [key]: 'duplicate' },
      }, registry),
      new RegExp(`compatibility\\.${key} duplicates configuredPipeline`),
    )
  }
  for (const key of ['planMemory', 'coherenceIntent']) {
    assert.throws(
      () => resolveComposedBrain({
        configuredPipeline: testConfiguredPipeline(),
        compatibility: {
          requests: { [key]: 'duplicate' },
        },
      }, registry),
      new RegExp(
        `compatibility\\.requests\\.${key} duplicates configuredPipeline`,
      ),
    )
  }
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

  const output = normalizeAgentOutput(
    await agent.decide(source.req, source.view),
  )
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
  const output = normalizeAgentOutput(
    await agent.decide(source.req, source.view),
  )

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
