/**
 * The shared two-axis public read of every seat.
 *
 * Three role families were each computing a private answer to the same
 * question. Merlin measured its own exposure, evil measured its own cover,
 * and Morgana measured how Merlin-like it looked, and underneath all three
 * sat one pair of public quantities: how evil does this seat read, and how
 * Merlin-like does this seat read. Both were already being computed for every
 * seat. Each consumer used one row and discarded the rest.
 *
 * So the measurement moves here and the roles keep only their weights. A
 * servant wants a low evil read for standing and a high Merlin read because
 * drawing the assassin's shot wins the game outright. Evil wants a low evil
 * read for cover. Merlin wants a low Merlin read, and notably does NOT want
 * the lowest available evil read, since a spotless record is the tell. Those
 * are three different weight vectors over identical inputs.
 *
 * Public in, public out. The projection never sees a PlayerView and cannot
 * leak private knowledge into a quantity every seat is meant to share.
 */

import type { Seat } from '../../engine/types.ts'
import type { PublicRecord } from '../record/public-record.ts'
import { observePublicRecord } from './observer.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
  type PublicObserverSnapshot,
} from './observer-types.ts'
import { buildPublicCounterfeitMerlinRead } from './morgana-counterfeit.ts'
import { MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION } from './morgana-counterfeit-types.ts'
import {
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  signedUnit,
  tableSize,
} from '../canonical/canonical-shape.ts'
import {
  clampProbability as clamp01,
  stableProbabilitySum,
  PROBABILITY_TOLERANCE,
} from '../canonical/probability-arithmetic.ts'
import {
  PUBLIC_SELF_READ_CONSTANTS as C,
  PUBLIC_SELF_READ_VERSION,
  type PublicSelfRead,
  type PublicSelfReadSnapshot,
  type ServantBaselineRead,
} from './public-self-read-types.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'

const clampSigned = (value: number): number =>
  Math.max(-1, Math.min(1, value))

function servantMarginal(
  observer: PublicObserverSnapshot,
  seat: Seat,
): number {
  const entry = observer.seats[seat]
  if (!entry) throw new Error('public self read observer lacks a seat')
  return entry.roleMarginals.find(
    (marginal) => marginal.role === 'servant',
  )?.probability ?? 0
}

/**
 * Weighted mean and population spread over the seats, weighted by servant
 * marginal. Spread is the population form rather than the sample form because
 * the seats ARE the whole population: there is no wider table being sampled.
 */
function weightedMoments(
  values: readonly number[],
  weights: readonly number[],
  weightTotal: number,
): { mean: number; spread: number } {
  const mean = values.reduce(
    (sum, value, index) => sum + weights[index] * value,
    0,
  ) / weightTotal
  const variance = values.reduce(
    (sum, value, index) => sum + weights[index] * (value - mean) ** 2,
    0,
  ) / weightTotal
  return { mean, spread: Math.sqrt(Math.max(0, variance)) }
}

/**
 * A deviation is only meaningful once the baseline has real width. With a
 * degenerate spread every seat sits on the mean, and the honest reading is
 * zero deviation rather than an infinity or an arbitrary sign.
 *
 * The threshold is a tolerance and not zero, which is the difference between
 * working and catastrophically wrong. When every seat carries an identical
 * index the weighted mean still lands an ulp or so off that shared value, so
 * the spread is float residue near 1e-17 rather than a clean 0. Dividing by
 * it hands back the MAXIMUM deviation the scale allows, meaning a board where
 * nobody has done anything reports every seat as an extreme read. A ten-player
 * opening board does exactly this.
 */
const deviationOf = (value: number, mean: number, spread: number): number =>
  spread > PROBABILITY_TOLERANCE
    ? clampSigned((value - mean) / spread)
    : 0

export function buildPublicSelfRead(
  record: PublicRecord,
): PublicSelfReadSnapshot {
  const observer = observePublicRecord(record)
  const likeness = buildPublicCounterfeitMerlinRead(record, observer)

  const evilReadIndices: number[] = []
  const merlinReadIndices: number[] = []
  const servantWeights: number[] = []
  for (let seat = 0; seat < record.playerCount; seat++) {
    const seatObserver = observer.seats[seat]
    const seatLikeness = likeness.seats[seat]
    if (!seatObserver || !seatLikeness) {
      throw new Error('public self read requires every seat on both axes')
    }
    evilReadIndices.push(clamp01(
      C.evilMarginalWeight * seatObserver.evilProbability
      + C.evilBehaviorWeight * seatObserver.behavior.failedQuestExposureIndex,
    ))
    merlinReadIndices.push(seatLikeness.counterfeitReadProxyIndex)
    servantWeights.push(servantMarginal(observer, seat))
  }

  const servantWeightTotal = stableProbabilitySum(
    servantWeights,
    (weight) => weight,
  )
  if (!(servantWeightTotal > 0)) {
    throw new Error('public self read requires a servant in the public cast')
  }

  const evil = weightedMoments(
    evilReadIndices, servantWeights, servantWeightTotal,
  )
  const merlin = weightedMoments(
    merlinReadIndices, servantWeights, servantWeightTotal,
  )
  const servantBaseline: ServantBaselineRead = {
    weightSemantics: 'public-servant-marginal-weighted',
    servantWeightTotal,
    evilReadMean: evil.mean,
    evilReadSpread: evil.spread,
    merlinReadMean: merlin.mean,
    merlinReadSpread: merlin.spread,
  }

  const seats = evilReadIndices.map((evilReadIndex, seat): PublicSelfRead => ({
    seat,
    probabilitySemantics: 'public-uniform-feasible-joint',
    evilProbability: observer.seats[seat].evilProbability,
    merlinProbability: likeness.seats[seat].merlinProbability,
    proxySemantics: 'bounded-deterministic-proxy-not-role-probability',
    evilReadIndex,
    merlinReadIndex: merlinReadIndices[seat],
    servantWeight: servantWeights[seat],
    evilReadDeviation: deviationOf(
      evilReadIndex, evil.mean, evil.spread,
    ),
    merlinReadDeviation: deviationOf(
      merlinReadIndices[seat], merlin.mean, merlin.spread,
    ),
  }))

  return {
    version: PUBLIC_SELF_READ_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    merlinLikenessVersion: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
    playerCount: record.playerCount,
    feasibleWorldCount: observer.feasibleWorldCount,
    servantBaseline,
    seats,
  }
}

const SEAT_KEYS = [
  'seat',
  'probabilitySemantics',
  'evilProbability',
  'merlinProbability',
  'proxySemantics',
  'evilReadIndex',
  'merlinReadIndex',
  'servantWeight',
  'evilReadDeviation',
  'merlinReadDeviation',
] as const

const BASELINE_KEYS = [
  'weightSemantics',
  'servantWeightTotal',
  'evilReadMean',
  'evilReadSpread',
  'merlinReadMean',
  'merlinReadSpread',
] as const

/**
 * The schema checks shape AND recomputes the baseline from the per-seat
 * indices it was handed. A snapshot whose seats and baseline disagree is
 * rejected even though every field is individually well formed, which is the
 * failure a shape-only check would wave through.
 */
function publicSelfReadSchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  if (!exactKeys(detached, [
    'version',
    'observerModelVersion',
    'merlinLikenessVersion',
    'playerCount',
    'feasibleWorldCount',
    'servantBaseline',
    'seats',
  ])) return false
  if (
    detached.version !== PUBLIC_SELF_READ_VERSION
    || detached.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || detached.merlinLikenessVersion
      !== MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION
    || !tableSize(detached.playerCount)
    || !Number.isSafeInteger(detached.feasibleWorldCount)
    || (detached.feasibleWorldCount as number) <= 0
    || !denseArray(detached.seats)
  ) return false

  const playerCount = detached.playerCount as number
  const seats = detached.seats as unknown[]
  if (seats.length !== playerCount) return false

  const evilReadIndices: number[] = []
  const merlinReadIndices: number[] = []
  const servantWeights: number[] = []
  for (let seat = 0; seat < playerCount; seat++) {
    const entry = seats[seat]
    if (!plainRecord(entry) || !exactKeys(entry, [...SEAT_KEYS])) return false
    if (
      entry.seat !== seat
      || entry.probabilitySemantics !== 'public-uniform-feasible-joint'
      || entry.proxySemantics
        !== 'bounded-deterministic-proxy-not-role-probability'
      || !probability(entry.evilProbability)
      || !probability(entry.merlinProbability)
      || !probability(entry.evilReadIndex)
      || !probability(entry.merlinReadIndex)
      || !probability(entry.servantWeight)
      || !signedUnit(entry.evilReadDeviation)
      || !signedUnit(entry.merlinReadDeviation)
    ) return false
    // Bracket the index against the probability it was built from. The
    // behavior term is unstored but bounded in [0, 1], so the marginal alone
    // fixes a floor and a ceiling one behavior-weight apart, and a stated
    // probability outside that band contradicts the index beside it. Without
    // this, the two probabilities were the only stored values the schema
    // range-checked but never related to anything.
    const marginalFloor =
      C.evilMarginalWeight * (entry.evilProbability as number)
    if (
      (entry.evilReadIndex as number) < marginalFloor - PROBABILITY_TOLERANCE
      || (entry.evilReadIndex as number)
        > marginalFloor + C.evilBehaviorWeight + PROBABILITY_TOLERANCE
    ) return false
    evilReadIndices.push(entry.evilReadIndex as number)
    merlinReadIndices.push(entry.merlinReadIndex as number)
    servantWeights.push(entry.servantWeight as number)
  }

  const baseline = detached.servantBaseline
  if (!plainRecord(baseline) || !exactKeys(baseline, [...BASELINE_KEYS])) {
    return false
  }
  // servantWeightTotal is a COUNT, not a probability: it sums one marginal per
  // seat, so it lands on the expected number of servants in the cast. That is
  // 1.0 at five players and 4.0 at ten, and validating it as a probability
  // rejected every cast above five while the five-player tests stayed green.
  if (
    baseline.weightSemantics !== 'public-servant-marginal-weighted'
    || typeof baseline.servantWeightTotal !== 'number'
    || !Number.isFinite(baseline.servantWeightTotal)
    || baseline.servantWeightTotal <= 0
    || baseline.servantWeightTotal > playerCount
    || !probability(baseline.evilReadMean)
    || !probability(baseline.evilReadSpread)
    || !probability(baseline.merlinReadMean)
    || !probability(baseline.merlinReadSpread)
  ) return false

  const weightTotal = stableProbabilitySum(servantWeights, (w) => w)
  if (
    !(weightTotal > 0)
    || Math.abs(weightTotal - (baseline.servantWeightTotal as number))
      > PROBABILITY_TOLERANCE
  ) return false

  const evil = weightedMoments(evilReadIndices, servantWeights, weightTotal)
  const merlin = weightedMoments(
    merlinReadIndices, servantWeights, weightTotal,
  )
  if (
    Math.abs(evil.mean - (baseline.evilReadMean as number))
      > PROBABILITY_TOLERANCE
    || Math.abs(evil.spread - (baseline.evilReadSpread as number))
      > PROBABILITY_TOLERANCE
    || Math.abs(merlin.mean - (baseline.merlinReadMean as number))
      > PROBABILITY_TOLERANCE
    || Math.abs(merlin.spread - (baseline.merlinReadSpread as number))
      > PROBABILITY_TOLERANCE
  ) return false

  for (let seat = 0; seat < playerCount; seat++) {
    const entry = seats[seat] as Record<string, unknown>
    const expectedEvil = deviationOf(
      evilReadIndices[seat], evil.mean, evil.spread,
    )
    const expectedMerlin = deviationOf(
      merlinReadIndices[seat], merlin.mean, merlin.spread,
    )
    if (
      Math.abs(expectedEvil - (entry.evilReadDeviation as number))
        > PROBABILITY_TOLERANCE
      || Math.abs(expectedMerlin - (entry.merlinReadDeviation as number))
        > PROBABILITY_TOLERANCE
    ) return false
  }

  return true
}

const publicSelfReadCodec =
  projectionCodec<PublicSelfReadSnapshot>(publicSelfReadSchema)

export const validatePublicSelfReadSnapshot = publicSelfReadCodec.validate

export const validateAdmittedPublicSelfReadHostJoin =
  exactHostJoin(buildPublicSelfRead)
