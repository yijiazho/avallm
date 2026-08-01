import type { Seat } from '../../engine/types.ts'
import type { ObservationFraction } from './observation-fraction.ts'
import type {
  ObjectiveRequest,
  ObjectiveSourceBase,
} from './role-objective-types.ts'

export const MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION =
  'morgana-counterfeit-public-read-v1'
export const MORGANA_COUNTERFEIT_OBJECTIVE_VERSION =
  'morgana-counterfeit-objectives-v1'
export const MORGANA_COUNTERFEIT_DEGRADATION =
  'morgana-objective-assessment-failed'
export const MAX_MORGANA_COUNTERFEIT_ASSESSMENTS = 252

export type CounterfeitObservationFraction = ObservationFraction

export interface PublicCounterfeitMerlinRead {
  seat: Seat
  probabilitySemantics: 'public-uniform-feasible-joint'
  merlinWorldNumerator: number
  feasibleWorldDenominator: number
  merlinProbability: number
  relativeMerlinEligibilityIndex: number
  observationSemantics: 'public-counts-no-data-is-null'
  proposalTruthTracking: CounterfeitObservationFraction
  voteTruthTracking: CounterfeitObservationFraction
  totalTruthTracking: CounterfeitObservationFraction
  proxySemantics: 'bounded-deterministic-proxy-not-role-probability'
  smoothedTruthTrackingIndex: number
  counterfeitReadProxyIndex: number
}

export interface PublicCounterfeitMerlinReadSnapshot {
  version: typeof MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
  observerModelVersion: string
  playerCount: number
  feasibleWorldCount: number
  seats: readonly PublicCounterfeitMerlinRead[]
}

export type MorganaCounterfeitDirection = 'support' | 'oppose'

export interface MorganaCounterfeitCandidate {
  candidateId: string
  kind: 'propose' | 'vote'
  direction: MorganaCounterfeitDirection
  team: readonly Seat[]
}

export interface MorganaCounterfeitAssessment {
  candidate: MorganaCounterfeitCandidate
  probabilitySemantics: 'resolved-complete-world-sum'
  merlinVisibleEvilCountDistribution: readonly number[]
  merlinVisibleFailureCapabilityProbability: number
  publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint'
  publicEvilCountDistribution: readonly number[]
  publicFailureCapabilityProbability: number
  valueSemantics: 'bounded-deterministic-indices-not-probabilities'
  expectedMerlinConsistencyIndex: number
  publicConsistencyBaselineIndex: number
  privateKnowledgeTellIndex: number
  publicAmbiguityIndex: number
  counterfeitSignalIndex: number
  counterfeitOpportunityReadProxyIndex: number
  counterfeitValue: number
}

export interface PrivateMorganaCounterfeitObjective {
  version: typeof MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
  role: 'morgana'
  source: ObjectiveSourceBase & {
    publicReadVersion: typeof MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
  }
  /** Canonical public team present only for vote objectives; see currentTeam. */
  request: ObjectiveRequest & {
    currentTeam?: readonly Seat[]
  }
  counterfeitApplicability: 'percival-in-cast'
  assessmentApplicability: 'team-candidates'
  actingSeatRead: PublicCounterfeitMerlinRead
  assessments: readonly MorganaCounterfeitAssessment[]
}
