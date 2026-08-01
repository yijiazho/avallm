/**
 * Public salience of one seat, shared by Merlin's objective and role utility.
 *
 * The observer initializes approvalIndex to zero before any complete public
 * ballot. Zero would look maximally opinionated if interpreted immediately, so
 * approval contributes only after the record contains a full vote. The result
 * is a bounded deterministic proxy, not a posterior probability.
 */

import { proposalVotes } from '../../engine/rules.ts'
import type { PublicRecord } from '../record/public-record.ts'
import { clampProbability } from '../canonical/probability-arithmetic.ts'
import type { PublicObserverSeatAssessment } from './observer-types.ts'

type PublicVoteRecord = Pick<PublicRecord, 'playerCount' | 'proposals'>

export function publicSeatSalience(
  assessment: PublicObserverSeatAssessment,
  record: PublicVoteRecord,
): number {
  const hasCompletedPublicVote = record.proposals.some(
    (proposal) => proposalVotes(proposal).length === record.playerCount,
  )
  const behavior = assessment.behavior
  const approvalSalience = hasCompletedPublicVote
    ? Math.abs(behavior.approvalIndex - 0.5) * 2
    : 0
  const behaviorSalience = (
    behavior.proposalSelectionIndex
    + behavior.failedQuestExposureIndex
    + approvalSalience
  ) / 3
  return clampProbability(
    (assessment.goodProbability + behaviorSalience) / 2,
  )
}
