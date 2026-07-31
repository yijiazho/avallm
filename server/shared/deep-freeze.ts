// The one deep-freeze walk. It names no seat, role, or quest, and pairs with
// DeepReadonly next door: that type states the immutability contract, this
// function establishes it at runtime.
//
// Two callers hand a graph over to code they do not control and need it to stay
// put: the policy layer's detachTrustedPolicyData (clone, then freeze) and the
// applied-trace lifecycle (clone the host's own request, view, and decisions,
// then freeze so the agent's acknowledgment hook can read them without a second
// full copy of everything). Freezing is what both actually want; cloning twice
// was how the second one bought it before.
//
// Precondition: the caller owns the graph outright, having just cloned or built
// it. The walk freezes a node BEFORE descending, so a cycle terminates on the
// already-frozen ancestor, and it treats an already-frozen node as already
// deeply frozen. That is exact for anything this walk produced, since every
// node it freezes is deeply frozen. A graph carrying somebody else's SHALLOW
// freeze is the one shape it cannot repair, which is why the caller must own
// what it passes.

import type { DeepReadonly } from './deep-readonly.ts'

function freezeSubtree(value: unknown): void {
  if (value === null || typeof value !== 'object') return
  if (Object.isFrozen(value)) return
  Object.freeze(value)
  if (Array.isArray(value)) {
    for (const entry of value) freezeSubtree(entry)
    return
  }
  for (const key of Reflect.ownKeys(value)) {
    freezeSubtree((value as Record<PropertyKey, unknown>)[key])
  }
}

/**
 * Deeply freeze a graph the caller owns, in place, and report it as immutable.
 *
 * The argument is returned rather than copied: freezing is the whole operation,
 * so a caller that needs detachment as well clones first.
 */
export function freezeDeep<T>(value: T): DeepReadonly<T> {
  freezeSubtree(value)
  return value as DeepReadonly<T>
}
