/**
 * The built-in role components (actor-target treatment, Mordred blindness,
 * assassin posterior), wired to their analysis builders through the shared
 * role-projection skeleton.
 *
 * They share the belief host input, the public-observer host input, and the
 * beliefIsExact predicate with the native score components module, which is
 * where those are declared; this module imports them rather than restating them.
 */
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
import {
  buildEvilExposureRead,
  buildPrivatePinRead,
  decodeCanonicalEvilExposureRead,
  decodeCanonicalPrivatePinRead,
  validateAdmittedEvilExposureReadHostJoin,
  validateAdmittedPrivatePinReadHostJoin,
} from '../analysis/private-pin.ts'
import {
  EVIL_EXPOSURE_READ_DEGRADATION,
  EVIL_EXPOSURE_READ_VERSION,
  PRIVATE_PIN_READ_DEGRADATION,
  PRIVATE_PIN_READ_VERSION,
  type EvilExposureRead,
  type PrivatePinRead,
} from '../analysis/private-pin-types.ts'
import { legalCandidates } from '../policy/candidates.ts'
import {
  appliesFrom,
  ASSASSIN_CLAIM,
  MORDRED_CLAIM,
} from '../policy/applicability.ts'
import {
  beliefIsExact,
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

export const PRIVATE_PIN_READ_COMPONENT:
ComponentToken<PrivatePinRead> = Object.freeze({
  id: 'private-pin-read',
  version: PRIVATE_PIN_READ_VERSION,
  kind: 'observer',
  privacy: 'private',
})

export const EVIL_EXPOSURE_READ_COMPONENT:
ComponentToken<EvilExposureRead> = Object.freeze({
  id: 'evil-exposure-read',
  version: EVIL_EXPOSURE_READ_VERSION,
  kind: 'observer',
  privacy: 'private',
})

/** Belief-derived payloads are exact only from a constraints-only belief. */
function exactBelief(
  source: Readonly<{ beliefQuality: string }>,
): boolean {
  return beliefIsExact(source.beliefQuality)
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
    applies: appliesFrom(MORDRED_CLAIM),
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
      beliefIsExact(input.belief.quality),
  })

  const assassinPosterior = roleProjection({
    token: ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
    degradationCode: ASSASSIN_MERLIN_POSTERIOR_DEGRADATION,
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    maxPayloadBytes: MAX_ASSASSIN_MERLIN_POSTERIOR_JSON_BYTES,
    applies: appliesFrom(ASSASSIN_CLAIM),
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
      beliefIsExact(input.belief.quality),
  })

  // The private pin read: what the acting seat knows the table does not. Belief
  // plus the public observer, so exactness follows belief quality like the
  // belief-derived reads above. Applies wherever a team is chosen or judged.
  const privatePin = roleProjection({
    token: PRIVATE_PIN_READ_COMPONENT,
    degradationCode: PRIVATE_PIN_READ_DEGRADATION,
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    applies(context) {
      return context.request.kind === 'propose'
        || context.request.kind === 'vote'
    },
    join(context) {
      return {
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
      }
    },
    build: buildPrivatePinRead,
    decode: decodeCanonicalPrivatePinRead,
    hostJoin: validateAdmittedPrivatePinReadHostJoin,
    detachedExact: (payload) => exactBelief(payload),
    hostExact: (_payload, input) => beliefIsExact(input.belief.quality),
  })

  // The level-2 mirror: which good seats are certain the acting evil seat is
  // evil. Evil-only, so it applies only to an evil seat choosing or judging a
  // team; buildEvilExposureRead throws for a good seat, which the guard avoids.
  const evilExposure = roleProjection({
    token: EVIL_EXPOSURE_READ_COMPONENT,
    degradationCode: EVIL_EXPOSURE_READ_DEGRADATION,
    requiredHostInputs: [PRIVATE_BELIEF_INPUT],
    applies(context) {
      return (context.request.kind === 'propose'
        || context.request.kind === 'vote')
        && context.view.alignment === 'evil'
    },
    join(context) {
      return {
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
      }
    },
    build: buildEvilExposureRead,
    decode: decodeCanonicalEvilExposureRead,
    hostJoin: validateAdmittedEvilExposureReadHostJoin,
    detachedExact: (payload) => exactBelief(payload),
    hostExact: (_payload, input) => beliefIsExact(input.belief.quality),
  })

  return Object.freeze([
    treatment,
    objective,
    assassinPosterior,
    privatePin,
    evilExposure,
  ])
}
