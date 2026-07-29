import type { PlayerView } from '../../engine/types.ts'
import {
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  type PrivateEvilQuestCardPolicy,
} from '../policy/evil-quest-card.ts'
import type { DecisionTrace } from '../trace.ts'
import type { ComponentToken } from './types.ts'

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

/**
 * Read-only identity for traces emitted before R3B3A. It is deliberately
 * private to this historical admission bridge: no production registry can
 * request or execute it.
 */
const HISTORICAL_EXACT_QUOTA_COMPONENT:
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

function historicalExactQuotaBinding():
LegacyRoleAdapterTraceBinding {
  const token = HISTORICAL_EXACT_QUOTA_COMPONENT
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
    policyStages: (trace: DecisionTrace) => {
      const selected = trace.privateEvilQuestCardPolicy?.selectedCard
      return selected !== undefined
        && trace.action.kind === 'quest'
        && trace.action.card === selected
        ? ['action-selection']
        : []
    },
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

/**
 * Historical trace-reader metadata only. R3B3B removes this facade together
 * with the old flat trace projection and evaluation readers.
 */
export const LEGACY_ROLE_ADAPTER_TRACE_BINDINGS:
readonly LegacyRoleAdapterTraceBinding[] = Object.freeze([
  historicalExactQuotaBinding(),
])
