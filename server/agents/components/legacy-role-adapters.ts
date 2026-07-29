import type {
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import {
  SITUATION_ANALYSIS_VERSION,
  type SituationAnalysis,
} from '../analysis/types.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  decodeCanonicalPrivateEvilRoleObjectiveSnapshot,
  validateAdmittedPrivateEvilRoleObjectiveHostJoin,
} from '../analysis/evil-objectives.ts'
import {
  MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateEvilRoleObjectiveSnapshot,
} from '../analysis/evil-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  decodeCanonicalPrivateRoleObjectiveSnapshot,
  roleObjectiveIdentityScope,
  validateAdmittedPrivateRoleObjectiveHostJoin,
} from '../analysis/role-objectives.ts'
import {
  MAX_ROLE_OBJECTIVE_JSON_BYTES,
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
  type PrivateRoleObjectiveSnapshot,
} from '../analysis/role-objective-types.ts'
import {
  buildAdmittedEvilRoleUtilityProjection,
  decodeCanonicalPrivateEvilRoleUtilityProjection,
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
  type PrivateEvilRoleUtilityProjection,
  validateAdmittedPrivateEvilRoleUtilityHostJoin,
} from '../analysis/evil-role-utility.ts'
import {
  buildAdmittedRoleUtilityProjection,
  decodeCanonicalPrivateRoleUtilityProjection,
  MAX_ROLE_UTILITY_JSON_BYTES,
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
  validateAdmittedPrivateRoleUtilityHostJoin,
} from '../analysis/role-utility.ts'
import {
  observePublicRecord,
  validatePublicObserverSnapshot,
} from '../analysis/observer.ts'
import type {
  PublicObserverSnapshot,
} from '../analysis/observer-types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  validatePrivateIdentitySnapshot,
} from '../belief/identity.ts'
import type {
  PrivateIdentitySnapshot,
} from '../belief/identity.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
  type BeliefSnapshot,
} from '../belief/types.ts'
import {
  exactBelief,
} from '../belief/exact.ts'
import {
  buildAdmittedMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  decodeCanonicalPrivateMorganaCounterfeitObjective,
  decodeCanonicalPublicCounterfeitMerlinRead,
  validateAdmittedPrivateMorganaCounterfeitHostJoin,
  validateAdmittedPublicCounterfeitMerlinReadHostJoin,
} from '../analysis/morgana-counterfeit.ts'
import {
  MAX_MORGANA_COUNTERFEIT_JSON_BYTES,
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type PrivateMorganaCounterfeitObjective,
  type PublicCounterfeitMerlinReadSnapshot,
} from '../analysis/morgana-counterfeit-types.ts'
import {
  buildAdmittedMorganaRoleUtilityProjection,
  decodeCanonicalPrivateMorganaRoleUtilityProjection,
  MAX_MORGANA_ROLE_UTILITY_JSON_BYTES,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  type MorganaRoleSelectionMode,
  type PrivateMorganaRoleUtilityProjection,
  validateAdmittedPrivateMorganaRoleUtilityHostJoin,
} from '../analysis/morgana-role-utility.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../policy/candidates.ts'
import {
  buildPrivateEvilQuestCardPolicy,
  EVIL_QUEST_CARD_POLICY_DEGRADATION,
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  type EvilQuestCardPolicyMode,
  type PrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicyHostJoin,
} from '../policy/evil-quest-card.ts'
import {
  FORCED_POLICY_VERSION,
  type ForcedPolicyResult,
} from '../policy/types.ts'
import {
  applyForcedPolicy,
} from '../policy/forced.ts'
import {
  analyzeSituation,
} from '../analysis/situation.ts'
import {
  projectPublicRecord,
} from '../communication/public-record.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../policy/score.ts'
import { componentEnvelope } from './kernel.ts'
import type {
  ComponentAdmissionResult,
  ComponentHostInputBinding,
  ComponentHostInputDefinition,
  ComponentHostInputToken,
  ComponentToken,
  DecisionComponentContext,
  DecisionComponentDefinition,
} from './types.ts'
import type {
  DecisionComponentPlan,
} from './kernel.ts'
import {
  createDecisionComponentRegistry,
  type DecisionComponentRegistry,
} from './registry.ts'
import type { DecisionTrace } from '../trace.ts'

const MAX_ROOT_JSON_BYTES = 1_048_576
const MAX_BELIEF_ROOT_JSON_BYTES = 16_777_216

export const GOOD_ROLE_OBJECTIVE_COMPONENT:
ComponentToken<PrivateRoleObjectiveSnapshot> = Object.freeze({
  id: 'good-role-objective',
  version: ROLE_OBJECTIVE_MODEL_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const GOOD_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateRoleUtilityProjection> = Object.freeze({
  id: 'good-role-utility',
  version: ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const EVIL_ROLE_OBJECTIVE_COMPONENT:
ComponentToken<PrivateEvilRoleObjectiveSnapshot> = Object.freeze({
  id: 'evil-role-objective',
  version: EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const EVIL_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateEvilRoleUtilityProjection> = Object.freeze({
  id: 'evil-role-utility',
  version: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT:
ComponentToken<PrivateMorganaCounterfeitObjective> = Object.freeze({
  id: 'morgana-counterfeit-objective',
  version: MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  kind: 'objective',
  privacy: 'private',
})
export const MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT:
ComponentToken<PublicCounterfeitMerlinReadSnapshot> = Object.freeze({
  id: 'morgana-counterfeit-public-read',
  version: MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  kind: 'observer',
  privacy: 'public',
})
export const MORGANA_ROLE_UTILITY_COMPONENT:
ComponentToken<PrivateMorganaRoleUtilityProjection> = Object.freeze({
  id: 'morgana-role-utility',
  version: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const MORGANA_ROLE_UTILITY_SEEDED_COMPONENT:
ComponentToken<PrivateMorganaRoleUtilityProjection> = Object.freeze({
  id: 'morgana-role-utility-seeded',
  version: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  kind: 'projection',
  privacy: 'private',
})
export const EVIL_QUEST_CARD_ROBUST_COMPONENT:
ComponentToken<PrivateEvilQuestCardPolicy> = Object.freeze({
  id: 'evil-quest-card-robust',
  version: EVIL_QUEST_ROBUST_POLICY_VERSION,
  kind: 'decision-rule',
  privacy: 'private',
})
export const EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT:
ComponentToken<PrivateEvilQuestCardPolicy> = Object.freeze({
  id: 'evil-quest-card-exact-quota',
  version: EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  kind: 'decision-rule',
  privacy: 'private',
})

export const PRIVATE_IDENTITY_INPUT:
ComponentHostInputToken<PrivateIdentitySnapshot> = Object.freeze({
  id: 'private-identity',
  version: JOINT_IDENTITY_MODEL_VERSION,
  privacy: 'private',
})
export const PRIVATE_PUBLIC_OBSERVER_INPUT:
ComponentHostInputToken<PublicObserverSnapshot> = Object.freeze({
  id: 'private-public-observer',
  version: PUBLIC_OBSERVER_MODEL_VERSION,
  privacy: 'private',
})
export const PRIVATE_BELIEF_INPUT:
ComponentHostInputToken<BeliefSnapshot> = Object.freeze({
  id: 'private-resolved-belief',
  version: 'resolved-belief-snapshot-v1',
  privacy: 'private',
})
export const PRIVATE_SITUATION_INPUT:
ComponentHostInputToken<SituationAnalysis> = Object.freeze({
  id: 'private-situation-analysis',
  version: SITUATION_ANALYSIS_VERSION,
  privacy: 'private',
})
export const PRIVATE_FORCED_POLICY_INPUT:
ComponentHostInputToken<ForcedPolicyResult> = Object.freeze({
  id: 'private-universal-forced-policy',
  version: FORCED_POLICY_VERSION,
  privacy: 'private',
})
export const PRIVATE_DETERMINISTIC_SEED_INPUT:
ComponentHostInputToken<string> = Object.freeze({
  id: 'private-deterministic-seed',
  version: 'deterministic-seed-v1',
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

function privateContext(context: DecisionComponentContext): {
  req: Readonly<DecisionRequest>
  view: Readonly<PlayerView>
  identity: PrivateIdentitySnapshot
  observer: PublicObserverSnapshot
} {
  if (context.privacy !== 'private') {
    throw new Error('private role adapter received public context')
  }
  return {
    req: context.request,
    view: context.view,
    identity: context.hostInputs.require(PRIVATE_IDENTITY_INPUT),
    observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
  }
}

function privateObserverContext(context: DecisionComponentContext): {
  req: Readonly<DecisionRequest>
  view: Readonly<PlayerView>
  observer: PublicObserverSnapshot
} {
  if (context.privacy !== 'private') {
    throw new Error('private role component received public context')
  }
  return {
    req: context.request,
    view: context.view,
    observer: context.hostInputs.require(PRIVATE_PUBLIC_OBSERVER_INPUT),
  }
}

function exactQuality(
  objective: PrivateRoleObjectiveSnapshot
    | PrivateEvilRoleObjectiveSnapshot,
): boolean {
  return objective.source.beliefQuality === 'constraints-only'
}

export interface LegacyRoleAdapterConfiguration {
  readonly goodObjectiveAllDecisionKinds: boolean
}

export type LegacyRolePolicyFamily =
  | 'good-role'
  | 'evil-role'
  | 'morgana-role'
  | 'evil-quest-card'

export interface LegacyRoleAdapterTraceBinding {
  readonly token: ComponentToken<unknown>
  readonly policyFamily: LegacyRolePolicyFamily
  payload(trace: DecisionTrace): unknown
  declaredVersion(trace: DecisionTrace): string | undefined
  policyStages(trace: DecisionTrace): readonly string[]
  suppressionReason?(trace: DecisionTrace): string | undefined
  legacyProjectionRequired?(
    trace: DecisionTrace,
    view?: PlayerView,
  ): boolean
  ownsLegacyDegradation?: boolean
  expectedResolution?(
    trace: DecisionTrace,
    view?: PlayerView,
  ): 'applicable' | 'inapplicable' | Readonly<{
    status: 'suppressed'
    reasonCode: string
  }> | undefined
}

function scorerActionSelectionSurvived(trace: DecisionTrace): boolean {
  const plannerSelectionAccepted =
    trace.plannerCandidateId !== undefined
    && trace.plannerCandidateId === trace.chosenCandidateId
    && !trace.degradation.some((code) => code.startsWith('planner-'))
  return (
    trace.structuredCandidateId !== undefined
    && trace.chosenCandidateId === trace.structuredCandidateId
    && trace.forcedPolicyResult?.selectedCandidateId === undefined
    && trace.privateEvilQuestCardPolicy?.selectedCard === undefined
    && !plannerSelectionAccepted
  )
}

function scorerStages(
  trace: DecisionTrace,
  consumed: boolean,
): readonly string[] {
  return consumed
    ? scorerActionSelectionSurvived(trace)
      ? ['candidate-score', 'action-selection']
      : ['candidate-score']
    : []
}

function goodRoleStages(trace: DecisionTrace): readonly string[] {
  const scorer = trace.componentVersions?.scorer
  return scorerStages(
    trace,
    (
      scorer === ROLE_OBJECTIVE_SCORER_VERSION
      || scorer === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
    )
    && !!trace.candidateScores?.length
    && trace.candidateScores.every(
      (score) => score.roleObjectiveFeatures !== undefined,
    ),
  )
}

function evilRoleStages(trace: DecisionTrace): readonly string[] {
  const scorer = trace.componentVersions?.scorer
  return scorerStages(
    trace,
    (
      scorer === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      || scorer === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      || scorer === MORGANA_ROLE_SCORER_VERSION
      || scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
    )
    && !!trace.candidateScores?.length
    && trace.candidateScores.every(
      (score) =>
        score.evilRoleObjectiveFeatures !== undefined
        || (
          (
            scorer === MORGANA_ROLE_SCORER_VERSION
            || scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
          )
          && score.morganaRoleObjectiveFeatures !== undefined
        ),
    ),
  )
}

function morganaRoleStages(trace: DecisionTrace): readonly string[] {
  const scorer = trace.componentVersions?.scorer
  return scorerStages(
    trace,
    (
      scorer === MORGANA_ROLE_SCORER_VERSION
      || scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
    )
    && !!trace.candidateScores?.length
    && trace.candidateScores.every(
      (score) => score.morganaRoleObjectiveFeatures !== undefined,
    ),
  )
}

function evilQuestCardStages(trace: DecisionTrace): readonly string[] {
  const selected = trace.privateEvilQuestCardPolicy?.selectedCard
  if (
    selected === undefined
    || trace.action.kind !== 'quest'
    || trace.action.card !== selected
  ) return []
  return ['action-selection']
}

export const LEGACY_ROLE_ADAPTER_TRACE_BINDINGS:
readonly LegacyRoleAdapterTraceBinding[] = Object.freeze([
  Object.freeze({
    token: GOOD_ROLE_OBJECTIVE_COMPONENT,
    policyFamily: 'good-role' as const,
    payload: (trace: DecisionTrace) => trace.privateRoleObjective,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleObjective
        === ROLE_OBJECTIVE_MODEL_VERSION
        ? ROLE_OBJECTIVE_MODEL_VERSION
        : undefined,
    policyStages: goodRoleStages,
  }),
  Object.freeze({
    token: GOOD_ROLE_UTILITY_COMPONENT,
    policyFamily: 'good-role' as const,
    payload: (trace: DecisionTrace) => trace.privateRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleUtility,
    policyStages: goodRoleStages,
  }),
  Object.freeze({
    token: EVIL_ROLE_OBJECTIVE_COMPONENT,
    policyFamily: 'evil-role' as const,
    payload: (trace: DecisionTrace) => trace.privateEvilRoleObjective,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.roleObjective
        === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        ? EVIL_ROLE_OBJECTIVE_MODEL_VERSION
        : undefined,
    policyStages: evilRoleStages,
  }),
  Object.freeze({
    token: EVIL_ROLE_UTILITY_COMPONENT,
    policyFamily: 'evil-role' as const,
    payload: (trace: DecisionTrace) => trace.privateEvilRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.evilRoleUtility,
    policyStages: evilRoleStages,
  }),
  Object.freeze({
    token: MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    policyFamily: 'morgana-role' as const,
    payload: (trace: DecisionTrace) =>
      trace.publicMorganaCounterfeitRead,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.morganaCounterfeitPublicRead,
    policyStages: morganaRoleStages,
    legacyProjectionRequired: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) =>
      view?.role === 'morgana'
      && trace.privateMorganaCounterfeitObjective !== undefined,
    ownsLegacyDegradation: false,
    expectedResolution: (
      trace: DecisionTrace,
      _view?: PlayerView,
    ) =>
      trace.request.kind === 'propose' || trace.request.kind === 'vote'
        ? 'applicable'
        : 'inapplicable',
  }),
  Object.freeze({
    token: MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    policyFamily: 'morgana-role' as const,
    payload: (trace: DecisionTrace) =>
      trace.privateMorganaCounterfeitObjective,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.morganaCounterfeitObjective,
    policyStages: morganaRoleStages,
    expectedResolution: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) => !view
      ? undefined
      : view.role === 'morgana'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
        ? 'applicable'
        : 'inapplicable',
  }),
  Object.freeze({
    token: MORGANA_ROLE_UTILITY_COMPONENT,
    policyFamily: 'morgana-role' as const,
    payload: (trace: DecisionTrace) => trace.privateMorganaRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.morganaRoleUtility,
    policyStages: morganaRoleStages,
    expectedResolution: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) => !view
      ? undefined
      : view.role === 'morgana'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
        ? 'applicable'
        : 'inapplicable',
  }),
  Object.freeze({
    token: MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
    policyFamily: 'morgana-role' as const,
    payload: (trace: DecisionTrace) => trace.privateMorganaRoleUtility,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.morganaRoleUtility,
    policyStages: morganaRoleStages,
    expectedResolution: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) => !view
      ? undefined
      : view.role === 'morgana'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
        ? 'applicable'
        : 'inapplicable',
  }),
  Object.freeze({
    token: EVIL_QUEST_CARD_ROBUST_COMPONENT,
    policyFamily: 'evil-quest-card' as const,
    payload: (trace: DecisionTrace) =>
      trace.privateEvilQuestCardPolicy?.policyVersion
        === EVIL_QUEST_ROBUST_POLICY_VERSION
        ? trace.privateEvilQuestCardPolicy
        : undefined,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.evilQuestCardPolicy
        === EVIL_QUEST_ROBUST_POLICY_VERSION
        ? EVIL_QUEST_ROBUST_POLICY_VERSION
        : undefined,
    policyStages: evilQuestCardStages,
    suppressionReason: (trace: DecisionTrace) =>
      trace.componentVersions?.configuredEvilQuestCardPolicy
        === EVIL_QUEST_ROBUST_POLICY_VERSION
      && trace.privateEvilQuestCardPolicy === undefined
      && trace.componentVersions?.evilQuestCardPolicy === undefined
      && trace.forcedPolicyResult?.applied
        ? 'universal-forced-policy'
        : undefined,
    expectedResolution: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) => {
      if (!view) return undefined
      const applicable =
        trace.request.kind === 'quest'
        && view.alignment === 'evil'
        && view.role !== 'oberon'
      if (!applicable) return 'inapplicable'
      return (
        trace.privateEvilQuestCardPolicy === undefined
        && trace.componentVersions?.evilQuestCardPolicy === undefined
        && trace.forcedPolicyResult?.applied
      )
        ? {
            status: 'suppressed' as const,
            reasonCode: 'universal-forced-policy',
          }
        : 'applicable'
    },
  }),
  Object.freeze({
    token: EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT,
    policyFamily: 'evil-quest-card' as const,
    payload: (trace: DecisionTrace) =>
      trace.privateEvilQuestCardPolicy?.policyVersion
        === EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
        ? trace.privateEvilQuestCardPolicy
        : undefined,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.evilQuestCardPolicy
        === EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
        ? EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
        : undefined,
    policyStages: evilQuestCardStages,
    suppressionReason: (trace: DecisionTrace) =>
      trace.componentVersions?.configuredEvilQuestCardPolicy
        === EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
      && trace.privateEvilQuestCardPolicy === undefined
      && trace.componentVersions?.evilQuestCardPolicy === undefined
      && trace.forcedPolicyResult?.applied
        ? 'universal-forced-policy'
        : undefined,
    expectedResolution: (
      trace: DecisionTrace,
      view?: PlayerView,
    ) => {
      if (!view) return undefined
      const applicable =
        trace.request.kind === 'quest'
        && view.alignment === 'evil'
        && view.role !== 'oberon'
      if (!applicable) return 'inapplicable'
      return (
        trace.privateEvilQuestCardPolicy === undefined
        && trace.componentVersions?.evilQuestCardPolicy === undefined
        && trace.forcedPolicyResult?.applied
      )
        ? {
            status: 'suppressed' as const,
            reasonCode: 'universal-forced-policy',
          }
        : 'applicable'
    },
  }),
])

export function legacyRoleAdapterDefinitions(
  configuration: LegacyRoleAdapterConfiguration,
): readonly DecisionComponentDefinition<any>[] {
  const goodObjective: DecisionComponentDefinition<
    PrivateRoleObjectiveSnapshot
  > = {
    token: GOOD_ROLE_OBJECTIVE_COMPONENT,
    source: 'native',
    dependencies: [],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_ROLE_OBJECTIVE_JSON_BYTES,
    degradationCode: ROLE_OBJECTIVE_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && (context.view.role === 'merlin' || context.view.role === 'percival')
        && (
          configuration.goodObjectiveAllDecisionKinds
          || context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const payload = buildRoleObjectiveSnapshot({
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(GOOD_ROLE_OBJECTIVE_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded = decodeCanonicalPrivateRoleObjectiveSnapshot(payload)
      return decoded
        ? admitted(decoded, exactQuality(decoded))
        : rejected(ROLE_OBJECTIVE_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      return validateAdmittedPrivateRoleObjectiveHostJoin(payload, {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(payload))
        : rejected(ROLE_OBJECTIVE_DEGRADATION)
    },
  }

  const goodUtility: DecisionComponentDefinition<
    PrivateRoleUtilityProjection
  > = {
    token: GOOD_ROLE_UTILITY_COMPONENT,
    source: 'native',
    dependencies: [GOOD_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_ROLE_UTILITY_JSON_BYTES,
    degradationCode: ROLE_UTILITY_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && (context.view.role === 'merlin' || context.view.role === 'percival')
        && (context.request.kind === 'propose' || context.request.kind === 'vote')
    },
    execute(context) {
      const { req, view, observer } = privateObserverContext(context)
      const payload = buildAdmittedRoleUtilityProjection({
        req,
        view,
        objective: context.dependencies.require(GOOD_ROLE_OBJECTIVE_COMPONENT),
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(GOOD_ROLE_UTILITY_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded = decodeCanonicalPrivateRoleUtilityProjection(payload)
      return decoded
        ? admitted(decoded, true)
        : rejected(ROLE_UTILITY_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, observer } = privateObserverContext(host)
      const objective = host.dependencies.require(GOOD_ROLE_OBJECTIVE_COMPONENT)
      return validateAdmittedPrivateRoleUtilityHostJoin(payload, {
        req,
        view,
        objective,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(objective))
        : rejected(ROLE_UTILITY_DEGRADATION)
    },
  }

  const evilObjective: DecisionComponentDefinition<
    PrivateEvilRoleObjectiveSnapshot
  > = {
    token: EVIL_ROLE_OBJECTIVE_COMPONENT,
    source: 'native',
    dependencies: [],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_EVIL_ROLE_OBJECTIVE_JSON_BYTES,
    degradationCode: EVIL_ROLE_OBJECTIVE_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.alignment === 'evil'
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const payload = buildEvilRoleObjectiveSnapshot({
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(EVIL_ROLE_OBJECTIVE_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded = decodeCanonicalPrivateEvilRoleObjectiveSnapshot(payload)
      return decoded
        ? admitted(decoded, exactQuality(decoded))
        : rejected(EVIL_ROLE_OBJECTIVE_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      return validateAdmittedPrivateEvilRoleObjectiveHostJoin(payload, {
        req,
        view,
        identity,
        observer,
        candidates: legalCandidates(req, view),
      })
        ? admitted(payload, exactQuality(payload))
        : rejected(EVIL_ROLE_OBJECTIVE_DEGRADATION)
    },
  }

  const evilUtility: DecisionComponentDefinition<
    PrivateEvilRoleUtilityProjection
  > = {
    token: EVIL_ROLE_UTILITY_COMPONENT,
    source: 'native',
    dependencies: [EVIL_ROLE_OBJECTIVE_COMPONENT],
    requiredHostInputs: [
      PRIVATE_IDENTITY_INPUT,
      PRIVATE_PUBLIC_OBSERVER_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_EVIL_ROLE_UTILITY_JSON_BYTES,
    degradationCode: EVIL_ROLE_UTILITY_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.alignment === 'evil'
        && (context.request.kind === 'propose' || context.request.kind === 'vote')
    },
    execute(context) {
      const { req, view, identity, observer } = privateContext(context)
      const candidates = legalCandidates(req, view)
      const alternativeCandidates = req.kind === 'vote'
        ? hypotheticalProposalCandidates(view)
        : undefined
      const alternativeObjective = alternativeCandidates
        ? buildEvilRoleObjectiveSnapshot({
            req: { ...req, kind: 'propose' },
            view,
            identity,
            observer,
            candidates: alternativeCandidates,
          })
        : undefined
      const payload = buildAdmittedEvilRoleUtilityProjection({
        req,
        view,
        objective: context.dependencies.require(EVIL_ROLE_OBJECTIVE_COMPONENT),
        candidates,
        ...(alternativeObjective ? { alternativeObjective } : {}),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(EVIL_ROLE_UTILITY_COMPONENT, payload),
      }
    },
    validateDetached(payload) {
      const decoded = decodeCanonicalPrivateEvilRoleUtilityProjection(payload)
      return decoded
        ? admitted(decoded, true)
        : rejected(EVIL_ROLE_UTILITY_DEGRADATION)
    },
    admitHost({ payload, host }) {
      const { req, view, identity, observer } = privateContext(host)
      const candidates = legalCandidates(req, view)
      const alternativeCandidates = req.kind === 'vote'
        ? hypotheticalProposalCandidates(view)
        : undefined
      const alternativeObjective = alternativeCandidates
        ? buildEvilRoleObjectiveSnapshot({
            req: { ...req, kind: 'propose' },
            view,
            identity,
            observer,
            candidates: alternativeCandidates,
          })
        : undefined
      const objective = host.dependencies.require(EVIL_ROLE_OBJECTIVE_COMPONENT)
      return validateAdmittedPrivateEvilRoleUtilityHostJoin(payload, {
        req,
        view,
        objective,
        candidates,
        ...(alternativeObjective
          ? { alternativeObjective }
          : {}),
      })
        ? admitted(payload, exactQuality(objective))
        : rejected(EVIL_ROLE_UTILITY_DEGRADATION)
    },
  }

  const morganaPublicRead: DecisionComponentDefinition<
    PublicCounterfeitMerlinReadSnapshot
  > = {
    token: MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    source: 'native',
    dependencies: [],
    requiredHostInputs: [],
    hostRequirements: [],
    maxPayloadBytes: MAX_MORGANA_COUNTERFEIT_JSON_BYTES,
    degradationCode: MORGANA_COUNTERFEIT_DEGRADATION,
    applies(context) {
      return context.privacy === 'public'
        && (
          context.decision.kind === 'propose'
          || context.decision.kind === 'vote'
        )
    },
    execute(context) {
      if (context.privacy !== 'public') {
        throw new Error('public Morgana observer received private context')
      }
      const payload = buildPublicCounterfeitMerlinRead(
        context.publicRecord,
      )
      return {
        status: 'produced',
        envelope: componentEnvelope(
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
          payload,
        ),
      }
    },
    validateDetached(payload) {
      const decoded = decodeCanonicalPublicCounterfeitMerlinRead(payload)
      return decoded
        ? admitted(decoded, true)
        : rejected(MORGANA_COUNTERFEIT_DEGRADATION)
    },
    admitHost({ payload, host }) {
      return host.privacy === 'public'
        && validateAdmittedPublicCounterfeitMerlinReadHostJoin(
          payload,
          host.publicRecord,
        )
        ? admitted(payload, true)
        : rejected(MORGANA_COUNTERFEIT_DEGRADATION)
    },
  }

  const morganaObjective: DecisionComponentDefinition<
    PrivateMorganaCounterfeitObjective
  > = {
    token: MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    source: 'native',
    dependencies: [MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT],
    requiredHostInputs: [
      PRIVATE_BELIEF_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_MORGANA_COUNTERFEIT_JSON_BYTES,
    degradationCode: MORGANA_COUNTERFEIT_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.view.role === 'morgana'
        && (
          context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      if (context.privacy !== 'private') {
        throw new Error('Morgana adapter received public context')
      }
      const payload = buildAdmittedMorganaCounterfeitObjective({
        req: context.request,
        view: context.view,
        belief: context.hostInputs.require(PRIVATE_BELIEF_INPUT),
        publicRead: context.dependencies.require(
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        ),
        candidates: legalCandidates(context.request, context.view),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(
          MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
          payload,
        ),
      }
    },
    validateDetached(payload) {
      const decoded =
        decodeCanonicalPrivateMorganaCounterfeitObjective(payload)
      return decoded
        ? admitted(
            decoded,
            decoded.source.beliefQuality === 'constraints-only',
          )
        : rejected(MORGANA_COUNTERFEIT_DEGRADATION)
    },
    admitHost({ payload, host }) {
      if (host.privacy !== 'private') {
        return rejected(MORGANA_COUNTERFEIT_DEGRADATION)
      }
      const belief = host.hostInputs.require(PRIVATE_BELIEF_INPUT)
      return validateAdmittedPrivateMorganaCounterfeitHostJoin(payload, {
        req: host.request,
        view: host.view,
        belief,
        publicRead: host.dependencies.require(
          MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        ),
        candidates: legalCandidates(host.request, host.view),
      })
        ? admitted(payload, belief.quality === 'constraints-only')
        : rejected(MORGANA_COUNTERFEIT_DEGRADATION)
    },
  }

  const morganaUtility = (
    token: ComponentToken<PrivateMorganaRoleUtilityProjection>,
    selectionMode: MorganaRoleSelectionMode,
  ): DecisionComponentDefinition<PrivateMorganaRoleUtilityProjection> => ({
    token,
    source: 'native',
    dependencies: [
      EVIL_ROLE_UTILITY_COMPONENT,
      MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
    ],
    requiredHostInputs: [
      PRIVATE_FORCED_POLICY_INPUT,
      PRIVATE_DETERMINISTIC_SEED_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_MORGANA_ROLE_UTILITY_JSON_BYTES,
    degradationCode: MORGANA_ROLE_UTILITY_DEGRADATION,
    deterministicSeedDomain:
      selectionMode === 'seeded-near-equal-vote-within-d2-band'
        ? MORGANA_ROLE_UTILITY_PROJECTION_VERSION
        : undefined,
    applies(context) {
      return context.privacy === 'private'
        && context.view.role === 'morgana'
        && (
          context.request.kind === 'propose'
          || context.request.kind === 'vote'
        )
    },
    execute(context) {
      if (context.privacy !== 'private') {
        throw new Error('Morgana utility adapter received public context')
      }
      const payload = buildAdmittedMorganaRoleUtilityProjection({
        req: context.request,
        view: context.view,
        candidates: legalCandidates(context.request, context.view),
        forced: context.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT),
        counterfeitObjective: context.dependencies.require(
          MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
        ),
        evilRoleUtility: context.dependencies.require(
          EVIL_ROLE_UTILITY_COMPONENT,
        ),
        selectionMode,
        deterministicSeed: context.hostInputs.require(
          PRIVATE_DETERMINISTIC_SEED_INPUT,
        ),
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(token, payload),
      }
    },
    validateDetached(payload) {
      const decoded =
        decodeCanonicalPrivateMorganaRoleUtilityProjection(payload)
      return decoded
        ? admitted(
            decoded,
            decoded.counterfeitObjective.source.beliefQuality
              === 'constraints-only',
          )
        : rejected(MORGANA_ROLE_UTILITY_DEGRADATION)
    },
    admitHost({ payload, host }) {
      if (host.privacy !== 'private') {
        return rejected(MORGANA_ROLE_UTILITY_DEGRADATION)
      }
      const objective = host.dependencies.require(
        MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
      )
      return validateAdmittedPrivateMorganaRoleUtilityHostJoin(payload, {
        req: host.request,
        view: host.view,
        candidates: legalCandidates(host.request, host.view),
        forced: host.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT),
        counterfeitObjective: objective,
        evilRoleUtility: host.dependencies.require(
          EVIL_ROLE_UTILITY_COMPONENT,
        ),
        selectionMode,
        deterministicSeed: host.hostInputs.require(
          PRIVATE_DETERMINISTIC_SEED_INPUT,
        ),
      })
        ? admitted(
            payload,
            objective.source.beliefQuality === 'constraints-only',
          )
        : rejected(MORGANA_ROLE_UTILITY_DEGRADATION)
    },
  })

  const questCardDefinition = (
    token: ComponentToken<PrivateEvilQuestCardPolicy>,
    mode: EvilQuestCardPolicyMode,
  ): DecisionComponentDefinition<PrivateEvilQuestCardPolicy> => ({
    token,
    source: 'legacy-adapter',
    dependencies: [],
    requiredHostInputs: [
      PRIVATE_SITUATION_INPUT,
      PRIVATE_FORCED_POLICY_INPUT,
    ],
    hostRequirements: [],
    maxPayloadBytes: MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
    degradationCode: EVIL_QUEST_CARD_POLICY_DEGRADATION,
    applies(context) {
      return context.privacy === 'private'
        && context.request.kind === 'quest'
        && context.view.alignment === 'evil'
        && context.view.role !== 'oberon'
    },
    execute(context) {
      if (context.privacy !== 'private') {
        throw new Error('evil quest-card adapter received public context')
      }
      const forced = context.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT)
      if (forced.applied) {
        return {
          status: 'suppressed',
          reasonCode: 'universal-forced-policy',
        }
      }
      const payload = buildPrivateEvilQuestCardPolicy({
        req: context.request,
        view: context.view,
        analysis: context.hostInputs.require(PRIVATE_SITUATION_INPUT),
        mode,
      })
      return {
        status: 'produced',
        envelope: componentEnvelope(token, payload),
      }
    },
    validateDetached(payload) {
      return validatePrivateEvilQuestCardPolicy(payload)
        && payload.mode === mode
        && payload.policyVersion === token.version
        ? {
            admitted: true,
            payload,
            verification: 'exact',
            promotionEligible: payload.promotionEvidenceEligible,
          }
        : rejected(EVIL_QUEST_CARD_POLICY_DEGRADATION)
    },
    admitSuppressed({ reasonCode, host }) {
      return host.privacy === 'private'
        && reasonCode === 'universal-forced-policy'
        && host.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT).applied
    },
    admitHost({ payload, host }) {
      if (host.privacy !== 'private') {
        return rejected(EVIL_QUEST_CARD_POLICY_DEGRADATION)
      }
      const forced = host.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT)
      return (
        !forced.applied
        && validatePrivateEvilQuestCardPolicyHostJoin(payload, {
          req: host.request,
          view: host.view,
          analysis: host.hostInputs.require(PRIVATE_SITUATION_INPUT),
          mode,
        })
      )
        ? {
            admitted: true,
            payload,
            verification: 'exact',
            promotionEligible: payload.promotionEvidenceEligible,
          }
        : rejected(EVIL_QUEST_CARD_POLICY_DEGRADATION)
    },
  })

  return [
    goodObjective,
    goodUtility,
    evilObjective,
    evilUtility,
    morganaPublicRead,
    morganaObjective,
    morganaUtility(
      MORGANA_ROLE_UTILITY_COMPONENT,
      'top-counterfeit-within-d2-band',
    ),
    morganaUtility(
      MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      'seeded-near-equal-vote-within-d2-band',
    ),
    questCardDefinition(
      EVIL_QUEST_CARD_ROBUST_COMPONENT,
      'robust-heterogeneous',
    ),
    questCardDefinition(
      EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT,
      'visible-exact-quota',
    ),
  ]
}

function root<Value>(
  token: ComponentHostInputToken<Value>,
  validate: (value: unknown) => value is Value,
  maxPayloadBytes = MAX_ROOT_JSON_BYTES,
): ComponentHostInputDefinition<Value> {
  return {
    token,
    maxPayloadBytes,
    validate(value) {
      return validate(value)
        ? { valid: true, value }
        : { valid: false, degradationCode: 'role-adapter-root-invalid' }
    },
  }
}

export const LEGACY_ROLE_ADAPTER_HOST_INPUTS = Object.freeze([
  root(PRIVATE_IDENTITY_INPUT, validatePrivateIdentitySnapshot),
  root(
    PRIVATE_PUBLIC_OBSERVER_INPUT,
    validatePublicObserverSnapshot,
    MAX_ROOT_JSON_BYTES,
  ),
  root(
    PRIVATE_BELIEF_INPUT,
    (value): value is BeliefSnapshot => {
      try {
        projectJointIdentity(value as BeliefSnapshot, {
          roleQueries: [],
          hiddenTeam: true,
        })
        return true
      } catch {
        return false
      }
    },
    MAX_BELIEF_ROOT_JSON_BYTES,
  ),
  root(
    PRIVATE_SITUATION_INPUT,
    (value): value is SituationAnalysis => {
      const analysis = value as SituationAnalysis | undefined
      return !!analysis
        && typeof analysis === 'object'
        && analysis.modelVersion === SITUATION_ANALYSIS_VERSION
        && (analysis.failsRequired === 1 || analysis.failsRequired === 2)
        && typeof analysis.matchPoint?.good === 'boolean'
        && typeof analysis.matchPoint?.evil === 'boolean'
    },
  ),
  root(
    PRIVATE_FORCED_POLICY_INPUT,
    (value): value is ForcedPolicyResult => {
      const forced = value as ForcedPolicyResult | undefined
      return !!forced
        && typeof forced === 'object'
        && forced.version === FORCED_POLICY_VERSION
        && typeof forced.applied === 'boolean'
        && Array.isArray(forced.reasonCodes)
        && Array.isArray(forced.allowedCandidateIds)
        && forced.reasonCodes.every((code) => typeof code === 'string')
        && forced.allowedCandidateIds.every(
          (candidate) => typeof candidate === 'string',
        )
        && (
          forced.selectedCandidateId === undefined
          || typeof forced.selectedCandidateId === 'string'
        )
    },
  ),
  root(
    PRIVATE_DETERMINISTIC_SEED_INPUT,
    (value): value is string =>
      typeof value === 'string'
      && value.trim().length > 0
      && Buffer.byteLength(value, 'utf8') <= 4_096,
    4_096,
  ),
])

/**
 * Reconstruct only host roots that an admission caller can derive
 * independently from the canonical request/view boundary.
 *
 * Exact joint belief and identity are intentionally unavailable for weighted
 * traces because their complete weighted world list is not transported.
 * Their component entries therefore remain structural and nonpromotable.
 * Public observation, universal rules, and deterministic seed do not share
 * that limitation.
 */
export function reconstructLegacyRoleAdapterHostInputs(input: {
  readonly trace: DecisionTrace
  readonly plan: DecisionComponentPlan
  readonly req: DecisionRequest
  readonly view: PlayerView
  readonly deterministicSeed: string
  /**
   * Optional full registry for native components that reuse the canonical
   * roots. The legacy default preserves standalone adapter callers.
   */
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
  const registry = suppliedRegistry ?? createLegacyRoleAdapterRegistry({
    goodObjectiveAllDecisionKinds: true,
  })
  const required = new Set(
    plan.configured.flatMap((ref) =>
      registry.definition(ref)?.requiredHostInputs.map(
        (root) => `${root.id}@${root.version}`,
      ) ?? []),
  )
  const bindings: ComponentHostInputBinding<unknown>[] = []
  const bind = <Value>(
    token: ComponentHostInputToken<Value>,
    value: Value,
  ): void => {
    if (required.has(`${token.id}@${token.version}`)) {
      bindings.push({ input: token, value })
    }
  }

  const exactReconstructable =
    trace.quality === 'constraints-only'
    && trace.beliefModelVersion === EXACT_BELIEF_MODEL_VERSION
    && trace.componentVersions?.belief === EXACT_BELIEF_MODEL_VERSION
    && trace.componentVersions?.factors === 'off'
    && trace.componentVersions?.languageEvidence === 'off'
  let validationBelief: BeliefSnapshot | undefined
  const needsValidationBelief =
    exactReconstructable
    || required.has(
      `${PRIVATE_SITUATION_INPUT.id}@${PRIVATE_SITUATION_INPUT.version}`,
    )
    || required.has(
      `${PRIVATE_FORCED_POLICY_INPUT.id}@${PRIVATE_FORCED_POLICY_INPUT.version}`,
    )
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

  if (
    validationBelief
    && (
      required.has(
        `${PRIVATE_SITUATION_INPUT.id}@${PRIVATE_SITUATION_INPUT.version}`,
      )
      || required.has(
        `${PRIVATE_FORCED_POLICY_INPUT.id}@`
          + PRIVATE_FORCED_POLICY_INPUT.version,
      )
    )
  ) {
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

export function createLegacyRoleAdapterRegistry(
  configuration: LegacyRoleAdapterConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    legacyRoleAdapterDefinitions(configuration),
    { hostInputs: LEGACY_ROLE_ADAPTER_HOST_INPUTS },
  )
}
