/**
 * Strict JSON boundary for the public observer snapshot, split out from
 * observer.ts. This is the decode leg: external and persisted-artifact readers
 * hand it an untrusted value and it re-derives every count-space equality the
 * builder produced. It depends on nothing from the build half, so observer.ts
 * re-exports validatePublicObserverSnapshot and this module never imports it.
 *
 * The count-space argument this module used to make privately now lives with
 * latticeCount in components/probability-arithmetic.ts, where the other sites
 * checking a uniform marginal against an integer world count can reach it. The
 * tolerance beside it was a second spelling of PROBABILITY_TOLERANCE.
 */

import type { Role } from '../../engine/types.ts'
import { ROLE_ALIGNMENT, validateRoles } from '../../engine/rules.ts'
import { CANONICAL_ROLE_ORDER } from '../canonical/canonical-shape.ts'
import {
  PUBLIC_BEHAVIOR_READING_VERSION,
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import {
  onlyAllowedKeys,
  probability,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  latticeCount,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'

function factorial(value: number): number {
  let result = 1
  for (let factor = 2; factor <= value; factor++) result *= factor
  return result
}

/**
 * The count-space state accumulated across seats: the shared role list every
 * seat must agree on, per-role world-occurrence totals, and the running good and
 * evil world-occurrence sums. validateSeat mutates these in place, exactly as
 * the original single-function loop did.
 */
interface ObserverAccumulator {
  sharedRoles: readonly Role[] | undefined
  roleWorldOccurrences: Map<Role, number>
  goodWorldOccurrences: number
  evilWorldOccurrences: number
}

/** Envelope shape, semantics, table size, world count, entropy, seats length. */
function validateSnapshotShape(snapshot: Record<string, unknown>): boolean {
  return !(
    !onlyAllowedKeys(snapshot, [
      'version',
      'probabilitySemantics',
      'behavioralSemantics',
      'playerCount',
      'feasibleWorldCount',
      'entropy',
      'seats',
    ])
    || snapshot.version !== PUBLIC_OBSERVER_MODEL_VERSION
    || snapshot.probabilitySemantics !== 'uniform-public-feasible-joint'
    || snapshot.behavioralSemantics
      !== 'bounded-deterministic-indices-not-probabilities'
    || !tableSize(snapshot.playerCount)
    || !Number.isSafeInteger(snapshot.feasibleWorldCount)
    || (snapshot.feasibleWorldCount as number) <= 0
    || typeof snapshot.entropy !== 'number'
    || !Number.isFinite(snapshot.entropy)
    || Math.abs(
      snapshot.entropy
      - Math.log2(snapshot.feasibleWorldCount as number),
    ) > PROBABILITY_TOLERANCE
    || !Array.isArray(snapshot.seats)
    || snapshot.seats.length !== snapshot.playerCount
  )
}

/**
 * One seat's role marginals: canonical-order shape and per-role count lattice,
 * accumulating the shared role total onto roleWorldOccurrences. Returns the
 * per-seat sums, or undefined on any rejection. Same clause set and order as the
 * original inner loop.
 */
function validateRoleMarginals(
  roles: readonly unknown[],
  feasibleWorldCount: number,
  roleWorldOccurrences: Map<Role, number>,
): {
  seatRoles: Role[]
  seatWorldOccurrences: number
  seatGoodWorldOccurrences: number
  seatEvilWorldOccurrences: number
} | undefined {
  const seatRoles: Role[] = []
  let seatWorldOccurrences = 0
  let seatGoodWorldOccurrences = 0
  let seatEvilWorldOccurrences = 0
  let previousRoleRank = -1
  for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
    const roleValue = roles[roleIndex]
    if (
      !roleValue
      || typeof roleValue !== 'object'
      || Array.isArray(roleValue)
    ) return undefined
    const marginal = roleValue as Record<string, unknown>
    const role = marginal.role as Role
    const canonicalRank = CANONICAL_ROLE_ORDER.indexOf(role)
    const count = latticeCount(marginal.probability, feasibleWorldCount)
    if (
      !onlyAllowedKeys(marginal, ['role', 'probability'])
      || typeof marginal.role !== 'string'
      || canonicalRank < 0
      || canonicalRank <= previousRoleRank
      || count === undefined
    ) return undefined
    previousRoleRank = canonicalRank
    seatRoles.push(role)
    seatWorldOccurrences += count
    const aggregateRoleOccurrences =
      (roleWorldOccurrences.get(role) ?? 0) + count
    if (!Number.isSafeInteger(aggregateRoleOccurrences)) return undefined
    roleWorldOccurrences.set(role, aggregateRoleOccurrences)
    if (ROLE_ALIGNMENT[role] === 'good') {
      seatGoodWorldOccurrences += count
    } else {
      seatEvilWorldOccurrences += count
    }
  }
  return {
    seatRoles,
    seatWorldOccurrences,
    seatGoodWorldOccurrences,
    seatEvilWorldOccurrences,
  }
}

/**
 * One seat: assessment and behavior shape, the role marginals (via
 * validateRoleMarginals), the per-seat integer equalities, the shared-role
 * consistency check, and the running good/evil accumulation. Mutates acc in the
 * same order the original loop body did.
 */
function validateSeat(
  snapshot: Record<string, unknown>,
  seat: number,
  feasibleWorldCount: number,
  acc: ObserverAccumulator,
): boolean {
  const seatValue = (snapshot.seats as unknown[])[seat]
  if (
    !seatValue
    || typeof seatValue !== 'object'
    || Array.isArray(seatValue)
  ) return false
  const assessment = seatValue as Record<string, unknown>
  const roles = assessment.roleMarginals
  const behavior = assessment.behavior as Record<string, unknown>
  const goodProbability = assessment.goodProbability
  const evilProbability = assessment.evilProbability
  const goodCount = latticeCount(
    goodProbability,
    feasibleWorldCount,
  )
  const evilCount = latticeCount(
    evilProbability,
    feasibleWorldCount,
  )
  if (
    !onlyAllowedKeys(assessment, [
      'seat',
      'goodProbability',
      'evilProbability',
      'roleMarginals',
      'behavior',
    ])
    || assessment.seat !== seat
    || !probability(goodProbability)
    || !probability(evilProbability)
    || goodCount === undefined
    || evilCount === undefined
    || Math.abs(
      goodProbability + evilProbability - 1,
    ) > PROBABILITY_TOLERANCE
    || !Array.isArray(roles)
    || !behavior
    || typeof behavior !== 'object'
    || Array.isArray(behavior)
    || !onlyAllowedKeys(behavior, [
      'version',
      'semantics',
      'proposalLeadershipCount',
      'proposalSelectionIndex',
      'approvalIndex',
      'failedQuestExposureIndex',
    ])
    || behavior.version !== PUBLIC_BEHAVIOR_READING_VERSION
    || behavior.semantics
      !== 'bounded-deterministic-indices-not-probabilities'
    || !Number.isSafeInteger(behavior.proposalLeadershipCount)
    || (behavior.proposalLeadershipCount as number) < 0
    || !probability(behavior.proposalSelectionIndex)
    || !probability(behavior.approvalIndex)
    || !probability(behavior.failedQuestExposureIndex)
  ) {
    return false
  }

  if (roles.length === 0) return false
  const marginals = validateRoleMarginals(
    roles as unknown[],
    feasibleWorldCount,
    acc.roleWorldOccurrences,
  )
  if (!marginals) return false
  const {
    seatRoles,
    seatWorldOccurrences,
    seatGoodWorldOccurrences,
    seatEvilWorldOccurrences,
  } = marginals
  // Integer equalities only. This seat's role marginals, its goodProbability
  // and its evilProbability all came back from latticeCount, so each is
  // within COUNT_LATTICE_ULP_MULTIPLIER machine epsilons of its k/N, and
  // there are at most CANONICAL_ROLE_ORDER.length of them. The three float
  // sums that used to stand here (roles total 1, good roles total
  // goodProbability, evil roles total evilProbability) are therefore implied
  // by the three integer equalities below with more than an order of
  // magnitude to spare, at any world count. They could reject nothing these
  // cannot, so they are gone rather than compensated;
  // test/probability-arithmetic.test.ts pins the bound that makes that true.
  if (
    !Number.isSafeInteger(seatWorldOccurrences)
    || !Number.isSafeInteger(seatGoodWorldOccurrences)
    || !Number.isSafeInteger(seatEvilWorldOccurrences)
    || seatWorldOccurrences !== feasibleWorldCount
    || seatGoodWorldOccurrences !== goodCount
    || seatEvilWorldOccurrences !== evilCount
  ) return false
  if (acc.sharedRoles === undefined) {
    acc.sharedRoles = seatRoles
  } else if (
    seatRoles.length !== acc.sharedRoles.length
    || seatRoles.some((role, index) => role !== acc.sharedRoles![index])
  ) return false
  acc.goodWorldOccurrences += goodCount
  acc.evilWorldOccurrences += evilCount
  if (
    !Number.isSafeInteger(acc.goodWorldOccurrences)
    || !Number.isSafeInteger(acc.evilWorldOccurrences)
  ) return false
  return true
}

/**
 * Reconstruct the role multiset from the accumulated per-role world counts,
 * validate the cast, bound the feasible-world count by the maximum distinct
 * worlds the multiset can produce, and confirm the good/evil totals. Verbatim
 * tail of the original validator.
 */
function reconstructAndCheckRoles(
  playerCount: number,
  feasibleWorldCount: number,
  sharedRoles: readonly Role[],
  roleWorldOccurrences: Map<Role, number>,
  goodWorldOccurrences: number,
  evilWorldOccurrences: number,
): boolean {
  const reconstructedRoles: Role[] = []
  const reconstructedRoleCounts = new Map<Role, number>()
  for (const role of sharedRoles) {
    const occurrences = roleWorldOccurrences.get(role) ?? 0
    if (occurrences % feasibleWorldCount !== 0) return false
    const roleCount = occurrences / feasibleWorldCount
    if (!Number.isSafeInteger(roleCount) || roleCount <= 0) return false
    reconstructedRoleCounts.set(role, roleCount)
    reconstructedRoles.push(...Array<Role>(roleCount).fill(role))
  }
  if (reconstructedRoles.length !== playerCount) return false
  try {
    validateRoles(playerCount, reconstructedRoles)
  } catch {
    return false
  }

  const repeatedRoleDivisor = [...reconstructedRoleCounts.values()].reduce(
    (product, roleCount) => product * factorial(roleCount),
    1,
  )
  const maximumDistinctWorlds =
    factorial(playerCount) / repeatedRoleDivisor
  if (
    !Number.isSafeInteger(maximumDistinctWorlds)
    || feasibleWorldCount > maximumDistinctWorlds
  ) return false

  const reconstructedGood = reconstructedRoles.filter(
    (role) => ROLE_ALIGNMENT[role] === 'good',
  ).length
  const reconstructedEvil = playerCount - reconstructedGood
  return goodWorldOccurrences === reconstructedGood * feasibleWorldCount
    && evilWorldOccurrences === reconstructedEvil * feasibleWorldCount
}

/** Strict JSON boundary used by external and persisted-artifact readers. */
export function validatePublicObserverSnapshot(
  value: unknown,
): value is PublicObserverSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Record<string, unknown>
  if (!validateSnapshotShape(snapshot)) return false

  const playerCount = snapshot.playerCount as number
  const feasibleWorldCount = snapshot.feasibleWorldCount as number
  // No role multiset can produce more distinct assignments than n!; reject
  // impossible or unsafe denominators before multiplying any marginal by it.
  if (feasibleWorldCount > factorial(playerCount)) return false
  const acc: ObserverAccumulator = {
    sharedRoles: undefined,
    roleWorldOccurrences: new Map<Role, number>(),
    goodWorldOccurrences: 0,
    evilWorldOccurrences: 0,
  }

  for (let seat = 0; seat < playerCount; seat++) {
    if (!validateSeat(snapshot, seat, feasibleWorldCount, acc)) return false
  }

  if (!acc.sharedRoles) return false
  return reconstructAndCheckRoles(
    playerCount,
    feasibleWorldCount,
    acc.sharedRoles,
    acc.roleWorldOccurrences,
    acc.goodWorldOccurrences,
    acc.evilWorldOccurrences,
  )
}
