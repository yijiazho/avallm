import type { Seat } from '../../engine/types.ts'

export const PUBLIC_SELF_READ_VERSION = 'public-self-read-v1'

/**
 * Weights blending the exact public evil marginal with the behavior the
 * marginal cannot see.
 *
 * These overlap on purpose and the overlap is not free. Failed quests are
 * public, so the observer's feasible-world enumeration already prices them
 * into evilProbability as a logical constraint ("at least N of that team was
 * evil"). failedQuestExposureIndex prices the same events again as
 * accumulated circumstantial weight ("this seat keeps being there"). A seat
 * on three failed quests is therefore counted twice.
 *
 * That is the intended behavior rather than a bug being tolerated: the two
 * readings answer different questions, and the table demonstrably reasons the
 * second way. The cost is that this index runs hotter than the marginal alone
 * for repeat participants, which is why it is labelled a bounded proxy and
 * never a probability. Do not let a consumer treat it as one.
 */
export const PUBLIC_SELF_READ_CONSTANTS = Object.freeze({
  evilMarginalWeight: 0.70,
  evilBehaviorWeight: 0.30,
})

/**
 * How one seat reads to a public observer, on the two axes every role has a
 * preference over.
 *
 * The read is deliberately role-neutral and carries no weights. Merlin, evil,
 * and servants all care about the same two quantities and disagree only on
 * the sign and strength they attach to each, so the shared thing is the
 * measurement and the private thing is the preference. Encoding any role's
 * preference here would force the other roles to subtract it back out.
 *
 * Deviations are signed for the same reason. A negative evilReadDeviation is
 * a seat reading cleaner than a typical servant, which is reassuring for a
 * servant, irrelevant for a minion, and dangerous for Merlin, since a
 * spotless record is exactly the assassin's tell. One number, three readings.
 */
export interface PublicSelfRead {
  seat: Seat
  probabilitySemantics: 'public-uniform-feasible-joint'
  evilProbability: number
  merlinProbability: number
  proxySemantics: 'bounded-deterministic-proxy-not-role-probability'
  evilReadIndex: number
  merlinReadIndex: number
  /**
   * This seat's public servant marginal, and its weight in the baseline below.
   * Carried per seat rather than only as a total so the snapshot verifies its
   * own baseline arithmetic without needing the record back.
   */
  servantWeight: number
  /** Signed distance from the servant baseline, in spread units, in [-1, 1]. */
  evilReadDeviation: number
  merlinReadDeviation: number
}

/**
 * The reference point the deviations are measured against: what an ordinary
 * servant currently looks like from outside.
 *
 * It is a distribution and not a centroid, and the spread is the part that
 * earns its keep. "Look like an ordinary servant" implemented as distance to
 * the mean would push a scruffy-looking Merlin back toward spotless, which is
 * precisely backwards. Servants vary, and Merlin needs to land inside that
 * variation rather than on its clean edge.
 *
 * Seats are weighted by their public servant marginal, so the baseline is
 * built from the seats the table currently believes are ordinary, not from a
 * flat average over a cast that includes the roles being hidden from.
 */
export interface ServantBaselineRead {
  weightSemantics: 'public-servant-marginal-weighted'
  servantWeightTotal: number
  evilReadMean: number
  evilReadSpread: number
  merlinReadMean: number
  merlinReadSpread: number
}

export interface PublicSelfReadSnapshot {
  version: typeof PUBLIC_SELF_READ_VERSION
  observerModelVersion: string
  merlinLikenessVersion: string
  playerCount: number
  feasibleWorldCount: number
  servantBaseline: ServantBaselineRead
  seats: readonly PublicSelfRead[]
}
