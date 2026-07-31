/**
 * The servant objective: the first consumer of the shared public read.
 *
 * It exists as much to prove a structural claim as to play the role. Every
 * other role model in this directory is several hundred lines, because each
 * one recomputes its own view of how the table sees a seat before it can act
 * on that view. If the measurement is genuinely shared, a new role should cost
 * only its weights. This module is that test, and it is about a hundred lines.
 *
 * Servants were previously routed to 'off' and modelled nothing at all, which
 * was not obviously wrong: the two special good roles have secrets and a
 * servant does not, so the concealment machinery had nothing to offer them. It
 * was wrong for a different reason. A servant still has a public image, still
 * pays for a bad one in influence, and is the best decoy on the board, and
 * none of that needs a secret to be worth optimizing.
 */

import { buildPublicSelfRead } from './public-self-read.ts'
import { PUBLIC_SELF_READ_VERSION } from './public-self-read-types.ts'
import {
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  signedUnit,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  clampProbability as clamp01,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'
import {
  SERVANT_OBJECTIVE_CONSTANTS as W,
  SERVANT_OBJECTIVE_MODEL_VERSION,
  type ServantObjectiveInput,
  type ServantObjectiveSnapshot,
  type ServantSelfObjective,
} from './servant-objective-types.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'

/**
 * Both deviations arrive signed in [-1, 1] and both values leave in [0, 1],
 * so each maps through a half-width shift. Standing inverts on the way because
 * a HIGH evil deviation is a LOW value, which is the only place in this module
 * where the two axes are treated differently.
 */
const standingFrom = (evilReadDeviation: number): number =>
  clamp01((1 - evilReadDeviation) / 2)

const decoyFrom = (merlinReadDeviation: number): number =>
  clamp01((merlinReadDeviation + 1) / 2)

const roleValueFrom = (standing: number, decoy: number): number =>
  clamp01(W.standingWeight * standing + W.decoyWeight * decoy)

export function buildServantObjective(
  input: ServantObjectiveInput,
): ServantObjectiveSnapshot {
  const read = buildPublicSelfRead(input.record)
  const seat = read.seats[input.seat]
  if (!seat) {
    throw new Error('servant objective requires a seat inside the read')
  }
  const standingValue = standingFrom(seat.evilReadDeviation)
  const decoyValue = decoyFrom(seat.merlinReadDeviation)
  const objective: ServantSelfObjective = {
    seat: input.seat,
    valueSemantics:
      'bounded-deterministic-heuristic-utility-not-probability',
    evilReadDeviation: seat.evilReadDeviation,
    merlinReadDeviation: seat.merlinReadDeviation,
    standingValue,
    decoyValue,
    roleValue: roleValueFrom(standingValue, decoyValue),
  }
  return {
    version: SERVANT_OBJECTIVE_MODEL_VERSION,
    selfReadVersion: PUBLIC_SELF_READ_VERSION,
    playerCount: read.playerCount,
    objective,
  }
}

function servantObjectiveSchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  if (!exactKeys(detached, [
    'version',
    'selfReadVersion',
    'playerCount',
    'objective',
  ])) return false
  if (
    detached.version !== SERVANT_OBJECTIVE_MODEL_VERSION
    || detached.selfReadVersion !== PUBLIC_SELF_READ_VERSION
    || !tableSize(detached.playerCount)
  ) return false

  const objective = detached.objective
  if (!plainRecord(objective) || !exactKeys(objective, [
    'seat',
    'valueSemantics',
    'evilReadDeviation',
    'merlinReadDeviation',
    'standingValue',
    'decoyValue',
    'roleValue',
  ])) return false
  if (
    objective.valueSemantics
      !== 'bounded-deterministic-heuristic-utility-not-probability'
    || !Number.isSafeInteger(objective.seat)
    || (objective.seat as number) < 0
    || (objective.seat as number) >= (detached.playerCount as number)
    || !signedUnit(objective.evilReadDeviation)
    || !signedUnit(objective.merlinReadDeviation)
    || !probability(objective.standingValue)
    || !probability(objective.decoyValue)
    || !probability(objective.roleValue)
  ) return false

  const standing = standingFrom(objective.evilReadDeviation as number)
  const decoy = decoyFrom(objective.merlinReadDeviation as number)
  return (
    Math.abs(standing - (objective.standingValue as number))
      <= PROBABILITY_TOLERANCE
    && Math.abs(decoy - (objective.decoyValue as number))
      <= PROBABILITY_TOLERANCE
    && Math.abs(roleValueFrom(standing, decoy)
      - (objective.roleValue as number)) <= PROBABILITY_TOLERANCE
  )
}

const servantObjectiveCodec =
  projectionCodec<ServantObjectiveSnapshot>(servantObjectiveSchema)

export const validateServantObjectiveSnapshot = servantObjectiveCodec.validate

/** The kernel's decoder: its input is already canonical, so it re-checks only. */
export const decodeCanonicalServantObjectiveSnapshot =
  servantObjectiveCodec.decode

export const validateAdmittedServantObjectiveHostJoin =
  exactHostJoin(buildServantObjective)
