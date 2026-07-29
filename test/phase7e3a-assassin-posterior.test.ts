import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { DecisionRequest, PlayerView, Role } from '../server/engine/types.ts'
import {
  buildPrivateAssassinMerlinPosterior,
  decodeCanonicalPrivateAssassinMerlinPosterior,
} from '../server/agents/analysis/assassin-merlin-posterior.ts'
import {
  ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP,
  MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
} from '../server/agents/analysis/assassin-merlin-posterior-types.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { canonicalizeJson } from '../server/agents/components/canonical-json.ts'
import { ASSASSIN_MERLIN_POSTERIOR_COMPONENT } from '../server/agents/components/native-role-components.ts'
import { PRIVATE_BELIEF_INPUT } from '../server/agents/components/native-score-components.ts'
import { createProductionComponentRegistry } from '../server/agents/components/production-registry.ts'
import { resolveComposedBrain } from '../server/agents/components/resolved-brain.ts'
import {
  assertNativeCodecContract,
  assertNativeExecutionContract,
} from './support/component-contract.ts'
import { testConfiguredPipeline } from './support/configured-pipeline.ts'

const FIVE: Role[] = ['merlin', 'servant', 'servant', 'assassin', 'mordred']
const TEN: Role[] = [
  'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
  'assassin', 'morgana', 'mordred', 'oberon',
]

function assassinFixture(
  roles: Role[] = FIVE,
  evidence = false,
): { game: ReturnType<typeof createGame>; view: PlayerView; req: DecisionRequest } {
  const game = createGame({
    seed: `phase7e3a-${roles.length}`,
    playerCount: roles.length,
    roles,
  })
  const assassin = game.players.find((player) => player.role === 'assassin')!
  const view = viewFor(game, assassin.seat)
  view.phase = 'assassination'
  view.round = 3
  view.proposalNum = 1
  if (evidence) {
    const partner = view.privateInfo.evilPartners![0]
    const [first, second, filler] = view.players
      .map((player) => player.seat)
      .filter((seat) => seat !== view.seat && seat !== partner)
    view.proposals = [
      {
        round: 1,
        proposalNum: 1,
        leader: first,
        team: [partner, first],
        votes: [{ seat: first, vote: 'approve' }],
        approved: true,
      },
      {
        round: 2,
        proposalNum: 1,
        leader: second,
        team: [partner, second, filler],
        votes: [{ seat: second, vote: 'reject' }],
        approved: true,
      },
    ]
  }
  return {
    game,
    view,
    req: {
      kind: 'assassinate',
      seat: assassin.seat,
      round: 3,
      proposalNum: 1,
    },
  }
}

test('joint prior and bounded behavior math respect Mordred sight and Oberon uncertainty', () => {
  const fixture = assassinFixture(FIVE, true)
  const posterior = buildPrivateAssassinMerlinPosterior({
    ...fixture,
    belief: exactBelief(fixture.view),
  })
  const supported = posterior.targets.filter((row) => row.priorProbability > 0)
  assert.deepEqual(supported.map((row) => row.priorProbability), [1 / 3, 1 / 3, 1 / 3])
  assert.deepEqual(
    supported.map((row) => [row.cleanTeamProposalRate, row.voteAgreement]),
    [[1, 1], [1, 0], [0, 0]],
  )
  assert.ok(close(posterior.source.behavioralLogWeightSpan, Math.LN2))
  const expectedMass = [1, 1 / Math.sqrt(2), 0.5]
  const total = expectedMass.reduce((sum, value) => sum + value, 0)
  supported.forEach((row, index) =>
    assert.ok(close(row.posteriorProbability, expectedMass[index] / total)))

  const oberonFixture = assassinFixture(TEN)
  const oberon = oberonFixture.game.players.find(
    (player) => player.role === 'oberon',
  )!.seat
  const oberonPosterior = buildPrivateAssassinMerlinPosterior({
    ...oberonFixture,
    belief: exactBelief(oberonFixture.view),
  })
  assert.ok(oberonPosterior.targets.find((row) => row.seat === oberon)!.priorProbability > 0)
  assert.ok(oberonPosterior.source.behavioralLogWeightSpan <= ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP)
})

test('rejected votes count while auto-approved proposals carry no vote evidence', () => {
  const fixture = assassinFixture()
  const belief = exactBelief(fixture.view)
  const baseline = buildPrivateAssassinMerlinPosterior({ ...fixture, belief })
  const partner = fixture.view.privateInfo.evilPartners![0]
  const [candidate, filler] = fixture.view.players
    .map((player) => player.seat)
    .filter((seat) => seat !== fixture.view.seat && seat !== partner)
  fixture.view.proposals = [
    {
      round: 2, proposalNum: 1, leader: candidate,
      team: [partner, candidate, filler],
      votes: [{ seat: candidate, vote: 'reject' }],
      approved: true, auto: true,
    },
    {
      round: 1, proposalNum: 1, leader: candidate,
      team: [partner, candidate],
      votes: [{ seat: candidate, vote: 'approve' }],
      approved: false,
    },
  ]
  const posterior = buildPrivateAssassinMerlinPosterior({ ...fixture, belief })
  const before = baseline.targets.find((row) => row.seat === candidate)!
  const after = posterior.targets.find((row) => row.seat === candidate)!
  assert.deepEqual(
    [after.proposalObservations, after.cleanTeamProposalRate,
      after.voteObservations, after.voteAgreement],
    [2, 1, 1, 1],
  )
  assert.ok(after.posteriorProbability > before.posteriorProbability)
})

test('native component reuses the generic codec, execution, and privacy contracts', async () => {
  const fixture = assassinFixture()
  const belief = exactBelief(fixture.view)
  const payload = buildPrivateAssassinMerlinPosterior({ ...fixture, belief })
  const validate = (value: unknown): boolean => {
    const canonical = canonicalizeJson(value, MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES)
    return canonical.ok
      && !!decodeCanonicalPrivateAssassinMerlinPosterior(canonical.payload)
  }
  assertNativeCodecContract({
    label: 'Assassin Merlin posterior',
    value: payload,
    maxBytes: MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
    validate,
    decode: decodeCanonicalPrivateAssassinMerlinPosterior,
    invalidValue: { ...payload, role: 'merlin' },
  })
  const scalarForgery = structuredClone(payload)
  scalarForgery.targets[0].proposalObservations = 0.5
  const forged = canonicalizeJson(
    scalarForgery,
    MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
  )
  assert.ok(forged.ok)
  assert.equal(
    forged.ok && decodeCanonicalPrivateAssassinMerlinPosterior(forged.payload),
    undefined,
  )
  const registry = createProductionComponentRegistry({
    goodObjectiveAllDecisionKinds: false,
  })
  const brain = resolveComposedBrain({
    requestedComponents: [ASSASSIN_MERLIN_POSTERIOR_COMPONENT],
    configuredPipeline: testConfiguredPipeline(),
  }, registry)
  await assertNativeExecutionContract({
    label: 'Assassin Merlin posterior',
    registry,
    brain,
    request: fixture.req,
    view: fixture.view,
    hostInputs: [{ input: PRIVATE_BELIEF_INPUT, value: belief }],
    entries: [{
      token: ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
      verification: 'exact',
      promotionEligible: true,
      missingRootFailure: 'host-input-unavailable',
    }],
  })
})

test('truth outside the captured seat view cannot affect the posterior', () => {
  const fixture = assassinFixture()
  const belief = exactBelief(fixture.view)
  const before = buildPrivateAssassinMerlinPosterior({ ...fixture, belief })
  const unknown = fixture.game.players.filter(
    (player) =>
      player.seat !== fixture.view.seat
      && !fixture.view.privateInfo.evilPartners!.includes(player.seat),
  )
  ;[unknown[0].role, unknown[1].role] = [unknown[1].role, unknown[0].role]
  ;[unknown[0].alignment, unknown[1].alignment] = [
    unknown[1].alignment,
    unknown[0].alignment,
  ]
  assert.deepEqual(
    buildPrivateAssassinMerlinPosterior({ ...fixture, belief }),
    before,
  )
})

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-12
}
