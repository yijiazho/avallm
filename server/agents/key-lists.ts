// Type-level machinery for binding a runtime key list to the compile-time shape
// it guards. Nothing here is specific to trace admission, which is where these
// grew: any validator that enumerates the fields of an interface has the same
// drift problem, and the helpers are pure types with no imports, so any layer
// above the engine can reach them.
//
// The three assertions compose to cover the three ways a hand-written list rots:
// ExactKeyList rejects a name that is not a key (typo, or a field renamed out
// from under it), NoMissingKeys rejects a key the list forgot (a field added
// without extending its validator), and NoDuplicateKeys rejects a repeat.

/**
 * A runtime key list bound to the compile-time shape it guards. Every entry has
 * to name a real key of `T`, so renaming or removing a field on `T` turns its
 * stale string here into a type error instead of a silently dropped check.
 */
export type ExactKeyList<T> = readonly (keyof T & string)[]

/**
 * Keys of `T` that `List` fails to name, or `never` when the list is complete.
 * Pair it with `NoMissingKeys` to bind the two directions at once: `ExactKeyList`
 * rejects keys that do not exist, this rejects keys that were never listed.
 */
export type MissingKeys<T, List extends readonly PropertyKey[]> =
  Exclude<keyof T & string, List[number]>

/** Keys of `T` the shape declares as mandatory, computed from `T` itself. */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T] & string

/**
 * Like `MissingKeys`, restricted to the mandatory keys of `T`. Validators that
 * check presence for required fields and value shape for optional ones separately
 * bind their presence list with this.
 */
export type MissingRequiredKeys<T, List extends readonly PropertyKey[]> =
  Exclude<RequiredKeys<T>, List[number]>

/**
 * Type-level assertion that a key list is exhaustive. Instantiating it with a
 * leftover key fails the `never` constraint, and the compiler names the missing
 * field in the error, so adding a field to a validated shape cannot pass review
 * without also extending the validator that guards it.
 */
export type NoMissingKeys<Leftover extends never> = Leftover

/**
 * The first key `List` repeats, or `never` when every entry is distinct. Walks
 * the tuple accumulating what it has already seen, so it only resolves for a
 * literal tuple (an `as const` list); a widened `string[]` yields `never`.
 */
export type DuplicateKeys<
  List extends readonly PropertyKey[],
  Seen = never,
> = List extends readonly [
  infer Head,
  ...infer Rest extends readonly PropertyKey[],
]
  ? Head extends Seen
    ? Head
    : DuplicateKeys<Rest, Seen | Head>
  : never

/**
 * Type-level assertion that a key list repeats nothing. Duplicates are harmless
 * for plain membership checks, which is why this looks redundant until you meet
 * the case that motivated it: the Morgana call site in `admission/composed-trace.ts`
 * compares the assembled list's length against the trace's own key count, so one
 * repeated entry inflates the length and refuses every otherwise valid trace.
 * Any caller that measures a list rather than only querying it has that hazard.
 */
export type NoDuplicateKeys<Repeated extends never> = Repeated
