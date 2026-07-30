// Contract tests for the shared payload shape guards.
//
// These guards exist because each analysis module used to carry its own copy
// and the copies drifted: some rejected a Proxy and some did not, some pinned
// the prototype and some did not. The consolidation is only worth anything if
// the strict definitions stay strict, so every rejection below is pinned
// deliberately rather than incidentally.
//
// The proxy cases are the point. A Proxy can answer Object.keys one way for a
// validator and hand a different value to the consumer immediately afterwards,
// so a guard that admits one has admitted an unvalidated payload.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative } from 'node:path'
import {
  canonicalCombinations,
  canonicalSeats,
  denseArray,
  exactKeys,
  onlyAllowedKeys,
  plainDataRecord,
  plainDetachedData,
  plainRecord,
  probability,
} from '../server/agents/components/canonical-shape.ts'

test('plainRecord admits only a plain-prototype own-data object', () => {
  assert.equal(plainRecord({ a: 1 }), true)
  assert.equal(plainRecord({}), true)

  assert.equal(plainRecord(new Proxy({ a: 1 }, {})), false)
  assert.equal(plainRecord(Object.create(null)), false)
  assert.equal(plainRecord(Object.create({ inherited: true })), false)
  assert.equal(plainRecord([]), false)
  assert.equal(plainRecord(null), false)
  assert.equal(plainRecord(undefined), false)
  assert.equal(plainRecord('a'), false)
  assert.equal(plainRecord(0), false)
})

test('plainDataRecord additionally admits a null prototype', () => {
  const nullProto = Object.create(null) as Record<string, unknown>
  nullProto.a = 1
  assert.equal(plainDataRecord(nullProto), true)
  assert.equal(plainDataRecord({ a: 1 }), true)

  // The canonical JSON boundary builds records with Object.create(null), so a
  // validator downstream of it must accept them. Nothing else relaxes.
  assert.equal(plainDataRecord(new Proxy({ a: 1 }, {})), false)
  assert.equal(plainDataRecord(Object.create({ inherited: true })), false)
  assert.equal(plainDataRecord([]), false)
  assert.equal(plainDataRecord(null), false)
})

test('a proxy cannot answer one shape and serve another', () => {
  // The exact time-of-check/time-of-use shape the proxy guard closes: this
  // target reports two keys to Object.keys and a different value on read.
  let reads = 0
  const target = { a: 1, b: 2 }
  const lying = new Proxy(target, {
    get: (object, key) =>
      key === 'a' ? (reads++, reads) : Reflect.get(object, key),
  })
  assert.equal(plainRecord(lying), false)
  assert.equal(plainDataRecord(lying), false)
  assert.equal(plainDetachedData(lying), false)
  assert.equal(reads, 0, 'a rejected payload must not be read at all')
})

test('denseArray requires a dense own-index array and no proxy', () => {
  assert.equal(denseArray([]), true)
  assert.equal(denseArray([1, 2, 3]), true)

  assert.equal(denseArray(new Proxy([1, 2], {})), false)
  assert.equal(denseArray([, 1]), false)
  assert.equal(denseArray(Object.assign([1, 2], { extra: true })), false)
  assert.equal(denseArray({ 0: 1, length: 1 }), false)
  assert.equal(denseArray('ab'), false)
  assert.equal(denseArray(null), false)
})

test('canonicalSeats requires ascending, bounded, in-range seats', () => {
  assert.equal(canonicalSeats([0, 1, 2], 5), true)
  assert.equal(canonicalSeats([4], 5), true)

  assert.equal(canonicalSeats([], 5), false, 'empty needs allowEmpty')
  assert.equal(canonicalSeats([], 5, true), true)
  assert.equal(canonicalSeats([1, 0], 5), false, 'descending is not canonical')
  assert.equal(canonicalSeats([1, 1], 5), false, 'a repeat is not ascending')
  assert.equal(canonicalSeats([0, 5], 5), false, 'seat >= playerCount')
  assert.equal(canonicalSeats([-1], 5), false)
  assert.equal(canonicalSeats([0.5], 5), false)
  assert.equal(canonicalSeats([0, 1, 2], 2), false, 'longer than the table')
  assert.equal(canonicalSeats(new Proxy([0, 1], {}), 5), false)
  assert.equal(canonicalSeats(['0'], 5), false)
})

test('exactKeys is set equality, not containment', () => {
  assert.equal(exactKeys({ a: 1, b: 2 }, ['a', 'b']), true)
  assert.equal(exactKeys({ b: 2, a: 1 }, ['a', 'b']), true, 'order-free')
  assert.equal(exactKeys({}, []), true)

  assert.equal(exactKeys({ a: 1 }, ['a', 'b']), false, 'missing key')
  assert.equal(exactKeys({ a: 1, b: 2, c: 3 }, ['a', 'b']), false, 'extra key')
  assert.equal(exactKeys({ a: 1, c: 3 }, ['a', 'b']), false, 'substituted key')
})

test('onlyAllowedKeys permits absent keys but never unknown ones', () => {
  assert.equal(onlyAllowedKeys({ a: 1, b: 2 }, ['a', 'b']), true)
  assert.equal(onlyAllowedKeys({ a: 1 }, ['a', 'b']), true, 'b is optional')
  assert.equal(onlyAllowedKeys({}, ['a', 'b']), true, 'all optional')

  assert.equal(onlyAllowedKeys({ c: 3 }, ['a', 'b']), false, 'unknown key')
  assert.equal(onlyAllowedKeys({ a: 1, c: 3 }, ['a', 'b']), false)
})

test('exactKeys and onlyAllowedKeys are not interchangeable', () => {
  // The distinction five modules lost by spelling both of these `exactKeys`.
  // A record with an optional field absent is legal to one and not the other,
  // so collapsing them silently rejects valid payloads (or admits partial
  // ones), depending on which direction the collapse goes.
  const partial = { version: 1 }
  const fields = ['version', 'optionalExtra']
  assert.equal(exactKeys(partial, fields), false)
  assert.equal(onlyAllowedKeys(partial, fields), true)

  const unknown = { version: 1, surprise: true }
  assert.equal(exactKeys(unknown, ['version']), false)
  assert.equal(onlyAllowedKeys(unknown, ['version']), false)
})

test('probability is a finite number within the closed unit interval', () => {
  assert.equal(probability(0), true)
  assert.equal(probability(1), true)
  assert.equal(probability(0.5), true)

  assert.equal(probability(-0.000001), false)
  assert.equal(probability(1.000001), false)
  assert.equal(probability(Number.NaN), false)
  assert.equal(probability(Number.POSITIVE_INFINITY), false)
  assert.equal(probability('0.5'), false)
  assert.equal(probability(null), false)
})

test('plainDetachedData rejects accessors, exotica, and cycles', () => {
  assert.equal(plainDetachedData({ a: [1, { b: 'c' }], d: null }), true)
  assert.equal(plainDetachedData([]), true)

  const accessor = {}
  Object.defineProperty(accessor, 'a', { enumerable: true, get: () => 1 })
  assert.equal(plainDetachedData(accessor), false)

  const nonEnumerable = {}
  Object.defineProperty(nonEnumerable, 'a', { value: 1, enumerable: false })
  assert.equal(plainDetachedData(nonEnumerable), false)

  const symbolKeyed: Record<PropertyKey, unknown> = {}
  Object.defineProperty(symbolKeyed, Symbol('hidden'), {
    value: true,
    enumerable: true,
  })
  assert.equal(plainDetachedData(symbolKeyed), false)

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.equal(plainDetachedData(cyclic), false)

  assert.equal(plainDetachedData({ a: Number.NaN }), false)
  assert.equal(plainDetachedData(Object.assign([1], { extra: true })), false)
  assert.equal(plainDetachedData(Object.create({ inherited: true })), false)
  assert.equal(plainDetachedData(() => 1), false)
})

test('canonicalCombinations enumerates ascending seat sets in order', () => {
  assert.deepEqual(canonicalCombinations(4, 2), [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ])
  assert.deepEqual(canonicalCombinations(3, 0), [[]])
  assert.deepEqual(canonicalCombinations(3, 4), [])
  // Every emitted combination is itself a canonical seat list, which is what
  // the callers then validate against.
  for (const combination of canonicalCombinations(6, 3)) {
    assert.equal(canonicalSeats(combination, 6), true)
  }
})

// The consolidation is a chokepoint only while the consumers keep using it.
// A module that imports a guard and then re-declares that same name locally has
// re-created the private copy this file exists to prevent, so name the failure
// here rather than waiting for the two definitions to drift apart again.
//
// Both halves are derived, never listed. The consumer set is discovered by
// scanning for the import, so a new consumer is covered the moment it is
// written, and each file is checked against exactly the names it imports, so a
// same-named predicate that means something else is not a false positive.
// identity.ts is the live example of the latter: it declares its own
// `probability` meaning `> 0`, and it does not import ours.
const GUARD_SOURCE = 'server/agents/components/canonical-shape.ts'

function serverSources(directory: string): string[] {
  const entries = readdirSync(new URL(`../${directory}/`, import.meta.url), {
    withFileTypes: true,
  })
  return entries.flatMap((entry) =>
    entry.isDirectory()
      ? serverSources(`${directory}/${entry.name}`)
      : entry.name.endsWith('.ts') ? [`${directory}/${entry.name}`] : [])
}

/** The names `file` imports from the guard module, unwrapping `x as y`. */
function importedGuards(file: string, source: string): readonly string[] {
  const specifier = relative(dirname(file), GUARD_SOURCE).replaceAll('\\', '/')
  const from = specifier.startsWith('.') ? specifier : `./${specifier}`
  const block = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*'${from.replace(/\./g, '\\.')}'`,
  ).exec(source)
  if (!block) return []
  return block[1]
    .split(',')
    .map((entry) => entry.trim().split(/\s+as\s+/)[0]!.trim())
    .filter(Boolean)
}

test('no consumer re-declares a guard it imports from canonical-shape', () => {
  const consumers: string[] = []
  const offenders: string[] = []
  for (const file of serverSources('server')) {
    if (file === GUARD_SOURCE) continue
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    if (!source.includes('canonical-shape.ts')) continue
    const guards = importedGuards(file, source)
    assert.notEqual(
      guards.length,
      0,
      `${file} references canonical-shape but no import was parsed`,
    )
    consumers.push(file)
    for (const guard of guards) {
      const declaration = new RegExp(
        `^(?:export )?(?:const|function) ${guard}\\b`,
        'm',
      )
      if (declaration.test(source)) offenders.push(`${file}: ${guard}`)
    }
  }
  assert.deepEqual(offenders, [])
  // Guard the guard: if the scan silently matched nothing, the loop above
  // would pass while checking exactly zero files.
  assert.ok(consumers.length >= 10, `only found ${consumers.length} consumers`)
})

// Shadowing, the quieter sibling of re-declaration, is pinned by the ARCH013
// architecture rule instead of here. It needs the TypeScript parser: a
// shadowing parameter in a wrapped function signature reads exactly like an
// interface field to a regular expression, and the rule also has to follow
// `x as y` to the local name. See tools/architecture-fitness.mjs.
