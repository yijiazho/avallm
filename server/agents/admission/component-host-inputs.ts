import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import { observePublicRecord } from '../analysis/observer.ts'
import { roleObjectiveIdentityScope } from '../analysis/role-objectives.ts'
import { analyzeSituation } from '../analysis/situation.ts'
import { exactBelief } from '../belief/exact.ts'
import { projectJointIdentity } from '../belief/identity.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
} from '../belief/types.ts'
import { projectPublicRecord } from '../record/public-record.ts'
import type { DecisionComponentPlan } from '../components/kernel.ts'
import {
  createNativeScoreComponentRegistry,
  PRIVATE_BELIEF_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
  PRIVATE_SITUATION_INPUT,
} from '../components/native-score-components.ts'
import type { DecisionComponentRegistry } from '../components/registry.ts'
import type {
  ComponentHostInputBinding,
  ComponentHostInputRef,
  ComponentHostInputToken,
} from '../components/types.ts'
import {
  candidateTeams,
  legalCandidates,
} from '../candidate/candidates.ts'
import { applyForcedPolicy } from '../policy/forced.ts'
import type { DecisionTrace } from '../trace.ts'

/** The `${id}@${version}` set key a host-input token is required under. */
function tokenKey(token: ComponentHostInputRef): string {
  return `${token.id}@${token.version}`
}

/**
 * Reconstruct only host roots independently derivable from canonical
 * request/view coordinates. Weighted trace diagnostics cannot reconstruct
 * their private belief and identity roots.
 *
 * This re-derives host inputs during trace admission so an admitted trace's
 * component scores can be re-checked against a host reconstruction.
 */
export function reconstructScoreComponentHostInputs(input: {
  readonly trace: DecisionTrace
  readonly plan: DecisionComponentPlan
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly deterministicSeed: string
  readonly registry?: DecisionComponentRegistry
}): readonly ComponentHostInputBinding<unknown>[] {
  const {
    trace,
    plan,
    req,
    view,
    deterministicSeed,
    registry: suppliedRegistry,
  } = input
  const registry = suppliedRegistry ?? createNativeScoreComponentRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const required = new Set(
    plan.configured.flatMap((ref) =>
      registry.definition(ref)?.requiredHostInputs.map(tokenKey) ?? []),
  )
  const requires = (token: ComponentHostInputRef): boolean =>
    required.has(tokenKey(token))
  const bindings: ComponentHostInputBinding<unknown>[] = []
  const bind = <Value>(
    token: ComponentHostInputToken<Value>,
    value: Value,
  ): void => {
    if (requires(token)) {
      bindings.push({ input: token, value })
    }
  }
  const needsSituationOrForcedPolicy =
    requires(PRIVATE_SITUATION_INPUT) || requires(PRIVATE_FORCED_POLICY_INPUT)

  const exactReconstructable =
    trace.quality === 'constraints-only'
    && trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
    && trace.componentVersions?.belief === EXACT_BELIEF_MODEL_VERSION
    && trace.componentVersions?.factors === 'off'
    && trace.componentVersions?.languageEvidence === 'off'
  let validationBelief: BeliefSnapshot | undefined
  const needsValidationBelief =
    exactReconstructable
    || needsSituationOrForcedPolicy
  if (needsValidationBelief) validationBelief = exactBelief(view)

  if (exactReconstructable && validationBelief) {
    bind(PRIVATE_BELIEF_INPUT, validationBelief)
    const identityScope =
      view.role === 'merlin' || view.role === 'percival'
        ? roleObjectiveIdentityScope(view.role, view.rolesInPlay)
        : { roleQueries: [], hiddenTeam: true }
    bind(
      PRIVATE_IDENTITY_INPUT,
      projectJointIdentity(validationBelief, identityScope),
    )
  }
  bind(
    PRIVATE_PUBLIC_OBSERVER_INPUT,
    observePublicRecord(projectPublicRecord(view)),
  )

  if (validationBelief && needsSituationOrForcedPolicy) {
    const candidates = legalCandidates(req, view)
    const analysis = analyzeSituation(view, {
      belief: validationBelief,
      policyCandidateTeams: candidateTeams(candidates, view),
    })
    bind(PRIVATE_SITUATION_INPUT, analysis)
    bind(
      PRIVATE_FORCED_POLICY_INPUT,
      applyForcedPolicy(req, view, analysis, candidates),
    )
  }
  bind(PRIVATE_DETERMINISTIC_SEED_INPUT, deterministicSeed)
  return Object.freeze(bindings)
}
