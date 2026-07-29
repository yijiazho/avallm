import { isProxy } from 'node:util/types'

declare const canonicalJsonBrand: unique symbol

/**
 * A value which has crossed the component kernel's strict JSON boundary.
 *
 * The brand is intentionally opaque. Component decoders may inspect the
 * value's semantic shape, but must not accept arbitrary JavaScript values.
 */
export type CanonicalJsonValue = unknown & {
  readonly [canonicalJsonBrand]: true
}

export type CanonicalJsonResult =
  | Readonly<{
      ok: true
      payload: CanonicalJsonValue
      bytes: number
    }>
  | Readonly<{
      ok: false
      failureCode: 'payload-json-unsafe' | 'payload-too-large'
    }>

const MAX_CANONICAL_JSON_DEPTH = 256
const MAX_COMPONENT_INPUT_NODES = 2_097_152

class CanonicalJsonError extends Error {
  readonly failureCode: 'payload-json-unsafe' | 'payload-too-large'

  constructor(
    failureCode: 'payload-json-unsafe' | 'payload-too-large',
    message: string,
  ) {
    super(message)
    this.failureCode = failureCode
  }
}

interface TraversalBudget {
  readonly maxBytes?: number
  readonly maxNodes: number
  nodes: number
}

interface FrozenJsonValue {
  readonly value: unknown
  readonly bytes: number
}

function unsafe(message: string): never {
  throw new CanonicalJsonError('payload-json-unsafe', message)
}

function tooLarge(): never {
  throw new CanonicalJsonError(
    'payload-too-large',
    'JSON payload exceeds its byte bound',
  )
}

function addBytes(
  budget: TraversalBudget,
  ...parts: number[]
): number {
  const bytes = parts.reduce((sum, part) => sum + part, 0)
  if (budget.maxBytes !== undefined && bytes > budget.maxBytes) {
    tooLarge()
  }
  return bytes
}

function primitiveBytes(
  value: null | string | boolean | number,
  budget: TraversalBudget,
): number {
  if (typeof value === 'string') {
    // JSON escaping never makes a string shorter than its UTF-8 source. This
    // cheap lower bound avoids allocating a much larger escaped form after
    // the payload is already known to be oversized.
    if (
      budget.maxBytes !== undefined
      && Buffer.byteLength(value, 'utf8') + 2 > budget.maxBytes
    ) {
      tooLarge()
    }
  }
  return addBytes(
    budget,
    Buffer.byteLength(JSON.stringify(value), 'utf8'),
  )
}

function freezeJsonValue(
  value: unknown,
  ancestors: Set<object>,
  budget: TraversalBudget,
  depth = 0,
  allowUndefined = false,
  omitUndefinedObjectProperties = false,
): FrozenJsonValue {
  if (depth > MAX_CANONICAL_JSON_DEPTH) {
    unsafe('JSON nesting exceeds the canonical depth bound')
  }
  budget.nodes++
  if (budget.nodes > budget.maxNodes) {
    if (budget.maxBytes !== undefined) tooLarge()
    unsafe('component input exceeds the canonical node bound')
  }
  if (value === undefined && allowUndefined) {
    return { value, bytes: 0 }
  }
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return { value, bytes: primitiveBytes(value, budget) }
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) unsafe('non-finite number')
    return { value, bytes: primitiveBytes(value, budget) }
  }
  if (typeof value !== 'object') unsafe('non-JSON value')
  if (isProxy(value)) unsafe('proxy value')
  if (ancestors.has(value)) unsafe('cyclic value')

  const isArray = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (
    isArray
      ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null
  ) {
    unsafe('non-plain object')
  }

  ancestors.add(value)
  try {
    if (isArray) {
      // Every dense JSON array needs at least one byte per element plus its
      // commas and brackets. Reject impossible-to-fit lengths before own-key
      // enumeration or an index-sized allocation.
      if (
        budget.maxBytes !== undefined
        && value.length > Math.floor((budget.maxBytes - 1) / 2)
      ) {
        tooLarge()
      }
      const ownKeys = Reflect.ownKeys(value)
      if (
        ownKeys.length !== value.length + 1
        || !ownKeys.includes('length')
      ) {
        unsafe('non-JSON array shape')
      }
      for (const key of ownKeys) {
        if (key === 'length') continue
        if (
          typeof key !== 'string'
          || !/^(0|[1-9]\d*)$/.test(key)
          || Number(key) >= value.length
        ) {
          unsafe('non-JSON array shape')
        }
      }
      const clone: unknown[] = []
      let bytes = 2
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          `${index}`,
        )
        if (
          !descriptor
          || descriptor.enumerable !== true
          || !Object.hasOwn(descriptor, 'value')
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) {
          unsafe('non-JSON array shape')
        }
        const child = freezeJsonValue(
          descriptor.value,
          ancestors,
          budget,
          depth + 1,
          allowUndefined,
          omitUndefinedObjectProperties,
        )
        clone.push(child.value)
        bytes = addBytes(
          budget,
          bytes,
          child.bytes,
          index === 0 ? 0 : 1,
        )
      }
      return { value: Object.freeze(clone), bytes }
    }
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string')) {
      unsafe('unsafe property')
    }
    // A nonempty property needs at least five bytes: two object delimiters,
    // a two-byte quoted key, and a colon. Bound property work before cloning
    // descriptors or values.
    if (
      budget.maxBytes !== undefined
      && keys.length > Math.max(0, budget.maxBytes - 2) / 3
    ) {
      tooLarge()
    }
    const sortedKeys = (keys as string[]).sort()
    const clone: Record<string, unknown> = {}
    let bytes = 2
    let emitted = 0
    for (const key of sortedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        unsafe('non-JSON property')
      }
      if (
        omitUndefinedObjectProperties
        && descriptor.value === undefined
      ) {
        continue
      }
      const keyBytes = primitiveBytes(key, budget)
      const child = freezeJsonValue(
        descriptor.value,
        ancestors,
        budget,
        depth + 1,
        allowUndefined,
        omitUndefinedObjectProperties,
      )
      Object.defineProperty(clone, key, {
        value: child.value,
        enumerable: true,
        writable: false,
        configurable: false,
      })
      bytes = addBytes(
        budget,
        bytes,
        keyBytes,
        1,
        child.bytes,
        emitted === 0 ? 0 : 1,
      )
      emitted++
    }
    return { value: Object.freeze(clone), bytes }
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Copy arbitrary component ingress into a sorted, deeply frozen, strict JSON
 * value and measure the exact bytes the kernel will retain.
 */
function canonicalizeJsonMode(
  value: unknown,
  maxBytes: number,
  omitUndefinedObjectProperties: boolean,
): CanonicalJsonResult {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      return { ok: false, failureCode: 'payload-json-unsafe' }
    }
    const frozen = freezeJsonValue(
      value,
      new Set(),
      {
        maxBytes,
        maxNodes: maxBytes,
        nodes: 0,
      },
      0,
      false,
      omitUndefinedObjectProperties,
    )
    const payload = frozen.value as CanonicalJsonValue
    // Exercise the platform clone boundary only after accessors and proxies
    // have been rejected, so clone cannot execute hostile JavaScript.
    structuredClone(payload)
    return { ok: true, payload, bytes: frozen.bytes }
  } catch (error) {
    return {
      ok: false,
      failureCode: error instanceof CanonicalJsonError
        ? error.failureCode
        : 'payload-json-unsafe',
    }
  }
}

export function canonicalizeJson(
  value: unknown,
  maxBytes: number,
): CanonicalJsonResult {
  return canonicalizeJsonMode(value, maxBytes, false)
}

/**
 * Canonicalize an in-process value exactly as an object crossing a JSON
 * transport would arrive: own data properties whose value is undefined are
 * omitted. Undefined array entries remain invalid rather than silently
 * becoming null, because protocol arrays do not use that ambiguity.
 */
export function canonicalizeTransportJson(
  value: unknown,
  maxBytes: number,
): CanonicalJsonResult {
  return canonicalizeJsonMode(value, maxBytes, true)
}

export function canonicalJsonEqual(
  left: CanonicalJsonValue,
  right: CanonicalJsonValue,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Freeze engine-owned input which may contain optional undefined properties.
 * This is not a component payload and therefore does not receive the
 * CanonicalJsonValue brand.
 */
export function freezeComponentInput<T>(value: T): Readonly<T> {
  const frozen = freezeJsonValue(
    value,
    new Set(),
    {
      maxNodes: MAX_COMPONENT_INPUT_NODES,
      nodes: 0,
    },
    0,
    true,
  ).value as Readonly<T>
  structuredClone(frozen)
  return frozen
}

/**
 * Read one exact data-only wrapper without invoking accessors.
 *
 * Wrapper parsing stays distinct from payload canonicalization so malformed
 * execution tags retain their established failure classification.
 */
export function exactOwnDataRecord(
  value: unknown,
  expected: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  try {
    if (
      !value
      || typeof value !== 'object'
      || Array.isArray(value)
      || isProxy(value)
    ) {
      return undefined
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined
    }
    const keys = Reflect.ownKeys(value)
    const sortedExpected = [...expected].sort()
    if (
      !keys.every((key) => typeof key === 'string')
      || keys.length !== expected.length
      || ![...keys].sort().every(
        (key, index) => key === sortedExpected[index],
      )
    ) {
      return undefined
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const record = Object.create(null) as Record<string, unknown>
    for (const key of expected) {
      const descriptor = descriptors[key]
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined
      }
      Object.defineProperty(record, key, {
        value: descriptor.value,
        enumerable: true,
        writable: false,
        configurable: false,
      })
    }
    return Object.freeze(record)
  } catch {
    return undefined
  }
}

export function denseOwnDataArrayValues(
  value: unknown,
  maxLength = 65_536,
): readonly unknown[] | undefined {
  try {
    if (!Array.isArray(value) || isProxy(value)) return undefined
    if (
      !Number.isSafeInteger(maxLength)
      || maxLength < 0
      || value.length > maxLength
    ) return undefined
    const keys = Reflect.ownKeys(value)
    if (
      keys.length !== value.length + 1
      || !keys.includes('length')
    ) {
      return undefined
    }
    const result: unknown[] = []
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        `${index}`,
      )
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined
      }
      result.push(descriptor.value)
    }
    return result
  } catch {
    return undefined
  }
}
