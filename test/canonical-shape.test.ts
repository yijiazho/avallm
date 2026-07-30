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
  canonicalRequestBlock,
  canonicalSeats,
  denseArray,
  exactKeys,
  onlyAllowedKeys,
  plainDataRecord,
  plainDetachedData,
  plainRecord,
  probability,
  strictCanonicalArray,
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

// The three cases below are the ones two private forks of plainDetachedData
// got wrong before they were deleted (score.ts and plan-memory.ts each carried
// their own). Each fork was individually plausible, which is the argument for
// pinning the answers here rather than at the call sites.

test('plainDetachedData rejects a proxy at any depth', () => {
  // score.ts's fork omitted the isProxy check entirely, and it guards
  // validateCandidateScores, the untrusted scorer/plugin entry point. A payload
  // that answers a validator one way and its consumer another is the exact
  // thing that boundary exists to refuse, so the weakest copy sat at the one
  // call site where the input is hostile.
  assert.equal(plainDetachedData(new Proxy({ a: 1 }, {})), false)
  assert.equal(plainDetachedData(new Proxy([1, 2], {})), false)
  assert.equal(plainDetachedData({ nested: new Proxy({ a: 1 }, {}) }), false)
  assert.equal(plainDetachedData([{ deep: [new Proxy({}, {})] }]), false)

  // A proxy that reports a clean shape and serves a different value on read.
  let reads = 0
  const shifty = new Proxy({ a: 1 }, {
    getOwnPropertyDescriptor: (target, key) => (
      reads++,
      { value: reads, writable: true, enumerable: true, configurable: true }
    ),
  })
  assert.equal(plainDetachedData({ scores: [shifty] }), false)
  assert.equal(reads, 0, 'a rejected payload must not be read at all')
})

test('plainDetachedData refuses a shared subobject, not just a cycle', () => {
  // The deliberate call: `visited` means seen anywhere in the walk, so an
  // acyclic DAG is refused alongside a true cycle. score.ts's fork deleted on
  // exit and so admitted sharing; the shared guard and plan-memory's fork did
  // not. Detached means a tree that survives a JSON round trip, and sharing
  // does not: every caller stringifies or structuredClones right after
  // validating, so a DAG means validating one payload and using another.
  const shared = { a: 1 }
  assert.equal(plainDetachedData({ left: shared, right: shared }), false)
  assert.equal(plainDetachedData([shared, shared]), false)
  assert.equal(
    plainDetachedData({ outer: { inner: shared }, sibling: shared }),
    false,
    'sharing across depths counts too',
  )

  // Equal-but-distinct values are not sharing and stay admitted, so the rule
  // is about object identity rather than about repeated content.
  assert.equal(plainDetachedData({ left: { a: 1 }, right: { a: 1 } }), true)
  assert.equal(plainDetachedData([[], []]), true)
  assert.equal(plainDetachedData({ a: 'x', b: 'x', c: 1, d: 1 }), true)

  // Why it is a rejection and not a tolerated redundancy: `{left: x, right: x}`
  // nested 23 deep is 24 objects with 2^23 root-to-leaf paths. A stack-scoped
  // `seen` walks every path and JSON.stringify expands it to ~251MB, so a byte
  // cap measured after stringify cannot save the caller. Refusing the repeat
  // keeps the walk linear in node count: this runs in milliseconds.
  let bomb: Record<string, unknown> = { leaf: 'x' }
  for (let depth = 0; depth < 512; depth++) bomb = { left: bomb, right: bomb }
  assert.equal(plainDetachedData(bomb), false)
})

test('strictCanonicalArray pins the prototype where denseArray does not', () => {
  assert.equal(strictCanonicalArray([]), true)
  assert.equal(strictCanonicalArray([1, 2, 3]), true)

  assert.equal(strictCanonicalArray([, 1]), false)
  assert.equal(strictCanonicalArray(Object.assign([1], { extra: true })), false)
  assert.equal(strictCanonicalArray(new Proxy([1, 2], {})), false)
  assert.equal(strictCanonicalArray({ 0: 1, length: 1 }), false)
  assert.equal(strictCanonicalArray(null), false)

  // The sole difference from denseArray, and the reason plan-memory used to
  // fork plainDetachedData rather than import it: an exotic prototype on an
  // array still answers Array.isArray. plainDetachedData now takes the strict
  // one, so the fork has nothing left to be stricter about.
  class Subclassed extends Array {}
  const subclassed = Subclassed.from([1, 2]) as unknown
  assert.equal(denseArray(subclassed), true, 'denseArray does not pin this')
  assert.equal(strictCanonicalArray(subclassed), false)
  assert.equal(plainDetachedData(subclassed), false)
  assert.equal(plainDetachedData({ rows: subclassed }), false)

  const reprototyped = Object.setPrototypeOf([1, 2], null) as unknown
  assert.equal(strictCanonicalArray(reprototyped), false)
  assert.equal(plainDetachedData(reprototyped), false)
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

const ALL_KINDS = [
  'discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate',
]

const requestBlock = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  seat: 0,
  kind: 'propose',
  round: 1,
  proposalNum: 1,
  failsRequired: 1,
  ...overrides,
})

test('canonicalRequestBlock derives failsRequired from the board', () => {
  // The drift this guard exists to end: five of the six copies stopped at a
  // 1-or-2 membership test, which admits two fails required on boards where
  // the engine deals one. Only quest 4 at seven or more players takes two.
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    for (let round = 1; round <= 5; round++) {
      const legal = playerCount >= 7 && round === 4 ? 2 : 1
      for (const failsRequired of [1, 2]) {
        assert.equal(
          canonicalRequestBlock(
            requestBlock({ round, failsRequired }),
            { playerCount, kinds: ALL_KINDS },
          ),
          failsRequired === legal,
          `${playerCount}p round ${round} failsRequired ${failsRequired}`,
        )
      }
    }
  }
  // Nothing outside the pair is admitted at any board either.
  for (const failsRequired of [0, 3, 1.5, '1', null, undefined, Number.NaN]) {
    assert.equal(
      canonicalRequestBlock(
        requestBlock({ round: 4, failsRequired }),
        { playerCount: 7, kinds: ALL_KINDS },
      ),
      false,
      `failsRequired ${String(failsRequired)}`,
    )
  }
})

test('canonicalRequestBlock bounds the block against its table', () => {
  const contract = { playerCount: 5, kinds: ALL_KINDS }
  const admits = (overrides: Record<string, unknown>) =>
    canonicalRequestBlock(requestBlock(overrides), contract)
  assert.equal(canonicalRequestBlock(requestBlock(), contract), true)
  assert.equal(admits({ seat: 4 }), true)

  assert.equal(admits({ seat: 5 }), false, 'seat >= playerCount')
  assert.equal(admits({ seat: -1 }), false)
  assert.equal(admits({ round: 0 }), false)
  assert.equal(admits({ round: 6 }), false)
  assert.equal(admits({ proposalNum: 0 }), false)
  assert.equal(admits({ proposalNum: 6 }), false)
  assert.equal(
    canonicalRequestBlock(requestBlock(), { ...contract, playerCount: 4 }),
    false,
    'a table the engine cannot deal',
  )
  assert.equal(
    canonicalRequestBlock(requestBlock(), { ...contract, playerCount: 11 }),
    false,
  )

  // Kinds are per-payload, so a projection that only exists for propose and
  // vote refuses the rest rather than sharing one permissive list.
  assert.equal(
    canonicalRequestBlock(
      requestBlock({ kind: 'discuss' }),
      { playerCount: 5, kinds: ['propose', 'vote'] },
    ),
    false,
  )
  assert.equal(
    canonicalRequestBlock(requestBlock({ kind: 'shout' }), contract),
    false,
  )

  // Shape: exactly the stated keys, on a record that is not exotic.
  assert.equal(
    canonicalRequestBlock(requestBlock({ extra: true }), contract),
    false,
    'extra key',
  )
  assert.equal(
    canonicalRequestBlock({ seat: 0, kind: 'propose', round: 1 }, contract),
    false,
    'missing keys',
  )
  assert.equal(
    canonicalRequestBlock(new Proxy(requestBlock(), {}), contract),
    false,
  )
  assert.equal(canonicalRequestBlock(null, contract), false)
  assert.equal(canonicalRequestBlock([], contract), false)
})

test('canonicalRequestBlock states extra and vote-only fields per call', () => {
  const proposeOrVote = { playerCount: 5, kinds: ['propose', 'vote'] }
  const tally = { completedGoodQuests: 0, completedEvilQuests: 0 }
  const withTally = {
    ...proposeOrVote,
    extraKeys: ['completedGoodQuests', 'completedEvilQuests'],
  }
  assert.equal(canonicalRequestBlock(requestBlock(tally), withTally), true)
  assert.equal(
    canonicalRequestBlock(requestBlock(), withTally),
    false,
    'an extra key is required, not optional',
  )
  assert.equal(
    canonicalRequestBlock(requestBlock(tally), proposeOrVote),
    false,
    'a site that does not declare the tally refuses it',
  )

  const votes = { ...proposeOrVote, voteCurrentTeam: true }
  const admits = (overrides: Record<string, unknown>) =>
    canonicalRequestBlock(requestBlock(overrides), votes)
  const vote = { kind: 'vote', currentTeam: [0, 1] }
  assert.equal(admits(vote), true)
  assert.equal(
    admits({ ...vote, currentTeam: [0] }),
    false,
    'the team must be the round-1 team size',
  )
  assert.equal(
    admits({ ...vote, currentTeam: [1, 0] }),
    false,
    'descending seats are not canonical',
  )
  assert.equal(admits({ kind: 'vote' }), false, 'a vote must carry its team')
  assert.equal(
    admits({ currentTeam: [0, 1] }),
    false,
    'a propose must not carry a team',
  )
  // A site that never admits the field refuses it even on a vote.
  assert.equal(
    canonicalRequestBlock(requestBlock(vote), proposeOrVote),
    false,
  )
})

// The consolidation is a chokepoint only while the consumers keep using it.
// A module that imports a guard and then re-declares that same name locally has
// re-created the private copy this file exists to prevent, so name the failure
// here rather than waiting for the two definitions to drift apart again.
//
// Both halves are derived, never listed. The consumer set is discovered by
// scanning for the import, so a new consumer is covered the moment it is
// written, and each file is checked against exactly the names it imports.
//
// This catches importers only. The next test covers the rest of the tree,
// which is where the surviving private copies actually were.
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

// The test above only inspects modules that already import the guard module,
// and that is the hole the private copies fit through. score.ts and
// plan-memory.ts each kept a whole `plainDetachedData` walk without importing
// anything from canonical-shape, so the consolidation scan never looked at
// them and the two copies drifted for free: neither rejected a Proxy, and they
// disagreed with each other and with the shared guard about shared subobjects.
//
// So scan every server module, importer or not. Declaring a guard's name
// privately is the failure regardless of what the file imports, because the
// next reader has no way to tell which of the two definitions is in force at a
// given call site. A module that wants a genuinely different predicate should
// give it a different name, exactly as exactKeys and onlyAllowedKeys do; a
// module that wants this predicate should import it.
const GUARD_NAMES = [
  'canonicalCombinations',
  'canonicalRequestBlock',
  'canonicalSeats',
  'denseArray',
  'exactKeys',
  'onlyAllowedKeys',
  'plainDataRecord',
  'plainDetachedData',
  'plainRecord',
  'probability',
  'strictCanonicalArray',
] as const

test('no server module keeps a private copy of a shared guard', () => {
  const guardSource = readFileSync(
    new URL(`../${GUARD_SOURCE}`, import.meta.url),
    'utf8',
  )
  // Derived, not asserted by hand: the list above has to stay the full set of
  // exported guards, or a guard added later is scanned for by nobody.
  //
  // Callable exports only. Banning a name across the whole server tree is only
  // defensible for a predicate, where a second definition means a second
  // contract; a future `export const MAX_DETACHED_DEPTH = 512` here must not
  // turn every local constant of that name into a reported "private copy". So
  // the pattern matches a function or an arrow, and a plain value export drops
  // out of both halves at once rather than forcing a name onto the ban list.
  const exported = [...guardSource.matchAll(
    /^export (?:const (\w+) = \(|function (\w+)\()/gm,
  )].map((match) => match[1] ?? match[2]!).sort()
  assert.deepEqual(exported, [...GUARD_NAMES].sort())

  const offenders: string[] = []
  for (const file of serverSources('server')) {
    if (file === GUARD_SOURCE) continue
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    for (const guard of GUARD_NAMES) {
      const declaration = new RegExp(
        `^(?:export )?(?:async )?(?:const|let|var|function) ${guard}\\b`,
        'm',
      )
      if (declaration.test(source)) offenders.push(`${file}: ${guard}`)
    }
  }
  assert.deepEqual(offenders, [])
})

// Shadowing, the quieter sibling of re-declaration, is pinned by the ARCH013
// architecture rule instead of here. It needs the TypeScript parser: a
// shadowing parameter in a wrapped function signature reads exactly like an
// interface field to a regular expression, and the rule also has to follow
// `x as y` to the local name. See tools/architecture-fitness.mjs.
