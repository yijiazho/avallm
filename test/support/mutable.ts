/**
 * Write access to engine state that is immutable by type but not at runtime.
 *
 * `DeepReadonly` marks Game, PlayerView and GameEvent readonly because the
 * engine owns them and callers must not write through them. Tests are the one
 * caller that legitimately does: they build a board position by hand that a
 * real deal would reach only by luck, then hand it to the code under test.
 * Those writes were always safe at runtime (readonly is erased, and the log
 * array is the same one `emit` appends to) but stopped type-checking when the
 * contract was written down.
 *
 * `mutable` is a cast, not a copy, so the object under test is the one that
 * changes. Prefer `mutableClone` when the point is a detached forgery rather
 * than a scenario, and prefer building the state through the engine over
 * either when that is practical.
 */
export type Mutable<T> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends ReadonlyArray<infer Item>
      ? Mutable<Item>[]
      : T extends object
        ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
        : T

/** In-place write access to a fixture the test owns. */
export function mutable<T>(value: T): Mutable<T> {
  return value as Mutable<T>
}

/** Detached mutable data for tests that intentionally forge hostile payloads. */
export function mutableClone<T>(value: T): Mutable<T> {
  return structuredClone(value) as Mutable<T>
}
