/**
 * The public-read half of the Morgana counterfeit component, split out from
 * morgana-counterfeit.ts. This is a public-only "appears Merlin-like" read: its
 * builder, semantic schema, codec, and host-joins depend on nothing from the
 * private objective half, so the objective imports this module (its typed value
 * plus the shared row validator) and never the reverse.
 */

import { isDeepStrictEqual } from 'node:util'
import {
  proposalApproved,
  proposalVotes,
} from '../../engine/rules.ts'
import { teamsEqual } from '../../engine/seatset.ts'
import { observePublicRecord } from './observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import type { PublicRecord } from '../communication/public-record.ts'
import { projectionCodec } from './projection-codec.ts'
import {
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type CounterfeitObservationFraction,
  type PublicCounterfeitMerlinRead,
  type PublicCounterfeitMerlinReadSnapshot,
} from './morgana-counterfeit-types.ts'
import {
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  tableSize,
} from '../components/canonical-shape.ts'
import {
  closeProbability as close,
  latticeCount,
} from '../components/probability-arithmetic.ts'

function fraction(
  numerator: number,
  denominator: number,
): CounterfeitObservationFraction {
  return {
    numerator,
    denominator,
    index: denominator === 0 ? null : numerator / denominator,
  }
}

interface TruthCounts {
  proposalHits: number
  proposalObservations: number
  voteHits: number
  voteObservations: number
}

/**
 * Join only resolved public proposals to their quest outcomes. Player names,
 * prose, raw events, private state, and input ordering never enter this read.
 */
function truthCounts(record: PublicRecord): readonly TruthCounts[] {
  const counts = Array.from(
    { length: record.playerCount },
    (): TruthCounts => ({
      proposalHits: 0,
      proposalObservations: 0,
      voteHits: 0,
      voteObservations: 0,
    }),
  )
  for (const quest of [...record.quests].sort((a, b) => a.num - b.num)) {
    if (!quest.team || quest.result === undefined) continue
    const executed = record.proposals
      .filter(
        (proposal) =>
          proposal.round === quest.num
          && proposalApproved(proposal)
          && teamsEqual(proposal.team, quest.team!),
      )
      .sort(
        (left, right) =>
          left.proposalNum - right.proposalNum
          || left.leader - right.leader,
      )
      .at(-1)
    if (!executed) continue
    counts[executed.leader].proposalObservations += 1
    if (quest.result === 'success') {
      counts[executed.leader].proposalHits += 1
    }
    for (const vote of [...proposalVotes(executed)].sort(
      (left, right) => left.seat - right.seat,
    )) {
      counts[vote.seat].voteObservations += 1
      if (
        (vote.vote === 'approve' && quest.result === 'success')
        || (vote.vote === 'reject' && quest.result === 'fail')
      ) {
        counts[vote.seat].voteHits += 1
      }
    }
  }
  return counts
}

/**
 * A public-only read projection for "appears Merlin-like." Exact public role
 * marginals remain separate from explicitly non-probabilistic behavior counts.
 */
export function buildPublicCounterfeitMerlinRead(
  record: PublicRecord,
  observer: PublicObserverSnapshot = observePublicRecord(record),
): PublicCounterfeitMerlinReadSnapshot {
  // The rebuild-and-compare is a deliberate self-consistency guard for callers
  // that pass their own observer (public-self-read, and the objective builder).
  // When the parameter is defaulted it recomputes the same value, so the check
  // is trivially satisfied there; it is kept rather than folded into the default
  // because dropping the parameter would remove the guard the explicit-observer
  // callers rely on.
  const authoritative = observePublicRecord(record)
  if (!isDeepStrictEqual(observer, authoritative)) {
    throw new Error('counterfeit public read received inconsistent observer')
  }
  const counts = truthCounts(record)
  const merlinNumerators = observer.seats.map((seat) => {
    const merlin = seat.roleMarginals.find(
      (marginal) => marginal.role === 'merlin',
    )?.probability ?? 0
    return Math.round(merlin * observer.feasibleWorldCount)
  })
  const maximum = Math.max(...merlinNumerators)
  if (maximum <= 0) {
    throw new Error('counterfeit public read requires Merlin in the public cast')
  }
  const seats = counts.map((entry, seat): PublicCounterfeitMerlinRead => {
    const proposal = fraction(
      entry.proposalHits,
      entry.proposalObservations,
    )
    const vote = fraction(entry.voteHits, entry.voteObservations)
    const total = fraction(
      entry.proposalHits + entry.voteHits,
      entry.proposalObservations + entry.voteObservations,
    )
    const smoothedTruthTrackingIndex =
      (total.numerator + 1) / (total.denominator + 2)
    const relativeMerlinEligibilityIndex =
      merlinNumerators[seat] / maximum
    return {
      seat,
      probabilitySemantics: 'public-uniform-feasible-joint',
      merlinWorldNumerator: merlinNumerators[seat],
      feasibleWorldDenominator: observer.feasibleWorldCount,
      merlinProbability:
        merlinNumerators[seat] / observer.feasibleWorldCount,
      relativeMerlinEligibilityIndex,
      observationSemantics: 'public-counts-no-data-is-null',
      proposalTruthTracking: proposal,
      voteTruthTracking: vote,
      totalTruthTracking: total,
      proxySemantics:
        'bounded-deterministic-proxy-not-role-probability',
      smoothedTruthTrackingIndex,
      counterfeitReadProxyIndex:
        relativeMerlinEligibilityIndex * smoothedTruthTrackingIndex,
    }
  })
  return {
    version: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    playerCount: record.playerCount,
    feasibleWorldCount: observer.feasibleWorldCount,
    seats,
  }
}

function validFraction(value: unknown): value is CounterfeitObservationFraction {
  if (!plainRecord(value)) return false
  if (
    !exactKeys(value, ['numerator', 'denominator', 'index'])
    || !Number.isSafeInteger(value.numerator)
    || !Number.isSafeInteger(value.denominator)
    || (value.numerator as number) < 0
    || (value.denominator as number) < (value.numerator as number)
  ) return false
  if (value.denominator === 0) {
    return value.numerator === 0 && value.index === null
  }
  return probability(value.index)
    && close(
      value.index,
      (value.numerator as number) / (value.denominator as number),
    )
}

/**
 * Validate one public-read row against its seat and the projection's declared
 * table size and feasible-world count. Shared with the objective schema, which
 * validates its acting-seat read with the same rule.
 */
export function validReadRow(
  value: unknown,
  seat: number,
  playerCount: number,
  feasibleWorldCount: number,
): value is PublicCounterfeitMerlinRead {
  if (!plainRecord(value)) return false
  if (
    !exactKeys(value, [
      'seat',
      'probabilitySemantics',
      'merlinWorldNumerator',
      'feasibleWorldDenominator',
      'merlinProbability',
      'relativeMerlinEligibilityIndex',
      'observationSemantics',
      'proposalTruthTracking',
      'voteTruthTracking',
      'totalTruthTracking',
      'proxySemantics',
      'smoothedTruthTrackingIndex',
      'counterfeitReadProxyIndex',
    ])
    || value.seat !== seat
    || seat < 0
    || seat >= playerCount
    || value.probabilitySemantics !== 'public-uniform-feasible-joint'
    || !Number.isSafeInteger(value.merlinWorldNumerator)
    || (value.merlinWorldNumerator as number) < 0
    || value.feasibleWorldDenominator !== feasibleWorldCount
    || !probability(value.merlinProbability)
    || !probability(value.relativeMerlinEligibilityIndex)
    || value.observationSemantics !== 'public-counts-no-data-is-null'
    || !validFraction(value.proposalTruthTracking)
    || !validFraction(value.voteTruthTracking)
    || !validFraction(value.totalTruthTracking)
    || value.proxySemantics
      !== 'bounded-deterministic-proxy-not-role-probability'
    || !probability(value.smoothedTruthTrackingIndex)
    || !probability(value.counterfeitReadProxyIndex)
  ) return false
  const proposal = value.proposalTruthTracking
  const vote = value.voteTruthTracking
  const total = value.totalTruthTracking
  return (
    (value.merlinWorldNumerator as number) <= feasibleWorldCount
    && proposal.denominator <= 5
    && vote.denominator <= 5
    && total.denominator <= 10
    && total.numerator === proposal.numerator + vote.numerator
    && total.denominator === proposal.denominator + vote.denominator
    && latticeCount(
      value.merlinProbability,
      feasibleWorldCount,
    ) === value.merlinWorldNumerator
    && close(
      value.smoothedTruthTrackingIndex as number,
      (total.numerator + 1) / (total.denominator + 2),
    )
    && close(
      value.counterfeitReadProxyIndex as number,
      (value.relativeMerlinEligibilityIndex as number)
        * (value.smoothedTruthTrackingIndex as number),
    )
  )
}

function publicCounterfeitReadSchema(value: unknown): boolean {
  if (
    !plainRecord(value)
    || !exactKeys(value, [
      'version',
      'observerModelVersion',
      'playerCount',
      'feasibleWorldCount',
      'seats',
    ])
    || value.version !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || value.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || !tableSize(value.playerCount)
    || !Number.isSafeInteger(value.feasibleWorldCount)
    || (value.feasibleWorldCount as number) <= 0
    || (value.feasibleWorldCount as number) > 3_628_800
    || !denseArray(value.seats)
    || value.seats.length !== value.playerCount
  ) return false
  const playerCount = value.playerCount as number
  const denominator = value.feasibleWorldCount as number
  const rows = value.seats as unknown[]
  if (
    rows.some(
      (row, seat) =>
        !validReadRow(row, seat, playerCount, denominator),
    )
  ) return false
  const typed = rows as PublicCounterfeitMerlinRead[]
  const maxNumerator = Math.max(
    ...typed.map((row) => row.merlinWorldNumerator),
  )
  if (
    maxNumerator <= 0
    || typed.reduce(
      (sum, row) => sum + row.merlinWorldNumerator,
      0,
    ) !== denominator
  ) return false
  // Also a count lattice: the index is one seat's Merlin-world count over the
  // largest such count, so the exact integer is recoverable and a decimal slack
  // would admit ratios no world set can produce.
  return typed.every(
    (row) =>
      latticeCount(row.relativeMerlinEligibilityIndex, maxNumerator)
        === row.merlinWorldNumerator,
  )
}

const publicCounterfeitReadCodec =
  projectionCodec<PublicCounterfeitMerlinReadSnapshot>(
    publicCounterfeitReadSchema,
  )

export const validatePublicCounterfeitMerlinRead =
  publicCounterfeitReadCodec.validate
export const decodeCanonicalPublicCounterfeitMerlinRead =
  publicCounterfeitReadCodec.decode

export function validatePublicCounterfeitMerlinReadHostJoin(
  value: unknown,
  record: PublicRecord,
): value is PublicCounterfeitMerlinReadSnapshot {
  return validatePublicCounterfeitMerlinRead(value)
    && validateAdmittedPublicCounterfeitMerlinReadHostJoin(value, record)
}

export function validateAdmittedPublicCounterfeitMerlinReadHostJoin(
  value: PublicCounterfeitMerlinReadSnapshot,
  record: PublicRecord,
): boolean {
  return isDeepStrictEqual(value, buildPublicCounterfeitMerlinRead(record))
}
