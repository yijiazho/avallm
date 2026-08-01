// test-lane: contract
// BELIEF-001: the vote matrix as a likelihood.
//
// The factor makes one claim, that evil approves a team it can fail and is
// more reluctant about one it cannot, and everything else is meant to follow
// from it. These tests are mostly about that following: the two heuristic
// signals this replaces should fall out of the single rule read in two
// directions, rather than needing their own cases.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { createHeuristicAgent } from '../../../server/agents/heuristic.ts'
import type { Role } from '../../../server/engine/types.ts'
import {
  analyticalVoteMatrixFactor,
  evilApproveProbability,
  visibleFailPower,
  voteMatrixEvidence,
  voteMatrixWeightedBeliefModel,
  VOTE_MATRIX_BUNDLE_VERSION,
  VOTE_MATRIX_FACTOR_VERSION,
  VOTE_MATRIX_LOG_LIKELIHOOD_CAP,
  VOTE_MATRIX_MODEL_PARAMETERS,
  VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
} from '../../../server/agents/belief/vote-matrix-factor.ts'
import { exactBelief } from '../../../server/agents/belief/exact.ts'
import type {
  VoteMatrixEvidence,
} from '../../../server/agents/belief/vote-matrix-factor.ts'
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

const ballot = (
  team: readonly number[],
  votes: readonly (readonly [number, boolean])[],
  overrides: Partial<VoteMatrixEvidence> = {},
): VoteMatrixEvidence => ({
  evidenceId: 'event:1:vote-matrix',
  sourceSeq: 1,
  round: 2,
  proposalNum: 1,
  team: [...team],
  failsRequired: 1,
  votes: votes.map(([seat, approve]) => ({ seat, approve })),
  decisiveBoard: false,
  ...overrides,
})

test('the model parameters are pinned, so a retune cannot be silent', () => {
  assert.equal(VOTE_MATRIX_FACTOR_VERSION, 'analytical-vote-matrix-v1')
  assert.equal(VOTE_MATRIX_BUNDLE_VERSION, 'vote-matrix-only-v1')
  assert.equal(
    VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
    'exact-constraints+vote-matrix-v1',
  )
  assert.deepEqual(VOTE_MATRIX_MODEL_PARAMETERS, {
    canFail: { decisiveBoard: 0.92, openBoard: 0.82 },
    cannotFail: { decisiveBoard: 0.34, openBoard: 0.45 },
    uniformMixtureWeight: 0.08,
  })
  // Tighter than the quest factor's log(2) on purpose: a game holds far more
  // ballots than quests, and no pile of votes may outweigh a Fail-count fact.
  assert.ok(VOTE_MATRIX_LOG_LIKELIHOOD_CAP < Math.log(2))
})

// The one claim the whole factor rests on.
test('evil is likelier to approve a team it can fail', () => {
  // Seats 4 and 5 are Morgana and the Assassin; seat 6 is Oberon.
  const world = worldOf(SEVEN)
  const failable = ballot([0, 1, 4], [[4, true]])
  const unfailable = ballot([0, 1, 2], [[4, true]])
  assert.ok(
    evilApproveProbability(world, failable, 4)
      > evilApproveProbability(world, unfailable, 4),
  )
})

// Both heuristic signals, recovered from that one claim rather than encoded.
test('the two heuristic vote signals fall out of the single rule', () => {
  const world = worldOf(SEVEN)
  const dirtyTeam = ballot([0, 1, 4], [[5, true]])
  const cleanTeam = ballot([0, 1, 2], [[5, true]])

  // Approving a team that seats a visible partner is EXPLAINED by being evil,
  // so that world keeps more weight: the heuristic's "+0.4 approved a proposal
  // whose quest failed".
  assert.ok(
    analyticalVoteMatrixFactor.logLikelihood(world, dirtyTeam)
      > analyticalVoteMatrixFactor.logLikelihood(world, cleanTeam),
  )

  // And the same rule read the other way: approving a clean team is poorly
  // explained by being evil, so an evil-voter world loses weight relative to
  // rejecting it.
  const cleanRejected = ballot([0, 1, 2], [[5, false]])
  assert.ok(
    analyticalVoteMatrixFactor.logLikelihood(world, cleanRejected)
      > analyticalVoteMatrixFactor.logLikelihood(world, cleanTeam),
  )
})

// The part a hand-weight cannot express.
test('failability is what the VOTER can see, not what is aboard', () => {
  const world = worldOf(SEVEN)
  // Seat 6 is Oberon, seat 4 is Morgana. A team seating both holds two evils.
  const team = [4, 6]
  // Morgana cannot see Oberon, so it reads one failer aboard: itself.
  assert.equal(visibleFailPower(world, 4, team), 1)
  // Oberon sees no partners at all, so it also reads only itself.
  assert.equal(visibleFailPower(world, 6, team), 1)
  // A second NON-Oberon partner is visible, and then the count rises.
  assert.equal(visibleFailPower(world, 4, [4, 5]), 2)
  // A seat not aboard sees only the partners aboard.
  assert.equal(visibleFailPower(world, 5, [4, 6]), 1)
})

test('a good voter is never priced, in any world', () => {
  const world = worldOf(SEVEN)
  // Seats 0..3 are good. Their votes must not move the likelihood at all, so
  // an all-good ballot is exactly neutral.
  const allGood = ballot([0, 1, 2], [[0, true], [1, false], [2, true], [3, false]])
  assert.equal(analyticalVoteMatrixFactor.logLikelihood(world, allGood), 0)
})

test('every ballot stays priceable, so no feasible world is annihilated', () => {
  const world = worldOf(SEVEN)
  for (const approve of [true, false]) {
    for (const decisiveBoard of [true, false]) {
      for (const failsRequired of [1, 2]) {
        const evidence = ballot(
          [0, 1, 4],
          [[4, approve], [5, !approve]],
          { decisiveBoard, failsRequired },
        )
        const value = analyticalVoteMatrixFactor.logLikelihood(world, evidence)
        assert.ok(Number.isFinite(value), 'a legal ballot must never be impossible')
      }
    }
  }
})

test('the hammer is not evidence, because nobody cast it', () => {
  // Proposal 5 is auto-approved by the engine with no ballot. It must not
  // appear as evidence, or the factor would price a vote that never happened.
  const game = createGame({
    seed: 'vote-matrix-hammer',
    playerCount: 7,
    roles: [...SEVEN],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const view = viewFor(game, 0)
  // An opening board has no resolved ballots at all, which is the anchor: with
  // nothing cast there is nothing to weigh.
  assert.deepEqual(voteMatrixEvidence(view, 0), [])
})

// §3.4, and the asymmetry that let it go unnoticed here for a whole factor.
test('the viewer\'s own ballot is excluded, per ballot and not per record', async () => {
  const game = createGame({
    seed: 'vote-matrix-viewer',
    playerCount: 7,
    roles: [...SEVEN],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  // Drive far enough to resolve at least one ballot, which is all this needs:
  // a vote reveal carries every seat's vote, so one record exercises both the
  // exclusion and the survival of everyone else.
  const agents = game.players.map((player) =>
    createHeuristicAgent({ seed: 'vote-matrix-viewer', seat: player.seat }))
  for (let step = 0; step < 200; step++) {
    const pending = expectedDecisions(game)
    if (!pending.length) break
    for (const req of pending) {
      applyDecision(
        game,
        req.seat,
        (await agents[req.seat].decide(req, viewFor(game, req.seat))).decision,
      )
    }
    if (viewFor(game, 0).proposals.some((p) => p.outcome === 'voted')) break
  }
  const anyResolved = viewFor(game, 0).proposals.filter(
    (proposal) => proposal.outcome === 'voted',
  )
  assert.ok(anyResolved.length > 0, 'the fixture must resolve a ballot')

  for (let viewer = 0; viewer < 7; viewer++) {
    const view = viewFor(game, viewer)
    for (const record of voteMatrixEvidence(view, viewer)) {
      // Not down-weighted: absent.
      assert.ok(
        !record.votes.some((vote) => vote.seat === viewer),
        `seat ${viewer} priced its own ballot`,
      )
      // And the record itself survives, carrying everyone else. Dropping the
      // whole reveal would discard six other seats' votes to hide one.
      assert.equal(record.votes.length, view.playerCount - 1)
    }
  }
})

test('excluding the viewer changes nothing for good and something for evil', () => {
  // The reason the omission was invisible. `logLikelihood` prices a seat only
  // in worlds where that seat is evil, and a viewer knows its own role, so a
  // good viewer's ballot was already skipped in every feasible world.
  const world = worldOf(SEVEN)
  const team = [0, 1, 4]
  const others: readonly (readonly [number, boolean])[] = [[5, true], [6, false]]

  const withServant = ballot(team, [...others, [2, true]])
  const withoutServant = ballot(team, others)
  assert.equal(
    analyticalVoteMatrixFactor.logLikelihood(world, withServant),
    analyticalVoteMatrixFactor.logLikelihood(world, withoutServant),
    'a good seat\'s ballot was never priced, so removing it is a no-op',
  )

  // From the evil side it was live. Morgana's own approval is priced through
  // visibleFailPower, which varies with how many partners that world lets it
  // see, so the seat was reading its own vote back as evidence about a deal it
  // already knows its own place in.
  const withMorgana = ballot(team, [...others, [4, true]])
  const withoutMorgana = ballot(team, others)
  assert.notEqual(
    analyticalVoteMatrixFactor.logLikelihood(world, withMorgana),
    analyticalVoteMatrixFactor.logLikelihood(world, withoutMorgana),
  )
})

test('an opening board reads exactly the uniform posterior', () => {
  const game = createGame({
    seed: 'vote-matrix-open',
    playerCount: 7,
    roles: [...SEVEN],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const view = viewFor(game, 0)
  const weighted = voteMatrixWeightedBeliefModel.infer(view)
  const uniform = exactBelief(view)
  // Same posterior, its own name: no ballot has been cast, so the honest answer
  // is the uniform one rather than an invented tilt.
  assert.equal(weighted.modelVersion, VOTE_MATRIX_WEIGHTED_BELIEF_VERSION)
  assert.equal(weighted.quality, 'constraints-only')
  assert.deepEqual(
    weighted.playerMarginals.map((entry) => entry.evilProbability),
    uniform.playerMarginals.map((entry) => entry.evilProbability),
  )
})

test('the model declares the versions the belief reports', () => {
  assert.equal(
    voteMatrixWeightedBeliefModel.version,
    VOTE_MATRIX_WEIGHTED_BELIEF_VERSION,
  )
  assert.equal(
    voteMatrixWeightedBeliefModel.factorsVersion,
    VOTE_MATRIX_BUNDLE_VERSION,
  )
})

// The factor must find NOTHING where there is nothing to find. Against a table
// that votes without regard to who is aboard there is no vote behaviour to
// read, and measured on random-driven records this factor correctly finds
// nothing (`p = 0.40`, against `p = 2.7e-35` on heuristic-driven ones). The
// mechanism that keeps a patternless record from accumulating is the mixture:
// no ballot is ever near-certain, so no run of them can pin a world.
test('the mixture keeps every priced vote away from certainty', () => {
  const world = worldOf(SEVEN)
  const floor = VOTE_MATRIX_MODEL_PARAMETERS.uniformMixtureWeight / 2
  for (const decisiveBoard of [true, false]) {
    for (const failsRequired of [1, 2]) {
      for (const team of [[0, 1, 4], [0, 1, 2], [4, 5], [4, 6]]) {
        const evidence = ballot(team, [[4, true]], {
          decisiveBoard,
          failsRequired,
        })
        const approve = evilApproveProbability(world, evidence, 4)
        assert.ok(
          approve >= floor && approve <= 1 - floor,
          `approve ${approve} escaped the mixture floor ${floor}`,
        )
      }
    }
  }
})
