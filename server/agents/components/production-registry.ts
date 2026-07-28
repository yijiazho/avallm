import {
  LEGACY_ROLE_ADAPTER_HOST_INPUTS,
  legacyRoleAdapterDefinitions,
  type LegacyRoleAdapterConfiguration,
} from './legacy-role-adapters.ts'
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
  configuration: LegacyRoleAdapterConfiguration,
): DecisionComponentRegistry {
  return createDecisionComponentRegistry(
    [
      ...legacyRoleAdapterDefinitions(configuration),
      ...nativeRoleComponentDefinitions(),
    ],
    { hostInputs: LEGACY_ROLE_ADAPTER_HOST_INPUTS },
  )
}
