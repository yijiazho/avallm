import {
  createDecisionLayerRegistry,
  type DecisionLayerRegistry,
} from '../policy/decision-layer/registry.ts'

/**
 * Production strategic-layer registry. R3B2A intentionally leaves this empty
 * while establishing the sole runtime and replay seam; R3B2B registers robust
 * heterogeneous quest policy here.
 */
export function createConfiguredDecisionLayerRegistry():
DecisionLayerRegistry {
  return createDecisionLayerRegistry([])
}
