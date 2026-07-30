// One definition of the good-side vote confusion matrix.
//
// Three offline readers label the same event: the architecture report's
// decision-quality block, the Phase 5C conversion report, and the NB-010
// good-policy diagnosis. A good-side vote has two error directions whose game
// value differs. Rejecting a clean team costs one proposal; approving a dirty
// team can cost a quest and the game. A symmetric accuracy that averages the
// two rose while the win rate fell, so NB-013 gates a promotion on the
// dirty-team approval rate falling instead. Owning both the cell assignment and
// every denominator here means the three readers cannot disagree about which
// cell a vote lands in, or about what a directional rate is conditioned on.
//
// Every input is the archived full reveal of a finished game. None of these
// labels enter a running agent.

import type { Alignment, Seat } from '../engine/types.ts'

/** One seat's revealed votes, split by team cleanliness and vote direction. */
export interface VoteConfusionCounts {
  cleanApprovals: number
  /** The cheap error: one wasted proposal. */
  cleanRejects: number
  /** The costly error: a quest evil can fail. */
  dirtyApprovals: number
  dirtyRejects: number
}

export type VoteConfusionRate =
  /** The costly error, conditioned on the dirty teams the seat was offered. */
  | 'dirty-team-approve'
  /** The cheap error, conditioned on the clean teams the seat was offered. */
  | 'clean-team-reject'
  /** Symmetric agreement with the deal. NB-013: cannot gate a promotion. */
  | 'truth'
  /** Raw approvals, which mix the two directions with the teams offered. */
  | 'approve'

export interface VoteRateCount {
  successes: number
  trials: number
}

export function emptyVoteConfusion(): VoteConfusionCounts {
  return {
    cleanApprovals: 0,
    cleanRejects: 0,
    dirtyApprovals: 0,
    dirtyRejects: 0,
  }
}

/**
 * Adds one revealed vote to the tally. A vote value the engine never emits is
 * left uncounted rather than folded into a direction, so no denominator can
 * quietly disagree with the four cells.
 */
export function countVoteByDirection(
  counts: VoteConfusionCounts,
  vote: string,
  dirtyTeam: boolean,
): void {
  if (dirtyTeam) {
    if (vote === 'approve') counts.dirtyApprovals++
    else if (vote === 'reject') counts.dirtyRejects++
    return
  }
  if (vote === 'approve') counts.cleanApprovals++
  else if (vote === 'reject') counts.cleanRejects++
}

/**
 * A team is dirty when any seat on it is evil. Every seat is resolved before
 * the answer is returned, and an unknown seat is refused: scoring it as good
 * would silently convert the costly error into the cheap one.
 */
export function teamIsDirty(
  players: readonly Readonly<{ seat: Seat; alignment: Alignment }>[],
  team: readonly number[],
  context?: string,
): boolean {
  let dirty = false
  for (const seat of team) {
    const player = players.find((candidate) => candidate.seat === seat)
    if (!player) {
      throw new Error(
        `${context ? `${context}: ` : ''}`
        + `vote team contains an unknown seat ${seat}`,
      )
    }
    if (player.alignment === 'evil') dirty = true
  }
  return dirty
}

/** The successes and trials of one named rate over the four cells. */
export function voteRateCount(
  counts: VoteConfusionCounts,
  of: VoteConfusionRate,
): VoteRateCount {
  const cleanTeamVotes = counts.cleanApprovals + counts.cleanRejects
  const dirtyTeamVotes = counts.dirtyApprovals + counts.dirtyRejects
  switch (of) {
    case 'dirty-team-approve':
      return { successes: counts.dirtyApprovals, trials: dirtyTeamVotes }
    case 'clean-team-reject':
      return { successes: counts.cleanRejects, trials: cleanTeamVotes }
    case 'truth':
      return {
        successes: counts.cleanApprovals + counts.dirtyRejects,
        trials: cleanTeamVotes + dirtyTeamVotes,
      }
    case 'approve':
      return {
        successes: counts.cleanApprovals + counts.dirtyApprovals,
        trials: cleanTeamVotes + dirtyTeamVotes,
      }
  }
}

export function addVoteConfusion(
  left: VoteConfusionCounts,
  right: VoteConfusionCounts,
): VoteConfusionCounts {
  return {
    cleanApprovals: left.cleanApprovals + right.cleanApprovals,
    cleanRejects: left.cleanRejects + right.cleanRejects,
    dirtyApprovals: left.dirtyApprovals + right.dirtyApprovals,
    dirtyRejects: left.dirtyRejects + right.dirtyRejects,
  }
}
