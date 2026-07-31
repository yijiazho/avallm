/**
 * Shape guards shared by every payload validator that admits untrusted data,
 * in any layer: analysis, belief, policy, cognition, communication, eval.
 *
 * Each such module needs the same handful of predicates: is this a plain
 * record, is this a dense array, is this exactly these keys, is this a
 * probability. Each module used to carry its own copy, and the copies drifted:
 * some rejected a Proxy and some did not, some pinned the prototype and some
 * did not. A guard that is weaker at one call site than another is a hole at
 * that site only, which is precisely the defect duplication hides.
 *
 * The scope line above is not decoration. This header once said these guards
 * were for the analysis domain, and the consolidation it describes did stop at
 * that boundary: private copies of plainDetachedData survived in policy and in
 * cognition, and both were weaker than this one. The weakest of the two sat on
 * validateCandidateScores, the untrusted scorer entry point, which is the worst
 * place in the tree to hold the laxest copy. So the domain is every layer, and
 * a validator outside analysis is not thereby outside this module.
 *
 * These are the strict definitions. A caller that needs a laxer check should
 * say so explicitly rather than keep a private copy.
 */

import { isDeepStrictEqual } from 'node:util'
import { isProxy } from 'node:util/types'
import { isPlainDataDescriptor } from './canonical-json.ts'
import {
  failsRequired,
  MAX_PLAYERS,
  MAX_PROPOSALS,
  MIN_PLAYERS,
  QUESTS_PER_GAME,
  TEAM_SIZES,
  validateRoles,
} from '../../engine/rules.ts'
import { isRole } from '../../engine/types.ts'
import type { Role, Seat } from '../../engine/types.ts'
import { compareCanonicalRoles } from '../belief/types.ts'

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
 * A dense array that also pins Array.prototype and the canonical key order.
 *
 * denseArray runs on host-produced snapshots, where the prototype is not in
 * question. This one runs on payloads that crossed an untrusted boundary, where
 * an Array subclass instance or a re-prototyped array is exactly the kind of
 * exotic that reads as an array to Array.isArray and iterates as something
 * else. The two live under separate names on purpose, as exactKeys and
 * onlyAllowedKeys do: the strictness difference is the entire content of the
 * distinction, so a call site has to say which one it wanted.
 */
export const strictCanonicalArray = (value: unknown): value is unknown[] => {
  if (
    !Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) return false
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1) return false
  for (let index = 0; index < value.length; index++) {
    if (keys[index] !== String(index)) return false
  }
  return keys[value.length] === 'length'
}

/**
 * Recursively assert detached JSON-shaped data: no accessors, no proxies, no
 * exotic prototypes, no cycles, no shared subobjects, no symbol keys, no
 * non-finite numbers.
 *
 * `visited` means seen anywhere in this walk, not seen on the current recursion
 * stack, so a shared but acyclic subobject is refused alongside a true cycle.
 * That is deliberate, and it is the one place where this guard refuses
 * something a cycle detector would admit:
 *
 *   - Detached means a tree that survives a JSON round trip unchanged. A DAG
 *     does not. Every caller here stringifies or structuredClones the payload
 *     right after validating it, so admitting a DAG means validating one object
 *     and using a materially different one.
 *   - Sharing is exponential in both directions. `{left: x, right: x}` nested
 *     to depth 23 is 24 objects, but it has 2^23 root-to-leaf paths: a
 *     stack-scoped `seen` walks all of them (~13s), and JSON.stringify expands
 *     it to 251MB. A byte cap computed after stringify cannot save a caller
 *     from that, because producing the string is the blowup. Treating a repeat
 *     as a rejection keeps the walk linear in node count.
 *
 * So `visited` is never deleted on the success path. A caller that genuinely
 * wants DAG-shaped input needs a different guard and a different name, not a
 * one-line relaxation of this one.
 */
export function plainDetachedData(
  value: unknown,
  visited = new Set<object>(),
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
    || visited.has(value)
  ) return false
  visited.add(value)
  const array = Array.isArray(value)
  if (
    array
      ? !strictCanonicalArray(value)
      : Object.getPrototypeOf(value) !== Object.prototype
  ) return false
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Reflect.ownKeys(value)) {
    if (array && key === 'length') continue
    if (typeof key !== 'string') return false
    const descriptor = descriptors[key]
    if (
      !isPlainDataDescriptor(descriptor)
      || !plainDetachedData(descriptor.value, visited)
    ) return false
  }
  return true
}

/**
 * Ordered equality of two numeric vectors: same length, same value at every
 * index. This is a sequence comparison, not a set comparison, so it is
 * deliberately distinct from the engine's order-insensitive team equality
 * (canonicalTeam / teamsEqual in engine/rules.ts). The values here are
 * score-layer feature vectors and probability distributions, where position is
 * significant, so a permutation is a genuine difference rather than a normalized
 * duplicate.
 */
export const sequenceEqual = (
  left: readonly number[],
  right: readonly number[],
): boolean =>
  left.length === right.length
  && left.every((value, index) => value === right[index])

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

/**
 * A dense, canonically ordered, rules-legal role multiset for this table size.
 *
 * The direct analogue of canonicalSeats, and it had the same history of private
 * copies: four analysis validators carried this predicate under two different
 * names, and two of the four checked membership against an inlined copy of the
 * eight role names instead of the constant. Adding a role to the Role union and
 * to CANONICAL_ROLE_ORDER would have left those two rejecting the new role
 * while the other two accepted it, and that split typechecks and passes the
 * suite. Membership and order both come from CANONICAL_ROLE_ORDER here, so a
 * new role reaches every call site at once.
 *
 * Legality is the engine's answer, not ours: validateRoles owns the evil count,
 * the merlin/assassin pairing, the role prerequisites, and role uniqueness.
 */
export const canonicalRoles = (
  value: unknown,
  playerCount: number,
): value is Role[] => {
  if (
    !denseArray(value)
    || value.length !== playerCount
    || !value.every(isRole)
  ) return false
  const roles = value as Role[]
  // Spelled with the comparator rather than belief/worlds.ts's
  // canonicalRoleMultiset, which is how every other caller sorts roles. This
  // module is a leaf that forty others import, and worlds.ts is the world
  // enumerator; depending on it here would invite a cycle the first time
  // worlds.ts wants a shape guard of its own.
  if (
    !isDeepStrictEqual(roles, [...roles].sort(compareCanonicalRoles))
  ) return false
  try {
    validateRoles(playerCount, [...roles])
    return true
  } catch {
    return false
  }
}

/** Exactly these keys: same set, same count. Nothing optional. */
export const exactKeys = (
  value: object,
  keys: readonly string[],
): boolean =>
  Object.keys(value).length === keys.length
  && Object.keys(value).every((key) => keys.includes(key))

/**
 * No key outside `allowed`, with no requirement that all of `allowed` appear.
 *
 * This is the guard for records that have optional fields, and it is
 * deliberately not exactKeys. PrivateIdentitySnapshot omits hiddenTeamPosterior
 * whenever the scope excludes it, so a count-equality check there would reject
 * a legal snapshot. Which fields are required is the caller's job, checked one
 * by one right after this.
 *
 * The two live under separate names on purpose. Five modules once spelled this
 * predicate `exactKeys` while four others spelled the count-checking one the
 * same way, and no call site revealed which contract it was getting.
 */
export const onlyAllowedKeys = (
  value: object,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key))

export const probability = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1

/**
 * A signed bounded value: finite and inside [-1, 1].
 *
 * The sibling of `probability`, for the quantities that carry a DIRECTION as
 * well as a magnitude. An influence that can help or hurt, and a deviation
 * that can sit above or below a baseline, are both meaningless without the
 * sign, so they cannot reuse the [0, 1] predicate next door.
 *
 * It lived privately in role-utility.ts, which was correct while one module
 * needed it. It is promoted here on the second caller rather than the fifth,
 * because the failure mode is silent: a private copy that drifts to `> -1`
 * still type-checks, still passes its own tests, and only disagrees with the
 * original on the exact boundary value that motivated writing it down.
 */
export const signedUnit = (value: unknown): value is number =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= -1
  && value <= 1

/**
 * A legal table size: a safe integer inside the range the engine deals.
 *
 * Twelve validators spelled this by hand as `< 5 || > 10` against the bare
 * literals, in a module that has imported MIN_PLAYERS and MAX_PLAYERS for
 * canonicalRequestBlock the whole time. The range belongs to the engine, and
 * restating it here made this file a second membership authority of exactly
 * the kind canonicalRoles' note describes: an eleventh seat added to the
 * engine would reach canonicalRequestBlock and none of the twelve.
 *
 * It matters more than a tidiness fix, because a table size is the denominator
 * of every seat bound in this tree. A validator that admits an out-of-range
 * one has already made its own seat checks vacuous, since
 * canonicalSeats(value, 9999) happily accepts seat 9998. Bounding the size is
 * what makes bounding the seats mean anything.
 */
export const tableSize = (value: unknown): value is number =>
  Number.isSafeInteger(value)
  && (value as number) >= MIN_PLAYERS
  && (value as number) <= MAX_PLAYERS

/**
 * What a payload's decision-request block is allowed to say.
 *
 * `kinds` and the optional fields are per-payload, so each call site states
 * its own contract instead of keeping a private copy of the chain: a
 * projection that only exists for propose and vote says so here, and one that
 * carries the quest tally says that here too.
 */
export interface RequestBlockContract {
  /** Table size the block must agree with, from the payload's own source. */
  readonly playerCount: number
  /** The decision kinds this payload admits. Nothing else. */
  readonly kinds: readonly string[]
  /** Keys this block carries beyond the common five, always required. */
  readonly extraKeys?: readonly string[]
  /**
   * Admit `currentTeam` on a vote block: required for a vote, forbidden
   * otherwise, and checked against the round's team size.
   */
  readonly voteCurrentTeam?: boolean
}

/**
 * The `{seat, kind, round, proposalNum, failsRequired}` block every role
 * projection and objective carries, checked against the board it claims.
 *
 * Six modules validated this block by hand, and the copies drifted: only one
 * of them derived `failsRequired` from the rules, so the other five admitted
 * two fails required on round 1 of a five-handed game, a board the engine
 * cannot deal. The derivation is free wherever the block is checked at all,
 * since `playerCount` and `round` are both already in hand, so it lives here
 * and every site gets it.
 */
export function canonicalRequestBlock(
  value: unknown,
  contract: RequestBlockContract,
): boolean {
  if (!plainDataRecord(value)) return false
  const { playerCount, kinds } = contract
  const vote = value.kind === 'vote'
  const currentTeam = contract.voteCurrentTeam === true && vote
  if (
    !exactKeys(value, [
      'seat', 'kind', 'round', 'proposalNum', 'failsRequired',
      ...contract.extraKeys ?? [],
      ...currentTeam ? ['currentTeam'] : [],
    ])
    || !tableSize(playerCount)
    || typeof value.kind !== 'string'
    || !kinds.includes(value.kind)
    || !Number.isSafeInteger(value.seat)
    || (value.seat as number) < 0
    || (value.seat as number) >= playerCount
    || !Number.isSafeInteger(value.round)
    || (value.round as number) < 1
    || (value.round as number) > QUESTS_PER_GAME
    || !Number.isSafeInteger(value.proposalNum)
    || (value.proposalNum as number) < 1
    || (value.proposalNum as number) > MAX_PROPOSALS
    || value.failsRequired
      !== failsRequired(playerCount, value.round as number)
  ) return false
  // A block that is not a vote cannot carry the field at all: the key list
  // above omits it, so its absence is already settled here.
  if (!currentTeam) return true
  const teamSize = TEAM_SIZES[playerCount]?.[(value.round as number) - 1]
  return Number.isSafeInteger(teamSize)
    && canonicalSeats(value.currentTeam, playerCount)
    && (value.currentTeam as Seat[]).length === teamSize
}

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
