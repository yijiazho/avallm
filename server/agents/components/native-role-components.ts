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
  MAX_MORDRED_BLINDNESS_JSON_BYTES,
  MORDRED_BLINDNESS_DEGRADATION,
  MORDRED_BLINDNESS_OBJECTIVE_VERSION,
  type PrivateMordredBlindnessObjective,
} from '../analysis/mordred-blindness-types.ts'
import { legalCandidates } from '../policy/candidates.ts'
import { componentEnvelope } from './kernel.ts'
import {
  PRIVATE_BELIEF_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from './native-score-components.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import { projectPublicRecord } from '../communication/public-record.ts'
import type {
  ComponentAdmissionResult,
  ComponentToken,
  DecisionComponentContext,
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

function admitted<Payload>(
  payload: Payload,
  exact: boolean,
): ComponentAdmissionResult<Payload> {
  return {
    admitted: true,
    payload,
    verification: exact ? 'exact' : 'structural',
    promotionEligible: exact,
  }
}

function rejected<Payload>(
  degradationCode: string,
): ComponentAdmissionResult<Payload> {
  return { admitted: false, degradationCode }
}

function privateNativeContext(context: DecisionComponentContext) {
  if (context.privacy !== 'private') {
    throw new Error('private native component received public context')
  }
  return context
}

export function nativeRoleComponentDefinitions():
readonly DecisionComponentDefinition<any>[] {
  const treatment: DecisionComponentDefinition<
    PrivateActorTargetTreatmentRead
  > = {
    token: ACTOR_TARGET_TREATMENT_COMPONENT,
    source: 'native',
    brainContribution: {
      observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
    },
    dependencies: [],
    requiredHostInputs: [PRIVATE_PUBLIC_OBSERVER_INPUT],
    hostRequirements: [],
    maxPayloadBytes: MAX_ACTOR_TARGET_TREATMENT_JSON_BYTES,
    degradationCode: ACTOR_TARGET_TREATMENT_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && (
          context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      const host = privateNativeContext(context)
      const payload = buildPrivateActorTargetTreatmentRead(
        projectPublicRecord(host.view),
        host.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
      )
      return {
        status: 'produced',
        envelope: componentEnvelope(ACTOR_TARGET_TREATMENT_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded =
        decodeCanonicalPrivateActorTargetTreatmentRead(payload)
      return decoded
        ? admitted(decoded, true)
        : rejected(ACTOR_TARGET_TREATMENT_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const context = privateNativeContext(host)
      return validateAdmittedPrivateActorTargetTreatmentHostJoin(payload, {
        record: projectPublicRecord(context.view),
        observer: context.hostInputs.require(
          PRIVATE_PUBLIC_OBSERVER_INPUT,
        ),
      })
        ? admitted(payload, true)
        : rejected(ACTOR_TARGET_TREATMENT_DEGRADATION)
    },
  }

  const objective: DecisionComponentDefinition<
    PrivateMordredBlindnessObjective
  > = {
    token: MORDRED_BLINDNESS_COMPONENT,
    source: 'native',
    dependencies: [ACTOR_TARGET_TREATMENT_COMPONENT],
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    hostRequirements: [],
    maxPayloadBytes: MAX_MORDRED_BLINDNESS_JSON_BYTES,
    degradationCode: MORDRED_BLINDNESS_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.role === 'mordred'
        && context.view.rolesInPlay.includes('merlin')
        && (
          context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      const host = privateNativeContext(context)
      const payload = buildPrivateMordredBlindnessObjective({
        req: host.request,
        view: host.view,
        belief: host.hostInputs.require(PRIVATE_BELIEF_INPUT),
        treatment: host.dependencies.require(ACTOR_TARGET_TREATMENT_COMPONENT),
        candidates: legalCandidates(host.request, host.view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(MORDRED_BLINDNESS_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded =
        decodeCanonicalPrivateMordredBlindnessObjective(payload)
      return decoded
        ? admitted(
            decoded,
            decoded.source.beliefQuality === 'constraints-only',
          )
        : rejected(MORDRED_BLINDNESS_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const context = privateNativeContext(host)
      const belief = context.hostInputs.require(PRIVATE_BELIEF_INPUT)
      return validateAdmittedPrivateMordredBlindnessHostJoin(payload, {
        req: context.request,
        view: context.view,
        belief,
        treatment: context.dependencies.require(
          ACTOR_TARGET_TREATMENT_COMPONENT,
        ),
        candidates: legalCandidates(context.request, context.view),
      })
        ? admitted(payload, belief.quality === 'constraints-only')
        : rejected(MORDRED_BLINDNESS_DEGRADATION)
    },
  }

  return Object.freeze([treatment, objective])
}
