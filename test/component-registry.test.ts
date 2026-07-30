// Migration phase 7R2B1; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ComponentRegistryError,
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import type {
  ComponentAdmissionResult,
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentHostInputToken,
  ComponentRef,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import {
  createComposedAgent,
  type ComposedAgentOptions,
} from '../server/agents/composed.ts'
import type {
  CandidatePlanner,
} from '../server/agents/communication/planner-voice-adapter.ts'
import {
  compatibilityCandidateScores,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

test('registry rejects a single unsupported observer-model contribution', () => {
  const custom = {
    ...definition('custom-observer'),
    brainContribution: {
      observerModel: 'custom-observer-model-v1',
    },
  }
  assert.throws(
    () => createDecisionComponentRegistry([
      custom as unknown as DecisionComponentDefinition,
    ]),
    (error: unknown) =>
      error instanceof ComponentRegistryError
      && error.code === 'invalid-definition',
  )
})

function admitted<Payload>(
  payload: Payload,
): ComponentAdmissionResult<Payload> {
  return Object.freeze({
    admitted: true,
    payload,
    verification: 'exact',
    promotionEligible: true,
  })
}

const PRIVATE_ROOT: ComponentHostInputToken<{ seed: string }> = {
  id: 'runtime.seed',
  version: 'v1',
  privacy: 'private',
}

function hostInput(
  token: ComponentHostInputToken<unknown> = PRIVATE_ROOT,
): ComponentHostInputDefinition<unknown> {
  return {
    token,
    maxPayloadBytes: 128,
    validate: (value) => ({ valid: true, value }),
  }
}

function definition(
  id: string,
  dependencies: ComponentRef[] = [],
  hostRequirements: string[] = [],
  version = 'v1',
  privacy: 'public' | 'private' = 'private',
  requiredHostInputs: ComponentHostInputRef[] = [],
): DecisionComponentDefinition {
  return {
    token: {
      id,
      version,
      kind: 'observer',
      privacy,
    },
    source: 'native',
    dependencies,
    requiredHostInputs,
    hostRequirements,
    maxPayloadBytes: 256,
    degradationCode: `${id}-failed`,
    applies: () => true,
    execute() {
      return {
        status: 'produced',
        envelope: {
          component: { id, version },
          kind: 'observer',
          privacy,
          payload: null,
        },
      }
    },
    validateDetached: admitted,
    admitHost: ({ payload }) => admitted(payload),
  }
}

function errorCode(block: () => unknown): string | undefined {
  try {
    block()
  } catch (error) {
    assert.ok(error instanceof ComponentRegistryError)
    return error.code
  }
  assert.fail('expected a ComponentRegistryError')
}

test('registry rejects duplicate, conflicting, missing, and cyclic definitions', () => {
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([
      definition('same'),
      definition('same'),
    ])),
    'duplicate-identity',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([
      definition('same', [], [], 'v1'),
      definition('same', [], [], 'v2'),
    ])),
    'conflicting-version',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([
      definition('consumer', [{ id: 'missing', version: 'v1' }]),
    ])),
    'missing-dependency',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([
      definition('private-source'),
      definition(
        'public-consumer',
        [{ id: 'private-source', version: 'v1' }],
        [],
        'v1',
        'public',
      ),
    ])),
    'privacy-violation',
  )
  assert.throws(
    () => createDecisionComponentRegistry([
      definition('alpha', [{ id: 'bravo', version: 'v1' }]),
      definition('bravo', [{ id: 'charlie', version: 'v1' }]),
      definition('charlie', [{ id: 'alpha', version: 'v1' }]),
    ]),
    (error: unknown) => {
      assert.ok(error instanceof ComponentRegistryError)
      assert.equal(error.code, 'dependency-cycle')
      assert.match(
        error.message,
        /alpha@v1 -> bravo@v1 -> charlie@v1 -> alpha@v1/,
      )
      return true
    },
  )
})

test('host inputs use a separate immutable registry namespace', () => {
  const component = definition(
    'runtime.seed',
    [],
    [],
    'v1',
    'private',
    [PRIVATE_ROOT],
  )
  const root = hostInput()
  const registry = createDecisionComponentRegistry([component], {
    hostInputs: [root],
  })

  assert.equal(registry.size, 1)
  assert.equal(registry.hostInputSize, 1)
  assert.equal(registry.definitions()[0].token.id, 'runtime.seed')
  assert.equal(
    registry.hostInputDefinitions()[0].token.id,
    'runtime.seed',
  )
  assert.deepEqual(
    registry.definitions()[0].requiredHostInputs,
    [PRIVATE_ROOT],
  )
  assert.ok(Object.isFrozen(registry.hostInputDefinitions()))
  assert.ok(Object.isFrozen(registry.hostInputDefinitions()[0]))
  assert.ok(Object.isFrozen(registry.hostInputDefinitions()[0].token))

  assert.equal(
    errorCode(() => createDecisionComponentRegistry(
      [definition(
        'missing-root-consumer',
        [],
        [],
        'v1',
        'private',
        [PRIVATE_ROOT],
      )],
    )),
    'missing-host-input',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([], {
      hostInputs: [hostInput(), hostInput()],
    })),
    'duplicate-host-input-identity',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([], {
      hostInputs: [
        hostInput(),
        hostInput({ ...PRIVATE_ROOT, version: 'v2' }),
      ],
    })),
    'conflicting-host-input-version',
  )
  assert.equal(
    errorCode(() => createDecisionComponentRegistry([
      definition(
        'public-consumer',
        [],
        [],
        'v1',
        'public',
        [PRIVATE_ROOT],
      ),
    ], {
      hostInputs: [root],
    })),
    'privacy-violation',
  )
})

test('host input registry snapshots metadata and preserves validator receiver', () => {
  class StatefulHostInput
  implements ComponentHostInputDefinition<{ seed: string }> {
    readonly token = { ...PRIVATE_ROOT }
    readonly maxPayloadBytes = 128
    #marker = 'original'

    validate(value: unknown) {
      assert.equal(this.#marker, 'original')
      return {
        valid: true as const,
        value: value as { seed: string },
      }
    }
  }
  const source = new StatefulHostInput()
  const registry = createDecisionComponentRegistry([], {
    hostInputs: [source],
  })
  const mutable = source as unknown as {
    token: { id: string }
    maxPayloadBytes: number
  }
  mutable.token.id = 'mutated'
  mutable.maxPayloadBytes = 999

  const registered = registry.hostInputDefinitions()[0]
  assert.equal(registered.token.id, 'runtime.seed')
  assert.equal(registered.maxPayloadBytes, 128)
  assert.deepEqual(registered.validate({ seed: 'x' }), {
    valid: true,
    value: { seed: 'x' },
  })
})

test('registry resolves a deterministic dependency-first eligible graph', () => {
  const registry = createDecisionComponentRegistry([
    definition('zulu'),
    definition(
      'delta',
      [{ id: 'alpha', version: 'v1' }],
      ['private-belief'],
    ),
    definition('alpha'),
    definition('echo', [{ id: 'delta', version: 'v1' }]),
    definition('bravo'),
  ])
  assert.deepEqual(
    registry.definitions().map((entry) => entry.token.id),
    ['alpha', 'bravo', 'delta', 'echo', 'zulu'],
  )
  const unavailable = registry.resolve({
    requested: [{ id: 'echo', version: 'v1' }],
  })
  assert.deepEqual(
    unavailable.configured.map((entry) => entry.id),
    ['alpha', 'delta', 'echo'],
  )
  assert.deepEqual(
    unavailable.eligible.map((entry) => entry.id),
    ['alpha'],
  )
  assert.deepEqual(
    unavailable.ineligible.map((entry) => ({
      id: entry.component.id,
      missing: entry.missingHostRequirements,
      dependencies: entry.ineligibleDependencies.map(
        (dependency) => dependency.id,
      ),
    })),
    [
      {
        id: 'delta',
        missing: ['private-belief'],
        dependencies: [],
      },
      {
        id: 'echo',
        missing: [],
        dependencies: ['delta'],
      },
    ],
  )
  const eligible = registry.resolve({
    requested: [{ id: 'echo', version: 'v1' }],
    hostCapabilities: ['private-belief'],
  })
  assert.deepEqual(
    eligible.eligible.map((entry) => entry.id),
    ['alpha', 'delta', 'echo'],
  )
})

test('registry snapshots definitions and exposes no mutable collection', () => {
  const dependencies = [{ id: 'alpha', version: 'v1' }]
  const requirements = ['private-belief']
  const source = definition('bravo', dependencies, requirements)
  const registry = createDecisionComponentRegistry([
    definition('alpha'),
    source,
  ])
  dependencies[0].id = 'changed'
  requirements[0] = 'changed'
  const mutableSource = source as unknown as {
    token: { id: string }
    maxPayloadBytes: number
  }
  mutableSource.token.id = 'changed'
  mutableSource.maxPayloadBytes = 999

  const registered = registry.definition({ id: 'bravo', version: 'v1' })!
  assert.equal(registered.token.id, 'bravo')
  assert.equal(registered.dependencies[0].id, 'alpha')
  assert.deepEqual(registered.hostRequirements, ['private-belief'])
  assert.equal(registered.maxPayloadBytes, 256)
  assert.ok(Object.isFrozen(registry))
  assert.ok(Object.isFrozen(registry.definitions()))
  assert.ok(Object.isFrozen(registered))
  assert.ok(Object.isFrozen(registered.token))
  assert.ok(Object.isFrozen(registered.dependencies))
  assert.ok(Object.isFrozen(registered.dependencies[0]))
  assert.ok(Object.isFrozen(registered.hostRequirements))
})

test('registry preserves stateful component receiver semantics', () => {
  class StatefulDefinition
  implements DecisionComponentDefinition<string> {
    readonly token = {
      id: 'stateful',
      version: 'v1',
      kind: 'observer' as const,
      privacy: 'private' as const,
    }
    readonly source = 'native' as const
    readonly dependencies: readonly ComponentRef[] = []
    readonly requiredHostInputs = []
    readonly hostRequirements: readonly string[] = []
    readonly maxPayloadBytes = 256
    readonly degradationCode = 'stateful-failed'
    #marker = 'original-receiver'

    applies(): true {
      assert.equal(this.#marker, 'original-receiver')
      return true
    }

    execute() {
      assert.equal(this.#marker, 'original-receiver')
      return {
        status: 'produced' as const,
        envelope: {
          component: { id: 'stateful', version: 'v1' },
          kind: 'observer' as const,
          privacy: 'private' as const,
          payload: 'payload',
        },
      }
    }

    validateDetached(payload: unknown): ComponentAdmissionResult<string> {
      assert.equal(this.#marker, 'original-receiver')
      return typeof payload === 'string'
        ? admitted(payload)
        : { admitted: false, degradationCode: this.degradationCode }
    }

    admitHost(
      input: { readonly payload: string; readonly host: unknown },
    ): ComponentAdmissionResult<string> {
      assert.equal(this.#marker, 'original-receiver')
      return admitted(input.payload)
    }
  }

  const registry = createDecisionComponentRegistry([
    new StatefulDefinition(),
  ])
  const registered = registry.definition({
    id: 'stateful',
    version: 'v1',
  })!
  assert.deepEqual(registered.validateDetached('payload'), {
    admitted: true,
    payload: 'payload',
    verification: 'exact',
    promotionEligible: true,
  })
  assert.equal(registered.admitHost({
    payload: 'payload',
    host: {},
  }).admitted, true)
})

test('resolved brain owns frozen definitions, descriptions, and layer order', () => {
  const registry = createDecisionComponentRegistry([
    definition('observer'),
    {
      ...definition(
        'objective',
        [{ id: 'observer', version: 'v1' }],
      ),
      token: {
        id: 'objective',
        version: 'v1',
        kind: 'objective',
        privacy: 'private',
      },
    },
  ])
  const requested = [{ id: 'objective', version: 'v1' }]
  const resolved = resolveComposedBrain({
    requestedComponents: requested,
    scoreLayerOrder: [],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  requested[0].id = 'changed'

  assert.deepEqual(
    resolved.description.components.requested.map((entry) => entry.id),
    ['objective'],
  )
  assert.deepEqual(
    resolved.eligibleDefinitions.map((entry) => entry.token.id),
    ['observer', 'objective'],
  )
  assert.equal(
    resolved.eligibleDefinitions[0],
    registry.definition({ id: 'observer', version: 'v1' }),
  )
  assert.deepEqual(
    resolved.description.scoreLayerOrder.map((entry) => entry.id),
    [],
  )
  assert.ok(Object.isFrozen(resolved))
  assert.ok(Object.isFrozen(resolved.description))
  assert.ok(Object.isFrozen(resolved.description.base))
  assert.ok(Object.isFrozen(resolved.description.components))
  assert.ok(Object.isFrozen(resolved.description.requiredHostInputs))
  assert.ok(Object.isFrozen(resolved.hostInputDefinitions))
  assert.ok(Object.isFrozen(resolved.configuredDefinitions))
  assert.ok(Object.isFrozen(resolved.eligibleDefinitions))
  assert.ok(Object.isFrozen(resolved.description.scoreLayerOrder))
  assert.doesNotThrow(() => JSON.stringify(resolved.description))
  assert.doesNotMatch(
    JSON.stringify(resolved.description),
    /validateDetached|admitHost|\"validate\"/,
  )
})

test('composed construction resists later caller option and injection mutation', async () => {
  const source = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const stages: string[] = []
  const scorer: CandidateScorer = {
    version: 'construction-snapshot-v1',
    score: compatibilityCandidateScores,
  }
  class StatefulPlanner implements CandidatePlanner {
    version = 'construction-planner-v1'
    #calls = 0

    async choose(input: Parameters<CandidatePlanner['choose']>[0]) {
      this.#calls++
      return { candidateId: input.structuredCandidateId }
    }

    calls(): number {
      return this.#calls
    }
  }
  const planner = new StatefulPlanner()
  const options: ComposedAgentOptions = {
    seed: source.source.seed,
    scorer,
    planner,
    publicObserver: false,
    privateIdentity: {
      roleQueries: ['merlin' as const],
      hiddenTeam: false,
    },
    onStage: (stage: string) => stages.push(stage),
  }
  const agent = createComposedAgent(options)
  const construction = agent.resolvedBrain()

  const mutableOptions = options as unknown as {
    seed: string
    publicObserver: boolean
    privateIdentity: { roleQueries: string[] }
    onStage: () => void
  }
  mutableOptions.seed = 'mutated-seed'
  mutableOptions.publicObserver = true
  mutableOptions.privateIdentity.roleQueries[0] = 'morgana'
  mutableOptions.onStage = () =>
    assert.fail('mutated callback was observed')
  scorer.version = 'mutated-scorer'
  scorer.score = () => {
    throw new Error('mutated scorer was observed')
  }
  planner.version = 'mutated-planner'
  planner.choose = async () => {
    throw new Error('mutated planner was observed')
  }

  const output = await agent.decide(source.req, source.view)
  assert.equal(
    output.trace!.componentVersions!.scorer,
    'compatibility-scorer-v1',
  )
  assert.equal(
    output.trace!.componentVersions!.configuredScorer,
    'construction-snapshot-v1',
  )
  assert.equal(
    output.trace!.componentVersions!.planner,
    'construction-planner-v1',
  )
  assert.equal(planner.calls(), 1)
  assert.ok(stages.length)
  assert.deepEqual(construction.description.components.requested, [])
  assert.deepEqual(construction.eligibleDefinitions, [])
})
