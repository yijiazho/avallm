// `Immutable` is the shared DeepReadonly operator under a local name: in this
// layer the type always describes a value `detachTrustedPolicyData` has actually
// frozen, so the name states the runtime guarantee rather than the type
// operation. It used to be a second, byte-identical definition of the engine's
// DeepReadonly; both now come from server/shared/.
import type { DeepReadonly } from '../../shared/deep-readonly.ts'
import { freezeDeep } from '../../shared/deep-freeze.ts'

export type { DeepReadonly as Immutable } from '../../shared/deep-readonly.ts'

/** Deep-freeze an order-preserving clone of already-trusted acyclic data.
 * This is not hostile-input admission; callers must use the owning boundary.
 */
export function detachTrustedPolicyData<T>(value: T): DeepReadonly<T> {
  return freezeDeep(structuredClone(value))
}
