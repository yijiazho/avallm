// Migration phase 7R2C2; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import { mutable } from './support/mutable.ts'
import assert from 'node:assert/strict'
import { pendingQuest, resolveQuest } from './support/quests.ts'
import {
  canonicalizeJson,
  canonicalizeTransportJson,
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
} from '../server/agents/components/canonical-json.ts'
import {
  ACTOR_TARGET_TREATMENT_COMPONENT,
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
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
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_SITUATION_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  SERVANT_OBJECTIVE_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../server/agents/components/robust-evil-quest-card.ts'
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
} from '../server/agents/components/native-score-components.ts'
import {
  buildEvilRoleUtilityProjection,
  decodeCanonicalPrivateEvilRoleUtilityProjection,
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
  validateAdmittedPrivateRoleUtilityHostJoin,
  validatePrivateRoleUtilityProjection,
} from '../server/agents/analysis/role-utility.ts'
import {
  buildAdmittedMorganaCounterfeitObjective,
  buildMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  decodeCanonicalPrivateMorganaCounterfeitObjective,
  decodeCanonicalPublicCounterfeitMerlinRead,
  validateAdmittedPrivateMorganaCounterfeitHostJoin,
  validatePrivateMorganaCounterfeitObjective,
  validatePublicCounterfeitMerlinRead,
} from '../server/agents/analysis/morgana-counterfeit.ts'
import {
  buildAdmittedMorganaRoleUtilityProjection,
  buildMorganaRoleUtilityProjection,
  decodeCanonicalPrivateMorganaRoleUtilityProjection,
  validateAdmittedPrivateMorganaRoleUtilityHostJoin,
  validatePrivateMorganaRoleUtilityProjection,
} from '../server/agents/analysis/morgana-role-utility.ts'
import {
  projectPublicRecord,
} from '../server/agents/communication/public-record.ts'
import {
  applyForcedPolicy,
} from '../server/agents/policy/forced.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import {
  buildPrivateEvilQuestCardPolicy,
  decodeCanonicalRobustEvilQuestCardPolicy,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
} from '../server/agents/policy/evil-quest-card.ts'
import {
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { createGame } from '../server/engine/game.ts'
import { DEFAULT_ROLES } from '../server/engine/rules.ts'
import type { Role } from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'
import {
  assertNativeCodecContract,
  assertNativeExecutionContract,
} from './support/component-contract.ts'

const PRODUCTION_COMPONENT_INVENTORY = Object.freeze({
  'actor-target-treatment-read':
    { proof: 'mordred-native-family' },
  'assassin-merlin-posterior':
    { proof: 'assassin-native-family' },
  'evil-quest-card-robust':
    { proof: 'robust-quest-native-family' },
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
    { proof: 'morgana-native-family' },
  'morgana-counterfeit-objective':
    { proof: 'morgana-native-family' },
  'morgana-role-utility-seeded':
    { proof: 'morgana-native-family' },
  'morgana-role-utility':
    { proof: 'morgana-native-family' },
  'servant-objective':
    { proof: 'servant-native-family' },
})

const NATIVE_PROOF_OWNERS = new Map([
  [ACTOR_TARGET_TREATMENT_COMPONENT.id, 'mordred-native-family'],
  [ASSASSIN_MERLIN_POSTERIOR_COMPONENT.id, 'assassin-native-family'],
  [MORDRED_BLINDNESS_COMPONENT.id, 'mordred-native-family'],
  [GOOD_ROLE_OBJECTIVE_COMPONENT.id, 'good-role-native-family'],
  [GOOD_ROLE_UTILITY_COMPONENT.id, 'good-role-native-family'],
  [EVIL_ROLE_OBJECTIVE_COMPONENT.id, 'evil-role-native-family'],
  [EVIL_ROLE_UTILITY_COMPONENT.id, 'evil-role-native-family'],
  [MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id, 'morgana-native-family'],
  [MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id, 'morgana-native-family'],
  [MORGANA_ROLE_UTILITY_COMPONENT.id, 'morgana-native-family'],
  [MORGANA_ROLE_UTILITY_SEEDED_COMPONENT.id, 'morgana-native-family'],
  [SERVANT_OBJECTIVE_COMPONENT.id, 'servant-native-family'],
  [
    EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
    'robust-quest-native-family',
  ],
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

function robustQuestNativeFixture() {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'oberon-two-fail-quest',
  )
  assert.ok(source)
  const view = structuredClone(source.view)
  mutable(view).seat = 4
  mutable(view).name = view.players.find((player) => player.seat === 4)!.name
  mutable(view).role = 'assassin'
  mutable(view).alignment = 'evil'
  mutable(view).privateInfo = {
    kind: 'evil',
    evilPartners: [5],
  }
  mutable(view).quests[0] = resolveQuest(view.quests[0], { result: 'success', failCount: 0 })
  mutable(view).quests[1] = resolveQuest(view.quests[1], { result: 'fail', failCount: 1 })
  mutable(view).quests[2] = pendingQuest(view.quests[2])
  const req = {
    kind: 'quest' as const,
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const analysis = analyzeSituation(view, {
    belief: exactBelief(view),
  })
  const candidates = legalCandidates(req, view)
  const forced = applyForcedPolicy(req, view, analysis, candidates)
  const policy = buildPrivateEvilQuestCardPolicy({
    req,
    view,
    analysis,
  })
  return { req, view, analysis, forced, policy }
}

function morganaNativeFixture() {
  let game: ReturnType<typeof createGame> | undefined
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const candidate = createGame({
      seed: `phase7r3a4-conformance-${attempt}`,
      playerCount: 9,
    })
    if (candidate.players[candidate.leaderSeat].role === 'morgana') {
      game = candidate
      break
    }
  }
  assert.ok(game)
  const view = viewFor(game, game.leaderSeat)
  assert.equal(view.role, 'morgana')
  const req = {
    kind: 'propose' as const,
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const record = projectPublicRecord(view)
  const observer = observePublicRecord(record)
  const belief = exactBelief(view)
  const identity = projectJointIdentity(belief, {
    roleQueries: [],
    hiddenTeam: true,
  })
  const candidates = legalCandidates(req, view)
  const evilObjective = buildEvilRoleObjectiveSnapshot({
    req,
    view,
    identity,
    observer,
    candidates,
  })
  const evilUtility = buildEvilRoleUtilityProjection({
    req,
    view,
    objective: evilObjective,
    candidates,
  })
  const publicRead = buildPublicCounterfeitMerlinRead(record)
  const objective = buildMorganaCounterfeitObjective({
    req,
    view,
    belief,
    publicRead,
    candidates,
  })
  const forced = applyForcedPolicy(
    req,
    view,
    analyzeSituation(view, { belief }),
    candidates,
  )
  const deterministicSeed = game.seed
  const utility = buildMorganaRoleUtilityProjection({
    req,
    view,
    candidates,
    forced,
    counterfeitObjective: objective,
    evilRoleUtility: evilUtility,
    selectionMode: 'top-counterfeit-within-d2-band',
    deterministicSeed,
  })
  const seededUtility = buildMorganaRoleUtilityProjection({
    req,
    view,
    candidates,
    forced,
    counterfeitObjective: objective,
    evilRoleUtility: evilUtility,
    selectionMode: 'seeded-near-equal-vote-within-d2-band',
    deterministicSeed,
  })
  return {
    req,
    view,
    observer,
    belief,
    identity,
    forced,
    deterministicSeed,
    publicRead,
    objective,
    utility,
    seededUtility,
  }
}

/**
 * A five-handed round-1 board, dealt so the named role leads.
 *
 * Five players and quest 1 is the board where the shared request-block guard
 * has something to say that a membership test does not: two fails required is
 * legal only on quest 4 at seven or more players, so every payload built here
 * must carry exactly one.
 */
function fiveHandedLeaderFixture(role: Role, roles: readonly Role[]) {
  let game: ReturnType<typeof createGame> | undefined
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const candidate = createGame({
      seed: `five-handed-fails-required-${role}-${attempt}`,
      playerCount: 5,
      roles: [...roles],
    })
    if (candidate.players[candidate.leaderSeat].role === role) {
      game = candidate
      break
    }
  }
  assert.ok(game, `no five-handed deal put ${role} in the leader seat`)
  const view = viewFor(game, game.leaderSeat)
  assert.equal(view.role, role)
  assert.equal(view.round, 1)
  const req = {
    kind: 'propose' as const,
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const record = projectPublicRecord(view)
  return {
    view,
    req,
    record,
    observer: observePublicRecord(record),
    belief: exactBelief(view),
    candidates: legalCandidates(req, view),
  }
}

/** Every payload that carries a decision-request block, on that board. */
function fiveHandedRequestBlockPayloads() {
  const good = fiveHandedLeaderFixture('merlin', DEFAULT_ROLES[5]!)
  const goodIdentity = projectJointIdentity(
    good.belief,
    roleObjectiveIdentityScope('merlin', good.view.rolesInPlay),
  )
  const goodObjective = buildRoleObjectiveSnapshot({
    req: good.req,
    view: good.view,
    identity: goodIdentity,
    observer: good.observer,
    candidates: good.candidates,
  })

  const evil = fiveHandedLeaderFixture('assassin', DEFAULT_ROLES[5]!)
  const evilIdentity = projectJointIdentity(evil.belief, {
    roleQueries: [],
    hiddenTeam: true,
  })
  const evilObjective = buildEvilRoleObjectiveSnapshot({
    req: evil.req,
    view: evil.view,
    identity: evilIdentity,
    observer: evil.observer,
    candidates: evil.candidates,
  })

  const morgana = fiveHandedLeaderFixture('morgana', DEFAULT_ROLES[5]!)
  const mordred = fiveHandedLeaderFixture(
    'mordred',
    ['merlin', 'servant', 'servant', 'assassin', 'mordred'],
  )

  return [
    {
      label: 'good role objective',
      payload: goodObjective as unknown as Record<string, unknown>,
      validate: validatePrivateRoleObjectiveSnapshot,
    },
    {
      label: 'good role utility',
      payload: buildRoleUtilityProjection({
        req: good.req,
        view: good.view,
        objective: goodObjective,
        observer: good.observer,
        candidates: good.candidates,
      }) as unknown as Record<string, unknown>,
      validate: validatePrivateRoleUtilityProjection,
    },
    {
      label: 'evil role objective',
      payload: evilObjective as unknown as Record<string, unknown>,
      validate: validatePrivateEvilRoleObjectiveSnapshot,
    },
    {
      label: 'evil role utility',
      payload: buildEvilRoleUtilityProjection({
        req: evil.req,
        view: evil.view,
        objective: evilObjective,
        candidates: evil.candidates,
      }) as unknown as Record<string, unknown>,
      validate: validatePrivateEvilRoleUtilityProjection,
    },
    {
      label: 'Morgana counterfeit objective',
      payload: buildMorganaCounterfeitObjective({
        req: morgana.req,
        view: morgana.view,
        belief: morgana.belief,
        publicRead: buildPublicCounterfeitMerlinRead(morgana.record),
        candidates: morgana.candidates,
      }) as unknown as Record<string, unknown>,
      validate: validatePrivateMorganaCounterfeitObjective,
    },
    {
      label: 'Mordred blindness objective',
      payload: buildPrivateMordredBlindnessObjective({
        req: mordred.req,
        view: mordred.view,
        belief: mordred.belief,
        treatment: buildPrivateActorTargetTreatmentRead(
          mordred.record,
          mordred.observer,
        ),
        candidates: mordred.candidates,
      }) as unknown as Record<string, unknown>,
      validate: validatePrivateMordredBlindnessObjective,
    },
  ] as const
}

test('every request-block validator pins failsRequired to the board', () => {
  // Six modules validated this block by hand and the copies drifted: only the
  // evil role utility derived failsRequired from the rules, so the other five
  // admitted two fails required on quest 1 of a five-handed game, a board the
  // engine cannot deal. The control assertion is what makes the rejection
  // meaningful: the forged payload differs in that one field and nothing else.
  const payloads = fiveHandedRequestBlockPayloads()
  assert.equal(payloads.length, 6)
  // Every site is exercised before anything is asserted, so a single validator
  // that stops pinning the field names itself instead of hiding behind the
  // first failure.
  const admitted: string[] = []
  for (const { label, payload, validate } of payloads) {
    assert.equal(validate(payload), true, `${label} must admit its own build`)
    const request = payload.request as { failsRequired: number }
    assert.equal(request.failsRequired, 1, `${label} board takes one fail`)
    const forged = structuredClone(payload)
    ;(forged.request as { failsRequired: number }).failsRequired = 2
    if (validate(forged)) admitted.push(label)
  }
  assert.deepEqual(
    admitted,
    [],
    'two fails required is unreachable on a five-handed quest 1',
  )
})

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

test('transport canonicalization omits object undefined without weakening arrays', () => {
  const transported = canonicalizeTransportJson(
    {
      kept: 1,
      omitted: undefined,
      nested: { omitted: undefined, kept: true },
    },
    1_000,
  )
  assert.equal(transported.ok, true)
  if (!transported.ok) return
  assert.equal(
    JSON.stringify(transported.payload),
    '{"kept":1,"nested":{"kept":true}}',
  )
  assert.equal(
    transported.bytes,
    Buffer.byteLength(JSON.stringify(transported.payload)),
  )
  assert.deepEqual(
    canonicalizeTransportJson([undefined], 1_000),
    { ok: false, failureCode: 'payload-json-unsafe' },
  )
  const cyclic: any = {}
  cyclic.self = cyclic
  const sparse = new Array(2)
  sparse[1] = true
  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'value', {
    enumerable: true,
    get() {
      accessorReads++
      return true
    },
  })
  const symbolKeyed = { value: true } as Record<PropertyKey, unknown>
  symbolKeyed[Symbol('hidden')] = true
  for (const hostile of [
    new Proxy({ value: true }, {}),
    accessor,
    cyclic,
    sparse,
    symbolKeyed,
    { value: Number.NaN },
    { value: Number.POSITIVE_INFINITY },
  ]) {
    assert.deepEqual(
      canonicalizeTransportJson(hostile, 1_000),
      { ok: false, failureCode: 'payload-json-unsafe' },
    )
  }
  assert.equal(accessorReads, 0)
})

test('native decoders preserve raw-validator semantics after one boundary', () => {
  const { treatment, objective } = nativeFixture()
  const good = goodNativeFixture()
  const evil = evilNativeFixture()
  const morgana = morganaNativeFixture()
  const robust = robustQuestNativeFixture()
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
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateMordredBlindnessObjective,
    decode: decodeCanonicalPrivateMordredBlindnessObjective,
    invalidValue: { ...objective, role: 'merlin' },
  })
  assertNativeCodecContract({
    label: GOOD_ROLE_OBJECTIVE_COMPONENT.id,
    value: good.objective,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateRoleObjectiveSnapshot,
    invalidValue: { ...good.objective, role: 'servant' },
  })
  assertNativeCodecContract({
    label: GOOD_ROLE_UTILITY_COMPONENT.id,
    value: good.utility,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateRoleUtilityProjection,
    decode: decodeCanonicalPrivateRoleUtilityProjection,
    invalidValue: { ...good.utility, role: 'servant' },
  })
  assertNativeCodecContract({
    label: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
    value: evil.objective,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateEvilRoleObjectiveSnapshot,
    decode: decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
    invalidValue: { ...evil.objective, role: 'servant' },
  })
  assertNativeCodecContract({
    label: EVIL_ROLE_UTILITY_COMPONENT.id,
    value: evil.utility,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateEvilRoleUtilityProjection,
    decode: decodeCanonicalPrivateEvilRoleUtilityProjection,
    invalidValue: { ...evil.utility, role: 'servant' },
  })
  assertNativeCodecContract({
    label: MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
    value: morgana.publicRead,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePublicCounterfeitMerlinRead,
    decode: decodeCanonicalPublicCounterfeitMerlinRead,
    invalidValue: { ...morgana.publicRead, playerCount: 4 },
  })
  assertNativeCodecContract({
    label: MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
    value: morgana.objective,
    maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    validate: validatePrivateMorganaCounterfeitObjective,
    decode: decodeCanonicalPrivateMorganaCounterfeitObjective,
    invalidValue: { ...morgana.objective, role: 'merlin' },
  })
  for (const [token, utility] of [
    [MORGANA_ROLE_UTILITY_COMPONENT, morgana.utility],
    [MORGANA_ROLE_UTILITY_SEEDED_COMPONENT, morgana.seededUtility],
  ] as const) {
    assertNativeCodecContract({
      label: token.id,
      value: utility,
      maxBytes: DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
      validate: validatePrivateMorganaRoleUtilityProjection,
      decode: decodeCanonicalPrivateMorganaRoleUtilityProjection,
      invalidValue: { ...utility, role: 'merlin' },
    })
  }
  assertNativeCodecContract({
    label: EVIL_QUEST_CARD_ROBUST_COMPONENT.id,
    value: robust.policy,
    maxBytes: MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
    validate: (value) => {
      const canonical = canonicalizeJson(
        value,
        MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
      )
      return canonical.ok
        && decodeCanonicalRobustEvilQuestCardPolicy(
          canonical.payload,
        ) !== undefined
    },
    decode: decodeCanonicalRobustEvilQuestCardPolicy,
    invalidValue: {
      ...robust.policy,
      coordinationAssumption: 'homogeneous-common-policy-required',
    },
  })
})

test('native robust quest family conforms through execution and host join', async () => {
  const robust = robustQuestNativeFixture()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [EVIL_QUEST_CARD_ROBUST_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const entries = [{
    token: EVIL_QUEST_CARD_ROBUST_COMPONENT,
    verification: 'exact' as const,
    promotionEligible: true,
    missingRootFailure: 'host-input-unavailable',
  }]
  assertProofCoverage('robust-quest-native-family', [
    EVIL_QUEST_CARD_ROBUST_COMPONENT,
  ])
  await assertNativeExecutionContract({
    label: 'robust quest native family',
    registry,
    request: robust.req,
    view: robust.view,
    brain,
    hostInputs: [
      { input: PRIVATE_SITUATION_INPUT, value: robust.analysis },
      { input: PRIVATE_FORCED_POLICY_INPUT, value: robust.forced },
    ],
    entries,
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

// The servant family is the one that needs no roots. Every other native
// component degrades to host-input-unavailable or dependency-unavailable when
// run bare, because each depends on a belief, an identity, or an observer the
// host must supply. The servant objective reaches the public record through
// the acting seat's own view, so running it with NO host inputs still admits.
// That is the registration proving the structural claim from the module: a new
// role costs its weights, not a new substrate.
test('native servant family conforms with no host inputs at all', async () => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.view.role === 'servant',
  )
  assert.ok(fixture, 'a servant decision fixture must exist')
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [SERVANT_OBJECTIVE_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  const entries = [
    {
      token: SERVANT_OBJECTIVE_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      // Not a failure code: with no roots to miss, the bare run still admits.
      missingRootFailure: 'admitted',
    },
  ]
  assertProofCoverage(
    'servant-native-family',
    entries.map((entry) => entry.token),
  )
  await assertNativeExecutionContract({
    label: 'servant native family',
    registry,
    request: fixture.req,
    view: fixture.view,
    brain,
    hostInputs: [],
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

test('native Morgana family conforms through execution and host join', async () => {
  const morgana = morganaNativeFixture()
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [
      MORGANA_ROLE_UTILITY_COMPONENT,
      MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
    ],
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
    {
      token: MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'admitted',
    },
    {
      token: MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'host-input-unavailable',
    },
    {
      token: MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'dependency-unavailable',
    },
    {
      token: MORGANA_ROLE_UTILITY_COMPONENT,
      verification: 'exact' as const,
      promotionEligible: true,
      missingRootFailure: 'dependency-unavailable',
    },
  ]
  assertProofCoverage(
    'morgana-native-family',
    entries.map((entry) => entry.token).filter((token) =>
      token.id.startsWith('morgana-')),
  )
  await assertNativeExecutionContract({
    label: 'Morgana native family',
    registry,
    request: morgana.req,
    view: morgana.view,
    brain,
    hostInputs: [
      { input: PRIVATE_IDENTITY_INPUT, value: morgana.identity },
      { input: PRIVATE_PUBLIC_OBSERVER_INPUT, value: morgana.observer },
      { input: PRIVATE_BELIEF_INPUT, value: morgana.belief },
      { input: PRIVATE_FORCED_POLICY_INPUT, value: morgana.forced },
      {
        input: PRIVATE_DETERMINISTIC_SEED_INPUT,
        value: morgana.deterministicSeed,
      },
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

test('admitted Morgana objective join trusts admitted roots and dependency', () => {
  const morgana = morganaNativeFixture()
  const admittedBelief = {
    ...morgana.belief,
    modelVersion: '',
  } as unknown as typeof morgana.belief
  const admittedPublicRead = {
    ...morgana.publicRead,
    version: 'already-admitted-public-read',
  } as unknown as typeof morgana.publicRead
  assert.throws(() => projectJointIdentity(admittedBelief, {
    roleQueries: [],
    hiddenTeam: true,
  }))
  assert.equal(validatePublicCounterfeitMerlinRead(admittedPublicRead), false)
  const input = {
    req: morgana.req,
    view: morgana.view,
    belief: admittedBelief,
    publicRead: admittedPublicRead,
    candidates: legalCandidates(morgana.req, morgana.view),
  }
  const payload = buildAdmittedMorganaCounterfeitObjective(input)
  assert.equal(validatePrivateMorganaCounterfeitObjective(payload), false)
  assert.equal(validateAdmittedPrivateMorganaCounterfeitHostJoin(
    payload,
    input,
  ), true)
})

test('admitted Morgana utility join trusts both admitted dependencies', () => {
  const morgana = morganaNativeFixture()
  const objective = {
    ...morgana.objective,
    version: 'already-admitted-counterfeit-objective',
  } as unknown as typeof morgana.objective
  const evilRoleUtility = {
    ...morgana.utility.evilRoleUtility,
    version: 'already-admitted-evil-utility',
  } as unknown as typeof morgana.utility.evilRoleUtility
  assert.equal(validatePrivateMorganaCounterfeitObjective(objective), false)
  assert.equal(validatePrivateEvilRoleUtilityProjection(evilRoleUtility), false)
  const input = {
    req: morgana.req,
    view: morgana.view,
    candidates: legalCandidates(morgana.req, morgana.view),
    forced: morgana.forced,
    counterfeitObjective: objective,
    evilRoleUtility,
    selectionMode: 'top-counterfeit-within-d2-band' as const,
    deterministicSeed: morgana.deterministicSeed,
  }
  const payload = buildAdmittedMorganaRoleUtilityProjection(input)
  assert.equal(
    validatePrivateMorganaRoleUtilityProjection(payload),
    false,
  )
  assert.equal(
    validateAdmittedPrivateMorganaRoleUtilityHostJoin(payload, input),
    true,
  )
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
