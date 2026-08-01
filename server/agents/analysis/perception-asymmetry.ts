// Shared computation behind the one-layer opponent-models: mordred-blindness,
// assassin-merlin-posterior, and morgana-counterfeit. See
// docs/design-perception-primitive.md for the consolidation this is the first
// step of.
//
// This is the certainty side of the primitive: a complete-world sum over an
// acting seat's belief worlds, accumulated per subject (a seat hypothesis or a
// target), optionally split by a bounded non-probability behavioral overlay.
// The overlay is held strictly beside the mass; the only place it multiplies
// into probability is the overlay-weighted mass a consumer explicitly asks for,
// which is a conditional expectation, not a reweighted posterior.
//
// The accumulators are generic over the subject key: they know about neither
// worlds nor roles, only keys, probabilities, and overlay samples. The single
// dependency is the shared compensated sum, which partitionBySubject reuses so
// its per-subject mass is bit-identical to a caller that summed each bucket
// inline. Each role module supplies its own channel (which world maps to which
// subject) and its own exploit value; those are the genuinely role-specific
// pieces and stay put.
//
// Two further shared folds live here beside the accumulators.
// certaintyDifferential is the private-vs-public certainty comparison behind
// the private-pin read, and teamEvilCountDistribution is the per-team evil-count
// fold that the counterfeit and blindness objectives share. Both reuse the same
// compensated sum so their totals match an inline loop bit for bit.

import { stableProbabilitySum } from '../canonical/probability-arithmetic.ts'

export interface PerceptionOverlaySample {
  /** Whether the behavioral overlay had any observation for this item. */
  readonly available: boolean
  /** Bounded overlay index; read only when `available` is true. */
  readonly index: number
}

export interface SubjectMassAccumulation {
  /** Sum of probability over items mapped to this subject. */
  mass: number
  /** Sum of probability over items whose overlay sample was available. */
  overlayAvailableMass: number
  /** Sum of probability * overlay index over overlay-available items. */
  overlayWeightedMass: number
}

/**
 * Accumulate complete-world probability mass per subject, in input order.
 *
 * The accumulation order is contractual, not incidental. Consumers compare the
 * resulting sums by a strict tolerance and, downstream, by byte-identical
 * payload, so the sequence of additions has to match a hand-rolled reduction
 * over the same items or the last bits drift. Iterating `items` once, in order,
 * and folding into a Map keyed by subject reproduces exactly the inline loops
 * this replaces.
 *
 * An item whose `keyOf` returns `undefined` belongs to no subject and is
 * skipped, which lets a channel predicate exclude items without a second pass.
 */
export function accumulateSubjectMass<Item, Key>(
  items: Iterable<Item>,
  keyOf: (item: Item) => Key | undefined,
  probabilityOf: (item: Item) => number,
  overlayOf?: (item: Item) => PerceptionOverlaySample,
): Map<Key, SubjectMassAccumulation> {
  const totals = new Map<Key, SubjectMassAccumulation>()
  for (const item of items) {
    const key = keyOf(item)
    if (key === undefined) continue
    const probability = probabilityOf(item)
    const aggregate = totals.get(key) ?? {
      mass: 0,
      overlayAvailableMass: 0,
      overlayWeightedMass: 0,
    }
    aggregate.mass += probability
    if (overlayOf) {
      const overlay = overlayOf(item)
      if (overlay.available) {
        aggregate.overlayAvailableMass += probability
        aggregate.overlayWeightedMass += probability * overlay.index
      }
    }
    totals.set(key, aggregate)
  }
  return totals
}

export interface SubjectPartition<Item, Key> {
  /** Items grouped by subject, each bucket in input order. */
  readonly buckets: Map<Key, Item[]>
  /** Compensated total probability mass per subject. */
  readonly mass: Map<Key, number>
}

/**
 * Group items by subject and give each subject's total probability mass, using
 * the shared compensated summation.
 *
 * This is the counterpart to accumulateSubjectMass for consumers that (a) need
 * the buckets themselves for a second, subject-local pass, and (b) require the
 * compensated summation rather than the naive fold, because their result is
 * precision-sensitive (the assassin posterior feeds an irreversible kill shot,
 * and its per-Merlin-candidate buckets can be large enough that a naive sum
 * drifts). Every item must map to a subject; `keyOf` may throw to reject an
 * illegal item, which keeps a caller's validation in its single grouping pass.
 *
 * Mass is stableProbabilitySum over each bucket, in insertion (input) order, so
 * the result is bit-identical to a caller that bucketed inline and summed each
 * bucket the same way. That identity is the whole point: it lets the assassin
 * posterior route its prior through here without moving a single ULP.
 */
export function partitionBySubject<Item, Key>(
  items: Iterable<Item>,
  keyOf: (item: Item) => Key,
  probabilityOf: (item: Item) => number,
): SubjectPartition<Item, Key> {
  const buckets = new Map<Key, Item[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }
  const mass = new Map<Key, number>()
  for (const [key, bucket] of buckets) {
    mass.set(key, stableProbabilitySum(bucket, probabilityOf))
  }
  return { buckets, mass }
}

/**
 * The distribution of "how many of `team` are evil" over the given worlds,
 * accumulated with the naive fold in input order.
 *
 * Returns the raw (unnormalized) mass per count, indices 0..team.length; the
 * caller normalizes with whatever discipline its payload pins. `isEvilOnTeam`
 * is the channel: it decides, per world and seat, which alignment/role counts
 * (Merlin-visible evil, total evil, quest-fail-implied evil, ...). This is the
 * per-team counterpart to accumulateSubjectMass. The counterfeit read calls it;
 * the blind-window assessments compute the same shape inline (kept fused there
 * because their loop also needs the per-world counts for the window predicate),
 * and the quest-coparticipation channel will need it. Naive summation matches
 * those consumers bit-for-bit; the counts per team are small, so compensation
 * is unnecessary here.
 */
export function teamEvilCountDistribution<Item>(
  items: Iterable<Item>,
  team: readonly number[],
  isEvilOnTeam: (item: Item, seat: number) => boolean,
  probabilityOf: (item: Item) => number,
): number[] {
  const out = Array<number>(team.length + 1).fill(0)
  for (const item of items) {
    let count = 0
    for (const seat of team) if (isEvilOnTeam(item, seat)) count += 1
    out[count]! += probabilityOf(item)
  }
  return out
}

/**
 * What a seat's private belief is certain of about another seat that the public
 * posterior is not. `'evil'`/`'good'` mean the private belief pins that seat's
 * alignment (probability exactly 1 or 0) while the public posterior still leaves
 * it open; `null` means no private advantage over the table.
 */
export type PrivatePin = 'evil' | 'good' | null

export interface CertaintyDifferentialRow {
  readonly seat: number
  readonly privateEvilProbability: number
  readonly publicEvilProbability: number
  readonly privatePin: PrivatePin
}

/**
 * The certainty differential between a seat's own belief and the public read:
 * per seat, whether the private posterior pins an alignment the table still
 * treats as open.
 *
 * This is the quest-coparticipation channel's substrate, and the shape behind
 * the original question: a good player who failed a small quest alongside an
 * evil one has that evil pinned privately (its private evil probability is 1)
 * while the table only suspects (public evil probability strictly between 0 and
 * 1), so the row reads `privatePin: 'evil'`. It needs no new fold: a seat's
 * feasible-world belief already integrates the quest record, so the pin is just
 * where the two marginals disagree at a certainty boundary.
 *
 * A pin requires the PRIVATE side to be exactly certain (the belief snapshots
 * snap certainty to exactly 1, and the public observer's marginals are exact
 * count ratios) AND the PUBLIC side to be strictly uncertain. A seat the public
 * has already pinned carries no private advantage and reads `null`.
 */
export function certaintyDifferential(
  privateEvilProbability: readonly number[],
  publicEvilProbability: readonly number[],
): CertaintyDifferentialRow[] {
  if (privateEvilProbability.length !== publicEvilProbability.length) {
    throw new Error('certainty differential requires aligned marginals')
  }
  return privateEvilProbability.map((privateEvil, seat) => {
    const publicEvil = publicEvilProbability[seat]!
    const publicUncertain = publicEvil > 0 && publicEvil < 1
    const privatePin: PrivatePin =
      !publicUncertain ? null
        : privateEvil === 1 ? 'evil'
          : privateEvil === 0 ? 'good'
            : null
    return { seat, privateEvilProbability: privateEvil, publicEvilProbability: publicEvil, privatePin }
  })
}

/** The zero accumulation a subject with no matching item reads as. */
export const EMPTY_SUBJECT_MASS: Readonly<SubjectMassAccumulation> =
  Object.freeze({
    mass: 0,
    overlayAvailableMass: 0,
    overlayWeightedMass: 0,
  })

/**
 * The overlay-weighted mass conditioned on overlay availability, or null when
 * no observation was available for the subject.
 *
 * This is the raw ratio the consumers spell out inline; callers that want a
 * bounded index clamp the result themselves, so the guarded division lives here
 * and the clamp policy stays with the payload it feeds.
 */
export function conditionalOverlayIndex(
  aggregate: SubjectMassAccumulation,
): number | null {
  return aggregate.overlayAvailableMass === 0
    ? null
    : aggregate.overlayWeightedMass / aggregate.overlayAvailableMass
}
