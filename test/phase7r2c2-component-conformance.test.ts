import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizeJson,
} from '../server/agents/components/canonical-json.ts'
import {
  publicDecisionComponentRun,
  runDecisionComponents,
  validateDecisionComponentRunHostJoin,
} from '../server/agents/components/kernel.ts'
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
  PRIVATE_PUBLIC_OBSERVER_INPUT,
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
  projectPublicRecord,
} from '../server/agents/communication/public-record.ts'
import { legalCandidates } from '../server/agents/policy/candidates.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { structurallyHostileRecords } from './support/hostile-data.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

const PRODUCTION_COMPONENT_INVENTORY = Object.freeze({
  'actor-target-treatment-read':
    { fixture: 'mordred-late-vote' },
  'evil-quest-card-exact-quota':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'evil-quest-card-robust':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'evil-role-objective':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'evil-role-utility':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'good-role-objective':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'good-role-utility':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'mordred-blindness-objective':
    { fixture: 'mordred-late-vote' },
  'morgana-counterfeit-public-read':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'morgana-counterfeit-objective':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'morgana-role-utility-seeded':
    { legacyExemption: 'C2B/7R3 native migration pending' },
  'morgana-role-utility':
    { legacyExemption: 'C2B/7R3 native migration pending' },
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
  const cases = [
    {
      value: treatment,
      maxBytes: MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
      raw: validatePrivateActorTargetTreatmentRead,
      decode: decodeCanonicalPrivateActorTargetTreatmentRead,
      mutate(value: any) {
        value.matrixSemantics = 'forged'
      },
    },
    {
      value: objective,
      maxBytes: MAX_MORDRED_BLINDNESS_JSON_BYTES,
      raw: validatePrivateMordredBlindnessObjective,
      decode: decodeCanonicalPrivateMordredBlindnessObjective,
      mutate(value: any) {
        value.role = 'merlin'
      },
    },
  ] as const
  for (const entry of cases) {
    const canonical = canonicalizeJson(entry.value, entry.maxBytes)
    assert.equal(canonical.ok, true)
    if (!canonical.ok) continue
    assert.equal(entry.raw(entry.value), true)
    assert.ok(entry.decode(canonical.payload))

    const forged = structuredClone(entry.value)
    entry.mutate(forged)
    const forgedCanonical = canonicalizeJson(forged, entry.maxBytes)
    assert.equal(forgedCanonical.ok, true)
    if (!forgedCanonical.ok) continue
    assert.equal(entry.raw(forged), false)
    assert.equal(entry.decode(forgedCanonical.payload), undefined)

    for (const hostile of structurallyHostileRecords(entry.value)) {
      assert.equal(entry.raw(hostile), false)
      assert.equal(canonicalizeJson(hostile, entry.maxBytes).ok, false)
    }
  }
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
  const invocation = {
    hostInputs: [
      { input: PRIVATE_PUBLIC_OBSERVER_INPUT, value: observer },
      { input: PRIVATE_BELIEF_INPUT, value: belief },
    ],
  }
  const first = await runDecisionComponents(
    brain,
    structuredClone(fixture.req),
    structuredClone(fixture.view),
    structuredClone(invocation),
  )
  const second = await runDecisionComponents(
    brain,
    structuredClone(fixture.req),
    structuredClone(fixture.view),
    structuredClone(invocation),
  )
  assert.deepEqual(first, second)
  assert.deepEqual(first.entries.map((entry) => ({
    id: entry.component.id,
    kind: entry.kind,
    privacy: entry.privacy,
    status: entry.status,
    ...(entry.status === 'admitted'
      ? {
          verification: entry.verification,
          promotionEligible: entry.promotionEligible,
        }
      : {}),
  })), [
    {
      id: ACTOR_TARGET_TREATMENT_COMPONENT.id,
      kind: 'observer',
      privacy: 'private',
      status: 'admitted',
      verification: 'exact',
      promotionEligible: true,
    },
    {
      id: MORDRED_BLINDNESS_COMPONENT.id,
      kind: 'objective',
      privacy: 'private',
      status: 'admitted',
      verification: 'exact',
      promotionEligible: true,
    },
  ])
  for (const entry of first.entries) {
    assert.equal(entry.status, 'admitted')
    if (entry.status !== 'admitted') continue
    assert.ok(entry.payloadBytes <= (
      registry.definition(entry.component)?.maxPayloadBytes ?? 0
    ))
    assert.ok(Object.isFrozen(entry.envelope.payload))
  }
  assert.deepEqual(publicDecisionComponentRun(first), {
    version: first.version,
    configured: [],
    entries: [],
    policyUse: [],
  })
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run: first,
    request: fixture.req,
    view: fixture.view,
    hostInputs: invocation.hostInputs,
  }), true)
  assert.equal(validateDecisionComponentRunHostJoin({
    registry,
    run: first,
    request: fixture.req,
    view: fixture.view,
    hostInputs: invocation.hostInputs.slice(0, 1),
  }), false)
  for (const mutate of [
    (run: any) => {
      run.entries[0].component.version = 'forged'
    },
    (run: any) => {
      run.entries[0].privacy = 'public'
    },
    (run: any) => {
      run.entries[0].envelope.component.id = 'forged'
    },
    (run: any) => {
      run.entries[1].envelope.payload.role = 'merlin'
    },
  ]) {
    const forged = structuredClone(first)
    mutate(forged)
    assert.equal(validateDecisionComponentRunHostJoin({
      registry,
      run: forged,
      request: fixture.req,
      view: fixture.view,
      hostInputs: invocation.hostInputs,
    }), false)
  }

  const missingRoots = await runDecisionComponents(
    brain,
    fixture.req,
    fixture.view,
  )
  assert.deepEqual(
    missingRoots.entries.map((entry) =>
      entry.status === 'degraded'
        ? [entry.component.id, entry.failureCode]
        : [entry.component.id, entry.status]),
    [
      [ACTOR_TARGET_TREATMENT_COMPONENT.id, 'host-input-unavailable'],
      [MORDRED_BLINDNESS_COMPONENT.id, 'dependency-unavailable'],
    ],
  )
})
