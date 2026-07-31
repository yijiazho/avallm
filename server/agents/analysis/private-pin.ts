/**
 * The private pin read: what the acting seat knows that the table does not.
 *
 * A seat's feasible-world belief already integrates everything it privately
 * knows (role vision AND the public quest record), so a pin is not a new fold
 * but a certainty differential: where the seat's own posterior is certain about
 * an alignment the public read still leaves open. This is the general form of
 * the servant-pins-minion case (a good player who failed a small quest beside
 * an evil one) and of Merlin's vision alike; both surface here uniformly.
 *
 * Inert substrate: this projects a read and holds no scoring authority. It
 * composes with public-self-read rather than replacing it (that is public-in,
 * public-out; this adds the private operand).
 */

import type { PlayerView } from '../../engine/types.ts'
import { visibleEventCursor } from '../belief/exact.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import { certaintyDifferential } from './perception-asymmetry.ts'
import { observePublicRecord } from './observer.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from './observer-types.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import {
  denseArray,
  exactKeys,
  plainDataRecord as plainRecord,
  probability,
  tableSize,
} from '../components/canonical-shape.ts'
import {
  EVIL_EXPOSURE_READ_VERSION,
  PRIVATE_PIN_READ_VERSION,
  type EvilExposurePinner,
  type EvilExposureRead,
  type PrivatePinRead,
  type PrivatePinRow,
} from './private-pin-types.ts'
import {
  exactHostJoin,
  projectionCodec,
} from './projection-codec.ts'

/** The pin a row must carry, recomputed from its own two probabilities. */
function expectedPin(
  privateEvilProbability: number,
  publicEvilProbability: number,
): PrivatePinRow['pin'] {
  const publicUncertain =
    publicEvilProbability > 0 && publicEvilProbability < 1
  if (!publicUncertain) return null
  if (privateEvilProbability === 1) return 'evil'
  if (privateEvilProbability === 0) return 'good'
  return null
}

export function buildPrivatePinRead(input: {
  view: PlayerView
  belief: BeliefSnapshot
}): PrivatePinRead {
  const { view, belief } = input
  if (belief.throughSeq !== visibleEventCursor(view)) {
    throw new Error('private pin read requires a belief at the view cursor')
  }
  if (belief.playerMarginals.length !== view.playerCount) {
    throw new Error('private pin read requires a marginal per seat')
  }
  const observer = observePublicRecord(projectPublicRecord(view))
  if (observer.seats.length !== view.playerCount) {
    throw new Error('private pin read requires a public seat read per seat')
  }
  const privateEvil = belief.playerMarginals.map(
    (marginal) => marginal.evilProbability,
  )
  const publicEvil = observer.seats.map((seat) => seat.evilProbability)
  const rows = certaintyDifferential(privateEvil, publicEvil).map(
    (row): PrivatePinRow => ({
      seat: row.seat,
      privateEvilProbability: row.privateEvilProbability,
      publicEvilProbability: row.publicEvilProbability,
      pin: row.privatePin,
    }),
  )
  const leverage = rows.filter((row) => row.seat !== view.seat)
  return {
    version: PRIVATE_PIN_READ_VERSION,
    observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
    beliefModelVersion: belief.modelVersion,
    beliefThroughSeq: belief.throughSeq,
    beliefQuality: belief.quality,
    playerCount: view.playerCount,
    actingSeat: view.seat,
    rows,
    pinnedEvilCount: leverage.filter((row) => row.pin === 'evil').length,
    pinnedGoodCount: leverage.filter((row) => row.pin === 'good').length,
  }
}

const ROW_KEYS = [
  'seat',
  'privateEvilProbability',
  'publicEvilProbability',
  'pin',
] as const

/**
 * Shape plus the two internal recomputations a shape-only check would miss:
 * every row's pin must follow from its own probabilities, and the leverage
 * counts must match the pins over the non-acting rows. The two probabilities
 * themselves are checked against the belief and observer by the host join, not
 * here (this schema never sees a view).
 */
function privatePinReadSchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  if (!exactKeys(detached, [
    'version',
    'observerModelVersion',
    'beliefModelVersion',
    'beliefThroughSeq',
    'beliefQuality',
    'playerCount',
    'actingSeat',
    'rows',
    'pinnedEvilCount',
    'pinnedGoodCount',
  ])) return false
  if (
    detached.version !== PRIVATE_PIN_READ_VERSION
    || detached.observerModelVersion !== PUBLIC_OBSERVER_MODEL_VERSION
    || typeof detached.beliefModelVersion !== 'string'
    || detached.beliefModelVersion.length === 0
    || detached.beliefModelVersion.length > 200
    || !Number.isSafeInteger(detached.beliefThroughSeq)
    || (detached.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      String(detached.beliefQuality),
    )
    || !tableSize(detached.playerCount)
    || !Number.isSafeInteger(detached.actingSeat)
    || (detached.actingSeat as number) < 0
    || (detached.actingSeat as number) >= (detached.playerCount as number)
    || !denseArray(detached.rows)
  ) return false

  const playerCount = detached.playerCount as number
  const rows = detached.rows as unknown[]
  if (rows.length !== playerCount) return false

  let evilLeverage = 0
  let goodLeverage = 0
  for (let seat = 0; seat < playerCount; seat++) {
    const entry = rows[seat]
    if (!plainRecord(entry) || !exactKeys(entry, [...ROW_KEYS])) return false
    if (
      entry.seat !== seat
      || !probability(entry.privateEvilProbability)
      || !probability(entry.publicEvilProbability)
      || ![null, 'evil', 'good'].includes(entry.pin as string | null)
    ) return false
    if (entry.pin !== expectedPin(
      entry.privateEvilProbability as number,
      entry.publicEvilProbability as number,
    )) return false
    if (seat !== (detached.actingSeat as number)) {
      if (entry.pin === 'evil') evilLeverage += 1
      else if (entry.pin === 'good') goodLeverage += 1
    }
  }
  return detached.pinnedEvilCount === evilLeverage
    && detached.pinnedGoodCount === goodLeverage
}

const privatePinReadCodec =
  projectionCodec<PrivatePinRead>(privatePinReadSchema)

export const validatePrivatePinReadSnapshot = privatePinReadCodec.validate

export const decodeCanonicalPrivatePinRead = privatePinReadCodec.decode

export const validateAdmittedPrivatePinReadHostJoin =
  exactHostJoin(buildPrivatePinRead)

/**
 * The level-2 mirror: which good seats are certain the acting evil seat is evil,
 * via the exact quest-collapse channel. A resolved failed quest with
 * failCount === teamSize - 1 has one good member and the rest evil, so that lone
 * good member pins every teammate. The acting seat's belief marks the good seats
 * (evil probability exactly 0), and the collapse condition is public.
 */
export function buildEvilExposureRead(input: {
  view: PlayerView
  belief: BeliefSnapshot
}): EvilExposureRead {
  const { view, belief } = input
  if (view.alignment !== 'evil') {
    throw new Error('evil exposure read requires an evil seat')
  }
  if (belief.throughSeq !== visibleEventCursor(view)) {
    throw new Error('evil exposure read requires a belief at the view cursor')
  }
  if (belief.playerMarginals.length !== view.playerCount) {
    throw new Error('evil exposure read requires a marginal per seat')
  }
  const certainGood = new Set(
    belief.playerMarginals
      .filter((marginal) => marginal.evilProbability === 0)
      .map((marginal) => marginal.seat),
  )
  const record = projectPublicRecord(view)
  const collapseTeams = record.quests
    .filter((quest) =>
      quest.result === 'fail'
      && quest.team !== undefined
      && (quest.failCount ?? 0) === quest.team.length - 1
      && quest.team.includes(view.seat))
    .map((quest) => quest.team as readonly number[])
  const pinnerSeats = new Set<number>()
  for (const team of collapseTeams) {
    for (const seat of team) {
      if (seat !== view.seat && certainGood.has(seat)) pinnerSeats.add(seat)
    }
  }
  const pinners: EvilExposurePinner[] = [...pinnerSeats]
    .sort((left, right) => left - right)
    .map((seat) => ({ seat, channel: 'quest-collapse' }))
  return {
    version: EVIL_EXPOSURE_READ_VERSION,
    beliefModelVersion: belief.modelVersion,
    beliefThroughSeq: belief.throughSeq,
    beliefQuality: belief.quality,
    playerCount: view.playerCount,
    actingSeat: view.seat,
    actingIsMordred: view.role === 'mordred',
    pinners,
  }
}

const EXPOSURE_PINNER_KEYS = ['seat', 'channel'] as const

function evilExposureReadSchema(detached: unknown): boolean {
  if (!plainRecord(detached)) return false
  if (!exactKeys(detached, [
    'version',
    'beliefModelVersion',
    'beliefThroughSeq',
    'beliefQuality',
    'playerCount',
    'actingSeat',
    'actingIsMordred',
    'pinners',
  ])) return false
  if (
    detached.version !== EVIL_EXPOSURE_READ_VERSION
    || typeof detached.beliefModelVersion !== 'string'
    || detached.beliefModelVersion.length === 0
    || detached.beliefModelVersion.length > 200
    || !Number.isSafeInteger(detached.beliefThroughSeq)
    || (detached.beliefThroughSeq as number) < -1
    || !['constraints-only', 'weighted', 'degraded'].includes(
      String(detached.beliefQuality),
    )
    || !tableSize(detached.playerCount)
    || !Number.isSafeInteger(detached.actingSeat)
    || (detached.actingSeat as number) < 0
    || (detached.actingSeat as number) >= (detached.playerCount as number)
    || typeof detached.actingIsMordred !== 'boolean'
    || !denseArray(detached.pinners)
  ) return false

  const playerCount = detached.playerCount as number
  let previousSeat = -1
  for (const raw of detached.pinners) {
    if (!plainRecord(raw) || !exactKeys(raw, [...EXPOSURE_PINNER_KEYS])) {
      return false
    }
    if (
      !Number.isSafeInteger(raw.seat)
      || (raw.seat as number) <= previousSeat
      || (raw.seat as number) >= playerCount
      || raw.seat === detached.actingSeat
      || raw.channel !== 'quest-collapse'
    ) return false
    previousSeat = raw.seat as number
  }
  return true
}

const evilExposureReadCodec =
  projectionCodec<EvilExposureRead>(evilExposureReadSchema)

export const validateEvilExposureReadSnapshot = evilExposureReadCodec.validate

export const decodeCanonicalEvilExposureRead = evilExposureReadCodec.decode

export const validateAdmittedEvilExposureReadHostJoin =
  exactHostJoin(buildEvilExposureRead)
