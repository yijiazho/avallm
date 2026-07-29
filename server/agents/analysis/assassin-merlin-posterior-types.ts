import type { Seat } from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'

export const ASSASSIN_MERLIN_POSTERIOR_VERSION =
  'assassin-merlin-posterior-v1'
export const ASSASSIN_BEHAVIOR_COEFFICIENT_VERSION =
  'assassin-public-behavior-linear-v1'
export const ASSASSIN_MERLIN_POSTERIOR_DEGRADATION =
  'assassin-merlin-posterior-failed'
export const ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP = Math.LN2
export const MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES = 65_536

export const ASSASSIN_BEHAVIOR_COEFFICIENTS = Object.freeze({
  cleanTeamProposalRate: 0.4,
  voteAgreement: 0.4,
})

export interface AssassinMerlinTargetPosterior {
  seat: Seat
  knownVisibleEvil: boolean
  priorProbability: number
  proposalObservations: number
  cleanTeamProposalRate: number
  voteObservations: number
  voteAgreement: number
  posteriorProbability: number
}

export interface PrivateAssassinMerlinPosterior {
  version: typeof ASSASSIN_MERLIN_POSTERIOR_VERSION
  source: {
    beliefModelVersion: string
    beliefThroughSeq: number
    beliefQuality: BeliefSnapshot['quality']
    coefficientVersion: typeof ASSASSIN_BEHAVIOR_COEFFICIENT_VERSION
    behavioralLogWeightCap: typeof ASSASSIN_BEHAVIOR_LOG_WEIGHT_CAP
    behavioralLogWeightSpan: number
  }
  coefficients: typeof ASSASSIN_BEHAVIOR_COEFFICIENTS
  targets: readonly AssassinMerlinTargetPosterior[]
}
