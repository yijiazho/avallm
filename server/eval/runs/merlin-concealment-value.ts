import { compareCandidateIds } from '../../agents/candidate/candidates.ts'
import {
  PROBABILITY_TOLERANCE,
} from '../../agents/canonical/probability-arithmetic.ts'
import { probability } from '../../agents/canonical/canonical-shape.ts'

export const MERLIN_CONCEALMENT_VALUE_VERSION =
  'merlin-outcome-aware-concealment-value-v1'
export const MERLIN_PIVOTAL_PRIOR_VERSION =
  'public-neutral-independent-pivotal-prior-v1'
export const MERLIN_PROPOSAL_DELAY_VERSION =
  'proven-clean-proposal-share-delay-cost-v1'

export type MerlinVote = 'approve' | 'reject'

export interface MerlinConcealmentCandidateInput {
  readonly candidateId: string
  readonly vote: MerlinVote
  /** Board-swing utility from the admitted good-vote score surface. */
  readonly boardUtility: number
  /** Merlin's legal private belief that the current team is clean. */
  readonly currentCleanProbability: number
  /** Public proposals remaining before the hammer, including this vote. */
  readonly rejectionsBeforeHammer: number
  /** Legal role-utility projection; lower means less self-exposure. */
  readonly correctedExposureProxyIndex: number
}

export interface MerlinConcealmentValueInput {
  readonly playerCount: number
  /** Converts one exposure-proxy unit into one board-utility unit. */
  readonly concealmentExchangeRate: number
  readonly candidates: readonly MerlinConcealmentCandidateInput[]
}

export interface MerlinConcealmentCandidateValue
extends MerlinConcealmentCandidateInput {
  readonly proposalDelayCost: number
  readonly strategicValueIfPivotal: number
  readonly concealmentValueIfNotPivotal: number
  readonly expectedStrategicValue: number
  readonly expectedConcealmentValue: number
  readonly totalValue: number
}

export interface MerlinConcealmentValueResult {
  readonly version: typeof MERLIN_CONCEALMENT_VALUE_VERSION
  readonly pivotalPriorVersion: typeof MERLIN_PIVOTAL_PRIOR_VERSION
  readonly proposalDelayVersion: typeof MERLIN_PROPOSAL_DELAY_VERSION
  readonly pivotalProbability: number
  readonly concealmentExchangeRate: number
  readonly candidates: readonly MerlinConcealmentCandidateValue[]
  readonly chosenCandidateId: string
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  const smaller = Math.min(k, n - k)
  let value = 1
  for (let index = 1; index <= smaller; index++) {
    value = value * (n - smaller + index) / index
  }
  return value
}

/**
 * Probability that this ballot alone changes a strict-majority result under a
 * public, information-independent 50/50 prior for every other ballot.
 *
 * This is deliberately a prior, not a claim that public behavior indices are
 * calibrated vote probabilities. Those indices explicitly are not
 * probabilities. The value is therefore stable, visible-information-only, and
 * auditable for every supported table size.
 */
export function neutralPivotalProbability(playerCount: number): number {
  if (!Number.isSafeInteger(playerCount) || playerCount < 5 || playerCount > 10) {
    throw new Error('Merlin pivotal prior requires a supported player count')
  }
  const otherVoters = playerCount - 1
  const approvalsNeededFromOthers = Math.floor(playerCount / 2)
  return choose(otherVoters, approvalsNeededFromOthers) / 2 ** otherVoters
}

function validateInput(input: MerlinConcealmentValueInput): void {
  neutralPivotalProbability(input.playerCount)
  if (
    !Number.isFinite(input.concealmentExchangeRate)
    || input.concealmentExchangeRate < 0
  ) throw new Error('concealment exchange rate must be finite and nonnegative')
  if (input.candidates.length !== 2) {
    throw new Error('outcome-aware Merlin voting requires two candidates')
  }
  const ids = new Set<string>()
  const votes = new Set<MerlinVote>()
  for (const candidate of input.candidates) {
    if (!candidate.candidateId.length || ids.has(candidate.candidateId)) {
      throw new Error('outcome-aware Merlin voting requires distinct candidate ids')
    }
    ids.add(candidate.candidateId)
    votes.add(candidate.vote)
    if (!Number.isFinite(candidate.boardUtility)) {
      throw new Error('board utility must be finite')
    }
    if (!probability(candidate.currentCleanProbability)) {
      throw new Error('current clean probability must be a finite probability')
    }
    if (!probability(candidate.correctedExposureProxyIndex)) {
      throw new Error('corrected exposure proxy must be a finite probability')
    }
    if (
      !Number.isSafeInteger(candidate.rejectionsBeforeHammer)
      || candidate.rejectionsBeforeHammer < 1
      || candidate.rejectionsBeforeHammer > 4
    ) throw new Error('rejections before hammer must be an integer from one to four')
  }
  if (!votes.has('approve') || !votes.has('reject')) {
    throw new Error('outcome-aware Merlin voting requires approve and reject')
  }
  const first = input.candidates[0]!
  if (input.candidates.some((candidate) =>
    candidate.currentCleanProbability !== first.currentCleanProbability
    || candidate.rejectionsBeforeHammer !== first.rejectionsBeforeHammer)) {
    throw new Error('outcome-aware Merlin candidates disagree on shared vote state')
  }
}

/**
 * Price a Merlin ballot in the two mutually exclusive states that matter.
 *
 * If the ballot is pivotal, the admitted board-swing utility is authoritative.
 * Rejecting a team the private posterior proves clean also consumes a visible
 * share of the remaining proposal runway. Uncertain teams pay no such premium:
 * partial confidence must not buy an approval when hidden Mordred remains legal.
 * If the ballot is not pivotal, it cannot change the proposal outcome,
 * so only the legal self-exposure proxy has value. The exchange rate remains an
 * explicit evaluation parameter instead of hiding a tuned constant in policy.
 */
export function valueOutcomeAwareMerlinVote(
  input: MerlinConcealmentValueInput,
): MerlinConcealmentValueResult {
  validateInput(input)
  const pivotalProbability = neutralPivotalProbability(input.playerCount)
  const candidates = input.candidates.map(
    (candidate): MerlinConcealmentCandidateValue => {
      const proposalDelayCost = candidate.vote === 'reject'
        && candidate.currentCleanProbability >= 1 - PROBABILITY_TOLERANCE
        ? 1 / (candidate.rejectionsBeforeHammer + 1)
        : 0
      const strategicValueIfPivotal =
        candidate.boardUtility - proposalDelayCost
      const concealmentValueIfNotPivotal =
        1 - candidate.correctedExposureProxyIndex
      const expectedStrategicValue =
        pivotalProbability * strategicValueIfPivotal
      const expectedConcealmentValue =
        (1 - pivotalProbability)
        * input.concealmentExchangeRate
        * concealmentValueIfNotPivotal
      return Object.freeze({
        ...candidate,
        proposalDelayCost,
        strategicValueIfPivotal,
        concealmentValueIfNotPivotal,
        expectedStrategicValue,
        expectedConcealmentValue,
        totalValue: expectedStrategicValue + expectedConcealmentValue,
      })
    },
  )
  const chosen = candidates.reduce((best, candidate) =>
    candidate.totalValue > best.totalValue
      || (
        candidate.totalValue === best.totalValue
        && compareCandidateIds(candidate.candidateId, best.candidateId) < 0
      )
      ? candidate
      : best)
  return Object.freeze({
    version: MERLIN_CONCEALMENT_VALUE_VERSION,
    pivotalPriorVersion: MERLIN_PIVOTAL_PRIOR_VERSION,
    proposalDelayVersion: MERLIN_PROPOSAL_DELAY_VERSION,
    pivotalProbability,
    concealmentExchangeRate: input.concealmentExchangeRate,
    candidates: Object.freeze(candidates),
    chosenCandidateId: chosen.candidateId,
  })
}
