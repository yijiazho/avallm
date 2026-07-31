import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../components/robust-evil-quest-card.ts'
import {
  candidateIdForDecision,
} from '../candidate/candidates.ts'
import {
  decisionLayerToken,
  type DecisionLayerDefinition,
} from '../policy/decision-layer/types.ts'
import type {
  EvilQuestCardPolicyReason,
} from '../policy/evil-quest-card.ts'

export const ROBUST_EVIL_QUEST_CARD_DECISION_LAYER =
  decisionLayerToken(
    'evil-quest-card-robust-strategic',
    'evil-robust-heterogeneous-quest-decision-v1',
  )

export const ROBUST_EVIL_QUEST_CARD_DECISION_DEGRADATION =
  'evil-robust-quest-decision-failed'

const REASON_CODES = {
  INSUFFICIENT_VISIBLE_QUOTA_SUCCESS:
    'EVIL_INSUFFICIENT_VISIBLE_QUOTA_HOLD',
  ROBUST_DECISIVE_FAIL:
    'EVIL_ROBUST_DECISIVE_FAIL',
  ROBUST_LOCAL_SLOW_PLAY_FAIL:
    'EVIL_ROBUST_LOCAL_SLOW_PLAY_FAIL',
  ROBUST_LOCAL_SLOW_PLAY_HOLD:
    'EVIL_ROBUST_LOCAL_SLOW_PLAY_HOLD',
} satisfies Partial<Record<EvilQuestCardPolicyReason, string>>

/**
 * The mixed-table-safe D3 authority. It consumes only the admitted private
 * seat-local component and selects one already-legal quest card.
 */
export const ROBUST_EVIL_QUEST_CARD_DECISION_LAYER_DEFINITION:
DecisionLayerDefinition = {
  token: ROBUST_EVIL_QUEST_CARD_DECISION_LAYER,
  requiredComponents: [EVIL_QUEST_CARD_ROBUST_COMPONENT],
  degradationCode: ROBUST_EVIL_QUEST_CARD_DECISION_DEGRADATION,
  applies(context) {
    return context.request.kind === 'quest'
      && context.view.alignment === 'evil'
      && context.view.role !== 'oberon'
  },
  execute(context) {
    const policy = context.components.require(
      EVIL_QUEST_CARD_ROBUST_COMPONENT,
    )
    const reason = REASON_CODES[
      policy.reason as keyof typeof REASON_CODES
    ]
    if (
      policy.mode !== 'robust-heterogeneous'
      || policy.policyVersion !== EVIL_QUEST_CARD_ROBUST_COMPONENT.version
      || policy.coordinationAssumption !== 'none'
      || policy.populationAssumption !== 'heterogeneous-independent'
      || !policy.mixedTableSafe
      || !policy.promotionEvidenceEligible
      || !policy.applicable
      || !policy.selectedCard
      || !reason
    ) return { status: 'degraded' }
    const selectedCandidateId = candidateIdForDecision({
      kind: 'quest',
      card: policy.selectedCard,
    })
    if (!context.prior.survivorCandidateIds.includes(selectedCandidateId)) {
      return { status: 'degraded' }
    }
    return {
      status: 'applied',
      surface: context.surface.create({
        survivorCandidateIds: [selectedCandidateId],
        selectedCandidateId,
        reasonCodes: [reason],
      }),
    }
  },
}
