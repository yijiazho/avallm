import {
  buildPrivateEvilQuestCardPolicy,
  decodeCanonicalRobustEvilQuestCardPolicy,
  EVIL_QUEST_CARD_POLICY_DEGRADATION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  type PrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicyHostJoin,
} from '../policy/evil-quest-card.ts'
import { roleDecisionRule } from './role-projection.ts'
import {
  PRIVATE_FORCED_POLICY_INPUT,
  PRIVATE_SITUATION_INPUT,
} from './native-score-components.ts'
import type {
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

/**
 * Native, seat-local D3 evidence for the heterogeneous-safe strategic layer.
 * This is the only executable evil quest-card component.
 *
 * It is built on the role-projection decision-rule skeleton: the skeleton owns
 * the narrow-or-throw execution, the decode/host re-derive admission, and the
 * execute-throws vs host-fails-closed asymmetry, so this file states only the
 * role semantics. A universal forced policy suppresses the component at
 * execution and its matching admitSuppressed proof; promotion eligibility is
 * carried in the payload rather than tied to exactness.
 */
export const EVIL_QUEST_CARD_ROBUST_COMPONENT_DEFINITION:
DecisionComponentDefinition<PrivateEvilQuestCardPolicy> =
  roleDecisionRule({
    token: EVIL_QUEST_CARD_ROBUST_COMPONENT,
    degradationCode: EVIL_QUEST_CARD_POLICY_DEGRADATION,
    requiredHostInputs: [
      PRIVATE_SITUATION_INPUT,
      PRIVATE_FORCED_POLICY_INPUT,
    ],
    maxPayloadBytes: MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
    applies: (context) =>
      context.request.kind === 'quest'
      && context.view.alignment === 'evil'
      && context.view.role !== 'oberon',
    join: (context) => ({
      req: context.request,
      view: context.view,
      analysis: context.hostInputs.require(PRIVATE_SITUATION_INPUT),
      forcedApplied:
        context.hostInputs.require(PRIVATE_FORCED_POLICY_INPUT).applied,
    }),
    suppress: (input) =>
      input.forcedApplied ? 'universal-forced-policy' : undefined,
    build: (input) =>
      buildPrivateEvilQuestCardPolicy({
        req: input.req,
        view: input.view,
        analysis: input.analysis,
      }),
    decode: (payload) => decodeCanonicalRobustEvilQuestCardPolicy(payload),
    hostJoin: (payload, input) =>
      validatePrivateEvilQuestCardPolicyHostJoin(payload, {
        req: input.req,
        view: input.view,
        analysis: input.analysis,
      }),
    detachedPromotion: (payload) => payload.promotionEvidenceEligible,
    hostPromotion: (payload) => payload.promotionEvidenceEligible,
  })
