// The shape primitives the rest of admission reaches for: the host-table-bounded
// seat guard, the exact generic record and array walkers, the full-view
// narrowing, and the two small readings of a trace that both the relation
// validators and the native score replay want. This sits at the bottom of the
// admission graph deliberately. Each of these was written once and then wanted
// from several directions at once, and a private copy per caller is exactly how
// the seat guard lost its table bound the first time.

import type {
  PlayerView,
  Seat,
} from '../../../engine/types.ts'
import {
  canonicalSeats,
} from '../../canonical/canonical-shape.ts'
import type {
  DecisionTrace,
} from '../../trace.ts'
import {
  isDeepStrictEqual,
} from 'node:util'
import {
  isProxy,
} from 'node:util/types'

/**
 * The table size a trace's seat lists are bounded by, or undefined when the
 * caller supplied no host context at all.
 *
 * `rolesInPlay` is the one field both host-view arms carry, and its length is
 * the table size, so a partial `Pick<PlayerView, 'rolesInPlay'>` bounds the
 * seats just as well as a full view. It is also the only trustworthy source
 * here: a DecisionTrace declares no table size of its own, and reading one off
 * the payload would let the payload pick its own bound.
 *
 * `parseExternalDecisionReply` may be called with no host view at all, and that
 * path therefore gets the canonical seat shape without the upper bound. Every
 * finalized path holds a full PlayerView and is always bounded.
 */
export function hostTableSize(
  hostView: Pick<PlayerView, 'rolesInPlay'> | undefined,
): number | undefined {
  if (!hostView || !Array.isArray(hostView.rolesInPlay)) return undefined
  return hostView.rolesInPlay.length
}

/** No trustworthy table size, so bound the seat list by nothing but integers. */
const UNBOUNDED_TABLE = Number.MAX_SAFE_INTEGER

/**
 * canonicalSeats against the host's table, when the caller supplied one.
 *
 * This module used to carry a private `seatArray` that kept only "integer and
 * non-negative": no density, no safe-integer bound, no ordering, and above all
 * no table bound, so an admitted trace could name seat 9999 at a five-handed
 * table. Three call sites re-added distinct-and-ascending inline and none of
 * them re-added the bound, which is exactly the defect the shared guard
 * module's header describes.
 */
export function canonicalTraceSeats(
  value: unknown,
  playerCount: number | undefined,
  allowEmpty = false,
): value is readonly Seat[] {
  return canonicalSeats(value, playerCount ?? UNBOUNDED_TABLE, allowEmpty)
}

export const COMPONENT_FAILURE_CODES = new Set([
  'construction-ineligible',
  'applicability-failed',
  'dependency-unavailable',
  'host-input-unavailable',
  'host-input-invalid',
  'execution-failed',
  'malformed-result',
  'tag-mismatch',
  'payload-json-unsafe',
  'payload-too-large',
  'detached-validation-failed',
  'host-admission-failed',
])

export function exactGenericRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)
  ) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(
      [...ownKeys as string[]].sort(),
      [...keys].sort(),
    )
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  return keys.every((key) => {
    const descriptor = descriptors[key]
    return !!descriptor
      && descriptor.enumerable === true
      && 'value' in descriptor
      && descriptor.get === undefined
      && descriptor.set === undefined
  })
}

export function exactGenericArray(value: unknown): value is unknown[] {
  if (
    !Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) return false
  const expectedKeys = [
    ...Array.from({ length: value.length }, (_, index) => String(index)),
    'length',
  ]
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.some((key) => typeof key !== 'string')
    || !isDeepStrictEqual(
      [...ownKeys as string[]].sort(),
      [...expectedKeys].sort(),
    )
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    !length
    || !('value' in length)
    || length.value !== value.length
    || length.enumerable !== false
    || Object.hasOwn(length, 'get')
    || Object.hasOwn(length, 'set')
  ) return false
  for (let index = 0; index < value.length; index++) {
    const descriptor = descriptors[String(index)]
    if (!(
      !!descriptor
      && descriptor.enumerable === true
      && 'value' in descriptor
      && !Object.hasOwn(descriptor, 'get')
      && !Object.hasOwn(descriptor, 'set')
    )) return false
  }
  return true
}

export function nativeScoreSelectionSurvived(trace: DecisionTrace): boolean {
  const plannerSelectionAccepted =
    trace.plannerCandidateId !== undefined
    && trace.plannerCandidateId === trace.chosenCandidateId
    && !trace.degradation.some((code) => code.startsWith('planner-'))
  return trace.structuredCandidateId !== undefined
    && trace.chosenCandidateId === trace.structuredCandidateId
    && trace.forcedPolicyResult?.selectedCandidateId === undefined
    && trace.decisionLayerRun?.surface.selectedCandidateId === undefined
    && !plannerSelectionAccepted
}

export function isFullPlayerView(
  value: Pick<PlayerView, 'rolesInPlay'> | undefined,
): value is PlayerView {
  return !!value
    && 'events' in value
    && 'privateInfo' in value
    && 'quests' in value
    && 'players' in value
    && 'seat' in value
}
