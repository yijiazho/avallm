/**
 * Deep-readonly mapped type: recursively marks every property and array element
 * `readonly`. Compile-time only (erased at runtime) and structural — it encodes
 * an immutability contract in the type, while the callers that need the runtime
 * guarantee enforce it separately with Object.freeze. Functions and primitives
 * pass through untouched; arrays (mutable or already-readonly) become
 * ReadonlyArray.
 *
 * Scoped to JSON-shaped data (the wire/view/payload types it is used on). It
 * does NOT special-case built-in collections: applied to a type containing a
 * Map, Set, Date, or Promise it would map over the instance's own keys instead
 * of preserving it, so keep those out of the shapes it wraps.
 *
 * The function arm is `never[]` rather than `any[]` so a call signature is
 * carried through untouched without the alias itself admitting `any`.
 *
 * The policy layer imports this under the name `Immutable`, where it pairs with
 * `detachTrustedPolicyData` (`server/agents/policy/trusted-data.ts`) and reads
 * as the type of a value that has actually been frozen. Here it is the plain
 * type operator, which is what the engine's `PlayerView` projection needs.
 */
export type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends readonly (infer E)[] ? readonly DeepReadonly<E>[]
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T
