import type { Role, Seat } from '../../engine/types.ts'

export const PUBLIC_OBSERVER_MODEL_VERSION = 'exact-public-observer-v1'
export const PUBLIC_BEHAVIOR_READING_VERSION = 'public-behavior-indices-v1'

export interface PublicBehaviorReading {
  version: typeof PUBLIC_BEHAVIOR_READING_VERSION
  semantics: 'bounded-deterministic-indices-not-probabilities'
  proposalLeadershipCount: number
  proposalSelectionIndex: number
  approvalIndex: number
  failedQuestExposureIndex: number
}

export interface PublicObserverSeatAssessment {
  seat: Seat
  goodProbability: number
  evilProbability: number
  roleMarginals: readonly { role: Role; probability: number }[]
  behavior: PublicBehaviorReading
}

export interface PublicObserverSnapshot {
  version: typeof PUBLIC_OBSERVER_MODEL_VERSION
  probabilitySemantics: 'uniform-public-feasible-joint'
  behavioralSemantics: 'bounded-deterministic-indices-not-probabilities'
  playerCount: number
  feasibleWorldCount: number
  entropy: number
  seats: readonly PublicObserverSeatAssessment[]
}

export interface PublicJointTeamAssessment {
  team: readonly Seat[]
  probabilitySemantics: 'public-preaction-uniform-feasible-joint'
  cleanProbability: number
  evilCountDistribution: readonly number[]
}

export interface PublicAlignmentMaskCount {
  mask: number
  count: number
}
