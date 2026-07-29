import {
  legacyRoleAdapterDefinitions,
} from './legacy-role-adapters.ts'
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
 * The composed agent's production registry. Compatibility adapters and native
 * components share one dependency graph, admission kernel, and generic trace
 * surface; requesting nothing native preserves the legacy resolved plan.
 */
export function createProductionComponentRegistry(
  configuration: NativeScoreComponentConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    [
      ...nativeScoreComponentDefinitions(configuration),
      ...legacyRoleAdapterDefinitions(),
      ...nativeRoleComponentDefinitions(),
    ],
    { hostInputs: SCORE_COMPONENT_HOST_INPUTS },
  )
}
