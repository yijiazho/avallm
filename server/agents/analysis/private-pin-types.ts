import type { Seat } from '../../engine/types.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { PrivatePin } from './perception-asymmetry.ts'

export const PRIVATE_PIN_READ_VERSION = 'private-pin-read-v1'
export const PRIVATE_PIN_READ_DEGRADATION = 'private-pin-read-failed'

export interface PrivatePinRow {
  /** The seat this row is about. */
  readonly seat: Seat
  /** The acting seat's own posterior that `seat` is evil. */
  readonly privateEvilProbability: number
  /** The public read that `seat` is evil (the whole table's suspicion). */
  readonly publicEvilProbability: number
  /**
   * `'evil'`/`'good'` when the acting seat's belief pins this seat's alignment
   * (probability exactly 1 or 0) while the public read still leaves it open;
   * `null` otherwise. See certaintyDifferential.
   */
  readonly pin: PrivatePin
}

/**
 * What one seat privately knows that the table does not, as a per-seat gap
 * between its own belief and the shared public read.
 *
 * The rows for OTHER seats are leverage: alignments the acting seat can pin and
 * the room cannot (a good player who saw a teammate fail a quest, Merlin's
 * vision of the evils it sees). The acting seat's OWN row is the complementary
 * cover read: where its certain self-knowledge sits against the table's diffuse
 * suspicion. It composes with public-self-read (public-in, public-out): that
 * gives the table's read of every seat, this adds the private operand and
 * reports where the two disagree at a certainty boundary.
 */
export interface PrivatePinRead {
  readonly version: typeof PRIVATE_PIN_READ_VERSION
  readonly observerModelVersion: string
  readonly beliefModelVersion: string
  readonly beliefThroughSeq: number
  readonly beliefQuality: BeliefSnapshot['quality']
  readonly playerCount: number
  readonly actingSeat: Seat
  /** One row per seat, ordered by seat; includes the acting seat's own row. */
  readonly rows: readonly PrivatePinRow[]
  /** Evil pins the acting seat holds on OTHER seats (leverage). */
  readonly pinnedEvilCount: number
  /** Good pins the acting seat holds on OTHER seats (leverage). */
  readonly pinnedGoodCount: number
}

export const EVIL_EXPOSURE_READ_VERSION = 'evil-exposure-read-v1'
export const EVIL_EXPOSURE_READ_DEGRADATION = 'evil-exposure-read-failed'

/** The exact channels by which a good seat can be certain the acting seat is evil. */
export type EvilExposureChannel = 'quest-collapse'

export interface EvilExposurePinner {
  /** A good seat that is certain the acting (evil) seat is evil. */
  readonly seat: Seat
  /** How it knows. */
  readonly channel: EvilExposureChannel
}

/**
 * Who, among the good seats, is certain the acting (evil) seat is evil: the
 * level-2 mirror of the leverage read. This is the "who can pin me" the minion
 * in the original question wanted and its own belief cannot represent.
 *
 * It reports only the exact, seat-specific channel: quest collapse. A resolved
 * failed quest with failCount === teamSize - 1 has exactly one good member (the
 * rest are evil), so that lone good member knows every teammate is evil,
 * including the acting seat if it shared the quest. The diffuse audience read
 * (public-self-read's evil-cover axis) and the Merlin-vision channel (which
 * good seat is the Merlin that sees all non-Mordred evil) are covered
 * elsewhere: the former by public-self-read, the latter by the assassin Merlin
 * posterior, whose P(seat is Merlin) IS the vision-exposure distribution.
 * Partial multi-quest deductions are a future extension.
 */
export interface EvilExposureRead {
  readonly version: typeof EVIL_EXPOSURE_READ_VERSION
  readonly beliefModelVersion: string
  readonly beliefThroughSeq: number
  readonly beliefQuality: BeliefSnapshot['quality']
  readonly playerCount: number
  readonly actingSeat: Seat
  /** Whether the acting seat is Mordred (invisible to Merlin), for the reader's vision-channel context. */
  readonly actingIsMordred: boolean
  /** Good seats certain the acting seat is evil, ordered by seat. */
  readonly pinners: readonly EvilExposurePinner[]
}
