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

/**
 * The payload bound a component payload gets unless its own structure
 * justifies a tighter one.
 *
 * This lives with the canonicalizer rather than with any one role because
 * both sides of a component's boundary must agree on it: the module's own
 * hostile-ingress canonicalizeJson call and the component definition's
 * declared maxPayloadBytes. Seven roles previously repeated this literal.
 */
export const DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES = 1_048_576

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

/**
 * The UTF-8 byte length of one JSON string literal, counted rather than built.
 *
 * The obvious spelling, Buffer.byteLength(JSON.stringify(value)), allocates the
 * whole escaped string only to read its size and drop it, and this is the
 * hottest measurement in the canonicalizer: every key and every string value of
 * every payload passes through it. Counting is exact by construction because
 * JSON string escaping is per code unit, and the arms below are the complete
 * escape table from the JSON grammar:
 *
 *   quote and backslash          two bytes (the escape plus the character)
 *   the five short escapes       two bytes (\b \t \n \f \r)
 *   any other control character  six bytes (\u00xx)
 *   a lone surrogate             six bytes (\udxxx; well-formed JSON.stringify)
 *   everything else              its plain UTF-8 length
 *
 * test/component-conformance.test.ts pins it against the allocating spelling
 * over the shapes that separate the arms, because an undercount here would
 * admit a payload past its byte bound.
 */
function jsonStringBytes(value: string): number {
  let bytes = 2 // the enclosing quotes
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index)
    if (unit < 0x80) {
      bytes += unit === 0x22 || unit === 0x5c
        ? 2
        : unit >= 0x20
          ? 1
          : unit === 0x08 || unit === 0x09 || unit === 0x0a
            || unit === 0x0c || unit === 0x0d
            ? 2
            : 6
    } else if (unit < 0x800) {
      bytes += 2
    } else if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : 0
      if (next >= 0xdc00 && next <= 0xdfff) {
        // One astral code point: four UTF-8 bytes for the whole pair.
        bytes += 4
        index++
      } else {
        bytes += 6
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      bytes += 6
    } else {
      bytes += 3
    }
  }
  return bytes
}

// JSON numbers, booleans, and null are ASCII, so their serialized length is
// their byte length. Number reaches this arm already known finite.
function primitiveBytes(
  value: null | string | boolean | number,
  budget: TraversalBudget,
): number {
  if (typeof value === 'string') {
    // Every code unit costs at least one byte (a surrogate pair spends four on
    // two units), so length plus the quotes is a lower bound. Rejecting on it
    // first keeps an oversized string from being walked at all.
    if (
      budget.maxBytes !== undefined
      && value.length + 2 > budget.maxBytes
    ) {
      tooLarge()
    }
    return addBytes(budget, jsonStringBytes(value))
  }
  if (value === null) return addBytes(budget, 4)
  if (typeof value === 'boolean') return addBytes(budget, value ? 4 : 5)
  return addBytes(budget, String(value).length)
}

/**
 * A property descriptor for a plain, enumerable, own DATA property: a real
 * value slot and no accessor. This is the single definition of a safe own data
 * property, so every own-data reader here and the plainDetachedData guard route
 * through it and none can end up weaker than another.
 */
export function isPlainDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
): descriptor is PropertyDescriptor & { value: unknown } {
  return descriptor !== undefined
    && descriptor.enumerable === true
    && Object.hasOwn(descriptor, 'value')
    && descriptor.get === undefined
    && descriptor.set === undefined
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
        if (!isPlainDataDescriptor(descriptor)) {
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
      if (!isPlainDataDescriptor(descriptor)) {
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
      // Assign, then check the assignment landed, and fall back to the explicit
      // definition when it did not. Plain assignment is several times cheaper
      // and this is the canonicalizer's per-property inner loop, but assignment
      // consults the prototype chain, and this boundary's promise is that
      // building a payload runs no code of anyone else's choosing. Two shapes
      // can defeat it. An inherited setter swallows the write, which the
      // own-property-and-exact-value check catches afterwards. A '__proto__'
      // key retargets the prototype instead of creating a property, which no
      // check can catch afterwards because the damage is done by then, so that
      // key is tested BEFORE the write and never assigned at all.
      //
      // The fallback keeps the fast path unobservable rather than trusted, and
      // leaves a payload admissible in a process whose Object.prototype
      // somebody else has already polluted: that is not this payload's fault.
      // The trailing Object.freeze supplies the non-writable,
      // non-configurable half of the descriptor this replaces.
      let landed = false
      if (key !== '__proto__') {
        clone[key] = child.value
        landed = Object.hasOwn(clone, key) && clone[key] === child.value
      }
      if (!landed) {
        Object.defineProperty(clone, key, {
          value: child.value,
          enumerable: true,
          writable: false,
          configurable: false,
        })
      }
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
      if (!isPlainDataDescriptor(descriptor)) {
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

/**
 * Read the dense own data values of an array without invoking accessors.
 *
 * Pins Array.prototype the way exactOwnDataRecord pins the object prototype, so
 * a re-prototyped or subclassed array that reads as an array to Array.isArray
 * but iterates as something else is refused at this untrusted boundary.
 */
export function denseOwnDataArrayValues(
  value: unknown,
  maxLength = 65_536,
): readonly unknown[] | undefined {
  try {
    if (
      !Array.isArray(value)
      || isProxy(value)
      || Object.getPrototypeOf(value) !== Array.prototype
    ) return undefined
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
      if (!isPlainDataDescriptor(descriptor)) {
        return undefined
      }
      result.push(descriptor.value)
    }
    return result
  } catch {
    return undefined
  }
}
