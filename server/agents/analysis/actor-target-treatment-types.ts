import type { Seat } from '../../engine/types.ts'
import type { ObservationFraction } from './observation-fraction.ts'

export const ACTOR_TARGET_TREATMENT_READ_VERSION =
  'public-actor-target-treatment-read-v1'
export const ACTOR_TARGET_TREATMENT_DEGRADATION =
  'actor-target-treatment-read-failed'
export const MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES = 131_072

export type ActorTargetTreatmentFraction = ObservationFraction

export interface ActorTargetTreatmentRow {
  actor: Seat
  target: Seat
  observationSemantics: 'public-executed-proposal-counts-no-data-is-null'
  proposalSelection: ActorTargetTreatmentFraction
  voteApproval: ActorTargetTreatmentFraction
}

/**
 * Public facts kept in a private generic component envelope. The privacy
 * class avoids adding a new public projection before there is a consumer for
 * one; it does not make these counts private game information.
 */
export interface PrivateActorTargetTreatmentRead {
  version: typeof ACTOR_TARGET_TREATMENT_READ_VERSION
  observerModelVersion: string
  observerFeasibleWorldCount: number
  playerCount: number
  matrixSemantics: 'dense-canonical-actor-target'
  rows: readonly ActorTargetTreatmentRow[]
}
