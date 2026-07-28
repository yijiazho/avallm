/** Deep-freeze an order-preserving clone of already-trusted acyclic data.
 * This is not hostile-input admission; callers must use the owning boundary.
 */
export function detachTrustedPolicyData<T>(value: T): Immutable<T> {
  const clone = structuredClone(value)
  const visit = (current: unknown): void => {
    if (current === null || typeof current !== 'object') return
    if (Array.isArray(current)) for (const entry of current) visit(entry)
    else {
      for (const key of Reflect.ownKeys(current)) {
        visit((current as Record<PropertyKey, unknown>)[key])
      }
    }
    Object.freeze(current)
  }
  visit(clone)
  return clone as Immutable<T>
}

export type Immutable<T> = T extends (...args: any[]) => unknown ? T
  : T extends readonly (infer Entry)[] ? readonly Immutable<Entry>[]
  : T extends object ? { readonly [Key in keyof T]: Immutable<T[Key]> }
  : T
