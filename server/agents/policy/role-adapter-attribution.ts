/**
 * Which role adapter families a scorer actually used, and the run attribution
 * that has to agree with that answer.
 *
 * Lifted out of the composed agent because the attribution and the check on it
 * were written twice, side by side, and had drifted: the Morgana public read
 * was attributed by one list and absent from the other. One table now feeds
 * both, so a component cannot be attributed without also being checked.
 */
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/evil-role-utility.ts'
import {
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/morgana-role-utility.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../components/native-score-components.ts'
import {
  attributeComponentPolicyUse,
  type DecisionComponentRun,
} from '../components/kernel.ts'
import { componentIdentityKey } from '../components/registry.ts'
import type { ComponentToken } from '../components/types.ts'
import type { CandidateScore, CandidateScorer } from './score.ts'

/**
 * Raised when the run's own attribution bookkeeping contradicts itself.
 *
 * Distinct from every plugin fault, because it is not one: no custom scorer can
 * produce it by returning bad output, and the fallback that follows a scorer
 * fault is not a remedy for it. It is typed so it can travel through the catch
 * that owns plugin faults instead of being renamed by it.
 */
export class CompositionInvariantError extends Error {}

/**
 * One row per role adapter family: when its projection counts as used, which
 * components that use attributes, and which component identities the claim is
 * then checked against.
 *
 * `verify` is wider than `attribute` for Morgana, whose role-utility token has
 * a seeded and an unseeded spelling and whose configuration picks one. Both are
 * checked so a stale attribution of the variant that was not configured is
 * still caught.
 */
export interface RoleAdapterAttribution {
  readonly used: boolean
  readonly attribute: readonly ComponentToken[]
  readonly verify: readonly ComponentToken[]
}

export function roleAdapterAttributions(
  appliedScorer: CandidateScorer,
  scores: readonly CandidateScore[],
  morganaRoleUtilityComponent:
    typeof MORGANA_ROLE_UTILITY_COMPONENT | undefined,
): readonly RoleAdapterAttribution[] {
  const goodUsed =
    appliedScorer.roleUtilityRequirement
      === ROLE_UTILITY_PROJECTION_VERSION
    && scores.every((score) => score.roleObjectiveFeatures !== undefined)
  const evilUsed =
    appliedScorer.evilRoleUtilityRequirement
      === EVIL_ROLE_UTILITY_PROJECTION_VERSION
    && scores.every((score) =>
      score.evilRoleObjectiveFeatures !== undefined
      || (
        (
          appliedScorer.morganaRoleUtilityRequirement
            === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
        )
        && score.morganaRoleObjectiveFeatures !== undefined
      ))
  const morganaUsed =
    appliedScorer.morganaRoleUtilityRequirement
      === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    && scores.every(
      (score) => score.morganaRoleObjectiveFeatures !== undefined,
    )
  // The applied scorer decides whether the Morgana projection was used; the
  // configuration decides which of the two utility tokens names it. Nothing
  // downstream reconciles those two, so a disagreement is caught here by name
  // rather than by dereferencing an absent token.
  if (morganaUsed && !morganaRoleUtilityComponent) {
    throw new CompositionInvariantError(
      'morgana role utility used without a configured component token',
    )
  }
  const morganaComponents = [
    MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    ...(morganaRoleUtilityComponent ? [morganaRoleUtilityComponent] : []),
  ]
  return [
    {
      used: goodUsed,
      attribute: [GOOD_ROLE_OBJECTIVE_COMPONENT, GOOD_ROLE_UTILITY_COMPONENT],
      verify: [GOOD_ROLE_OBJECTIVE_COMPONENT, GOOD_ROLE_UTILITY_COMPONENT],
    },
    {
      used: evilUsed,
      attribute: [EVIL_ROLE_OBJECTIVE_COMPONENT, EVIL_ROLE_UTILITY_COMPONENT],
      verify: [EVIL_ROLE_OBJECTIVE_COMPONENT, EVIL_ROLE_UTILITY_COMPONENT],
    },
    {
      used: morganaUsed,
      attribute: morganaComponents,
      verify: [
        MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
        MORGANA_ROLE_UTILITY_COMPONENT,
        MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      ],
    },
  ]
}

/**
 * Attribute the role adapters this scorer actually used, then check the run
 * agrees.
 *
 * Both halves read the same rows, which is the point: the previous hand-written
 * check enumerated its clauses separately from the attribution above it and had
 * drifted by one component, so the Morgana public read was attributed and never
 * verified.
 *
 * The check is keyed on component identity, id and version together, because
 * that is what attribution matches on. Keying on id alone collapsed two
 * versions of one component into whichever entry came last.
 */
export function attributeCompatibilityRolePolicyUse(
  run: DecisionComponentRun,
  appliedScorer: CandidateScorer,
  scores: readonly CandidateScore[],
  morganaRoleUtilityComponent:
    typeof MORGANA_ROLE_UTILITY_COMPONENT | undefined,
): DecisionComponentRun {
  const rows = roleAdapterAttributions(
    appliedScorer,
    scores,
    morganaRoleUtilityComponent,
  )
  let attributed = run
  for (const row of rows) {
    if (!row.used) continue
    for (const token of row.attribute) {
      attributed = attributeComponentPolicyUse(
        attributed,
        token,
        'candidate-score',
      )
    }
  }
  const used = new Map(
    attributed.policyUse.map(
      (entry) => [componentIdentityKey(entry.component), entry.used],
    ),
  )
  for (const row of rows) {
    for (const token of row.verify) {
      const claim = used.get(componentIdentityKey(token))
      // An absent entry is only a contradiction for a row that was used: the
      // components a row did not use are frequently not in the run at all.
      if (claim === undefined) {
        if (row.used && row.attribute.includes(token)) {
          throw new CompositionInvariantError(
            `used role adapter component ${token.id} is unattributed`,
          )
        }
        continue
      }
      if (claim !== row.used) {
        throw new CompositionInvariantError(
          `generic adapter causal policy-use mismatch for ${token.id}`,
        )
      }
    }
  }
  return attributed
}
