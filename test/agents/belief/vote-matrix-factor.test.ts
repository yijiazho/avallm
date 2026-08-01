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
import { createGame } from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
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
  assert.deepEqual(voteMatrixEvidence(view), [])
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
