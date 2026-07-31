import type { Seat } from '../../engine/types.ts'
import type { PublicRecord } from '../record/public-record.ts'

export const SERVANT_OBJECTIVE_MODEL_VERSION =
  'servant-standing-decoy-objectives-v1'

/**
 * Native-only, so it lives on the component run entry and never on
 * trace.degradation. Admission derives the forbidden set from the registry, so
 * putting it there instead would be rejected rather than merely wrong.
 */
export const SERVANT_OBJECTIVE_DEGRADATION =
  'servant-objective-assessment-failed'

/**
 * The servant's weight pair over the shared public read.
 *
 * A servant is the one role with nothing to conceal, so the concealment term
 * every other role carries is absent here and two different terms replace it.
 *
 * Standing is the cost of reading dirty. It is not about being caught, since
 * there is nothing to catch: a servant who looks evil simply stops being
 * listened to, gets left off teams, and watches proposals they back get
 * rejected. That tax is charged on every proposal and every vote for the rest
 * of the game.
 *
 * Decoy is the benefit of reading Merlin-like. Drawing the assassin's shot
 * wins the game outright, and a servant is the cheapest possible decoy: unlike
 * Percival they hold no information that dies with them, and unlike Merlin
 * they lose nothing by being wrong about who is evil.
 *
 * Standing carries the larger weight because it is charged continuously while
 * the decoy payoff is collected once, only in games that actually reach the
 * shot. That reasoning fixes the ORDER of the two weights. It does not fix the
 * ratio, which is a hand-authored starting point and is expected to be tuned
 * against real play rather than argued to a second decimal place.
 */
export const SERVANT_OBJECTIVE_CONSTANTS = Object.freeze({
  standingWeight: 0.65,
  decoyWeight: 0.35,
})

/**
 * What a servant seat is optimizing, stated as two bounded values over the
 * shared read and a blend of them.
 *
 * The deviations are copied in rather than referenced so the snapshot can be
 * checked against itself. Both are signed, and both are read here with a
 * definite sign: a servant wants the evil deviation low and the Merlin
 * deviation high. Merlin reading the identical pair wants the second one low,
 * which is the entire reason the measurement lives somewhere neutral.
 */
export interface ServantSelfObjective {
  seat: Seat
  valueSemantics: 'bounded-deterministic-heuristic-utility-not-probability'
  evilReadDeviation: number
  merlinReadDeviation: number
  /** Rises as the seat reads cleaner than a typical servant. */
  standingValue: number
  /** Rises as the seat reads more Merlin-like than a typical servant. */
  decoyValue: number
  roleValue: number
}

export interface ServantObjectiveSnapshot {
  version: typeof SERVANT_OBJECTIVE_MODEL_VERSION
  selfReadVersion: string
  playerCount: number
  objective: ServantSelfObjective
}

/**
 * The build input, bundled so the host-join rule can take it as one value.
 *
 * The seat is supplied rather than derived, and the module never asks whether
 * that seat is really a servant, because it cannot: the record is public and
 * roles are not. Gating on the actual role belongs to the caller that holds
 * the private view. Keeping that check out of here is what lets the objective
 * be built from public state alone and tested without dealing a game.
 */
export interface ServantObjectiveInput {
  record: PublicRecord
  seat: Seat
}
