// Migration NB-013 (second half); see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  goodVoteValue,
  isGoodVoteUtilityVersion,
  type GoodVoteValueInputs,
} from '../server/agents/policy/good-score-contract.ts'
import {
  boardSwingGoodProposalVoteScorer,
  createGoodProposalVoteScorer,
  goodProposalVoteScorer,
  seededGoodProposalVoteScorer,
} from '../server/agents/policy/score.ts'
import {
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
} from '../server/agents/score-layers/good.ts'
import {
  configuredScoreLayerTerminalFor,
} from '../server/agents/score-layers/configured.ts'
import {
  nb013VoteObjectiveVariants,
  NB013_VOTE_OBJECTIVE_VARIANTS,
} from '../server/eval/vote-objective-bench.ts'

const inputs = (
  overrides: Partial<GoodVoteValueInputs> = {},
): GoodVoteValueInputs => ({
  currentCleanProbability: 0.5,
  bestAlternativeCleanProbability: 0.5,
  matchPointGood: false,
  matchPointEvil: false,
  futureQuestsRemain: false,
  rejectionsBeforeHammer: 2,
  ...overrides,
})

test('the symmetric utility leaves approving a dirty team costless', () => {
  // The NB-013 defect, stated as an assertion: under the measured Phase 4B
  // value function a coin-flip team is worth half a quest and the chance it
  // seats evil subtracts nothing at all.
  const value = goodVoteValue(inputs(), GOOD_VOTE_UTILITY_VERSION)
  assert.equal(value.dirtyApprovalCost, 0)
  assert.equal(value.approveUtility, 0.5)
})

test('the board-swing utility prices the chance the team is dirty', () => {
  const value = goodVoteValue(inputs(), GOOD_VOTE_BOARD_SWING_UTILITY_VERSION)
  // P(clean) - P(dirty) at a coin flip is zero: the swing it risks is nil.
  assert.equal(value.approveUtility, 0)
  assert.equal(value.dirtyApprovalCost, 0.5)
  // A certainly clean team is worth exactly what it was worth before, so the
  // change cannot be dismissed as a uniform pessimism shift.
  const certain = goodVoteValue(
    inputs({ currentCleanProbability: 1 }),
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  )
  assert.equal(certain.approveUtility, 1)
  assert.equal(certain.dirtyApprovalCost, 0)
  assert.equal(
    certain.approveUtility,
    goodVoteValue(
      inputs({ currentCleanProbability: 1 }),
      GOOD_VOTE_UTILITY_VERSION,
    ).approveUtility,
  )
})

test('a certain posterior votes the same way unless every team is dirty', () => {
  // Merlin knows the deal, so its team probabilities are 0 or 1. Wherever some
  // clean team exists the swing term changes no vote, which is why the bench
  // reports no Merlin delta at all: that is a property of the value function
  // rather than luck of the bank.
  const prefersApprove = (
    shared: GoodVoteValueInputs,
    utilityVersion: typeof GOOD_VOTE_UTILITY_VERSION
      | typeof GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  ): boolean => {
    const value = goodVoteValue(shared, utilityVersion)
    return value.approveUtility > value.rejectUtility
  }
  for (const [current, alternative] of [[1, 1], [1, 0], [0, 1]] as const) {
    const shared = inputs({
      currentCleanProbability: current,
      bestAlternativeCleanProbability: alternative,
    })
    assert.equal(
      prefersApprove(shared, GOOD_VOTE_UTILITY_VERSION),
      prefersApprove(shared, GOOD_VOTE_BOARD_SWING_UTILITY_VERSION),
    )
  }
  // The one case that does move, and it moves the way NB-010 wants. With every
  // team on the table dirty, the symmetric value function approves the one in
  // hand rather than pay the hammer penalty, because seating evil is free.
  // Board swing refuses and spends the proposal instead.
  const allDirty = inputs({
    currentCleanProbability: 0,
    bestAlternativeCleanProbability: 0,
  })
  assert.equal(prefersApprove(allDirty, GOOD_VOTE_UTILITY_VERSION), true)
  assert.equal(
    prefersApprove(allDirty, GOOD_VOTE_BOARD_SWING_UTILITY_VERSION),
    false,
  )
})

test('both branches are rescaled, so the runway costs keep their meaning', () => {
  // The first NB-013 formulation priced only the approve branch and left the two
  // on different scales, which made the policy reject nearly every clean team.
  // Under board swing a seat offered the same probability either way still
  // prefers the team in hand, because rejecting still costs runway and hammer.
  const value = goodVoteValue(
    inputs({
      currentCleanProbability: 0.8,
      bestAlternativeCleanProbability: 0.8,
    }),
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  )
  assert.ok(value.approveUtility > value.rejectUtility)
  assert.ok(value.hammerPenalty > 0)
  assert.ok(value.alternativeRealization < 1)
})

test('the failed-quest weight is the board-slot swing, not a tuned scale', () => {
  assert.equal(GOOD_VOTE_UTILITY_CONSTANTS.failedQuestCost, 1)
  const value = goodVoteValue(
    inputs({ currentCleanProbability: 0.75 }),
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  )
  // stake * (P(clean) - P(dirty)) = 1 * (0.75 - 0.25).
  assert.equal(value.approveUtility, 0.5)
})

test('match point scales both the gain and the newly priced loss', () => {
  const value = goodVoteValue(
    inputs({ currentCleanProbability: 0.25, matchPointEvil: true }),
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  )
  assert.equal(value.stake, 1.5)
  // 1.5 * (0.25 - 0.75) = -0.75, and the cost term reports the stake-scaled
  // 1.5 * 0.75 given up rather than the unscaled 0.75.
  assert.equal(value.approveUtility, -0.75)
  assert.equal(value.dirtyApprovalCost, 1.125)
})

test('the board-swing value function is a separate recorded identity', () => {
  assert.equal(
    boardSwingGoodProposalVoteScorer.version,
    GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  )
  assert.notEqual(
    boardSwingGoodProposalVoteScorer.version,
    goodProposalVoteScorer.version,
  )
  assert.equal(
    createGoodProposalVoteScorer({
      selectionMode: 'top-utility',
      voteValue: 'board-swing',
    }),
    boardSwingGoodProposalVoteScorer,
  )
  // Omitting the option cannot silently opt in, and the existing arms keep the
  // identities their measurements were recorded under.
  assert.equal(
    createGoodProposalVoteScorer({ selectionMode: 'top-utility' }),
    goodProposalVoteScorer,
  )
  assert.equal(
    createGoodProposalVoteScorer({
      selectionMode: 'seeded-band',
      voteValue: 'symmetric',
    }),
    seededGoodProposalVoteScorer,
  )
  // A seeded board-swing arm was never measured, so it cannot be constructed.
  assert.throws(
    () => createGoodProposalVoteScorer({
      selectionMode: 'seeded-band',
      voteValue: 'board-swing',
    }),
    /no seeded-band twin/,
  )
  assert.equal(
    configuredScoreLayerTerminalFor(boardSwingGoodProposalVoteScorer),
    GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
  )
  assert.ok(isGoodVoteUtilityVersion(GOOD_VOTE_BOARD_SWING_UTILITY_VERSION))
  assert.ok(isGoodVoteUtilityVersion(GOOD_VOTE_UTILITY_VERSION))
  assert.equal(isGoodVoteUtilityVersion('good-vote-utility-v9'), false)
  assert.equal(isGoodVoteUtilityVersion(undefined), false)
})

test('the NB-013 gate bench differs from its baseline in the vote value only', () => {
  const [baseline, candidate] = nb013VoteObjectiveVariants()
  assert.equal(baseline.id, NB013_VOTE_OBJECTIVE_VARIANTS.symmetric)
  assert.equal(candidate.id, NB013_VOTE_OBJECTIVE_VARIANTS.boardSwing)
  // Everything the comparison holds fixed has to be identical, or the delta
  // cannot be attributed to the value function.
  const { scorer: baselineScorer, ...baselineRest } = baseline.components
  const { scorer: candidateScorer, ...candidateRest } = candidate.components
  assert.deepEqual(
    { ...baselineRest, evaluationRole: 'shared' },
    { ...candidateRest, evaluationRole: 'shared' },
  )
  assert.equal(baselineScorer, goodProposalVoteScorer.version)
  assert.equal(candidateScorer, GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION)
  assert.equal(baseline.paid, false)
  assert.equal(candidate.paid, false)
})
