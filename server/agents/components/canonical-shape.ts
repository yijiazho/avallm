/**
 * Shape guards shared by the analysis-domain payload validators.
 *
 * Every analysis module that admits an untrusted component payload needs the
 * same handful of predicates: is this a plain record, is this a dense array, is
 * this exactly these keys, is this a probability. Each module used to carry its
 * own copy, and the copies drifted: some rejected a Proxy and some did not,
 * some pinned the prototype and some did not. A guard that is weaker at one
 * call site than another is a hole at that site only, which is precisely the
 * defect duplication hides.
 *
 * These are the strict definitions. A caller that needs a laxer check should
 * say so explicitly rather than keep a private copy.
 */

import { isProxy } from 'node:util/types'
import type { Seat } from '../../engine/types.ts'

export const plainRecord = (
  value: unknown,
): value is Record<string, unknown> =>
  !!value
  && typeof value === 'object'
  && !Array.isArray(value)
  && !isProxy(value)
  && Object.getPrototypeOf(value) === Object.prototype

/**
 * As plainRecord, but also admits a null prototype.
 *
 * The canonical JSON boundary hands downstream validators records built with
 * `Object.create(null)`, so a validator that runs after that boundary must
 * accept them. Everything else stays as strict: no proxy, no exotic prototype.
 */
export const plainDataRecord = (
  value: unknown,
): value is Record<string, unknown> => {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)
  ) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Recursively assert detached JSON-shaped data: no accessors, no proxies, no
 * exotic prototypes, no cycles, no symbol keys, no non-finite numbers.
 */
export function plainDetachedData(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (
    typeof value !== 'object'
    || isProxy(value)
    || seen.has(value)
  ) return false
  seen.add(value)
  const array = Array.isArray(value)
  if (
    array
      ? (
          Object.keys(value).length !== value.length
          || Array.from(
            { length: value.length },
            (_, index) => Object.hasOwn(value, index),
          ).some((present) => !present)
        )
      : Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = descriptors[key]
    if (
      !descriptor
      || !descriptor.enumerable
      || !('value' in descriptor)
      || !plainDetachedData(descriptor.value, seen)
    ) return false
  }
  return true
}

export const denseArray = (value: unknown): value is unknown[] =>
  Array.isArray(value)
  && !isProxy(value)
  && Object.keys(value).length === value.length
  && Array.from(
    { length: value.length },
    (_, index) => Object.hasOwn(value, index),
  ).every(Boolean)

/**
 * A dense ascending seat list bounded by the table size. Ascending order is
 * canonical, so a repeated or out-of-order seat is a malformed payload rather
 * than a set to be normalized.
 */
export const canonicalSeats = (
  value: unknown,
  playerCount: number,
  allowEmpty = false,
): value is Seat[] =>
  denseArray(value)
  && (allowEmpty || value.length > 0)
  && value.length <= playerCount
  && value.every((seat, index, all) => {
    const previous = all[index - 1]
    return typeof seat === 'number'
      && Number.isSafeInteger(seat)
      && seat >= 0
      && seat < playerCount
      && (
        index === 0
        || (typeof previous === 'number' && previous < seat)
      )
  })

export const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key))

export const probability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1

/** Every ascending seat combination of the given size, in canonical order. */
export function canonicalCombinations(
  playerCount: number,
  size: number,
): readonly Seat[][] {
  const out: Seat[][] = []
  const selected: Seat[] = []
  const visit = (start: number): void => {
    if (selected.length === size) {
      out.push(selected.slice())
      return
    }
    for (
      let seat = start;
      seat <= playerCount - (size - selected.length);
      seat++
    ) {
      selected.push(seat)
      visit(seat + 1)
      selected.pop()
    }
  }
  visit(0)
  return out
}
