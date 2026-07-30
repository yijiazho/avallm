// Type-level machinery for binding a runtime key list to the compile-time shape
// it guards. Nothing here is specific to trace admission, which is where these
// grew: any validator that enumerates the fields of an interface has the same
// drift problem, and the helpers are pure types with no imports, so any layer
// above the engine can reach them.
//
// Three checks cover the three ways a hand-written list rots. `ExactKeyList`
// rejects a name that is not a key (a typo, or a field renamed out from under
// it) and is applied with `satisfies` on the list itself. The other two are
// computations fed to `AssertNever`: `MissingKeys` yields a key the list forgot,
// `DuplicateKeys` yields a repeated entry, and either is a compile error.

/**
 * A runtime key list bound to the compile-time shape it guards. Every entry has
 * to name a real key of `T`, so renaming or removing a field on `T` turns its
 * stale string here into a type error instead of a silently dropped check.
 */
export type ExactKeyList<T> = readonly (keyof T & string)[]

/**
 * Fails to compile unless `T` is `never`, and names the offending type when it
 * is not. The alias body is deliberately an identity: all of the work is in the
 * constraint, which is what lets a type-level computation become an assertion.
 *
 * One assertion rather than a differently named one per computation, because
 * the check never varies: it is always "this must have come out empty". What is
 * being asserted is already named by the argument, as in
 * `AssertNever<MissingKeys<Row, typeof ROW_KEYS>>`.
 */
export type AssertNever<T extends never> = T

/**
 * Keys of `T` that `List` fails to name, or `never` when the list is complete.
 * Pair it with `AssertNever` to bind the two directions at once: `ExactKeyList`
 * rejects keys that do not exist, this rejects keys that were never listed.
 */
export type MissingKeys<T, List extends readonly PropertyKey[]> =
  Exclude<keyof T & string, List[number]>

/**
 * Keys of `T` the shape declares as mandatory, computed from `T` itself. Builds
 * `MissingRequiredKeys`, and is also exported for callers that need the inverse
 * (`Exclude<keyof T, RequiredKeys<T>>` to enumerate a shape's optional keys).
 */
export type RequiredKeys<T> = {
  [K in keyof T]-?: object extends Pick<T, K> ? never : K
}[keyof T] & string

/**
 * Like `MissingKeys`, restricted to the mandatory keys of `T`. Validators that
 * check presence for required fields and value shape for optional ones separately
 * bind their presence list with this.
 *
 * Not collapsible into `MissingKeys`: its one caller guards a shape with genuine
 * optional keys that the list deliberately omits, so the plain version reports
 * those as forgotten and fails to compile. Verified, not assumed.
 */
export type MissingRequiredKeys<T, List extends readonly PropertyKey[]> =
  Exclude<RequiredKeys<T>, List[number]>

/**
 * The first key `List` repeats, or `never` when every entry is distinct. Walks
 * the tuple accumulating what it has already seen, so it only resolves for a
 * literal tuple (an `as const` list); a widened `string[]` yields `never`.
 *
 * Worth asserting even though duplicates are harmless for plain membership
 * checks, because of the case that motivated it: the Morgana call site in
 * `admission/composed-trace.ts` compares the assembled list's length against the
 * trace's own key count, so one repeated entry inflates the length and refuses
 * every otherwise valid trace. Any caller that measures a list rather than only
 * querying it has that hazard.
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
