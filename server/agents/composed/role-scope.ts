/**
 * What the configured scorer and the acting seat's role imply for one decision.
 *
 * These answers are mutually dependent, and reading them one at a time from
 * decide() hid that: the routed objective decides which scorer in the fallback
 * chain is applicable, the applicable scorer decides which role objective is in
 * scope, and the role objective decides the identity scope. Resolving them in
 * one place makes the order a property of the module rather than of the order
 * somebody happened to write the locals in.
 *
 * The payload bindings live here for the same reason. A scorer keeps a
 * requirement only while the component that answers it arrived, so the walk that
 * steps a scorer down its base chain is the same computation as the scope, not a
 * separate scoring concern.
 */
import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type RoutedRoleObjectiveModel,
} from '../analysis/evil-objective-types.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/evil-role-utility.ts'
import {
  MORGANA_ROLE_SCORER_DEGRADATION,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/morgana-role-utility.ts'
import {
  ROLE_OBJECTIVE_MODEL_VERSION,
  type RoleObjectiveRole,
} from '../analysis/role-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from '../analysis/role-objective-router.ts'
import {
  mergeIdentityScopes,
  roleObjectiveIdentityScope,
} from '../analysis/role-objectives.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/role-utility.ts'
import type { IdentityProjectionScope } from '../belief/identity.ts'
import {
  componentPayload,
  type DecisionComponentRun,
} from '../components/kernel.ts'
import type {
  ComponentRef,
  ComponentToken,
} from '../components/types.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  type CandidateScorer,
} from '../policy/score.ts'

/**
 * What the configured scorer and the acting seat imply for one decision.
 *
 * These eight values were derived inline in decide() and then read from a dozen
 * places further down. Resolving them together makes their dependency order
 * legible, which is not obvious from the reads: the role objective depends on
 * the resolved scorer's declared requirements, and the identity scope depends in
 * turn on the role objective. `scorer` is the entry scorer only. Component
 * results can still step it down its base chain, so decide() keeps that as a
 * mutable local rather than reading it back from here.
 */
export interface DecisionRoleScope {
  readonly routedObjective: RoutedRoleObjectiveModel
  readonly scorer: CandidateScorer
  readonly roleObjectiveRole: RoleObjectiveRole | undefined
  readonly evilRoleObjectiveApplicable: boolean
  readonly morganaCounterfeitApplicable: boolean
  readonly identityScope: IdentityProjectionScope | undefined
}

export function resolveDecisionRoleScope(input: {
  configuredScorer: CandidateScorer
  req: DecisionRequest
  view: PlayerView
  routerConfigured: boolean
  roleObjectivesConfigured: boolean
  morganaCounterfeitConfigured: boolean
  configuredIdentityScope: IdentityProjectionScope | undefined
}): DecisionRoleScope {
  const { req, view, configuredIdentityScope } = input
  const routedObjective = input.routerConfigured
    ? routedRoleObjectiveModel(view.role)
    : 'off'
  const scorer = resolveRolePolicyScorer({
    configured: input.configuredScorer,
    req,
    view,
    routedObjective,
  })
  const roleUtilityApplicable =
    scorer.roleUtilityRequirement === ROLE_UTILITY_PROJECTION_VERSION
  const evilRoleObjectiveApplicable =
    routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const roleObjectiveRole: RoleObjectiveRole | undefined =
    (input.roleObjectivesConfigured || roleUtilityApplicable)
    && (view.role === 'merlin' || view.role === 'percival')
      ? view.role
      : routedObjective === ROLE_OBJECTIVE_MODEL_VERSION
        ? view.role as RoleObjectiveRole
        : undefined
  return {
    routedObjective,
    scorer,
    roleObjectiveRole,
    evilRoleObjectiveApplicable,
    morganaCounterfeitApplicable:
      (
        input.morganaCounterfeitConfigured
        || scorer.morganaRoleUtilityRequirement
          === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      )
      && view.role === 'morgana'
      && (req.kind === 'propose' || req.kind === 'vote'),
    identityScope: roleObjectiveRole
      ? mergeIdentityScopes(
          configuredIdentityScope,
          roleObjectiveIdentityScope(roleObjectiveRole, view.rolesInPlay),
        )
      : evilRoleObjectiveApplicable
        ? mergeIdentityScopes(
            configuredIdentityScope,
            { roleQueries: [], hiddenTeam: true },
          )
        : configuredIdentityScope,
  }
}

/**
 * One configured component whose admitted payload a scorer may depend on.
 *
 * `apply` captures the component's payload type in a closure so a decision can
 * hold bindings for unrelated roles in one list, and reports whether the
 * payload arrived. `requiredByScorer` is a thunk because the answer differs per
 * requirement: the good and evil requirements are read from the scorer that
 * entered the decision, while the Morgana requirement is read live, after any
 * earlier binding has already stepped the scorer down its base chain.
 */
export interface ScorerPayloadBinding {
  readonly component: ComponentRef
  readonly requiredByScorer: () => boolean
  readonly apply: (run: DecisionComponentRun) => boolean
}

export function scorerPayloadBinding<Payload>(
  component: ComponentToken<Payload>,
  requiredByScorer: () => boolean,
  assign: (payload: Payload | undefined) => void,
): ScorerPayloadBinding {
  return {
    component,
    requiredByScorer,
    apply(run: DecisionComponentRun): boolean {
      const payload = componentPayload(run, component)
      assign(payload)
      // Truthiness, not a defined check: every consumer of these payloads
      // tests them the same way, so a defined-but-falsy payload has to count
      // as absent here too or the scorer keeps a requirement it cannot read.
      return Boolean(payload)
    },
  }
}

export function resolveRolePolicyScorer(input: {
  configured: CandidateScorer
  req: DecisionRequest
  view: PlayerView
  routedObjective: RoutedRoleObjectiveModel
}): CandidateScorer {
  let current = input.configured
  const visited = new Set<CandidateScorer>()
  while (true) {
    if (visited.has(current)) {
      throw new Error('candidate scorer fallback chain contains a cycle')
    }
    visited.add(current)
    const roleApplicable =
      current.roleUtilityRequirement === ROLE_UTILITY_PROJECTION_VERSION
      && (input.req.kind === 'propose' || input.req.kind === 'vote')
      && (input.view.role === 'merlin' || input.view.role === 'percival')
    const evilApplicable =
      current.evilRoleUtilityRequirement
        === EVIL_ROLE_UTILITY_PROJECTION_VERSION
      && (input.req.kind === 'propose' || input.req.kind === 'vote')
      && input.routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
    const morganaApplicable =
      current.morganaRoleUtilityRequirement
        === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      && evilApplicable
      && input.view.role === 'morgana'
    if (
      (current.roleUtilityRequirement && !roleApplicable)
      || (current.evilRoleUtilityRequirement && !evilApplicable)
      || (current.morganaRoleUtilityRequirement && !morganaApplicable)
    ) {
      if (!current.baseScorer) return current
      current = current.baseScorer
      continue
    }
    return current
  }
}

/**
 * The degradation code to record if this scorer fails, or undefined when it is
 * not a role scorer and has no role-specific code.
 *
 * This replaces a pair of overlapping version lists: one asked whether the
 * scorer was any of six role versions, the other mapped those versions to a
 * code with a bare `else` for the rest. They agreed only because the second was
 * read exclusively when the first was true, so adding a role family to one and
 * not the other would have silently attributed its failure to the good-side
 * code. One lookup cannot drift from itself.
 */
export function roleScorerFallbackDegradation(
  scorer: CandidateScorer,
): string | undefined {
  switch (scorer.version) {
    case MORGANA_ROLE_SCORER_VERSION:
    case MORGANA_ROLE_SEEDED_SCORER_VERSION:
      return MORGANA_ROLE_SCORER_DEGRADATION
    case EVIL_ROLE_OBJECTIVE_SCORER_VERSION:
    case EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION:
      return 'evil-role-objective-scorer-failed'
    case ROLE_OBJECTIVE_SCORER_VERSION:
    case ROLE_OBJECTIVE_SEEDED_SCORER_VERSION:
      return 'role-objective-scorer-failed'
    default:
      return undefined
  }
}
