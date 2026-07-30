// Migration NB-013 (first half); see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { runArchitectureBench } from '../server/eval/architecture-bench.ts'
import {
  architectureReport,
  renderArchitectureReport,
} from '../server/eval/architecture-report.ts'
import {
  addVoteConfusion,
  countVoteByDirection,
  emptyVoteConfusion,
  teamIsDirty,
  voteRateCount,
} from '../server/eval/vote-direction.ts'
import type { VoteConfusionCounts } from '../server/eval/vote-direction.ts'
import type { AgentDef } from '../server/agents/defs.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'
import type { GameEvent, Seat } from '../server/engine/types.ts'

function tally(
  votes: readonly Readonly<{ dirty: boolean; approve: boolean }>[],
): VoteConfusionCounts {
  const counts = emptyVoteConfusion()
  for (const vote of votes) {
    countVoteByDirection(
      counts,
      vote.approve ? 'approve' : 'reject',
      vote.dirty,
    )
  }
  return counts
}

test('the two error directions split a pair symmetric accuracy cannot tell apart', () => {
  // Each seat casts one right and one wrong vote, so symmetric agreement with
  // the deal is 50% for both. Only the direction of the wrong vote differs, and
  // NB-010 measured that the direction is what tracks the win rate.
  const rejectsClean = tally([
    { dirty: false, approve: false },
    { dirty: true, approve: false },
  ])
  const approvesDirty = tally([
    { dirty: false, approve: true },
    { dirty: true, approve: true },
  ])

  assert.deepEqual(
    voteRateCount(rejectsClean, 'truth'),
    voteRateCount(approvesDirty, 'truth'),
  )
  assert.deepEqual(voteRateCount(rejectsClean, 'truth'), {
    successes: 1,
    trials: 2,
  })

  // The costly error: it is invisible above and total here.
  assert.deepEqual(voteRateCount(rejectsClean, 'dirty-team-approve'), {
    successes: 0,
    trials: 1,
  })
  assert.deepEqual(voteRateCount(approvesDirty, 'dirty-team-approve'), {
    successes: 1,
    trials: 1,
  })
  // The cheap error runs the other way, which is why averaging them hides both.
  assert.deepEqual(voteRateCount(rejectsClean, 'clean-team-reject'), {
    successes: 1,
    trials: 1,
  })
  assert.deepEqual(voteRateCount(approvesDirty, 'clean-team-reject'), {
    successes: 0,
    trials: 1,
  })
})

test('each directional rate is conditioned on the teams the seat was offered', () => {
  // Two dirty teams and one clean team. Marginal shares of all three votes
  // would read 33.3% and 33.3%; the conditional rates are 50% and 100%.
  const counts = tally([
    { dirty: true, approve: true },
    { dirty: true, approve: false },
    { dirty: false, approve: false },
  ])
  assert.deepEqual(voteRateCount(counts, 'dirty-team-approve'), {
    successes: 1,
    trials: 2,
  })
  assert.deepEqual(voteRateCount(counts, 'clean-team-reject'), {
    successes: 1,
    trials: 1,
  })
  assert.deepEqual(voteRateCount(counts, 'approve'), {
    successes: 1,
    trials: 3,
  })
  // Only the dirty-team reject agrees with the deal.
  assert.deepEqual(voteRateCount(counts, 'truth'), {
    successes: 1,
    trials: 3,
  })
})

test('the four cells stay consistent under addition and unknown vote values', () => {
  const left = tally([{ dirty: true, approve: true }])
  const right = tally([{ dirty: false, approve: false }])
  const total = addVoteConfusion(left, right)
  assert.deepEqual(total, {
    cleanApprovals: 0,
    cleanRejects: 1,
    dirtyApprovals: 1,
    dirtyRejects: 0,
  })
  // A value the engine never emits is left out of every cell rather than
  // folded into a direction, so no denominator can disagree with the cells.
  countVoteByDirection(total, 'abstain', true)
  countVoteByDirection(total, 'abstain', false)
  assert.equal(voteRateCount(total, 'truth').trials, 2)
})

test('an unknown team seat is refused rather than scored as clean', () => {
  const players = [
    { seat: 0 as Seat, alignment: 'good' as const },
    { seat: 1 as Seat, alignment: 'evil' as const },
  ]
  assert.equal(teamIsDirty(players, [0, 1]), true)
  assert.equal(teamIsDirty(players, [0]), false)
  // Every seat is resolved even after an evil one is found, so a malformed
  // team cannot be quietly reported as the cheap error instead of the costly.
  assert.throws(
    () => teamIsDirty(players, [1, 7], 'game-1'),
    /game-1: vote team contains an unknown seat 7/,
  )
})

const heuristic = (id: string): AgentDef => ({
  id,
  name: id,
  version: 1,
  engine: { type: 'heuristic' },
})

/**
 * Replaces the target seat's revealed votes with a hand-built pair, one clean
 * team and one dirty team, both voted the same way. The deal, cast, and table
 * are untouched, so the paired matched-variant law still holds.
 */
function withUniformVotes(
  source: GameArtifact,
  variant: string,
  vote: 'approve' | 'reject',
): GameArtifact {
  const artifact = structuredClone(source)
  artifact.architecture!.variant = variant
  const target = artifact.architecture!.targetSeat
  const ally = artifact.players.find(
    (player) => player.alignment === 'good' && player.seat !== target,
  )!
  const traitor = artifact.players.find(
    (player) => player.alignment === 'evil',
  )!
  const reveal = (seq: number, team: readonly Seat[]): GameEvent => ({
    seq,
    type: 'voteReveal',
    visibility: 'public',
    payload: { team: [...team], votes: [{ seat: target, vote }] },
  })
  const kept = artifact.log.filter((event) => event.type !== 'voteReveal')
  artifact.log = [
    ...kept,
    reveal(kept.length, [target, ally.seat]),
    reveal(kept.length + 1, [target, traitor.seat]),
  ]
  return artifact
}

test('the report separates the vote error directions a promotion is gated on', async () => {
  const [source] = await runArchitectureBench({
    variants: [{
      id: 'source',
      agent: heuristic('nb013-source'),
      components: { experiment: 'nb013' },
    }],
    cases: [{
      id: 'nb013-5p-merlin',
      seed: 'architecture-v1-5-merlin',
      playerCount: 5,
      roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
      talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
      targetRole: 'merlin',
      expectedTargetSeat: 4,
    }],
    bankId: 'nb013-bank',
  })

  const report = architectureReport([
    withUniformVotes(source, 'rejects-clean', 'reject'),
    withUniformVotes(source, 'approves-dirty', 'approve'),
  ])
  assert.equal(report.schema, 3)
  const [rejectsClean, approvesDirty] = report.variants

  // The symmetric metric is blind to the difference: one right, one wrong.
  assert.equal(rejectsClean.decisionQuality.voteTruthAccuracy.rate, 0.5)
  assert.equal(approvesDirty.decisionQuality.voteTruthAccuracy.rate, 0.5)

  assert.equal(rejectsClean.decisionQuality.voteDirtyTeamApproveRate.rate, 0)
  assert.equal(approvesDirty.decisionQuality.voteDirtyTeamApproveRate.rate, 1)
  assert.equal(rejectsClean.decisionQuality.voteCleanTeamRejectRate.rate, 1)
  assert.equal(approvesDirty.decisionQuality.voteCleanTeamRejectRate.rate, 0)
  assert.equal(
    rejectsClean.decisionQuality.voteDirtyTeamApproveRate.trials,
    1,
  )

  // The same split reaches the Merlin role slice, not just the variant total.
  const roleSlice = approvesDirty.byRole.find(
    (slice) => slice.role === 'merlin',
  )!
  assert.equal(roleSlice.decisionQuality.voteDirtyTeamApproveRate.rate, 1)
  assert.equal(roleSlice.decisionQuality.voteCleanTeamRejectRate.rate, 0)

  const [comparison] = report.comparisons
  assert.equal(comparison.matchedCases, 1)
  // The paired delta a promotion gate would read: the symmetric accuracy says
  // the candidate is unchanged while the costly error goes from none to all.
  assert.equal(comparison.voteTruthAccuracyDelta.delta, 0)
  assert.equal(comparison.voteDirtyTeamApproveRateDelta.delta, 1)
  assert.equal(comparison.voteCleanTeamRejectRateDelta.delta, -1)

  const rendered = renderArchitectureReport(report)
  assert.match(rendered, /vote-errors dirty-approve 0\.0% \(0\/1,/)
  assert.match(rendered, /vote-errors dirty-approve 100\.0% \(1\/1,/)
  assert.match(rendered, /clean-reject 100\.0% \(1\/1,/)
  assert.match(
    rendered,
    /vote-error deltas dirty-approve \+100\.0% .*clean-reject -100\.0%/,
  )
})
