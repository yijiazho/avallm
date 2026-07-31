/**
 * The one table that owns each opt-in role feature's construction-time fan-out,
 * and the canonical order the components it contributes must arrive in.
 *
 * A role feature used to be wired at five parallel sites and forgetting one
 * mis-wired the feature silently. The row shape below is that fan-out, and the
 * canonical order is a byte-level contract because the resolved brain descriptor
 * preserves requested order verbatim: a change here changes the architecture
 * identity digest of every agent that requests the component. Both belong out of
 * the spine so that adding a feature means editing a table, and so that the
 * ordering contract is not something a reader has to reconstruct from the
 * sequence of pushes in a constructor.
 */
import { isDeepStrictEqual } from 'node:util'
import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../components/robust-evil-quest-card.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  SERVANT_OBJECTIVE_COMPONENT,
  SERVANT_ROLE_UTILITY_COMPONENT,
} from '../components/native-score-components.ts'
import type { ComponentRef } from '../components/types.ts'

/**
 * Everything one opt-in role feature contributes to brain construction, in one
 * row.
 *
 * A role feature used to be threaded through five parallel sites: an option
 * flag, a requested-components slice, a compatibility.requests entry, a public
 * observer disjunct, and a good-objective decision-kind disjunct. Forgetting one
 * silently mis-wired the feature. The columns below are those sites, so adding a
 * feature is adding a row here (plus, when it carries private state into
 * scoring, a payload binding in the scorer walk).
 *
 * `components` and `forcesPublicObserver` are deliberately independent: a role
 * utility requirement that sits only on a base scorer contributes its components
 * through the chain walk yet does not force the observer, which reads the entry
 * scorer alone. Fusing the two would silently change the descriptor.
 */
export interface RoleFeatureSetup {
  /** This feature's disjunct of the aggregate public-observer requirement. */
  readonly forcesPublicObserver: boolean
  /** This feature's disjunct of the good-objective all-decision-kinds reach. */
  readonly forcesGoodObjectiveAllKinds?: boolean
  /**
   * Components this feature requests. Concatenated across configured features,
   * then deduplicated and reordered canonically, so shared components (the good
   * role objective is wanted by three features) resolve to one request at a
   * pinned position rather than a per-feature ordering.
   */
  readonly components?: readonly ComponentRef[]
}

/**
 * The canonical position of every role-feature component in the requested list.
 *
 * The resolved descriptor preserves requested order verbatim, so this order is
 * a byte-level contract, not a convenience. Reordering it, or contributing a
 * component absent from it, is rejected below rather than silently reshaping the
 * descriptor.
 */
const ROLE_FEATURE_COMPONENT_ORDER: readonly string[] = [
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  SERVANT_OBJECTIVE_COMPONENT,
  SERVANT_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
].map((component) => `${component.id}@${component.version}`)

export function orderedRoleFeatureComponents(
  contributed: readonly ComponentRef[],
): readonly ComponentRef[] {
  const byKey = new Map<string, ComponentRef>()
  for (const ref of contributed) {
    const key = `${ref.id}@${ref.version}`
    const existing = byKey.get(key)
    // Shared components (the good role objective is wanted by three features)
    // arrive more than once and collapse to one request. Two features naming
    // the same id with different tags would instead be a silent last-writer
    // overwrite, so reject the conflict rather than pick one.
    if (existing && !isDeepStrictEqual(existing, ref)) {
      throw new Error(
        `role features contributed conflicting variants of ${key}`,
      )
    }
    if (!existing) byKey.set(key, ref)
  }
  const ordered: ComponentRef[] = []
  for (const key of ROLE_FEATURE_COMPONENT_ORDER) {
    const ref = byKey.get(key)
    if (ref) {
      ordered.push(ref)
      byKey.delete(key)
    }
  }
  if (byKey.size > 0) {
    throw new Error(
      `role feature requested an uncanonical component: ${
        [...byKey.keys()].join(', ')
      }`,
    )
  }
  return ordered
}
