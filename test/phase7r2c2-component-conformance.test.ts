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
  validatePrivateIdentitySnapshot,
} from '../server/agents/belief/identity.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
  validateAdmittedPrivateEvilRoleObjectiveHostJoin,
  validatePrivateEvilRoleObjectiveHostJoin,
  validatePrivateEvilRoleObjectiveSnapshot,
} from '../server/agents/analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/legacy-role-adapters.ts'
import {
  MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
} from '../server/agents/analysis/evil-objective-types.ts'
import {
  buildEvilRoleUtilityProjection,
  decodeCanonicalPrivateEvilRoleUtilityProjection,
  MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
  validateAdmittedPrivateEvilRoleUtilityHostJoin,
  validatePrivateEvilRoleUtilityProjection,
} from '../server/agents/analysis/evil-role-utility.ts'
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
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import {
  assertNativeCodecContract,
  assertNativeExecutionContract,
} from './support/component-contract.ts'

const PRODUCTION_COMPONENT_INVENTORY = Object.freeze({
  'actor-target-treatment-read':
    { proof: 'mordred-native-family' },
  'evil-quest-card-exact-quota':
    { legacyExemption: '7R3B native retirement pending' },
  'evil-quest-card-robust':
    { legacyExemption: '7R3B native retirement pending' },
  'evil-role-objective':
    { proof: 'evil-role-native-family' },
  'evil-role-utility':
    { proof: 'evil-role-native-family' },
  'good-role-objective':
    { proof: 'good-role-native-family' },
  'good-role-utility':
    { proof: 'good-role-native-family' },
  'mordred-blindness-objective':
    { proof: 'mordred-native-family' },
  'morgana-counterfeit-public-read':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-counterfeit-objective':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-role-utility-seeded':
    { legacyExemption: '7R3A native retirement pending' },
  'morgana-role-utility':
    { legacyExemption: '7R3A native retirement pending' },
})

const NATIVE_PROOF_OWNERS = new Map([
  [ACTOR_TARGET_TREATMENT_COMPONENT.id, 'mordred-native-family'],
  [MORDRED_BLINDNESS_COMPONENT.id, 'mordred-native-family'],
  [GOOD_ROLE_OBJECTIVE_COMPONENT.id, 'good-role-native-family'],
  [GOOD_ROLE_UTILITY_COMPONENT.id, 'good-role-native-family'],
  [EVIL_ROLE_OBJECTIVE_COMPONENT.id, 'evil-role-native-family'],
  [EVIL_ROLE_UTILITY_COMPONENT.id, 'evil-role-native-family'],
] as const)

function assertProofCoverage(
  proof: string,
  exercisedTokens: readonly { readonly id: string }[],
): void {
  const owned = [...NATIVE_PROOF_OWNERS]
    .filter(([, owner]) => owner === proof)
    .map(([id]) => id)
    .sort()
  assert.deepEqual(
    exercisedTokens.map((token) => token.id).sort(),
    owned,
    `${proof} must execute every and only its owned native tokens`,
  )
}

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

function evilNativeFixture() {
  const fixture = readDecisionFixtures().find(
    (candidate) =>
      candidate.id === 'mordred-late-vote'
      && candidate.req.kind === 'vote',
  )
  assert.ok(fixture)
  const observer = observePublicRecord(projectPublicRecord(fixture.view))
  const belief = exactBelief(fixture.view)
  const identity = projectJointIdentity(belief, {
    roleQueries: [],
    hiddenTeam: true,
  })
  const candidates = legalCandidates(fixture.req, fixture.view)
  const objective = buildEvilRoleObjectiveSnapshot({
    req: fixture.req,
    view: fixture.view,
    identity,
    observer,
    candidates,
  })
  const alternativeCandidates = hypotheticalProposalCandidates(fixture.view)
  const alternativeObjective = buildEvilRoleObjectiveSnapshot({
    req: { ...fixture.req, kind: 'propose' },
    view: fixture.view,
    identity,
    observer,
    candidates: alternativeCandidates,
  })
  const utility = buildEvilRoleUtilityProjection({
    req: fixture.req,
    view: fixture.view,
    objective,
    candidates,
    alternativeObjective,
  })
  return {
    fixture,
    observer,
    belief,
    identity,
    candidates,
    objective,
    alternativeCandidates,
    alternativeObjective,
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
  const evil = evilNativeFixture()
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
  assertNativeCodecContract({
    label: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
    value: evil.objective,
    maxBytes: MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
    validate: validatePrivateEvilRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
    invalidValue: { ...evil.objective, role: 'servant' },
  })
  assertNativeCodecContract({
    label: EVIL_ROLE_UTILITY_COMPONENT.id,
    value: evil.utility,
    maxBytes: MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
    validate: validatePrivateEvilRoleUtilityProjection,
    decode: decodeCanonicalPrivateEvilRoleUtilityProjection,
    invalidValue: { ...evil.utility, role: 'servant' },
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
  const entries = [
    {
      token: GOOD_ROLE_OBJECTIVE_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'host-input-unavailable',
    },
    {
      token: GOOD_ROLE_UTILITY_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'dependency-unavailable',
    },
  ]
  assertProofCoverage(
    'good-role-native-family',
    entries.map((entry) => entry.token),
  )
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
    entries,
  })
})

test('native evil-role family conforms through execution and host join', async () => {
  const evil = evilNativeFixture()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [EVIL_ROLE_UTILITY_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const entries = [
    {
      token: EVIL_ROLE_OBJECTIVE_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'host-input-unavailable',
    },
    {
      token: EVIL_ROLE_UTILITY_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'dependency-unavailable',
    },
  ]
  assertProofCoverage(
    'evil-role-native-family',
    entries.map((entry) => entry.token),
  )
  await assertNativeExecutionContract({
    label: 'evil role native family',
    registry,
    request: evil.fixture.req,
    view: evil.fixture.view,
    brain,
    hostInputs: [
      { input: PRIVATE_IDENTITY_INPUT, value: evil.identity },
      { input: PRIVATE_PUBLIC_OBSERVER_INPUT, value: evil.observer },
    ],
    entries,
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

test('admitted evil joins trust kernel-admitted roots and dependencies', () => {
  const evil = evilNativeFixture()
  const invalidAtRawIdentityBoundary = {
    ...evil.identity,
    unadmittedExtra: true,
  } as unknown as typeof evil.identity
  assert.equal(
    validatePrivateIdentitySnapshot(invalidAtRawIdentityBoundary),
    false,
  )
  assert.equal(validatePrivateEvilRoleObjectiveHostJoin(
    evil.objective,
    {
      req: evil.fixture.req,
      view: evil.fixture.view,
      identity: invalidAtRawIdentityBoundary,
      observer: evil.observer,
      candidates: evil.candidates,
    },
  ), false)
  assert.equal(validateAdmittedPrivateEvilRoleObjectiveHostJoin(
    evil.objective,
    {
      req: evil.fixture.req,
      view: evil.fixture.view,
      identity: invalidAtRawIdentityBoundary,
      observer: evil.observer,
      candidates: evil.candidates,
    },
  ), true)

  const invalidAtRawObjectiveBoundary = {
    ...evil.objective,
    version: 'already-admitted-dependency',
  } as unknown as typeof evil.objective
  assert.equal(
    validatePrivateEvilRoleObjectiveSnapshot(
      invalidAtRawObjectiveBoundary,
    ),
    false,
  )
  assert.equal(validateAdmittedPrivateEvilRoleUtilityHostJoin(
    evil.utility,
    {
      req: evil.fixture.req,
      view: evil.fixture.view,
      objective: invalidAtRawObjectiveBoundary,
      candidates: evil.candidates,
      alternativeObjective: evil.alternativeObjective,
    },
  ), true)
})

test('production registry has executable proof for every native token', () => {
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
      Object.hasOwn(inventory, 'proof'),
      `${definition.token.id} must have a native proof or legacy exemption`,
    )
    if (definition.source === 'native') {
      assert.equal(
        NATIVE_PROOF_OWNERS.get(definition.token.id),
        (inventory as { proof: string }).proof,
        `${definition.token.id} must name its executable proof owner`,
      )
    }
  }
  assert.deepEqual(
    [...NATIVE_PROOF_OWNERS.keys()].sort(),
    registry.definitions()
      .filter((definition) => definition.source === 'native')
      .map((definition) => definition.token.id)
      .sort(),
    'proof coverage must equal the complete native registry',
  )
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
  const entries = [
    {
      token: ACTOR_TARGET_TREATMENT_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'host-input-unavailable',
    },
    {
      token: MORDRED_BLINDNESS_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'dependency-unavailable',
    },
  ]
  assertProofCoverage(
    'mordred-native-family',
    entries.map((entry) => entry.token),
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
    entries,
  })
})
