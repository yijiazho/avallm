import type { Seat } from '../../engine/types.ts'
import type {
  ObjectiveRequest,
  ObjectiveSource,
} from './role-objective-types.ts'
import type { ObservationFraction } from './observation-fraction.ts'

export type { ObservationFraction }

export const EVIL_ROLE_OBJECTIVE_MODEL_VERSION =
  'evil-oberon-objectives-v1'
export const ROLE_OBJECTIVE_ROUTER_VERSION = 'role-objective-router-v1'
export const EVIL_ROLE_OBJECTIVE_DEGRADATION =
  'evil-role-objective-assessment-failed'
export const MAX_EVIL_ROLE_OBJECTIVE_ASSESSMENTS = 256

export const EVIL_OBJECTIVE_ROLES = Object.freeze([
  'assassin',
  'morgana',
  'mordred',
  'minion',
  'oberon',
] as const)

export type EvilObjectiveRole = typeof EVIL_OBJECTIVE_ROLES[number]

export function isEvilObjectiveRole(
  value: unknown,
): value is EvilObjectiveRole {
  return (EVIL_OBJECTIVE_ROLES as readonly unknown[]).includes(value)
}

export type EvilRolePosture =
  | 'assassin-shot-preservation'
  | 'morgana-counterfeit-cover'
  | 'mordred-deep-cover'
  | 'minion-failure-banking'
  | 'oberon-uncoordinated-disruption'

// The evil source/request envelope is the shared objective envelope. The names
// are retained for callers that imported them before the good/evil unification.
export type EvilObjectiveSource = ObjectiveSource
export type EvilObjectiveRequest = ObjectiveRequest

export interface PublicEvilStanding {
  seat: Seat
  probabilitySemantics: 'public-uniform-feasible-joint'
  goodProbability: number
  evilProbability: number
  evilWorldNumerator: number
  feasibleWorldDenominator: number
  observationSemantics: 'public-counts-no-data-is-null'
  selection: ObservationFraction
  approval: ObservationFraction
  failedQuestExposure: ObservationFraction
  proxySemantics: 'bounded-deterministic-indices-not-probabilities'
  burnProxyIndex: number | null
  coverProxyIndex: number | null
  standingProxyIndex: number | null
}

export interface UnseenEvilSetHypothesis {
  evilSeats: readonly Seat[]
  probability: number
}

export interface OberonUnseenEvilPosterior {
  probabilitySemantics: 'resolved-complete-world-sum'
  excludesCoordinationSemantics: true
  hypotheses: readonly UnseenEvilSetHypothesis[]
  countDistribution: readonly number[]
}

export interface EvilCandidateObjective {
  candidateId: string
  kind: 'propose' | 'finalize' | 'vote'
  direction: 'support' | 'oppose'
  team: readonly Seat[]
  probabilitySemantics: 'resolved-complete-world-sum'
  teamFailureCapabilityProbability: number
  evilCountDistribution: readonly number[]
  publicProbabilitySemantics: 'public-preaction-uniform-feasible-joint'
  publicTeamFailureCapabilityProbability: number
  publicEvilCountDistribution: readonly number[]
  coordination:
    | {
        kind: 'visible-coordination'
        semantics: 'private-visible-evil-seats-only'
        coordinatedEvilAboard: number
      }
    | {
        kind: 'self-only-uncoordinated'
        semantics: 'oberon-self-is-not-coordination'
        selfAboard: boolean
      }
  /** Oberon only. This is knowledge, not a coordination or card-choice model. */
  unseenEvilOnTeamProbability?: number
}

export interface PrivateEvilRoleObjectiveSnapshot {
  version: typeof EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  team: 'evil'
  role: EvilObjectiveRole
  source: EvilObjectiveSource
  request: EvilObjectiveRequest
  posture: {
    kind: EvilRolePosture
    semantics: 'explicit-role-posture-not-policy'
  }
  coordination:
    | {
        kind: 'visible-partners'
        semantics: 'private-visible-evil-seats-only'
        seats: readonly Seat[]
        excludesUnseenOberon: true
        knowsPartnerSpecialRoles: false
      }
    | {
        kind: 'self-only-uncoordinated'
        semantics: 'oberon-has-no-visible-evil-partners'
        self: Seat
        visiblePartnerSeats: readonly []
        knowsPartnerSpecialRoles: false
      }
  publicStanding: readonly PublicEvilStanding[]
  oberonUnseenEvilPosterior?: OberonUnseenEvilPosterior
  assessmentApplicability:
    | 'team-candidates'
    | 'not-applicable-to-decision-kind'
  assessments: readonly EvilCandidateObjective[]
}

export type RoutedRoleObjectiveModel =
  | 'off'
  | 'merlin-percival-objectives-v1'
  | typeof EVIL_ROLE_OBJECTIVE_MODEL_VERSION
