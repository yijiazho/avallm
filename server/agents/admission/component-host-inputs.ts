import type { DecisionRequest, PlayerView } from '../../engine/types.ts'
import { observePublicRecord } from '../analysis/observer.ts'
import { roleObjectiveIdentityScope } from '../analysis/role-objectives.ts'
import { analyzeSituation } from '../analysis/situation.ts'
import { exactBelief } from '../belief/exact.ts'
import {
  hostReconstructibleBeliefModel,
  isHostReconstructibleCognition,
} from '../belief/host-reconstructible.ts'
import { projectJointIdentity } from '../belief/identity.ts'
import {
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

  // Which traces may be handed a host-rebuilt belief as a TRUSTED input.
  //
  // This used to name the uniform model literally, which was the same thing as
  // this list while that model was the only one anything ran. It is not the
  // same thing now: a decision made on the quest-weighted belief was refused
  // here, so its components never received a host belief to be verified
  // against and the whole join failed. The condition is really "can the host
  // rebuild what this trace says it used", so it now asks that directly.
  //
  // Every clause is still load-bearing. The model has to be one the host can
  // rebuild from the view alone; the component graph has to agree with the
  // trace about which belief and which factor bundle produced it, so a trace
  // cannot name a cheap model in one field and a different one in another; and
  // language evidence has to be off, because a language-weighted posterior
  // needs interpreted evidence no host holds.
  const claimedBeliefModel = typeof trace.beliefModelVersion === 'string'
    ? hostReconstructibleBeliefModel(trace.beliefModelVersion)
    : undefined
  const beliefClaimReconstructible =
    claimedBeliefModel !== undefined
    // The shared predicate, so this gate and the exact score replay cannot
    // drift into verifying different sets of traces.
    && isHostReconstructibleCognition(trace.componentVersions)
    // Plus the one relation only this gate can check: the trace's own belief
    // version must be the one its component graph names, or a trace could be
    // rebuilt from a model it never claimed to have run.
    && trace.componentVersions?.belief === trace.beliefModelVersion
  let validationBelief: BeliefSnapshot | undefined
  const needsValidationBelief =
    beliefClaimReconstructible
    || needsSituationOrForcedPolicy
  if (needsValidationBelief) {
    validationBelief = claimedBeliefModel
      ? claimedBeliefModel.infer(view)
      : exactBelief(view)
  }
  // The rebuild has to agree with the trace about what KIND of posterior it
  // produced, not only about which model produced it. Without this a trace
  // could claim `weighted` while the host rebuilds `constraints-only` from the
  // same view, and every component would then be verified against a posterior
  // the trace never used. Disagreement withholds the binding rather than
  // failing outright, which leaves the trace verifiable by the other routes
  // exactly as an unreconstructible model already is.
  const exactReconstructable =
    beliefClaimReconstructible
    && validationBelief !== undefined
    && validationBelief.quality === trace.quality

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
