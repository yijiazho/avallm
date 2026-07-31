import type { Seat } from '../../engine/types.ts'
import {
  ACTOR_TARGET_TREATMENT_READ_VERSION,
} from './actor-target-treatment-types.ts'
import type { ObjectiveSourceBase } from './role-objective-types.ts'

export const MORDRED_BLINDNESS_OBJECTIVE_VERSION =
  'mordred-blindness-objective-v1'
export const MORDRED_BLINDNESS_DEGRADATION =
  'mordred-blindness-objective-failed'
export const MAX_MORDRED_BLINDNESS_ASSESSMENTS = 252

export interface MordredMerlinHypothesis {
  seat: Seat
  hypothesisSemantics:
    'legal-world-merlin-coordinate-not-privileged-identity'
  worldMass: number
  observationCoverageMass: number
  anomalousTreatmentMass: number
  conditionalAnomalousTreatmentIndex: number | null
}

export interface MordredBlindnessTeam {
  teamId: string
  requestContext: 'propose' | 'vote'
  seats: readonly Seat[]
}

export interface MordredBlindnessAssessment {
  team: MordredBlindnessTeam
  probabilitySemantics: 'resolved-complete-world-joint-sums'
  jointSemantics: 'direct-joint-world-sums-no-marginal-products'
  visibleEvilCountDistribution: readonly number[]
  totalEvilCountDistribution: readonly number[]
  merlinBlindWindowProbability: number
  hiddenThresholdCrossingProbability: number
  treatmentObservationAvailable: boolean
  anomalousBlindWindowMass: number
  observationSemantics: 'no-public-observation-is-zero-signal-not-innocence'
  policySemantics: 'team-opportunity-not-action-utility'
  opportunityValueSemantics:
    'bounded-heuristic-nonprobability-three-quarters-hidden-crossing-one-quarter-anomalous-window'
  opportunityValue: number
}

export interface PrivateMordredBlindnessObjective {
  version: typeof MORDRED_BLINDNESS_OBJECTIVE_VERSION
  role: 'mordred'
  source: ObjectiveSourceBase & {
    treatmentReadVersion: typeof ACTOR_TARGET_TREATMENT_READ_VERSION
    worldSemantics: 'resolved-weighted-complete-worlds'
    promotionSemantics:
      'constraints-only-exact-weighted-structural'
  }
  request: {
    seat: Seat
    kind: 'propose' | 'vote'
    round: number
    proposalNum: number
    failsRequired: number
    currentTeam?: readonly Seat[]
  }
  merlinHypotheses: readonly MordredMerlinHypothesis[]
  assessments: readonly MordredBlindnessAssessment[]
}
