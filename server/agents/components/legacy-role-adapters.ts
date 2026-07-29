import type { PlayerView } from '../../engine/types.ts'
import {
  buildPrivateEvilQuestCardPolicy,
  EVIL_QUEST_CARD_POLICY_DEGRADATION,
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  type EvilQuestCardPolicyMode,
  type PrivateEvilQuestCardPolicy,
  decodeCanonicalRobustEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicyHostJoin,
} from '../policy/evil-quest-card.ts'
import { componentEnvelope } from './kernel.ts'
import {
  createDecisionComponentRegistry,
  type DecisionComponentRegistry,
} from './registry.ts'
import type {
  ComponentAdmissionResult,
  ComponentToken,
  DecisionComponentDefinition,
} from './types.ts'
import type { DecisionTrace } from '../trace.ts'
import {
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_SITUATION_INPUT,
  SCORE_COMPONENT_HOST_INPUTS,
  type NativeScoreComponentConfiguration,
} from './native-score-components.ts'

export {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
  PRIVATE_BELIEF_INPUT,
  PRIVATE_DETERMINISTIC_SEED_INPUT,
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
  PRIVATE_SITUATION_INPUT,
  SCORE_COMPONENT_HOST_INPUTS as LEGACY_ROLE_ADAPTER_HOST_INPUTS,
} from './native-score-components.ts'

export interface LegacyRoleAdapterConfiguration
  extends NativeScoreComponentConfiguration {}

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

export interface LegacyRoleAdapterTraceBinding {
  readonly token: ComponentToken<unknown>
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

function evilQuestCardStages(trace: DecisionTrace): readonly string[] {
  const selected = trace.privateEvilQuestCardPolicy?.selectedCard
  return selected !== undefined
    && trace.action.kind === 'quest'
    && trace.action.card === selected
    ? ['action-selection']
    : []
}

function d3Binding(
  token: ComponentToken<PrivateEvilQuestCardPolicy>,
): LegacyRoleAdapterTraceBinding {
  return Object.freeze({
    token,
    payload: (trace: DecisionTrace) =>
      trace.privateEvilQuestCardPolicy?.policyVersion === token.version
        ? trace.privateEvilQuestCardPolicy
        : undefined,
    declaredVersion: (trace: DecisionTrace) =>
      trace.componentVersions?.evilQuestCardPolicy === token.version
        ? token.version
        : undefined,
    policyStages: evilQuestCardStages,
    suppressionReason: (trace: DecisionTrace) =>
      trace.componentVersions?.configuredEvilQuestCardPolicy === token.version
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
      const applicable = trace.request.kind === 'quest'
        && view.alignment === 'evil'
        && view.role !== 'oberon'
      if (!applicable) return 'inapplicable'
      return trace.privateEvilQuestCardPolicy === undefined
        && trace.componentVersions?.evilQuestCardPolicy === undefined
        && trace.forcedPolicyResult?.applied
        ? {
            status: 'suppressed' as const,
            reasonCode: 'universal-forced-policy',
          }
        : 'applicable'
    },
  })
}

export const LEGACY_ROLE_ADAPTER_TRACE_BINDINGS:
readonly LegacyRoleAdapterTraceBinding[] = Object.freeze([
  d3Binding(EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT),
])

function rejected(
  degradationCode: string,
): ComponentAdmissionResult<PrivateEvilQuestCardPolicy> {
  return { admitted: false, degradationCode }
}

function questCardDefinition(
  token: ComponentToken<PrivateEvilQuestCardPolicy>,
  mode: EvilQuestCardPolicyMode,
): DecisionComponentDefinition<PrivateEvilQuestCardPolicy> {
  return {
    token,
    source: mode === 'robust-heterogeneous'
      ? 'native'
      : 'legacy-adapter',
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
      return {
        status: 'produced',
        envelope: componentEnvelope(token, buildPrivateEvilQuestCardPolicy({
          req: context.request,
          view: context.view,
          analysis: context.hostInputs.require(PRIVATE_SITUATION_INPUT),
          mode,
        })),
      }
    },
    validateDetached(payload) {
      const decoded = mode === 'robust-heterogeneous'
        ? decodeCanonicalRobustEvilQuestCardPolicy(payload)
        : validatePrivateEvilQuestCardPolicy(payload)
          ? payload
          : undefined
      return decoded
        && decoded.mode === mode
        && decoded.policyVersion === token.version
        ? {
            admitted: true,
            payload: decoded,
            verification: 'exact',
            promotionEligible: decoded.promotionEvidenceEligible,
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
      return !forced.applied
        && validatePrivateEvilQuestCardPolicyHostJoin(payload, {
          req: host.request,
          view: host.view,
          analysis: host.hostInputs.require(PRIVATE_SITUATION_INPUT),
          mode,
        })
        ? {
            admitted: true,
            payload,
            verification: 'exact',
            promotionEligible: payload.promotionEvidenceEligible,
          }
        : rejected(EVIL_QUEST_CARD_POLICY_DEGRADATION)
    },
  }
}

export function legacyRoleAdapterDefinitions():
readonly DecisionComponentDefinition<any>[] {
  return Object.freeze([
    questCardDefinition(
      EVIL_QUEST_CARD_ROBUST_COMPONENT,
      'robust-heterogeneous',
    ),
    questCardDefinition(
      EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT,
      'visible-exact-quota',
    ),
  ])
}

export function createLegacyRoleAdapterRegistry(
  configuration: LegacyRoleAdapterConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    legacyRoleAdapterDefinitions(),
    { hostInputs: SCORE_COMPONENT_HOST_INPUTS },
  )
}
