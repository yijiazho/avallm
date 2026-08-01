// test-lane: contract
// BELIEF-001: the proposal record as a likelihood.
//
// The factor makes one claim, that an evil leader normally seats a partner it
// can SEE less often than chance would because a clean-reading team is the
// cheapest cover in the game, with named exceptions where the arithmetic
// overrides the cover. The direction of that claim is the whole model and the
// first version of the file had it backwards, so the first two tests below pin
// the sign against `docs/research-strategy.md` §1 and §5.4 rather than against
// anything measured. The rest are about what must not break on the way to a
// posterior: the baseline has to be world-invariant so good leaders cancel, the
// viewer's own proposals have to vanish entirely, and no team may ever be
// impossible.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createGame, applyDecision, expectedDecisions } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { createHeuristicAgent } from '../../../server/agents/heuristic.ts'
import type { Role, Seat } from '../../../server/engine/types.ts'
import {
  analyticalProposalFactor,
  baselineInclusionRate,
  inclusionProbability,
  partnerOddsLift,
  partnerVisibleToLeader,
  proposalEvidence,
  proposalWeightedBeliefModel,
  PROPOSAL_BUNDLE_VERSION,
  PROPOSAL_FACTOR_VERSION,
  PROPOSAL_LOG_LIKELIHOOD_CAP,
  PROPOSAL_MODEL_PARAMETERS,
  PROPOSAL_WEIGHTED_BELIEF_VERSION,
} from '../../../server/agents/belief/proposal-factor.ts'
import type {
  ProposalEvidence,
} from '../../../server/agents/belief/proposal-factor.ts'
import { exactBelief } from '../../../server/agents/belief/exact.ts'
import type { HiddenWorld } from '../../../server/agents/belief/types.ts'
import { canonicalWorldKey } from '../../../server/agents/belief/worlds.ts'
import { ROLE_ALIGNMENT } from '../../../server/engine/rules.ts'

const SEVEN: Role[] = [
  'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin', 'oberon',
]

/**
 * A world by role assignment, which is all this factor reads. Alignment comes
 * from the engine's own table rather than a list retyped here, so a new evil
 * role cannot be good in this fixture and evil everywhere else.
 */
const worldOf = (roles: readonly Role[]): HiddenWorld => ({
  roleBySeat: [...roles],
  alignmentBySeat: roles.map((role) => ROLE_ALIGNMENT[role]),
  key: canonicalWorldKey(roles),
})

const proposal = (
  leader: Seat,
  team: readonly number[],
  overrides: Partial<ProposalEvidence> = {},
): ProposalEvidence => ({
  evidenceId: 'event:1:proposal',
  sourceSeq: 1,
  round: 2,
  proposalNum: 1,
  leader,
  team: [...team],
  playerCount: 7,
  failsRequired: 1,
  decisiveBoard: false,
  hammer: false,
  ...overrides,
})

const NO_DISCUSSION = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
} as const

test('the model parameters are pinned, so a retune cannot be silent', () => {
  assert.equal(PROPOSAL_FACTOR_VERSION, 'analytical-proposal-v1')
  assert.equal(PROPOSAL_BUNDLE_VERSION, 'proposal-only-v1')
  assert.equal(
    PROPOSAL_WEIGHTED_BELIEF_VERSION,
    'exact-constraints+proposal-v1',
  )
  assert.deepEqual(PROPOSAL_MODEL_PARAMETERS, {
    partnerOddsLift: {
      hammer: 1.6,
      twoFailsRequired: 2.2,
      decisiveBoard: 1.6,
      firstRound: 0.5,
      laterRound: 0.6,
    },
    uniformMixtureWeight: 0.08,
  })
  // The proposal record is the longest behavioural record the game produces:
  // every ballot has a proposal behind it and the hammer adds one more. So the
  // cap is at least as tight as the vote factor's, and tighter than the quest
  // factor's log(2).
  assert.equal(PROPOSAL_LOG_LIKELIHOOD_CAP, Math.log(1.5))
  assert.ok(PROPOSAL_LOG_LIKELIHOOD_CAP < Math.log(2))
})

// The one claim the whole factor rests on, and the direction the first version
// of the file had backwards. research-strategy.md §1 calls "propose teams with
// evil players on them" the AvalonBench NAIVE MINION baseline and says real
// evil play is that plus camouflage; §5.4, the script our own evil bots are
// prompted with, says propose semi-plausible teams including exactly one evil,
// yourself. So a stacked team is the SURPRISING observation under an
// evil-leader world, not the expected one.
test('a leader that seats a visible partner is worse explained by evil', () => {
  const world = worldOf(SEVEN)
  // Seats 4 and 5 are Morgana and the Assassin, and they see each other.
  const stacked = proposal(4, [4, 5, 0])
  const clean = proposal(4, [4, 0, 1])
  assert.ok(
    analyticalProposalFactor.logLikelihood(world, clean)
      > analyticalProposalFactor.logLikelihood(world, stacked),
  )
})

// The same rule read the other way, which is what makes it a likelihood and
// not a bonus: a stacked team is evidence AGAINST the world in which the
// leader could see what it was doing.
test('a stacked team is better explained by a leader who could not see it', () => {
  const evilLeader = worldOf(SEVEN)
  const stacked = proposal(4, [4, 5, 0])
  // The same public proposal, read in a world where seat 4 is a plain servant
  // and had no partner information at all, so seating 5 was chance.
  const goodLeader = worldOf([
    'merlin', 'percival', 'servant', 'morgana', 'servant', 'assassin', 'oberon',
  ])
  assert.ok(
    analyticalProposalFactor.logLikelihood(goodLeader, stacked)
      > analyticalProposalFactor.logLikelihood(evilLeader, stacked),
  )
})

// And the exceptions, which are the reason the model is contextual at all
// rather than one number: a quest a lone evil cannot fail overrides the cover.
test('the arithmetic overrides the cover where the brief says it does', () => {
  const world = worldOf(SEVEN)
  const stacked = (overrides: Partial<ProposalEvidence>) =>
    analyticalProposalFactor.logLikelihood(world, proposal(4, [4, 5, 0], overrides))
  const covered = stacked({ round: 3 })
  // A two-Fail quest needs two of them, so the partner aboard stops being a
  // surprise and starts being the point.
  assert.ok(stacked({ round: 3, failsRequired: 2 }) > covered)
  // So does a board where the game ends this quest either way.
  assert.ok(stacked({ round: 3, decisiveBoard: true }) > covered)
  // So does the hammer, which goes out whatever anybody thinks of it.
  assert.ok(stacked({ round: 3, hammer: true }) > covered)
})

// Why good leaders are priced at the baseline rather than skipped. A proposal
// prices ONE seat, and whether that seat is evil varies by world, so a skipped
// good leader would give different worlds different numbers of terms.
test('every good-leader world receives the identical constant', () => {
  const evidence = proposal(0, [0, 1, 2])
  // Seat 0 is good in both, and the two worlds disagree about everyone else.
  const first = analyticalProposalFactor.logLikelihood(worldOf(SEVEN), evidence)
  const second = analyticalProposalFactor.logLikelihood(
    worldOf([
      'merlin', 'morgana', 'assassin', 'oberon', 'percival', 'servant',
      'servant',
    ]),
    evidence,
  )
  // Equal to the last ulp of a seven-term log sum, which is what "identical
  // constant" means once the sum is accumulated in floating point.
  assert.ok(Math.abs(first - second) < 1e-12)
  // And the count of priced terms is the table minus the leader in every world,
  // which is what the equality above is really asserting.
  assert.ok(Number.isFinite(first))
})

// The part a hand-weight cannot express.
test('partner visibility is symmetric and Oberon is outside it', () => {
  const world = worldOf(SEVEN)
  // Seat 4 Morgana, seat 5 Assassin, seat 6 Oberon.
  assert.equal(partnerVisibleToLeader(world, 4, 5), true)
  assert.equal(partnerVisibleToLeader(world, 5, 4), true)
  // Neither side of an Oberon pairing sees the other, in either direction.
  assert.equal(partnerVisibleToLeader(world, 4, 6), false)
  assert.equal(partnerVisibleToLeader(world, 6, 4), false)
  // A good leader sees no partners, and a good seat is never a partner.
  assert.equal(partnerVisibleToLeader(world, 0, 4), false)
  assert.equal(partnerVisibleToLeader(world, 4, 0), false)
})

test('an Oberon leader reads exactly like a good one', () => {
  const world = worldOf(SEVEN)
  // Seat 6 is Oberon and knows nobody, so it has no partner information to act
  // on and its proposal must say nothing about the world.
  const withPartners = proposal(6, [6, 4, 5])
  const withoutPartners = proposal(6, [6, 0, 1])
  assert.ok(
    Math.abs(
      analyticalProposalFactor.logLikelihood(world, withPartners)
        - analyticalProposalFactor.logLikelihood(world, withoutPartners),
    ) < 1e-12,
  )
})

// §3.4, and the thing the vote-matrix factor does not do.
test('the viewer\'s own proposals are an exact, non-degraded no-op', async () => {
  const game = createGame({
    seed: 'proposal-factor-viewer',
    playerCount: 7,
    roles: [...SEVEN],
    talk: NO_DISCUSSION,
  })
  const agents = game.players.map((player) =>
    createHeuristicAgent({ seed: 'proposal-factor-viewer', seat: player.seat }))
  for (let step = 0; step < 400; step++) {
    const pending = expectedDecisions(game)
    if (!pending.length) break
    for (const req of pending) {
      const view = viewFor(game, req.seat)
      applyDecision(
        game,
        req.seat,
        (await agents[req.seat]!.decide(req, view)).decision,
      )
    }
    if (game.log.some((event) => event.type === 'proposal')) {
      // Only need enough record to hold proposals by several different leaders.
      const leaders = new Set(
        game.log
          .filter((event) => event.type === 'proposal')
          .map((event) => (event.payload as { leader: Seat }).leader),
      )
      if (leaders.size >= 3) break
    }
  }
  const seenLeaders = new Set(
    game.log
      .filter((event) => event.type === 'proposal')
      .map((event) => (event.payload as { leader: Seat }).leader),
  )
  assert.ok(seenLeaders.size >= 2, 'the fixture must hold several leaders')

  for (const viewer of seenLeaders) {
    const view = viewFor(game, viewer)
    const evidence = proposalEvidence(view, viewer)
    // Not merely down-weighted: absent.
    assert.ok(
      evidence.every((item) => item.leader !== viewer),
      'a viewer-authored proposal must not appear as evidence at all',
    )
    // And every other proposal in the record survives, so the exclusion is a
    // filter on authorship rather than a silent truncation.
    const visible = view.proposals.filter((item) => item.leader !== viewer)
    assert.equal(evidence.length, visible.length)
    // The posterior itself is non-degraded: an excluded proposal is not an
    // error path.
    const snapshot = proposalWeightedBeliefModel.infer(view)
    assert.deepEqual(snapshot.degradation, [])
    assert.notEqual(snapshot.quality, 'degraded')
  }
})

test('the baseline depends on the proposal shape, never on which seats', () => {
  // Same shape, disjoint teams: the baseline must not move, or it would be the
  // observed team and every world would price identically.
  assert.equal(
    baselineInclusionRate(proposal(0, [0, 1, 2])),
    baselineInclusionRate(proposal(0, [0, 5, 6])),
  )
  // Two of the six non-leader seats, because the leader took one of the three.
  assert.equal(baselineInclusionRate(proposal(0, [0, 1, 2])), 2 / 6)
  // A leader that left itself off distributes all three among the six.
  assert.equal(baselineInclusionRate(proposal(0, [1, 2, 3])), 3 / 6)
})

test('the lift is an odds lift, so it survives a change of table size', () => {
  const world = worldOf(SEVEN)
  const small = proposal(4, [4, 5, 0])
  const large = proposal(4, [4, 5, 0, 1, 2], { playerCount: 10 })
  // On both tables a visible partner must be strictly LESS likely to be aboard
  // than a seat the leader has no information about, and by a comparable
  // amount. A flat probability offset would not survive this: the ten-player
  // baseline (4/9) is nearly double the five-player one, so a constant that
  // suppressed on the small table could invert on the large one.
  for (const evidence of [small, large]) {
    assert.ok(
      inclusionProbability(world, evidence, 5)
        < inclusionProbability(world, evidence, 0),
      `the partner suppression inverted at playerCount ${evidence.playerCount}`,
    )
  }
})

test('the situation changes the price, in the documented precedence', () => {
  const lifts = PROPOSAL_MODEL_PARAMETERS.partnerOddsLift
  // Hammer first: an auto-approved proposal faces no ballot at all.
  assert.equal(
    partnerOddsLift(proposal(4, [4, 5], { hammer: true, failsRequired: 2 })),
    lifts.hammer,
  )
  // Then a two-fail quest, which a lone evil cannot fail whatever it draws.
  assert.equal(
    partnerOddsLift(proposal(4, [4, 5], { failsRequired: 2, decisiveBoard: true })),
    lifts.twoFailsRequired,
  )
  assert.equal(
    partnerOddsLift(proposal(4, [4, 5], { decisiveBoard: true, round: 1 })),
    lifts.decisiveBoard,
  )
  // Round one is the cheapest cover in the game, so it is the strongest
  // suppression of the five.
  assert.equal(partnerOddsLift(proposal(4, [4, 5], { round: 1 })), lifts.firstRound)
  assert.equal(partnerOddsLift(proposal(4, [4, 5], { round: 3 })), lifts.laterRound)
  // The default is camouflage; only the three named overrides sit above one.
  assert.ok(lifts.firstRound < lifts.laterRound)
  assert.ok(lifts.laterRound < 1)
  assert.ok(lifts.hammer > 1)
  assert.ok(lifts.twoFailsRequired > 1)
  assert.ok(lifts.decisiveBoard > 1)
})

test('every legal team stays priceable, so no feasible world is annihilated', () => {
  const world = worldOf(SEVEN)
  for (const hammer of [true, false]) {
    for (const decisiveBoard of [true, false]) {
      for (const failsRequired of [1, 2]) {
        for (const round of [1, 3]) {
          for (const team of [[4, 5, 6], [0, 1, 2], [4, 0, 1], [0, 1, 2, 3]]) {
            const value = analyticalProposalFactor.logLikelihood(
              world,
              proposal(4, team, { hammer, decisiveBoard, failsRequired, round }),
            )
            assert.ok(
              Number.isFinite(value),
              'a legal proposal must never be impossible',
            )
          }
        }
      }
    }
  }
})

// The mechanism that stops a long patternless record from pinning a world, and
// the same one the vote factor relies on.
test('the mixture keeps every priced seat away from certainty', () => {
  const world = worldOf(SEVEN)
  const floor = PROPOSAL_MODEL_PARAMETERS.uniformMixtureWeight / 2
  for (const hammer of [true, false]) {
    for (const failsRequired of [1, 2]) {
      for (const playerCount of [5, 7, 10]) {
        const evidence = proposal(4, [4, 5], { hammer, failsRequired, playerCount })
        for (const seat of [0, 5]) {
          const probability = inclusionProbability(world, evidence, seat)
          assert.ok(
            probability >= floor && probability <= 1 - floor,
            `inclusion ${probability} escaped the mixture floor ${floor}`,
          )
        }
      }
    }
  }
})

test('an opening board reads exactly the uniform posterior', () => {
  const game = createGame({
    seed: 'proposal-factor-open',
    playerCount: 7,
    roles: [...SEVEN],
    talk: NO_DISCUSSION,
  })
  const view = viewFor(game, 0)
  const weighted = proposalWeightedBeliefModel.infer(view)
  const uniform = exactBelief(view)
  // Nobody has proposed, so the honest answer is the uniform one rather than an
  // invented tilt.
  assert.deepEqual(proposalEvidence(view, 0), [])
  assert.equal(weighted.modelVersion, PROPOSAL_WEIGHTED_BELIEF_VERSION)
  assert.equal(weighted.quality, 'constraints-only')
  assert.deepEqual(
    weighted.playerMarginals.map((entry) => entry.evilProbability),
    uniform.playerMarginals.map((entry) => entry.evilProbability),
  )
})

test('the factor only redistributes inside the feasible set', async () => {
  const game = createGame({
    seed: 'proposal-factor-support',
    playerCount: 7,
    roles: [...SEVEN],
    talk: NO_DISCUSSION,
  })
  const agents = game.players.map((player) =>
    createHeuristicAgent({ seed: 'proposal-factor-support', seat: player.seat }))
  for (let step = 0; step < 60; step++) {
    const pending = expectedDecisions(game)
    if (!pending.length) break
    for (const req of pending) {
      applyDecision(
        game,
        req.seat,
        (await agents[req.seat]!.decide(req, viewFor(game, req.seat))).decision,
      )
    }
  }
  // A plain servant, so the feasible set is wide and the factor has room to act.
  const seat = game.players.find((player) => player.role === 'servant')!.seat
  const view = viewFor(game, seat)
  const uniform = exactBelief(view)
  const weighted = proposalWeightedBeliefModel.infer(view)
  assert.deepEqual(
    weighted.worlds.map((entry) => entry.world.key).sort(),
    uniform.worlds.map((entry) => entry.world.key).sort(),
    'the factor must not add or remove a world',
  )
  const total = weighted.worlds.reduce((sum, entry) => sum + entry.probability, 0)
  assert.ok(Math.abs(total - 1) < 1e-9)
  assert.ok(weighted.worlds.every((entry) => entry.probability > 0))
})

test('the model declares the versions the belief reports', () => {
  assert.equal(
    proposalWeightedBeliefModel.version,
    PROPOSAL_WEIGHTED_BELIEF_VERSION,
  )
  assert.equal(
    proposalWeightedBeliefModel.factorsVersion,
    PROPOSAL_BUNDLE_VERSION,
  )
})
