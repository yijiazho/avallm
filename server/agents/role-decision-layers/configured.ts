import {
  createDecisionLayerRegistry,
  type DecisionLayerRegistry,
} from '../policy/decision-layer/registry.ts'
import {
  ROBUST_EVIL_QUEST_CARD_DECISION_LAYER_DEFINITION,
} from './robust-evil-quest-card.ts'

/**
 * Production strategic-layer registry. Construction still chooses the exact
 * ordered subset, so registering a layer does not implicitly enable it.
 */
export function createConfiguredDecisionLayerRegistry():
DecisionLayerRegistry {
  return createDecisionLayerRegistry([
    ROBUST_EVIL_QUEST_CARD_DECISION_LAYER_DEFINITION,
  ])
}
