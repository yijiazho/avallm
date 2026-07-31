// Which belief models the HOST can rebuild from a view alone.
//
// Trace admission proves a decision by recomputing it. That recomputation has
// always built the posterior with `exactBelief`, which was correct while every
// seated preset ran the uniform model and silently wrong the moment one did
// not: a trace produced on a weighted belief is recomputed against a uniform
// one, disagrees, and is refused as a forgery. It disagrees even where the two
// posteriors are numerically identical, because the recomputed model version
// still differs.
//
// So the host needs to rebuild the belief the decision actually used. The
// precedent for how is already at this boundary: the score chain is resolved
// from the out-of-band architecture identity via `trustedNativeScoreChain`, and
// that identity already records `configuredPipeline.belief.model`. This is the
// same move for the belief.
//
// THE CLOSED LIST IS THE SECURITY PROPERTY. A model is listed here only if the
// host can rebuild it from `(view)` and nothing else. Anything unlisted returns
// undefined, and the caller must then decline to build a host surface at all,
// so the trace stays diagnostic. The failure direction matters: an unknown
// version must never fall back to `exactBelief`, because that would recompute a
// weighted decision against a lenient uniform posterior and could admit a trace
// the real model would have refused.
//
// The language-weighted belief is deliberately absent. Its version is composed
// at runtime from whatever mechanical belief sits underneath it, and rebuilding
// it needs interpreted language evidence that no host holds, so it is not
// reconstructible by this definition rather than merely unimplemented.

import { exactWorldBeliefModel } from './exact.ts'
import { questWeightedBeliefModel } from './quest-card-factor.ts'
import type { BeliefModel } from './types.ts'

/**
 * Every belief model the host can rebuild, keyed by the version an identity
 * records. Derived from the models themselves rather than from a second list of
 * strings, so a model cannot be registered here under a version it does not
 * actually report.
 */
const HOST_RECONSTRUCTIBLE_BELIEF_MODELS: ReadonlyMap<string, BeliefModel> =
  new Map(
    [exactWorldBeliefModel, questWeightedBeliefModel].map(
      (model) => [model.version, model],
    ),
  )

/**
 * The belief model an identity names, or undefined when the host cannot rebuild
 * it. Undefined is a refusal, not a default: see the header.
 */
export function hostReconstructibleBeliefModel(
  version: string,
): BeliefModel | undefined {
  return HOST_RECONSTRUCTIBLE_BELIEF_MODELS.get(version)
}

/**
 * Whether a trace's declared cognition is one the host can rebuild exactly.
 *
 * This is the single predicate both admission gates ask, and they must ask the
 * same one. `component-host-inputs` uses it to decide whether to bind a rebuilt
 * belief as a trusted input; `exact-host-join` uses it to decide whether to run
 * the exact native score replay. If those two ever disagreed, a trace could be
 * handed a rebuilt belief while escaping the replay that checks what it did
 * with one, which is precisely the hole that opened when the quest factor was
 * first seated against a predicate naming the uniform model literally.
 *
 * The factor bundle has to be the one the named model actually reports, so a
 * trace cannot pair a model with a bundle that did not produce it.
 *
 * Deliberately NOT reused by the legacy v1 role reader, which keeps its own
 * frozen `isExactNonLanguage`: that ingress is a historical shape, and widening
 * what it will verify is a separate decision with separate evidence.
 */
export function isHostReconstructibleCognition(
  components:
    | {
        readonly belief?: unknown
        readonly languageEvidence?: unknown
        readonly factors?: unknown
      }
    | undefined,
): boolean {
  const model = typeof components?.belief === 'string'
    ? hostReconstructibleBeliefModel(components.belief)
    : undefined
  return model !== undefined
    && components?.languageEvidence === 'off'
    && components?.factors === model.factorsVersion
}
