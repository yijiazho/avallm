// `Immutable` is the shared DeepReadonly operator under a local name: in this
// layer the type always describes a value `detachTrustedPolicyData` has actually
// frozen, so the name states the runtime guarantee rather than the type
// operation. It used to be a second, byte-identical definition of the engine's
// DeepReadonly; both now come from server/shared/.
import type { DeepReadonly } from '../../shared/deep-readonly.ts'

export type { DeepReadonly as Immutable } from '../../shared/deep-readonly.ts'

/** Deep-freeze an order-preserving clone of already-trusted acyclic data.
 * This is not hostile-input admission; callers must use the owning boundary.
 */
export function detachTrustedPolicyData<T>(value: T): DeepReadonly<T> {
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
  return clone as DeepReadonly<T>
}
