import {
  buildPrivateMordredBlindnessObjective,
  decodeCanonicalPrivateMordredBlindnessObjective,
  validateAdmittedPrivateMordredBlindnessHostJoin,
} from '../analysis/mordred-blindness.ts'
import {
  buildPrivateActorTargetTreatmentRead,
  decodeCanonicalPrivateActorTargetTreatmentRead,
  validateAdmittedPrivateActorTargetTreatmentHostJoin,
} from '../analysis/actor-target-treatment.ts'
import {
  ACTOR_TARGET_TREATMENT_DEGRADATION,
  ACTOR_TARGET_TREATMENT_READ_VERSION,
  MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
  type PrivateActorTargetTreatmentRead,
} from '../analysis/actor-target-treatment-types.ts'
import {
  MORDRED_BLINDNESS_DEGRADATION,
  MORDRED_BLINDNESS_OBJECTIVE_VERSION,
  type PrivateMordredBlindnessObjective,
} from '../analysis/mordred-blindness-types.ts'
import {
  buildPrivateAssassinMerlinPosterior,
  decodeCanonicalPrivateAssassinMerlinPosterior,
  validateAdmittedPrivateAssassinMerlinPosteriorHostJoin,
} from '../analysis/assassin-merlin-posterior.ts'
import {
  ASSASSIN_MERLIN_POSTERIOR_DEGRADATION,
  ASSASSIN_MERLIN_POSTERIOR_VERSION,
  MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
  type PrivateAssassinMerlinPosterior,
} from '../analysis/assassin-merlin-posterior-types.ts'
import { legalCandidates } from '../policy/candidates.ts'
import {
  PRIVATE_BELIEF_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from './native-score-components.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import { roleProjection } from './role-projection.ts'
import type {
  ComponentToken,
  DecisionComponentDefinition,
} from './types.ts'

export const ACTOR_TARGET_TREATMENT_COMPONENT:
ComponentToken<PrivateActorTargetTreatmentRead> = Object.freeze({
  id: 'actor-target-treatment-read',
  version: ACTOR_TARGET_TREATMENT_READ_VERSION,
  kind: 'observer',
  privacy: 'private',
})

export const MORDRED_BLINDNESS_COMPONENT:
ComponentToken<PrivateMordredBlindnessObjective> = Object.freeze({
  id: 'mordred-blindness-objective',
  version: MORDRED_BLINDNESS_OBJECTIVE_VERSION,
  kind: 'objective',
  privacy: 'private',
})

export const ASSASSIN_MERLIN_POSTERIOR_COMPONENT:
ComponentToken<PrivateAssassinMerlinPosterior> = Object.freeze({
  id: 'assassin-merlin-posterior',
  version: ASSASSIN_MERLIN_POSTERIOR_VERSION,
  kind: 'projection',
  privacy: 'private',
})

/** Belief-derived payloads are exact only from a constraints-only belief. */
function exactBelief(
  source: Readonly<{ beliefQuality: string }>,
): boolean {
  return source.beliefQuality === 'constraints-only'
}

export function nativeRoleComponentDefinitions():
readonly DecisionComponentDefinition<any>[] {
  const treatment = roleProjection({
    token: ACTOR_TARGET_TREATMENT_COMPONENT,
    degradationCode: ACTOR_TARGET_TREATMENT_DEGRADATION,
    brainContribution: {
      observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
    },
    requiredHostInputs: [PRIVATE_PUBLIC_OBSERVER_INPUT],
    maxPayloadBytes: MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
    applies(context) {
      return context.request.kind === 'propose'
        || context.request.kind === 'vote'
    },
    join(context) {
      return {
        record: projectPublicRecord(context.view),
        observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
      }
    },
    build({ record, observer }) {
      return buildPrivateActorTargetTreatmentRead(record, observer)
    },
    decode: decodeCanonicalPrivateActorTargetTreatmentRead,
    hostJoin: validateAdmittedPrivateActorTargetTreatmentHostJoin,
  })

  const objective = roleProjection({
    token: MORDRED_BLINDNESS_COMPONENT,
    degradationCode: MORDRED_BLINDNESS_DEGRADATION,
    dependencies: [ACTOR_TARGET_TREATMENT_COMPONENT],
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    applies(context) {
      return context.view.role === 'mordred'
        && context.view.rolesInPlay.includes('merlin')
        && (
          context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    join(context) {
      return {
        req: context.request,
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
        treatment: context.dependencies.require(
          ACTOR_TARGET_TREATMENT_COMPONENT,
        ),
        candidates: legalCandidates(context.request, context.view),
      }
    },
    build: buildPrivateMordredBlindnessObjective,
    decode: decodeCanonicalPrivateMordredBlindnessObjective,
    hostJoin: validateAdmittedPrivateMordredBlindnessHostJoin,
    detachedExact: (payload) => exactBelief(payload.source),
    hostExact: (_payload, input) =>
      input.belief.quality === 'constraints-only',
  })

  const assassinPosterior = roleProjection({
    token: ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
    degradationCode: ASSASSIN_MERLIN_POSTERIOR_DEGRADATION,
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    maxPayloadBytes: MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
    applies(context) {
      return context.view.role === 'assassin'
        && context.view.rolesInPlay.includes('merlin')
        && context.request.kind === 'assassinate'
    },
    join(context) {
      return {
        req: context.request,
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
      }
    },
    build: buildPrivateAssassinMerlinPosterior,
    decode: decodeCanonicalPrivateAssassinMerlinPosterior,
    hostJoin: validateAdmittedPrivateAssassinMerlinPosteriorHostJoin,
    detachedExact: (payload) => exactBelief(payload.source),
    hostExact: (_payload, input) =>
      input.belief.quality === 'constraints-only',
  })

  return Object.freeze([treatment, objective, assassinPosterior])
}
