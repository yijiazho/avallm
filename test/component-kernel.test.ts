// Migration phase 7R2B2; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { structurallyHostileRecords } from './support/hostile-data.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import {
  attributeComponentPolicyUse,
  componentEnvelope,
  componentPayload,
  DecisionComponentInvocationError,
  publicDecisionComponentRun,
  runDecisionComponents,
  type DecisionComponentRun,
  type DecisionComponentTrustedHostInputProvider,
  validateDecisionComponentRunHostJoin,
} from '../server/agents/components/kernel.ts'
import {
  createDecisionComponentRegistry,
} from '../server/agents/components/registry.ts'
import {
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import type {
  ComponentAdmissionResult,
  ComponentApplicability,
  ComponentExecutionResult,
  ComponentHostInputBinding,
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentHostInputToken,
  ComponentRef,
  ComponentToken,
  DecisionComponentApplicabilityContext,
  DecisionComponentContext,
  DecisionComponentDefinition,
} from '../server/agents/components/types.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

interface SignalPayload {
  readonly seat: number
  readonly proposal: number
}

interface ProjectionPayload {
  readonly sourceSeat: number
  readonly decisionKind: string
}

const SIGNAL_TOKEN: ComponentToken<SignalPayload> = {
  id: 'context.signal',
  version: 'v1',
  kind: 'observer',
  privacy: 'private',
}

const PROJECTION_TOKEN: ComponentToken<ProjectionPayload> = {
  id: 'context.projection',
  version: 'v1',
  kind: 'projection',
  privacy: 'private',
}

const SEED_INPUT: ComponentHostInputToken<{ seed: string }> = {
  id: 'runtime.seed',
  version: 'v1',
  privacy: 'private',
}

const PUBLIC_SIGNAL_INPUT: ComponentHostInputToken<{
  label: string
}> = {
  id: 'runtime.public-signal',
  version: 'v1',
  privacy: 'public',
}

function hostInputDefinition<Value>(
  token: ComponentHostInputToken<Value>,
  validate: ComponentHostInputDefinition<Value>['validate'],
  maxPayloadBytes = 256,
): ComponentHostInputDefinition<Value> {
  return {
    token,
    maxPayloadBytes,
    validate,
  }
}

const SEED_INPUT_DEFINITION = hostInputDefinition(
  SEED_INPUT,
  (value) => {
    const record = value as Record<string, unknown>
    return (
      record
      && typeof record.seed === 'string'
      && Object.keys(record).length === 1
    )
      ? { valid: true, value: { seed: record.seed } }
      : { valid: false, degradationCode: 'invalid-seed' }
  },
)

function exact<Payload>(
  payload: Payload,
): ComponentAdmissionResult<Payload> {
  return {
    admitted: true,
    payload,
    verification: 'exact',
    promotionEligible: true,
  }
}

function validSignal(
  value: unknown,
): ComponentAdmissionResult<SignalPayload> {
  const record = value as Record<string, unknown>
  if (
    record
    && Number.isSafeInteger(record.seat)
    && Number.isSafeInteger(record.proposal)
  ) {
    return exact({
      seat: record.seat as number,
      proposal: record.proposal as number,
    })
  }
  return {
    admitted: false,
    degradationCode: 'invalid-signal',
  }
}

function fixture(): {
  request: DecisionRequest
  view: PlayerView
} {
  const entry = readDecisionFixtures()[0]
  return {
    request: structuredClone(entry.req),
    view: structuredClone(entry.view),
  }
}

interface DefinitionOptions<Payload> {
  token: ComponentToken<Payload>
  dependencies?: readonly ComponentRef[]
  requiredHostInputs?: readonly ComponentHostInputRef[]
  hostRequirements?: readonly string[]
  maxPayloadBytes?: number
  applies?: (
    context: DecisionComponentApplicabilityContext,
  ) => ComponentApplicability
  execute: (
    context: DecisionComponentContext,
  ) => ComponentExecutionResult<Payload>
    | Promise<ComponentExecutionResult<Payload>>
  validateDetached?: (
    payload: unknown,
  ) => ComponentAdmissionResult<Payload>
  admitSuppressed?:
    DecisionComponentDefinition<Payload>['admitSuppressed']
  admitHost?: DecisionComponentDefinition<Payload>['admitHost']
}

function definition<Payload>(
  options: DefinitionOptions<Payload>,
): DecisionComponentDefinition<Payload> {
  return {
    token: options.token,
    source: 'native',
    dependencies: options.dependencies ?? [],
    requiredHostInputs: options.requiredHostInputs ?? [],
    hostRequirements: options.hostRequirements ?? [],
    maxPayloadBytes: options.maxPayloadBytes ?? 512,
    degradationCode: `${options.token.id.replaceAll('.', '-')}-failed`,
    applies: options.applies ?? (() => true),
    execute: options.execute,
    validateDetached: options.validateDetached ?? (
      (payload) => exact(payload as Payload)
    ),
    ...(options.admitSuppressed
      ? { admitSuppressed: options.admitSuppressed }
      : {}),
    admitHost: options.admitHost ?? (
      ({ payload }) => exact(payload)
    ),
  }
}

function resolve(
  definitions: readonly DecisionComponentDefinition<any>[],
  requested: readonly ComponentRef[],
  hostCapabilities: readonly string[] = [],
  hostInputs: readonly ComponentHostInputDefinition<any>[] = [],
) {
  return resolveComposedBrain({
    requestedComponents: requested,
    hostCapabilities,
    configuredPipeline: testConfiguredPipeline(),
  }, createDecisionComponentRegistry(definitions, { hostInputs }))
}

function requirePrivateContext(
  context: DecisionComponentContext,
): asserts context is Extract<
  DecisionComponentContext,
  { privacy: 'private' }
> {
  assert.equal(context.privacy, 'private')
}

test('kernel executes the native graph dependency-first and admits typed payloads', async () => {
  const order: string[] = []
  const signal = definition({
    token: SIGNAL_TOKEN,
    async execute(context) {
      requirePrivateContext(context)
      order.push('signal')
      await Promise.resolve()
      return {
        status: 'produced',
        envelope: componentEnvelope(SIGNAL_TOKEN, {
          seat: context.request.seat,
          proposal: context.view.proposalNum,
        }),
      }
    },
    validateDetached: validSignal,
  })
  const projection = definition({
    token: PROJECTION_TOKEN,
    dependencies: [SIGNAL_TOKEN],
    execute(context) {
      requirePrivateContext(context)
      order.push('projection')
      const source = context.dependencies.require(SIGNAL_TOKEN)
      return {
        status: 'produced',
        envelope: componentEnvelope(PROJECTION_TOKEN, {
          sourceSeat: source.seat,
          decisionKind: context.request.kind,
        }),
      }
    },
  })
  const brain = resolve(
    [projection, signal],
    [PROJECTION_TOKEN],
  )
  const { request, view } = fixture()
  view.currentTeam = undefined
  const run = await runDecisionComponents(brain, request, view)

  assert.deepEqual(order, ['signal', 'projection'])
  assert.deepEqual(
    run.configured.map((entry) => entry.id),
    ['context.signal', 'context.projection'],
  )
  assert.deepEqual(
    run.entries.map((entry) => entry.status),
    ['admitted', 'admitted'],
  )
  assert.deepEqual(componentPayload(run, SIGNAL_TOKEN), {
    proposal: view.proposalNum,
    seat: request.seat,
  })
  assert.deepEqual(componentPayload(run, PROJECTION_TOKEN), {
    decisionKind: request.kind,
    sourceSeat: request.seat,
  })
  assert.ok(Object.isFrozen(run))
  assert.ok(Object.isFrozen(run.entries))
  assert.ok(Object.isFrozen(
    componentPayload(run, PROJECTION_TOKEN) as object,
  ))
  assert.deepEqual(run.policyUse, [
    {
      component: { id: 'context.signal', version: 'v1' },
      used: false,
      stages: [],
    },
    {
      component: { id: 'context.projection', version: 'v1' },
      used: false,
      stages: [],
    },
  ])

  const attributed = attributeComponentPolicyUse(
    run,
    PROJECTION_TOKEN,
    'candidate-score',
  )
  assert.equal(run.policyUse[1].used, false)
  assert.deepEqual(attributed.policyUse[1], {
    component: {
      id: 'context.projection',
      version: 'v1',
    },
    used: true,
    stages: ['candidate-score'],
  })
  const selected = attributeComponentPolicyUse(
    attributed,
    PROJECTION_TOKEN,
    'action-selection',
  )
  assert.deepEqual(selected.policyUse[1].stages, [
    'candidate-score',
    'action-selection',
  ])
})

test('all generic statuses stay distinct from causal policy use', async () => {
  let shouldNotExecute = 0
  const admittedToken: ComponentToken<{ value: number }> = {
    id: 'status.admitted',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  const inapplicableToken: ComponentToken<null> = {
    id: 'status.inapplicable',
    version: 'v1',
    kind: 'observer',
    privacy: 'public',
  }
  const suppressedToken: ComponentToken<null> = {
    id: 'status.suppressed',
    version: 'v1',
    kind: 'decision-rule',
    privacy: 'private',
  }
  const degradedToken: ComponentToken<null> = {
    id: 'status.degraded',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const definitions = [
    definition({
      token: admittedToken,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(admittedToken, { value: 7 }),
      }),
    }),
    definition({
      token: inapplicableToken,
      applies: () => false,
      execute() {
        shouldNotExecute++
        return {
          status: 'produced',
          envelope: componentEnvelope(inapplicableToken, null),
        }
      },
    }),
    definition({
      token: suppressedToken,
      applies: () => ({
        status: 'suppressed',
        reasonCode: 'forced-action',
      }),
      execute() {
        shouldNotExecute++
        return {
          status: 'produced',
          envelope: componentEnvelope(suppressedToken, null),
        }
      },
    }),
    definition({
      token: degradedToken,
      hostRequirements: ['missing-capability'],
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(degradedToken, null),
      }),
    }),
  ]
  const brain = resolve(definitions, definitions.map(
    (entry) => entry.token,
  ))
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  const byId = Object.fromEntries(run.entries.map(
    (entry) => [entry.component.id, entry],
  ))

  assert.equal(byId['status.admitted'].status, 'admitted')
  assert.equal(byId['status.inapplicable'].status, 'inapplicable')
  assert.deepEqual(byId['status.suppressed'], {
    component: { id: 'status.suppressed', version: 'v1' },
    kind: 'decision-rule',
    privacy: 'private',
    status: 'suppressed',
    reasonCode: 'forced-action',
  })
  assert.deepEqual(byId['status.degraded'], {
    component: { id: 'status.degraded', version: 'v1' },
    kind: 'projection',
    privacy: 'private',
    status: 'degraded',
    degradationCode: 'status-degraded-failed',
    failureCode: 'construction-ineligible',
  })
  assert.equal(shouldNotExecute, 0)
  assert.ok(run.policyUse.every((entry) => entry.used === false))
  assert.throws(
    () => attributeComponentPolicyUse(
      run,
      suppressedToken,
      'decision-rule',
    ),
    /unadmitted component/,
  )
})

test('dependency failure degrades dependents without executing them', async () => {
  const sourceToken: ComponentToken<null> = {
    id: 'dependency.source',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const consumerToken: ComponentToken<null> = {
    id: 'dependency.consumer',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  let consumerExecutions = 0
  const brain = resolve([
    definition({
      token: sourceToken,
      execute() {
        throw new Error('private implementation detail')
      },
    }),
    definition({
      token: consumerToken,
      dependencies: [sourceToken],
      execute() {
        consumerExecutions++
        return {
          status: 'produced',
          envelope: componentEnvelope(consumerToken, null),
        }
      },
    }),
  ], [consumerToken])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)

  assert.deepEqual(
    run.entries.map((entry) =>
      entry.status === 'degraded'
        ? entry.failureCode
        : entry.status),
    ['execution-failed', 'dependency-unavailable'],
  )
  assert.equal(consumerExecutions, 0)
  assert.doesNotMatch(JSON.stringify(run), /private implementation detail/)
})

test('own applicability is decided before dependency availability', async () => {
  const sourceToken: ComponentToken<null> = {
    id: 'applicability.source',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const irrelevantToken: ComponentToken<null> = {
    id: 'applicability.irrelevant-role',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  let applicabilityChecks = 0
  let executions = 0
  const brain = resolve([
    definition({
      token: sourceToken,
      execute() {
        throw new Error('dependency unavailable')
      },
    }),
    definition({
      token: irrelevantToken,
      dependencies: [sourceToken],
      applies(context) {
        applicabilityChecks++
        assert.equal(Object.hasOwn(context, 'dependencies'), false)
        return false
      },
      execute() {
        executions++
        return {
          status: 'produced',
          envelope: componentEnvelope(irrelevantToken, null),
        }
      },
    }),
  ], [irrelevantToken])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)

  assert.equal(applicabilityChecks, 1)
  assert.equal(executions, 0)
  assert.equal(run.entries[0].status, 'degraded')
  assert.equal(run.entries[1].status, 'inapplicable')
})

test('applicability precedes construction eligibility for every graph entry', async () => {
  const unavailableToken: ComponentToken<null> = {
    id: 'applicability.construction-source',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const irrelevantToken: ComponentToken<null> = {
    id: 'applicability.construction-dependent',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  const checks: string[] = []
  const brain = resolve([
    definition({
      token: unavailableToken,
      hostRequirements: ['unavailable-capability'],
      applies() {
        checks.push('source')
        return false
      },
      execute: () => assert.fail('inapplicable source executed'),
    }),
    definition({
      token: irrelevantToken,
      dependencies: [unavailableToken],
      applies() {
        checks.push('dependent')
        return false
      },
      execute: () => assert.fail('inapplicable dependent executed'),
    }),
  ], [irrelevantToken])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)

  assert.deepEqual(checks, ['source', 'dependent'])
  assert.deepEqual(
    run.entries.map((entry) => entry.status),
    ['inapplicable', 'inapplicable'],
  )
})

test('invocation-local roots are typed, declared, bounded, and never serialized', async () => {
  const token: ComponentToken<{ seedLength: number }> = {
    id: 'host-root.consumer',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  let applicabilityContext: unknown
  let admissionContext: unknown
  const component = definition({
    token,
    requiredHostInputs: [SEED_INPUT],
    applies(context) {
      applicabilityContext = context
      return true
    },
    execute(context) {
      requirePrivateContext(context)
      const seed = context.hostInputs.require(SEED_INPUT)
      return {
        status: 'produced',
        envelope: componentEnvelope(token, {
          seedLength: seed.seed.length,
        }),
      }
    },
    admitHost({ payload, host }) {
      admissionContext = host
      assert.deepEqual(
        host.hostInputs.require(SEED_INPUT),
        { seed: 'private-root-value' },
      )
      return exact(payload)
    },
  })
  const brain = resolve(
    [component],
    [token],
    [],
    [SEED_INPUT_DEFINITION],
  )
  const { request, view } = fixture()
  const binding: ComponentHostInputBinding<{ seed: string }> = {
    input: SEED_INPUT,
    value: { seed: 'private-root-value' },
  }
  const run = await runDecisionComponents(
    brain,
    request,
    view,
    { hostInputs: [binding] },
  )

  assert.deepEqual(componentPayload(run, token), { seedLength: 18 })
  assert.equal(
    Object.hasOwn(applicabilityContext as object, 'hostInputs'),
    false,
  )
  assert.ok(Object.hasOwn(admissionContext as object, 'hostInputs'))
  assert.deepEqual(brain.description.requiredHostInputs, [{
    id: SEED_INPUT.id,
    version: SEED_INPUT.version,
    privacy: SEED_INPUT.privacy,
  }])
  assert.ok(Object.isFrozen(brain.description.requiredHostInputs))
  assert.equal(brain.hostInputDefinitions.length, 1)
  assert.doesNotMatch(
    JSON.stringify(run),
    /runtime\.seed|private-root-value|hostInputs/,
  )
  assert.deepEqual(
    run.configured,
    [{ id: token.id, version: token.version }],
  )
  assert.equal(run.policyUse.length, 1)
})

test('missing or invalid roots degrade only applicable consumers', async () => {
  const rootConsumer: ComponentToken<null> = {
    id: 'host-root.required',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const unrelated: ComponentToken<null> = {
    id: 'host-root.unrelated',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const irrelevant: ComponentToken<null> = {
    id: 'host-root.irrelevant',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  let executions = 0
  const brain = resolve([
    definition({
      token: rootConsumer,
      requiredHostInputs: [SEED_INPUT],
      execute() {
        executions++
        return {
          status: 'produced',
          envelope: componentEnvelope(rootConsumer, null),
        }
      },
    }),
    definition({
      token: unrelated,
      execute() {
        executions++
        return {
          status: 'produced',
          envelope: componentEnvelope(unrelated, null),
        }
      },
    }),
    definition({
      token: irrelevant,
      requiredHostInputs: [SEED_INPUT],
      applies: () => false,
      execute: () => assert.fail('irrelevant component executed'),
    }),
  ], [rootConsumer, unrelated, irrelevant], [], [
    SEED_INPUT_DEFINITION,
  ])
  const { request, view } = fixture()
  for (const candidate of [
    {
      hostInputs: undefined,
      failureCode: 'host-input-unavailable',
    },
    {
      hostInputs: [{
        input: SEED_INPUT,
        value: { seed: 42 },
      }] as unknown as ComponentHostInputBinding<unknown>[],
      failureCode: 'host-input-invalid',
    },
  ] as const) {
    executions = 0
    const run = await runDecisionComponents(
      brain,
      request,
      view,
      candidate.hostInputs === undefined
        ? undefined
        : { hostInputs: candidate.hostInputs },
    )
    const byId = Object.fromEntries(
      run.entries.map((entry) => [entry.component.id, entry]),
    )
    assert.equal(
      byId[rootConsumer.id].status === 'degraded'
        ? byId[rootConsumer.id].failureCode
        : undefined,
      candidate.failureCode,
    )
    assert.equal(byId[unrelated.id].status, 'admitted')
    assert.equal(byId[irrelevant.id].status, 'inapplicable')
    assert.equal(executions, 1)
  }
})

test('trusted root providers stay dormant before execution eligibility', async () => {
  const cases = [
    {
      id: 'lazy-root.inapplicable',
      applies: () => false as ComponentApplicability,
      hostRequirements: [] as string[],
      dependencies: [] as ComponentRef[],
      failingDependency: false,
      expected: 'inapplicable',
    },
    {
      id: 'lazy-root.suppressed',
      applies: () => ({
        status: 'suppressed' as const,
        reasonCode: 'already-decided',
      }),
      hostRequirements: [] as string[],
      dependencies: [] as ComponentRef[],
      failingDependency: false,
      expected: 'suppressed',
    },
    {
      id: 'lazy-root.construction-ineligible',
      applies: () => true as ComponentApplicability,
      hostRequirements: ['missing-capability'],
      dependencies: [] as ComponentRef[],
      failingDependency: false,
      expected: 'construction-ineligible',
    },
    {
      id: 'lazy-root.dependency-degraded',
      applies: () => true as ComponentApplicability,
      hostRequirements: [] as string[],
      dependencies: [SIGNAL_TOKEN] as ComponentRef[],
      failingDependency: true,
      expected: 'dependency-unavailable',
    },
  ] as const
  const { request, view } = fixture()

  for (const candidate of cases) {
    let providerCalls = 0
    const token: ComponentToken<null> = {
      id: candidate.id,
      version: 'v1',
      kind: 'projection',
      privacy: 'private',
    }
    const consumer = definition({
      token,
      requiredHostInputs: [SEED_INPUT],
      dependencies: candidate.dependencies,
      hostRequirements: candidate.hostRequirements,
      applies: candidate.applies,
      execute: () => assert.fail('ineligible component executed'),
    })
    const definitions = candidate.failingDependency
      ? [
          definition({
            token: SIGNAL_TOKEN,
            execute() {
              throw new Error('expected dependency failure')
            },
          }),
          consumer,
        ]
      : [consumer]
    const brain = resolve(
      definitions,
      [token],
      [],
      [SEED_INPUT_DEFINITION],
    )
    const run = await runDecisionComponents(
      brain,
      request,
      view,
      undefined,
      {
        providers: [{
          input: SEED_INPUT,
          provide() {
            providerCalls++
            return { seed: 'must-stay-unread' }
          },
        }],
      },
    )

    assert.equal(providerCalls, 0, candidate.id)
    const entry = run.entries.at(-1)!
    assert.equal(
      entry.status === 'degraded'
        ? entry.failureCode
        : entry.status,
      candidate.expected,
      candidate.id,
    )
  }
})

test('trusted roots resolve once and preserve unavailable before invalid', async () => {
  const otherInput: ComponentHostInputToken<{ label: string }> = {
    id: 'runtime.other-root',
    version: 'v1',
    privacy: 'private',
  }
  const otherDefinition = hostInputDefinition(
    otherInput,
    (value) => {
      const record = value as Record<string, unknown>
      return record
        && typeof record.label === 'string'
        && Object.keys(record).length === 1
        ? { valid: true, value: { label: record.label } }
        : { valid: false, degradationCode: 'invalid-other-root' }
    },
  )
  const firstToken: ComponentToken<{ seed: string }> = {
    id: 'lazy-root.first-consumer',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const secondToken: ComponentToken<{ seed: string }> = {
    id: 'lazy-root.second-consumer',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const consumers = [firstToken, secondToken].map((token) =>
    definition({
      token,
      requiredHostInputs: [SEED_INPUT],
      execute(context) {
        return {
          status: 'produced',
          envelope: componentEnvelope(token, {
            seed: context.hostInputs.require(SEED_INPUT).seed,
          }),
        }
      },
    }))
  let validationCalls = 0
  const countingSeedDefinition = hostInputDefinition(
    SEED_INPUT,
    (value) => {
      validationCalls++
      return SEED_INPUT_DEFINITION.validate(value)
    },
  )
  const sharedBrain = resolve(
    consumers,
    consumers.map((component) => component.token),
    [],
    [countingSeedDefinition],
  )
  const { request, view } = fixture()
  let sharedCalls = 0
  const shared = await runDecisionComponents(
    sharedBrain,
    request,
    view,
    undefined,
    {
      providers: [{
        input: SEED_INPUT,
        provide() {
          sharedCalls++
          return { seed: 'shared' }
        },
      }],
    },
  )
  assert.equal(sharedCalls, 1)
  assert.equal(validationCalls, 1)
  assert.deepEqual(
    shared.entries.map((entry) => entry.status),
    ['admitted', 'admitted'],
  )

  let throwingCalls = 0
  const throwing = await runDecisionComponents(
    sharedBrain,
    request,
    view,
    undefined,
    {
      providers: [{
        input: SEED_INPUT,
        provide() {
          throwingCalls++
          throw new Error('private provider failure')
        },
      }],
    },
  )
  assert.equal(throwingCalls, 1)
  assert.deepEqual(
    throwing.entries.map((entry) =>
      entry.status === 'degraded'
        ? entry.failureCode
        : entry.status),
    ['host-input-invalid', 'host-input-invalid'],
  )
  assert.doesNotMatch(JSON.stringify(throwing), /private provider failure/)

  let undefinedCalls = 0
  const unavailable = await runDecisionComponents(
    sharedBrain,
    request,
    view,
    undefined,
    {
      providers: [{
        input: SEED_INPUT,
        provide() {
          undefinedCalls++
          return undefined
        },
      }],
    },
  )
  assert.equal(undefinedCalls, 1)
  assert.deepEqual(
    unavailable.entries.map((entry) =>
      entry.status === 'degraded'
        ? entry.failureCode
        : entry.status),
    ['host-input-unavailable', 'host-input-unavailable'],
  )

  const precedenceToken: ComponentToken<null> = {
    id: 'lazy-root.precedence',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const precedenceBrain = resolve([
    definition({
      token: precedenceToken,
      requiredHostInputs: [SEED_INPUT, otherInput],
      execute: () => assert.fail('unavailable roots reached execution'),
    }),
  ], [precedenceToken], [], [
    SEED_INPUT_DEFINITION,
    otherDefinition,
  ])
  let missingCalls = 0
  let invalidCalls = 0
  const precedence = await runDecisionComponents(
    precedenceBrain,
    request,
    view,
    undefined,
    {
      providers: [
        {
          input: SEED_INPUT,
          provide() {
            missingCalls++
            return undefined
          },
        },
        {
          input: otherInput,
          provide() {
            invalidCalls++
            throw new Error('private provider failure')
          },
        },
      ],
    },
  )
  assert.equal(missingCalls, 1)
  assert.equal(invalidCalls, 1)
  assert.equal(
    precedence.entries[0].status === 'degraded'
      ? precedence.entries[0].failureCode
      : undefined,
    'host-input-unavailable',
  )
  assert.doesNotMatch(
    JSON.stringify(precedence),
    /private provider failure/,
  )
})

test('trusted and detached root bindings produce the same exact run', async () => {
  const token: ComponentToken<{ seed: string }> = {
    id: 'lazy-root.detached-equivalence',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const component = definition({
    token,
    requiredHostInputs: [SEED_INPUT],
    execute(context) {
      return {
        status: 'produced',
        envelope: componentEnvelope(token, {
          seed: context.hostInputs.require(SEED_INPUT).seed,
        }),
      }
    },
  })
  const brain = resolve(
    [component],
    [token],
    [],
    [SEED_INPUT_DEFINITION],
  )
  const { request, view } = fixture()
  const detached = await runDecisionComponents(
    brain,
    request,
    view,
    {
      hostInputs: [{
        input: SEED_INPUT,
        value: { seed: 'same-root' },
      }],
    },
  )
  let calls = 0
  const provider:
  DecisionComponentTrustedHostInputProvider<unknown> = {
    input: SEED_INPUT,
    provide() {
      calls++
      return { seed: 'same-root' }
    },
  }
  const trusted = await runDecisionComponents(
    brain,
    request,
    view,
    undefined,
    { providers: [provider] },
  )

  assert.equal(calls, 1)
  assert.deepEqual(trusted, detached)
  assert.equal(JSON.stringify(trusted), JSON.stringify(detached))
  assert.doesNotMatch(JSON.stringify(trusted), /provide|runtime\.seed/)
})

test('host join does not inspect roots of inapplicable components', async () => {
  const token: ComponentToken<null> = {
    id: 'lazy-root.unused-host-join',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const component = definition({
    token,
    requiredHostInputs: [SEED_INPUT],
    applies: () => false,
    execute: () => assert.fail('inapplicable component executed'),
  })
  const registry = createDecisionComponentRegistry(
    [component],
    { hostInputs: [SEED_INPUT_DEFINITION] },
  )
  const brain = resolve(
    [component],
    [token],
    [],
    [SEED_INPUT_DEFINITION],
  )
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  const hostileUnusedValue = Object.create(null)
  Object.defineProperty(hostileUnusedValue, 'seed', {
    enumerable: true,
    get() {
      throw new Error('unused root was inspected')
    },
  })

  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
    hostInputs: [{
      input: SEED_INPUT,
      value: hostileUnusedValue,
    }],
  }), true)
})

test('host-input readers reject undeclared and tag-substituted lookup', async () => {
  const token: ComponentToken<null> = {
    id: 'host-root.lookup-contract',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const undeclared: ComponentHostInputToken<null> = {
    id: 'runtime.undeclared',
    version: 'v1',
    privacy: 'private',
  }
  const substituted: ComponentHostInputToken<{ seed: string }> = {
    ...SEED_INPUT,
    privacy: 'public',
  }
  for (const lookup of [
    (context: DecisionComponentContext) =>
      context.hostInputs.require(undeclared),
    (context: DecisionComponentContext) =>
      context.hostInputs.require(substituted),
  ]) {
    const brain = resolve([
      definition({
        token,
        requiredHostInputs: [SEED_INPUT],
        execute(context) {
          lookup(context)
          return {
            status: 'produced',
            envelope: componentEnvelope(token, null),
          }
        },
      }),
    ], [token], [], [SEED_INPUT_DEFINITION])
    const { request, view } = fixture()
    const run = await runDecisionComponents(
      brain,
      request,
      view,
      {
        hostInputs: [{
          input: SEED_INPUT,
          value: { seed: 'root-value' },
        }],
      },
    )
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'execution-failed',
    )
  }
})

test('undeclared or incorrectly typed dependency lookup fails closed', async () => {
  const source = definition({
    token: SIGNAL_TOKEN,
    execute: () => ({
      status: 'produced',
      envelope: componentEnvelope(SIGNAL_TOKEN, {
        seat: 1,
        proposal: 1,
      }),
    }),
    validateDetached: validSignal,
  })
  const incorrectlyTypedToken: ComponentToken<SignalPayload> = {
    ...SIGNAL_TOKEN,
    kind: 'objective',
  }
  const consumerToken: ComponentToken<null> = {
    id: 'lookup.consumer',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  for (const candidate of [
    {
      dependencies: [SIGNAL_TOKEN],
      lookup: (context: DecisionComponentContext) =>
        context.dependencies.require(incorrectlyTypedToken),
    },
    {
      dependencies: [] as ComponentRef[],
      lookup: (context: DecisionComponentContext) =>
        context.dependencies.require(SIGNAL_TOKEN),
    },
  ]) {
    const consumer = definition({
      token: consumerToken,
      dependencies: candidate.dependencies,
      execute(context) {
        candidate.lookup(context)
        return {
          status: 'produced',
          envelope: componentEnvelope(consumerToken, null),
        }
      },
    })
    const brain = resolve([source, consumer], [consumerToken])
    const { request, view } = fixture()
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(run.entries.at(-1)?.status, 'degraded')
    assert.equal(
      run.entries.at(-1)?.status === 'degraded'
        ? run.entries.at(-1)?.failureCode
        : undefined,
      'execution-failed',
    )
  }
})

test('malformed execution and explicit execution suppression fail closed', async () => {
  const malformedToken: ComponentToken<null> = {
    id: 'result.malformed',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const suppressedToken: ComponentToken<null> = {
    id: 'result.suppressed',
    version: 'v1',
    kind: 'decision-rule',
    privacy: 'private',
  }
  const malformed = definition({
    token: malformedToken,
    execute: (() => ({ payload: null })) as never,
  })
  const suppressed = definition({
    token: suppressedToken,
    execute: () => ({
      status: 'suppressed',
      reasonCode: 'no-discretion',
    }),
  })
  const brain = resolve(
    [malformed, suppressed],
    [malformedToken, suppressedToken],
  )
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  assert.equal(run.entries[0].status, 'degraded')
  assert.equal(
    run.entries[0].status === 'degraded'
      ? run.entries[0].failureCode
      : undefined,
    'malformed-result',
  )
  assert.deepEqual(run.entries[1], {
    component: { id: 'result.suppressed', version: 'v1' },
    kind: 'decision-rule',
    privacy: 'private',
    status: 'suppressed',
    reasonCode: 'no-discretion',
  })
})

test('tag substitutions are rejected before payload admission', async () => {
  const substitutions = [
    {
      component: { id: 'changed', version: 'v1' },
      kind: SIGNAL_TOKEN.kind,
      privacy: SIGNAL_TOKEN.privacy,
    },
    {
      component: { id: SIGNAL_TOKEN.id, version: 'v2' },
      kind: SIGNAL_TOKEN.kind,
      privacy: SIGNAL_TOKEN.privacy,
    },
    {
      component: { id: SIGNAL_TOKEN.id, version: SIGNAL_TOKEN.version },
      kind: 'objective',
      privacy: SIGNAL_TOKEN.privacy,
    },
    {
      component: { id: SIGNAL_TOKEN.id, version: SIGNAL_TOKEN.version },
      kind: SIGNAL_TOKEN.kind,
      privacy: 'public',
    },
  ] as const
  for (const tags of substitutions) {
    let admissionCalls = 0
    const source = definition({
      token: SIGNAL_TOKEN,
      execute: () => ({
        status: 'produced',
        envelope: {
          ...tags,
          payload: { seat: 1, proposal: 1 },
        } as never,
      }),
      validateDetached(payload) {
        admissionCalls++
        return validSignal(payload)
      },
    })
    const brain = resolve([source], [SIGNAL_TOKEN])
    const { request, view } = fixture()
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(run.entries[0].status, 'degraded')
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'tag-mismatch',
    )
    assert.equal(admissionCalls, 0)
  }
})

test('oversized, cyclic, non-cloneable, and malformed payloads degrade safely', async () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const arrayPrototypeObject = Object.assign(
    Object.create(Array.prototype),
    { value: 1 },
  )
  const cases: readonly {
    id: string
    payload: unknown
    expected: 'payload-json-unsafe' | 'payload-too-large'
  }[] = [
    {
      id: 'unsafe.cyclic',
      payload: cyclic,
      expected: 'payload-json-unsafe',
    },
    {
      id: 'unsafe.function',
      payload: { callback: () => 1 },
      expected: 'payload-json-unsafe',
    },
    {
      id: 'unsafe.nan',
      payload: { value: Number.NaN },
      expected: 'payload-json-unsafe',
    },
    {
      id: 'unsafe.proxy',
      payload: new Proxy({ value: 1 }, {}),
      expected: 'payload-json-unsafe',
    },
    {
      id: 'unsafe.array-prototype-object',
      payload: arrayPrototypeObject,
      expected: 'payload-json-unsafe',
    },
    {
      id: 'unsafe.large',
      payload: { value: 'x'.repeat(200) },
      expected: 'payload-too-large',
    },
  ]
  for (const candidate of cases) {
    const token: ComponentToken<unknown> = {
      id: candidate.id,
      version: 'v1',
      kind: 'observer',
      privacy: 'private',
    }
    const brain = resolve([
      definition({
        token,
        maxPayloadBytes: 48,
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(token, candidate.payload),
        }),
      }),
    ], [token])
    const { request, view } = fixture()
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      candidate.expected,
      candidate.id,
    )
    assert.equal(componentPayload(run, token), undefined)
  }

  const malformedToken: ComponentToken<{ value: number }> = {
    id: 'unsafe.malformed',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const malformedBrain = resolve([
    definition({
      token: malformedToken,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(malformedToken, { value: 1 }),
      }),
      validateDetached: () => ({
        admitted: false,
        degradationCode: 'schema-rejected',
      }),
    }),
  ], [malformedToken])
  const { request, view } = fixture()
  const malformed = await runDecisionComponents(
    malformedBrain,
    request,
    view,
  )
  assert.deepEqual(malformed.entries[0], {
    component: { id: 'unsafe.malformed', version: 'v1' },
    kind: 'observer',
    privacy: 'private',
    status: 'degraded',
    degradationCode: 'schema-rejected',
    failureCode: 'detached-validation-failed',
  })
})

test('normalization is rebound, rechecked, and bounded at both admission stages', async () => {
  const token: ComponentToken<{ value: string }> = {
    id: 'admission.normalized',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const brain = resolve([
    definition({
      token,
      maxPayloadBytes: 64,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(token, { value: 'raw' }),
      }),
      validateDetached: () => ({
        admitted: true,
        payload: { value: 'normalized' },
        verification: 'structural',
        promotionEligible: true,
      }),
      admitHost: ({ payload }) => ({
        admitted: true,
        payload: { value: `${payload.value}-host` },
        verification: 'structural',
        promotionEligible: true,
      }),
    }),
  ], [token])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  assert.equal(run.entries[0].status, 'admitted')
  assert.deepEqual(componentPayload(run, token), {
    value: 'normalized-host',
  })
  assert.equal(
    run.entries[0].status === 'admitted'
      ? run.entries[0].verification
      : undefined,
    'structural',
  )
  assert.equal(
    run.entries[0].status === 'admitted'
      ? run.entries[0].promotionEligible
      : undefined,
    false,
  )
})

test('private components are absent from every public projection surface', async () => {
  const privateToken: ComponentToken<{ secret: string }> = {
    id: 'role.merlin.private-objective',
    version: 'v1',
    kind: 'objective',
    privacy: 'private',
  }
  const publicToken: ComponentToken<{ label: string }> = {
    id: 'privacy.public',
    version: 'v1',
    kind: 'observer',
    privacy: 'public',
  }
  const brain = resolve([
    definition({
      token: privateToken,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(privateToken, {
          secret: 'never-copy-this-private-value',
        }),
      }),
    }),
    definition({
      token: publicToken,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(publicToken, {
          label: 'public-observation',
        }),
      }),
    }),
  ], [privateToken, publicToken])
  const { request, view } = fixture()
  const privateRun = await runDecisionComponents(
    brain,
    request,
    view,
  )
  const attributed = attributeComponentPolicyUse(
    privateRun,
    privateToken,
    'role-objective',
  )
  const publicRun = publicDecisionComponentRun(attributed)
  const rendered = JSON.stringify({
    speechContext: publicRun,
    publicLog: publicRun,
  })

  assert.match(JSON.stringify(privateRun), /never-copy-this-private-value/)
  assert.doesNotMatch(rendered, /never-copy-this-private-value/)
  assert.doesNotMatch(rendered, /merlin|private-objective|role-objective/i)
  assert.match(rendered, /public-observation/)
  const privateEntry = publicRun.entries.find(
    (entry) => entry.component.id === privateToken.id,
  )
  assert.equal(privateEntry, undefined)
  assert.deepEqual(publicRun.configured, [{
    id: publicToken.id,
    version: publicToken.version,
  }])
  assert.deepEqual(publicRun.policyUse, [])

  const attributedPublic = attributeComponentPolicyUse(
    privateRun,
    publicToken,
    'merlin-cover',
  )
  const publicAfterPrivateUse =
    publicDecisionComponentRun(attributedPublic)
  assert.deepEqual(publicAfterPrivateUse.policyUse, [])
  assert.doesNotMatch(
    JSON.stringify(publicAfterPrivateUse),
    /merlin-cover/,
  )
})

test('v1 roots are private-only and cannot feed public components', () => {
  const publicToken: ComponentToken<null> = {
    id: 'privacy.public-root-consumer',
    version: 'v1',
    kind: 'observer',
    privacy: 'public',
  }
  assert.throws(
    () => createDecisionComponentRegistry([
      definition({
        token: publicToken,
        requiredHostInputs: [SEED_INPUT],
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(publicToken, null),
        }),
      }),
    ], {
      hostInputs: [SEED_INPUT_DEFINITION],
    }),
    /public component .* cannot require private host input/,
  )

  const wouldBePublicDefinition = hostInputDefinition(
    PUBLIC_SIGNAL_INPUT,
    (value) => {
      const record = value as Record<string, unknown>
      return record && Array.isArray(record.knownEvil)
        ? {
            valid: true,
            value: { label: record.knownEvil.join(',') },
          }
        : {
            valid: false,
            degradationCode: 'invalid-public-signal',
          }
    },
  )
  assert.throws(
    () => createDecisionComponentRegistry([
      definition({
        token: publicToken,
        requiredHostInputs: [PUBLIC_SIGNAL_INPUT],
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(publicToken, null),
        }),
      }),
    ], {
      hostInputs: [wouldBePublicDefinition],
    }),
    /cannot be a public host input/,
  )
})

test('public components receive only projected public context', async () => {
  const token: ComponentToken<{ kind: string; proposal: number }> = {
    id: 'privacy.public-context',
    version: 'v1',
    kind: 'observer',
    privacy: 'public',
  }
  let applicabilityContext: unknown
  let executionContext: unknown
  let hostContext: unknown
  const brain = resolve([
    definition({
      token,
      applies(context) {
        applicabilityContext = context
        return true
      },
      execute(context) {
        executionContext = context
        if (context.privacy !== 'public') {
          assert.fail('public component received private context')
        }
        return {
          status: 'produced',
          envelope: componentEnvelope(token, {
            kind: context.decision.kind,
            proposal: context.publicRecord.proposalNum,
          }),
        }
      },
      admitHost: ({ payload, host }) => {
        hostContext = host
        return exact(payload)
      },
    }),
  ], [token])
  const { request, view } = fixture()
  request.seat = 991
  view.seat = 997
  view.privateInfo = { kind: 'merlin', knownEvil: [998] }
  const run = await runDecisionComponents(brain, request, view)

  assert.equal(run.entries[0].status, 'admitted')
  assert.deepEqual(
    (applicabilityContext as { decision: unknown }).decision,
    { kind: request.kind },
  )
  assert.equal(
    Object.hasOwn(applicabilityContext as object, 'dependencies'),
    false,
  )
  for (const context of [applicabilityContext, executionContext, hostContext]) {
    const rendered = JSON.stringify(context)
    assert.doesNotMatch(rendered, /knownEvil|privateInfo|alignment|\"role\"/)
    assert.doesNotMatch(rendered, /991|997|998/)
    assert.equal(Object.hasOwn(context as object, 'request'), false)
    assert.equal(Object.hasOwn(context as object, 'view'), false)
  }
})

test('hostile results degrade at every untrusted result boundary', async () => {
  const hostileProxy = () => new Proxy({}, {
    ownKeys() {
      throw new Error('hostile ownKeys')
    },
  })
  const cases: readonly {
    id: string
    failureCode:
      | 'execution-failed'
      | 'malformed-result'
      | 'tag-mismatch'
      | 'detached-validation-failed'
      | 'host-admission-failed'
    execute: (
      token: ComponentToken<null>,
    ) => ComponentExecutionResult<null>
    validateDetached?: () => ComponentAdmissionResult<null>
    admitHost?: DecisionComponentDefinition<null>['admitHost']
  }[] = [
    {
      id: 'hostile.execution',
      failureCode: 'execution-failed',
      execute: (() => new Proxy({}, {
        get() {
          throw new Error('hostile status getter')
        },
      })) as never,
    },
    {
      id: 'hostile.envelope',
      failureCode: 'tag-mismatch',
      execute: (() => ({
        status: 'produced',
        envelope: hostileProxy(),
      })) as never,
    },
    {
      id: 'hostile.detached',
      failureCode: 'detached-validation-failed',
      execute: (token) => ({
        status: 'produced',
        envelope: componentEnvelope(token, null),
      }),
      validateDetached: (() => Object.defineProperty({}, 'admitted', {
        enumerable: true,
        get() {
          throw new Error('hostile admitted getter')
        },
      })) as never,
    },
    {
      id: 'hostile.host',
      failureCode: 'host-admission-failed',
      execute: (token) => ({
        status: 'produced',
        envelope: componentEnvelope(token, null),
      }),
      admitHost: (() => hostileProxy()) as never,
    },
  ]

  for (const candidate of cases) {
    const token: ComponentToken<null> = {
      id: candidate.id,
      version: 'v1',
      kind: 'observer',
      privacy: 'private',
    }
    const brain = resolve([
      definition({
        token,
        execute: () => candidate.execute(token),
        ...(candidate.validateDetached
          ? { validateDetached: candidate.validateDetached }
          : {}),
        ...(candidate.admitHost
          ? { admitHost: candidate.admitHost }
          : {}),
      }),
    ], [token])
    const { request, view } = fixture()
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(run.entries[0].status, 'degraded', candidate.id)
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      candidate.failureCode,
      candidate.id,
    )
  }
})

test('tagged and admission wrappers must be exact plain data records', async () => {
  const token: ComponentToken<null> = {
    id: 'hostile.structural-wrapper',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const envelope = componentEnvelope(token, null)
  const { request, view } = fixture()

  for (const wrapper of structurallyHostileRecords({
    status: 'produced',
    envelope,
  })) {
    const brain = resolve([
      definition({
        token,
        execute: (() => wrapper) as never,
      }),
    ], [token])
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'malformed-result',
    )
  }

  for (const hostileEnvelope of structurallyHostileRecords({
    component: { id: token.id, version: token.version },
    kind: token.kind,
    privacy: token.privacy,
    payload: null,
  })) {
    const brain = resolve([
      definition({
        token,
        execute: (() => ({
          status: 'produced',
          envelope: hostileEnvelope,
        })) as never,
      }),
    ], [token])
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'tag-mismatch',
    )
  }

  for (const admission of structurallyHostileRecords({
    admitted: true,
    payload: null,
    verification: 'exact',
    promotionEligible: true,
  })) {
    const brain = resolve([
      definition({
        token,
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(token, null),
        }),
        validateDetached: (() => admission) as never,
      }),
    ], [token])
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'detached-validation-failed',
    )
  }
})

test('strict JSON cloning preserves an own __proto__ key exactly', async () => {
  const token: ComponentToken<Record<string, unknown>> = {
    id: 'payload.proto-key',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const payload: Record<string, unknown> = { ordinary: 7 }
  Object.defineProperty(payload, '__proto__', {
    value: { nested: 'preserved' },
    enumerable: true,
    writable: true,
    configurable: true,
  })
  const brain = resolve([
    definition({
      token,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(token, payload),
      }),
      validateDetached: (value) => exact(
        value as Record<string, unknown>,
      ),
    }),
  ], [token])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  const admitted = componentPayload(run, token)!

  assert.equal(Object.getPrototypeOf(admitted), Object.prototype)
  assert.ok(Object.hasOwn(admitted, '__proto__'))
  assert.deepEqual(admitted, payload)
  assert.deepEqual(admitted.__proto__, { nested: 'preserved' })
})

test('exact admission cannot substitute a canonically different payload', async () => {
  const stages = ['detached', 'host'] as const
  for (const stage of stages) {
    const token: ComponentToken<{ value: string }> = {
      id: `exact-substitution.${stage}`,
      version: 'v1',
      kind: 'projection',
      privacy: 'private',
    }
    const brain = resolve([
      definition({
        token,
        execute: () => ({
          status: 'produced',
          envelope: componentEnvelope(token, { value: 'original' }),
        }),
        validateDetached: (payload) => exact(
          stage === 'detached'
            ? { value: 'substituted' }
            : payload as { value: string },
        ),
        admitHost: ({ payload }) => exact(
          stage === 'host'
            ? { value: 'substituted' }
            : payload,
        ),
      }),
    ], [token])
    const { request, view } = fixture()
    const run = await runDecisionComponents(brain, request, view)
    assert.equal(run.entries[0].status, 'degraded')
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      stage === 'detached'
        ? 'detached-validation-failed'
        : 'host-admission-failed',
    )
  }
})

test('native output projects through generic cognition, trace, transport, artifact, and evaluation shapes', async () => {
  const source = definition({
    token: SIGNAL_TOKEN,
    execute: (context) => {
      requirePrivateContext(context)
      return {
        status: 'produced',
        envelope: componentEnvelope(SIGNAL_TOKEN, {
          seat: context.request.seat,
          proposal: context.view.proposalNum,
        }),
      }
    },
    validateDetached: validSignal,
  })
  const brain = resolve([source], [SIGNAL_TOKEN])
  const { request, view } = fixture()
  const components = await runDecisionComponents(
    brain,
    request,
    view,
  )

  const cognition = { components }
  const trace = { components }
  const wire = JSON.parse(JSON.stringify({ components }))
  const artifact = {
    componentManifest: brain.description.components.configured.map(
      (component) => ({
        component,
        configured: true,
      }),
    ),
  }
  const evaluation = {
    componentStatuses: Object.fromEntries(
      components.entries.map((entry) => [
        `${entry.component.id}@${entry.component.version}`,
        entry.status,
      ]),
    ),
  }

  assert.deepEqual(wire, { components })
  assert.deepEqual(cognition.components, trace.components)
  assert.deepEqual(artifact, {
    componentManifest: [{
      component: { id: 'context.signal', version: 'v1' },
      configured: true,
    }],
  })
  assert.deepEqual(evaluation, {
    componentStatuses: {
      'context.signal@v1': 'admitted',
    },
  })
  const centralKeys = [
    ...Object.keys(cognition),
    ...Object.keys(trace),
    ...Object.keys(wire),
    ...Object.keys(artifact),
    ...Object.keys(evaluation),
  ]
  assert.deepEqual(centralKeys, [
    'components',
    'components',
    'components',
    'componentManifest',
    'componentStatuses',
  ])
  assert.doesNotMatch(
    centralKeys.join(' '),
    /merlin|percival|morgana|mordred|evil|signal/i,
  )
})

test('extra, duplicate, substituted, and malformed root bindings are programming errors', async () => {
  const token: ComponentToken<null> = {
    id: 'host-root.binding-contract',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const brain = resolve([
    definition({
      token,
      requiredHostInputs: [SEED_INPUT],
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(token, null),
      }),
    }),
  ], [token], [], [SEED_INPUT_DEFINITION])
  const { request, view } = fixture()
  const valid: ComponentHostInputBinding<unknown> = {
    input: SEED_INPUT,
    value: { seed: 'one' },
  }
  const cases: readonly {
    code: DecisionComponentInvocationError['code']
    bindings: readonly ComponentHostInputBinding<unknown>[]
  }[] = [
    {
      code: 'duplicate-host-input-binding',
      bindings: [valid, valid],
    },
    {
      code: 'host-input-tag-substitution',
      bindings: [{
        input: { ...SEED_INPUT, version: 'v2' },
        value: { seed: 'one' },
      }],
    },
    {
      code: 'host-input-tag-substitution',
      bindings: [{
        input: { ...SEED_INPUT, privacy: 'public' },
        value: { seed: 'one' },
      }],
    },
    {
      code: 'unknown-host-input-binding',
      bindings: [{
        input: {
          id: 'runtime.unknown',
          version: 'v1',
          privacy: 'private',
        },
        value: null,
      }],
    },
  ]
  for (const candidate of cases) {
    await assert.rejects(
      runDecisionComponents(
        brain,
        request,
        view,
        { hostInputs: candidate.bindings },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DecisionComponentInvocationError)
        assert.equal(error.code, candidate.code)
        return true
      },
    )
  }

  for (const malformed of structurallyHostileRecords({
    input: SEED_INPUT,
    value: { seed: 'one' },
  })) {
    await assert.rejects(
      runDecisionComponents(
        brain,
        request,
        view,
        {
          hostInputs: [
            malformed as ComponentHostInputBinding<unknown>,
          ],
        },
      ),
      (error: unknown) => {
        assert.ok(error instanceof DecisionComponentInvocationError)
        assert.equal(error.code, 'malformed-host-input-binding')
        return true
      },
    )
  }

  const empty = resolve([], [])
  await assert.rejects(
    runDecisionComponents(
      empty,
      request,
      view,
      { hostInputs: [valid] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof DecisionComponentInvocationError)
      assert.equal(error.code, 'unknown-host-input-binding')
      return true
    },
  )
})

test('malformed root validator wrappers fail closed without exposing values', async () => {
  const token: ComponentToken<null> = {
    id: 'host-root.validator-contract',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const { request, view } = fixture()
  for (const hostile of structurallyHostileRecords({
    valid: true,
    value: { seed: 'hidden-seed' },
  })) {
    const hostileDefinition = hostInputDefinition(
      SEED_INPUT,
      (() => hostile) as never,
    )
    const brain = resolve([
      definition({
        token,
        requiredHostInputs: [SEED_INPUT],
        execute: () => assert.fail('invalid root reached execution'),
      }),
    ], [token], [], [hostileDefinition])
    const run = await runDecisionComponents(
      brain,
      request,
      view,
      {
        hostInputs: [{
          input: SEED_INPUT,
          value: { seed: 'hidden-seed' },
        }],
      },
    )
    assert.equal(
      run.entries[0].status === 'degraded'
        ? run.entries[0].failureCode
        : undefined,
      'host-input-invalid',
    )
    assert.doesNotMatch(JSON.stringify(run), /hidden-seed|runtime\.seed/)
  }

  const substitutingDefinition = hostInputDefinition(
    SEED_INPUT,
    () => ({
      valid: true,
      value: { seed: 'substituted-seed' },
    }),
  )
  const substitutingBrain = resolve([
    definition({
      token,
      requiredHostInputs: [SEED_INPUT],
      execute: () => assert.fail('substituted root reached execution'),
    }),
  ], [token], [], [substitutingDefinition])
  const substituted = await runDecisionComponents(
    substitutingBrain,
    request,
    view,
    {
      hostInputs: [{
        input: SEED_INPUT,
        value: { seed: 'original-seed' },
      }],
    },
  )
  assert.equal(
    substituted.entries[0].status === 'degraded'
      ? substituted.entries[0].failureCode
      : undefined,
    'host-input-invalid',
  )
  assert.doesNotMatch(
    JSON.stringify(substituted),
    /original-seed|substituted-seed|runtime\.seed/,
  )
})

test('replay is deterministic and inputs are isolated from component mutation', async () => {
  const token: ComponentToken<{ eventCount: number }> = {
    id: 'replay.snapshot',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const brain = resolve([
    definition({
      token,
      async execute(context) {
        requirePrivateContext(context)
        await Promise.resolve()
        return {
          status: 'produced',
          envelope: componentEnvelope(token, {
            eventCount: context.view.events.length,
          }),
        }
      },
    }),
  ], [token])
  const { request, view } = fixture()
  const beforeRequest = structuredClone(request)
  const beforeView = structuredClone(view)
  const first = await runDecisionComponents(brain, request, view)
  const second = await runDecisionComponents(brain, request, view)

  assert.deepEqual(first, second)
  assert.equal(JSON.stringify(first), JSON.stringify(second))
  assert.deepEqual(request, beforeRequest)
  assert.deepEqual(view, beforeView)
})

test('concurrent invocations snapshot distinct roots, requests, and views before awaiting', async () => {
  const token: ComponentToken<{
    seed: string
    seat: number
    proposal: number
  }> = {
    id: 'replay.concurrent-roots',
    version: 'v1',
    kind: 'projection',
    privacy: 'private',
  }
  const brain = resolve([
    definition({
      token,
      requiredHostInputs: [SEED_INPUT],
      async execute(context) {
        requirePrivateContext(context)
        await new Promise<void>((resolveDelay) =>
          setImmediate(resolveDelay))
        const seed = context.hostInputs.require(SEED_INPUT)
        return {
          status: 'produced',
          envelope: componentEnvelope(token, {
            seed: seed.seed,
            seat: context.request.seat,
            proposal: context.view.proposalNum,
          }),
        }
      },
    }),
  ], [token], [], [SEED_INPUT_DEFINITION])
  const first = fixture()
  const second = fixture()
  first.request.seat = 1
  first.view.proposalNum = 2
  second.request.seat = 3
  second.view.proposalNum = 4
  const firstValue = { seed: 'first-seed' }
  const secondValue = { seed: 'second-seed' }

  const firstRun = runDecisionComponents(
    brain,
    first.request,
    first.view,
    {
      hostInputs: [{
        input: SEED_INPUT,
        value: firstValue,
      }],
    },
  )
  const secondRun = runDecisionComponents(
    brain,
    second.request,
    second.view,
    {
      hostInputs: [{
        input: SEED_INPUT,
        value: secondValue,
      }],
    },
  )
  first.request.seat = 91
  first.view.proposalNum = 92
  firstValue.seed = 'mutated-first'
  second.request.seat = 93
  second.view.proposalNum = 94
  secondValue.seed = 'mutated-second'

  const [firstResult, secondResult] = await Promise.all([
    firstRun,
    secondRun,
  ])
  assert.deepEqual(componentPayload(firstResult, token), {
    seed: 'first-seed',
    seat: 1,
    proposal: 2,
  })
  assert.deepEqual(componentPayload(secondResult, token), {
    seed: 'second-seed',
    seat: 3,
    proposal: 4,
  })

  const replayFixture = fixture()
  const replayInvocation = {
    hostInputs: [{
      input: SEED_INPUT,
      value: { seed: 'replay-seed' },
    }],
  }
  const [left, right] = await Promise.all([
    runDecisionComponents(
      brain,
      replayFixture.request,
      replayFixture.view,
      replayInvocation,
    ),
    runDecisionComponents(
      brain,
      replayFixture.request,
      replayFixture.view,
      replayInvocation,
    ),
  ])
  assert.deepEqual(left, right)
  assert.equal(JSON.stringify(left), JSON.stringify(right))
  assert.equal(
    Object.hasOwn(brain, 'hostInputValues'),
    false,
  )
  assert.equal(
    brain.hostInputDefinitions.some((definition) =>
      Object.hasOwn(definition, 'value')),
    false,
  )
})

test('kernel preserves stateful component receiver semantics', async () => {
  const token: ComponentToken<{ calls: number }> = {
    id: 'receiver.stateful',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  class StatefulComponent
  implements DecisionComponentDefinition<{ calls: number }> {
    readonly token = token
    readonly source = 'native' as const
    readonly dependencies: readonly ComponentRef[] = []
    readonly requiredHostInputs = []
    readonly hostRequirements: readonly string[] = []
    readonly maxPayloadBytes = 64
    readonly degradationCode = 'receiver-failed'
    #calls = 0

    applies(): true {
      return true
    }

    execute() {
      this.#calls++
      return {
        status: 'produced' as const,
        envelope: componentEnvelope(token, { calls: this.#calls }),
      }
    }

    validateDetached(
      payload: unknown,
    ): ComponentAdmissionResult<{ calls: number }> {
      assert.equal(this.#calls, 1)
      return exact(payload as { calls: number })
    }

    admitHost(
      input: {
        payload: { calls: number }
        host: DecisionComponentContext
      },
    ): ComponentAdmissionResult<{ calls: number }> {
      assert.equal(this.#calls, 1)
      return exact(input.payload)
    }
  }

  const brain = resolve([new StatefulComponent()], [token])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  assert.deepEqual(componentPayload(run, token), { calls: 1 })
})

test('empty graph is an inert deterministic identity', async () => {
  const brain = resolve([], [])
  const { request, view } = fixture()
  const first = await runDecisionComponents(brain, request, view)
  const second = await runDecisionComponents(brain, request, view)
  const explicitUndefined = await runDecisionComponents(
    brain,
    request,
    view,
    { hostInputs: undefined },
  )
  const explicitEmpty = await runDecisionComponents(
    brain,
    request,
    view,
    { hostInputs: [] },
  )
  const expected: DecisionComponentRun = {
    version: 'decision-component-run-v1',
    configured: [],
    entries: [],
    policyUse: [],
  }

  assert.deepEqual(first, expected)
  assert.deepEqual(second, expected)
  assert.equal(JSON.stringify(first), JSON.stringify(expected))
  assert.equal(first, second)
  assert.equal(first, explicitUndefined)
  assert.equal(first, explicitEmpty)
  assert.equal(brain.configuredDefinitions.length, 0)
  assert.equal(brain.eligibleDefinitions.length, 0)
})

test('host admission rejects a structural child of a non-admitted dependency', () => {
  const registry = createDecisionComponentRegistry([
    definition({
      token: SIGNAL_TOKEN,
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(SIGNAL_TOKEN, {
          seat: 0,
          proposal: 1,
        }),
      }),
      validateDetached: validSignal,
    }),
    definition({
      token: PROJECTION_TOKEN,
      dependencies: [SIGNAL_TOKEN],
      requiredHostInputs: [SEED_INPUT],
      execute: () => ({
        status: 'produced',
        envelope: componentEnvelope(PROJECTION_TOKEN, {
          sourceSeat: 0,
          decisionKind: 'vote',
        }),
      }),
    }),
  ], {
    hostInputs: [SEED_INPUT_DEFINITION],
  })
  const payload: ProjectionPayload = {
    sourceSeat: 0,
    decisionKind: 'vote',
  }
  const run: DecisionComponentRun = {
    version: 'decision-component-run-v1',
    configured: [
      { id: SIGNAL_TOKEN.id, version: SIGNAL_TOKEN.version },
      { id: PROJECTION_TOKEN.id, version: PROJECTION_TOKEN.version },
    ],
    entries: [
      {
        component: {
          id: SIGNAL_TOKEN.id,
          version: SIGNAL_TOKEN.version,
        },
        kind: SIGNAL_TOKEN.kind,
        privacy: SIGNAL_TOKEN.privacy,
        status: 'degraded',
        degradationCode: 'context-signal-failed',
        failureCode: 'execution-failed',
      },
      {
        component: {
          id: PROJECTION_TOKEN.id,
          version: PROJECTION_TOKEN.version,
        },
        kind: PROJECTION_TOKEN.kind,
        privacy: PROJECTION_TOKEN.privacy,
        status: 'admitted',
        envelope: componentEnvelope(PROJECTION_TOKEN, payload),
        verification: 'structural',
        promotionEligible: false,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      },
    ],
    policyUse: [
      {
        component: {
          id: SIGNAL_TOKEN.id,
          version: SIGNAL_TOKEN.version,
        },
        used: false,
        stages: [],
      },
      {
        component: {
          id: PROJECTION_TOKEN.id,
          version: PROJECTION_TOKEN.version,
        },
        used: false,
        stages: [],
      },
    ],
  }
  const { request, view } = fixture()
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
  }), false)
})

test('execution-time suppression requires an exact registered host proof', async () => {
  const forcedInput: ComponentHostInputToken<{ applied: boolean }> = {
    id: 'runtime.forced-proof',
    version: 'v1',
    privacy: 'private',
  }
  const forcedDefinition = hostInputDefinition(
    forcedInput,
    (value) => {
      const record = value as Record<string, unknown>
      return record
        && typeof record.applied === 'boolean'
        && Object.keys(record).length === 1
        ? { valid: true, value: { applied: record.applied } }
        : { valid: false, degradationCode: 'invalid-forced-proof' }
    },
  )
  const token: ComponentToken<{ selected: true }> = {
    id: 'suppression.proof',
    version: 'v1',
    kind: 'decision-rule',
    privacy: 'private',
  }
  const component = definition({
    token,
    requiredHostInputs: [forcedInput],
    execute(context) {
      requirePrivateContext(context)
      return context.hostInputs.require(forcedInput).applied
        ? {
            status: 'suppressed',
            reasonCode: 'forced-policy',
          }
        : {
            status: 'produced',
            envelope: componentEnvelope(token, { selected: true }),
          }
    },
    admitSuppressed({ reasonCode, host }) {
      requirePrivateContext(host)
      return reasonCode === 'forced-policy'
        && host.hostInputs.require(forcedInput).applied
    },
  })
  const registry = createDecisionComponentRegistry(
    [component],
    { hostInputs: [forcedDefinition] },
  )
  const brain = resolve(
    [component],
    [token],
    [],
    [forcedDefinition],
  )
  const { request, view } = fixture()
  const forcedBinding: ComponentHostInputBinding<{ applied: boolean }> = {
    input: forcedInput,
    value: { applied: true },
  }
  const run = await runDecisionComponents(brain, request, view, {
    hostInputs: [forcedBinding],
  })
  assert.equal(run.entries[0].status, 'suppressed')
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
    hostInputs: [forcedBinding],
  }), true)

  const forgedReason = structuredClone(run)
  assert.equal(forgedReason.entries[0].status, 'suppressed')
  if (forgedReason.entries[0].status === 'suppressed') {
    forgedReason.entries[0].reasonCode = 'forged-reason'
  }
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run: forgedReason,
    request,
    view,
    hostInputs: [forcedBinding],
  }), false)
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
    hostInputs: [{
      input: forcedInput,
      value: { applied: false },
    }],
  }), false)
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
  }), false)
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
    hostInputs: [{
      input: forcedInput,
      value: { applied: 'yes' } as unknown as { applied: boolean },
    }],
  }), false)
})

test('thenable applicability degrades at runtime and cannot host-admit', async () => {
  const token: ComponentToken<{ ok: true }> = {
    id: 'async.applicability',
    version: 'v1',
    kind: 'observer',
    privacy: 'private',
  }
  const component = definition({
    token,
    applies: (() => Promise.resolve(true)) as unknown as (
      context: DecisionComponentApplicabilityContext,
    ) => ComponentApplicability,
    execute: () => ({
      status: 'produced',
      envelope: componentEnvelope(token, { ok: true }),
    }),
  })
  const registry = createDecisionComponentRegistry([component])
  const brain = resolve([component], [token])
  const { request, view } = fixture()
  const run = await runDecisionComponents(brain, request, view)
  assert.equal(run.entries[0].status, 'degraded')
  if (run.entries[0].status === 'degraded') {
    assert.equal(run.entries[0].failureCode, 'applicability-failed')
  }
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run,
    request,
    view,
  }), false)
})
