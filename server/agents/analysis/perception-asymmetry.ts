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
// The reducer is generic and imports nothing: it knows about neither worlds nor
// roles, only about keys, probabilities, and overlay samples. Each role module
// supplies its own channel (which world maps to which subject) and its own
// exploit value; those are the genuinely role-specific pieces and stay put.

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
