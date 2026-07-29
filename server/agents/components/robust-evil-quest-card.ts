import {
  buildPrivateEvilQuestCardPolicy,
  decodeCanonicalRobustEvilQuestCardPolicy,
  EVIL_QUEST_CARD_POLICY_DEGRADATION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  type PrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicyHostJoin,
} from '../policy/evil-quest-card.ts'
import { componentEnvelope } from './kernel.ts'
import {
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_SITUATION_INPUT,
} from './native-score-components.ts'
import type {
  ComponentAdmissionResult,
  ComponentToken,
  DecisionComponentDefinition,
} from './types.ts'

export const EVIL_QUEST_CARD_ROBUST_COMPONENT:
ComponentToken<PrivateEvilQuestCardPolicy> = Object.freeze({
  id: 'evil-quest-card-robust',
  version: EVIL_QUEST_ROBUST_POLICY_VERSION,
  kind: 'decision-rule',
  privacy: 'private',
})

function rejected():
ComponentAdmissionResult<PrivateEvilQuestCardPolicy> {
  return {
    admitted: false,
    degradationCode: EVIL_QUEST_CARD_POLICY_DEGRADATION,
  }
}

/**
 * Native, seat-local D3 evidence for the heterogeneous-safe strategic layer.
 * This is the only executable evil quest-card component.
 */
export const EVIL_QUEST_CARD_ROBUST_COMPONENT_DEFINITION:
DecisionComponentDefinition<PrivateEvilQuestCardPolicy> = {
  token: EVIL_QUEST_CARD_ROBUST_COMPONENT,
  source: 'native',
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
      throw new Error('evil quest-card component received public context')
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
      envelope: componentEnvelope(
        EVIL_QUEST_CARD_ROBUST_COMPONENT,
        buildPrivateEvilQuestCardPolicy({
          req: context.request,
          view: context.view,
          analysis: context.hostInputs.require(PRIVATE_SITUATION_INPUT),
        }),
      ),
    }
  },
  validateDetached(payload) {
    const decoded = decodeCanonicalRobustEvilQuestCardPolicy(payload)
    return decoded
      ? {
          admitted: true,
          payload: decoded,
          verification: 'exact',
          promotionEligible: decoded.promotionEvidenceEligible,
        }
      : rejected()
  },
  admitSuppressed({ reasonCode, host }) {
    return host.privacy === 'private'
      && reasonCode === 'universal-forced-policy'
      && host.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT).applied
  },
  admitHost({ payload, host }) {
    if (host.privacy !== 'private') return rejected()
    const forced = host.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT)
    return !forced.applied
      && validatePrivateEvilQuestCardPolicyHostJoin(payload, {
        req: host.request,
        view: host.view,
        analysis: host.hostInputs.require(PRIVATE_SITUATION_INPUT),
      })
      ? {
          admitted: true,
          payload,
          verification: 'exact',
          promotionEligible: payload.promotionEvidenceEligible,
        }
      : rejected()
  },
}
