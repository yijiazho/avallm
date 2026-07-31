import {
  EVIL_QUEST_CARD_ROBUST_COMPONENT_DEFINITION,
} from './robust-evil-quest-card.ts'
import {
  SCORE_COMPONENT_HOST_INPUTS,
  nativeScoreComponentDefinitions,
  type NativeScoreComponentConfiguration,
} from './native-score-components.ts'
import { nativeRoleComponentDefinitions } from './native-role-components.ts'
import {
  createDecisionComponentRegistry,
  type DecisionComponentRegistry,
} from './registry.ts'

/**
 * The composed agent's production component registry: the native score
 * components, the robust evil-quest-card decision rule, and the native role
 * components, composed into one dependency graph with the score host inputs.
 */
export function createProductionComponentRegistry(
  configuration: NativeScoreComponentConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    [
      ...nativeScoreComponentDefinitions(configuration),
      EVIL_QUEST_CARD_ROBUST_COMPONENT_DEFINITION,
      ...nativeRoleComponentDefinitions(),
    ],
    { hostInputs: SCORE_COMPONENT_HOST_INPUTS },
  )
}
