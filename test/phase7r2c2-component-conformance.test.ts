import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizeJson,
} from '../server/agents/components/canonical-json.ts'
import {
  ACTOR_TARGET_TREATMENT_COMPONENT,
  MORDRED_BLINDNESS_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  createProductionComponentRegistry,
} from '../server/agents/components/production-registry.ts'
import {
  resolveComposedBrain,
} from '../server/agents/components/resolved-brain.ts'
import {
  PRIVATE_BELIEF_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/legacy-role-adapters.ts'
import {
  buildPrivateActorTargetTreatmentRead,
  decodeCanonicalPrivateActorTargetTreatmentRead,
  validatePrivateActorTargetTreatmentRead,
} from '../server/agents/analysis/actor-target-treatment.ts'
import {
  buildPrivateMordredBlindnessObjective,
  decodeCanonicalPrivateMordredBlindnessObjective,
  validatePrivateMordredBlindnessObjective,
} from '../server/agents/analysis/mordred-blindness.ts'
import {
  MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
} from '../server/agents/analysis/actor-target-treatment-types.ts'
import {
  MAX_MORDRED_BLINDNESS_JSON_BYTES,
} from '../server/agents/analysis/mordred-blindness-types.ts'
import {
  observePublicRecord,
} from '../server/agents/analysis/observer.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import {
  projectJointIdentity,
} from '../server/agents/belief/identity.ts'
import {
  buildRoleObjectiveSnapshot,
  decodeCanonicalPrivateRoleObjectiveSnapshot,
  roleObjectiveIdentityScope,
  validatePrivateRoleObjectiveSnapshot,
} from '../server/agents/analysis/role-objectives.ts'
import {
  buildRoleUtilityProjection,
  decodeCanonicalPrivateRoleUtilityProjection,
  MAX_ROLE_UTILITY_JSON_BYTES,
  validateAdmittedPrivateRoleUtilityHostJoin,
  validatePrivateRoleUtilityProjection,
} from '../server/agents/analysis/role-utility.ts'
import {
  MAX_ROLE_OBJECTIVE_JSON_BYTES,
} from '../server/agents/analysis/role-objective-types.ts'
import {
  projectPublicRecord,
} from '../server/agents/communication/public-record.ts'
import { legalCandidates } from '../server/agents/policy/candidates.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import {
  assertNativeCodecContract,
  assertNativeExecutionContract,
} from './support/component-contract.ts'

const PRODUCTION_COMPONENT_INVENTORY = Object.freeze({
  'actor-target-treatment-read':
    { fixture: 'mordred-late-vote' },
  'evil-quest-card-exact-quota':
    { legacyExemption: '7R3B native retirement pending' },
  'evil-quest-card-robust':
    { legacyExemption: '7R3B native retirement pending' },
  'evil-role-objective':
    { legacyExemption: '7R3A native retirement pending' },
  'evil-role-utility':
    { legacyExemption: '7R3A native retirement pending' },
  'good-role-objective':
    { fixture: 'merlin-proposal' },
  'good-role-utility':
    { fixture: 'merlin-proposal' },
  'mordred-blindness-objective':
    { fixture: 'mordred-late-vote' },
  'morgana-counterfeit-public-read':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-counterfeit-objective':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-role-utility-seeded':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-role-utility':
    { legacyExemption: '7R3A native retirement pending' },
})

function nativeFixture() {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.id === 'mordred-late-vote',
  )
  assert.ok(fixture)
  const record = projectPublicRecord(fixture.view)
  const observer = observePublicRecord(record)
  const belief = exactBelief(fixture.view)
  const treatment = buildPrivateActorTargetTreatmentRead(record, observer)
  const objective = buildPrivateMordredBlindnessObjective({
    req: fixture.req,
    view: fixture.view,
    belief,
    treatment,
    candidates: legalCandidates(fixture.req, fixture.view),
  })
  return { fixture, record, observer, belief, treatment, objective }
}

function goodNativeFixture() {
  const fixture = readDecisionFixtures().find(
    (candidate) =>
      candidate.view.role === 'merlin'
      && candidate.req.kind === 'propose',
  )
  assert.ok(fixture)
  const record = projectPublicRecord(fixture.view)
  const observer = observePublicRecord(record)
  const belief = exactBelief(fixture.view)
  const identity = projectJointIdentity(
    belief,
    roleObjectiveIdentityScope('merlin', fixture.view.rolesInPlay),
  )
  const candidates = legalCandidates(fixture.req, fixture.view)
  const objective = buildRoleObjectiveSnapshot({
    req: fixture.req,
    view: fixture.view,
    identity,
    observer,
    candidates,
  })
  const utility = buildRoleUtilityProjection({
    req: fixture.req,
    view: fixture.view,
    objective,
    observer,
    candidates,
  })
  return {
    fixture,
    observer,
    identity,
    objective,
    utility,
  }
}

test('strict canonical JSON boundary rejects hostile JavaScript shapes', () => {
  const source = { z: [{ b: 2, a: 1 }], a: true }
  const result = canonicalizeJson(source, 1_000)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(JSON.stringify(result.payload),
    '{"a":true,"z":[{"a":1,"b":2}]}')
  assert.equal(result.bytes, Buffer.byteLength(JSON.stringify(result.payload)))
  assert.ok(Object.isFrozen(result.payload))
  assert.ok(Object.isFrozen((result.payload as any).z))
  assert.ok(Object.isFrozen((result.payload as any).z[0]))

  const cyclic: any = {}
  cyclic.self = cyclic
  const sparse = new Array(2)
  sparse[1] = true
  const accessor = {}
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get: () => true,
  })
  for (const hostile of [
    new Proxy({ value: true }, {}),
    accessor,
    cyclic,
    sparse,
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
    { value: () => true },
    { value: 1n },
  ]) {
    assert.deepEqual(canonicalizeJson(hostile, 1_000), {
      ok: false,
      failureCode: 'payload-json-unsafe',
    })
  }
  assert.deepEqual(canonicalizeJson({ value: 'xx' }, 1), {
    ok: false,
    failureCode: 'payload-too-large',
  })

  const exact = { escaped: '"\\\n', nested: [0, null, true] }
  const exactBytes = Buffer.byteLength(JSON.stringify(exact), 'utf8')
  assert.equal(canonicalizeJson(exact, exactBytes).ok, true)
  assert.deepEqual(canonicalizeJson(exact, exactBytes - 1), {
    ok: false,
    failureCode: 'payload-too-large',
  })

  const hugeSparse = new Array(0xffff_ffff)
  assert.deepEqual(canonicalizeJson(hugeSparse, 1_000), {
    ok: false,
    failureCode: 'payload-too-large',
  })
  let nested: unknown = null
  for (let index = 0; index < 300; index++) nested = [nested]
  assert.deepEqual(canonicalizeJson(nested, 10_000), {
    ok: false,
    failureCode: 'payload-json-unsafe',
  })
  const tooManyNodes = Array.from({ length: 100 }, () => 0)
  assert.deepEqual(canonicalizeJson(tooManyNodes, 100), {
    ok: false,
    failureCode: 'payload-too-large',
  })
})

test('native decoders preserve raw-validator semantics after one boundary', () => {
  const { treatment, objective } = nativeFixture()
  const good = goodNativeFixture()
  assertNativeCodecContract({
    label: ACTOR_TARGET_TREATMENT_COMPONENT.id,
    value: treatment,
    maxBytes: MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
    validate: validatePrivateActorTargetTreatmentRead,
    decode: decodeCanonicalPrivateActorTargetTreatmentRead,
    invalidValue: { ...treatment, matrixSemantics: 'forged' },
  })
  assertNativeCodecContract({
    label: MORDRED_BLINDNESS_COMPONENT.id,
    value: objective,
    maxBytes: MAX_MORDRED_BLINDNESS_JSON_BYTES,
    validate: validatePrivateMordredBlindnessObjective,
    decode: decodeCanonicalPrivateMordredBlindnessObjective,
    invalidValue: { ...objective, role: 'merlin' },
  })
  assertNativeCodecContract({
    label: GOOD_ROLE_OBJECTIVE_COMPONENT.id,
    value: good.objective,
    maxBytes: MAX_ROLE_OBJECTIVE_JSON_BYTES,
    validate: validatePrivateRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateRoleObjectiveSnapshot,
    invalidValue: { ...good.objective, role: 'servant' },
  })
  assertNativeCodecContract({
    label: GOOD_ROLE_UTILITY_COMPONENT.id,
    value: good.utility,
    maxBytes: MAX_ROLE_UTILITY_JSON_BYTES,
    validate: validatePrivateRoleUtilityProjection,
    decode: decodeCanonicalPrivateRoleUtilityProjection,
    invalidValue: { ...good.utility, role: 'servant' },
  })
})

test('native good-role family conforms through execution and host join', async () => {
  const good = goodNativeFixture()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [GOOD_ROLE_UTILITY_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  await assertNativeExecutionContract({
    label: 'good role native family',
    registry,
    request: good.fixture.req,
    view: good.fixture.view,
    brain,
    hostInputs: [
      { input: PRIVATE_IDENTITY_INPUT, value: good.identity },
      { input: PRIVATE_PUBLIC_OBSERVER_INPUT, value: good.observer },
    ],
    entries: [
      {
        token: GOOD_ROLE_OBJECTIVE_COMPONENT,
        verification: 'exact',
        promotionEligible: true,
        missingRootFailure: 'host-input-unavailable',
      },
      {
        token: GOOD_ROLE_UTILITY_COMPONENT,
        verification: 'exact',
        promotionEligible: true,
        missingRootFailure: 'dependency-unavailable',
      },
    ],
  })
})

test('admitted utility join trusts its already-admitted objective dependency', () => {
  const good = goodNativeFixture()
  const invalidAtRawBoundary = {
    ...good.objective,
    version: 'already-admitted-dependency',
  } as unknown as typeof good.objective
  assert.equal(
    validatePrivateRoleObjectiveSnapshot(invalidAtRawBoundary),
    false,
  )
  assert.equal(validateAdmittedPrivateRoleUtilityHostJoin(
    good.utility,
    {
      req: good.fixture.req,
      view: good.fixture.view,
      objective: invalidAtRawBoundary,
      observer: good.observer,
      candidates: legalCandidates(good.fixture.req, good.fixture.view),
    },
  ), true)
})

test('production registry has a fail-closed conformance inventory', () => {
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  assert.deepEqual(
    registry.definitions().map((definition) => definition.token.id).sort(),
    Object.keys(PRODUCTION_COMPONENT_INVENTORY).sort(),
  )
  for (const definition of registry.definitions()) {
    const inventory = PRODUCTION_COMPONENT_INVENTORY[
      definition.token.id as keyof typeof PRODUCTION_COMPONENT_INVENTORY
    ]
    assert.ok(inventory)
    assert.equal(
      definition.source === 'native',
      Object.hasOwn(inventory, 'fixture'),
      `${definition.token.id} must have a native fixture or legacy exemption`,
    )
  }
})

test('native production family conforms through execution and host join', async () => {
  const { fixture, observer, belief } = nativeFixture()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [MORDRED_BLINDNESS_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  assert.deepEqual(
    brain.description.components.configured.map((entry) => entry.id),
    [
      ACTOR_TARGET_TREATMENT_COMPONENT.id,
      MORDRED_BLINDNESS_COMPONENT.id,
    ],
  )
  await assertNativeExecutionContract({
    label: 'mordred native family',
    registry,
    request: fixture.req,
    view: fixture.view,
    brain,
    hostInputs: [
      { input: PRIVATE_PUBLIC_OBSERVER_INPUT, value: observer },
      { input: PRIVATE_BELIEF_INPUT, value: belief },
    ],
    entries: [
      {
        token: ACTOR_TARGET_TREATMENT_COMPONENT,
        verification: 'exact',
        promotionEligible: true,
        missingRootFailure: 'host-input-unavailable',
      },
      {
        token: MORDRED_BLINDNESS_COMPONENT,
        verification: 'exact',
        promotionEligible: true,
        missingRootFailure: 'dependency-unavailable',
      },
    ],
  })
})
