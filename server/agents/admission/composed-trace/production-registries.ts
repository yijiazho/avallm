// The production component, score-layer, and decision-layer registries, plus the
// small readings of them that answer whether a scorer may own a diagnostic and
// whether a native score chain is trusted. Those two answers are wanted by both
// the relation validators and the native score replay, so they live with the
// registries they read rather than in either caller. Put either one in a caller
// and the other caller has to import sideways, which is how this graph would
// acquire its first cycle.

import {
  createProductionComponentRegistry,
} from '../../components/production-registry.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../components/resolved-brain.ts'
import type {
  ComponentToken,
} from '../../components/types.ts'
import {
  createDecisionLayerAdmissionAuthority,
} from '../../policy/decision-layer/admission-replay.ts'
import type {
  ResolvedScoreLayerChain,
} from '../../policy/score-layer/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
} from '../../policy/score.ts'
import {
  createConfiguredDecisionLayerRegistry,
} from '../../role-decision-layers/configured.ts'
import {
  configuredScoreLayerChainForVersion,
  configuredScoreLayerTerminalForVersion,
  createConfiguredScoreLayerRegistry,
} from '../../role-score-layers/configured.ts'

/*
 * The shape the decision-layer authority admits, re-exported here.
 *
 * ARCH011 confines the replay module to this file and to the admission ingress,
 * and a type-only import is still an edge, so a sibling that wants nothing but
 * the shape would have to be added to that rule to get it. Funnelling the type
 * through the module that already constructs the authority keeps the rule as
 * narrow as the single value import that genuinely needs it.
 */
export type {
  AdmittedDecisionLayerTrace,
} from '../../policy/decision-layer/admission-replay.ts'

export const PRODUCTION_COMPONENT_REGISTRY = createProductionComponentRegistry({
  goodObjectiveAllDecisionKinds: true,
})
const PRODUCTION_SCORE_LAYER_REGISTRY =
  createConfiguredScoreLayerRegistry()
export const PRODUCTION_DECISION_LAYER_REGISTRY =
  createConfiguredDecisionLayerRegistry()
export const DECISION_LAYER_ADMISSION =
  createDecisionLayerAdmissionAuthority()

export function componentKey(value: { id: string; version: string }): string {
  return `${value.id}@${value.version}`
}

export const NATIVE_SCORE_COMPONENT_IDS = (() => {
  const requested = new Map<string, ComponentToken>()
  for (const definition of PRODUCTION_SCORE_LAYER_REGISTRY.definitions()) {
    for (const component of definition.requiredComponents) {
      requested.set(componentKey(component), component)
    }
  }
  const configured = requested.size === 0
    ? []
    : PRODUCTION_COMPONENT_REGISTRY.resolve({
        requested: [...requested.values()],
      }).configured
  return new Set(configured.map((component) => component.id))
})()

export function configuredNativeScorerVersion(version: string): boolean {
  try {
    configuredScoreLayerTerminalForVersion(version)
    return true
  } catch {
    return false
  }
}

export function scorerAdmitsDiagnosticOwner(
  authoritativeVersion: unknown,
  ownerVersion: string,
): boolean {
  if (authoritativeVersion === ownerVersion) return true
  if (typeof authoritativeVersion !== 'string') return false
  try {
    const chain = configuredScoreLayerChainForVersion(authoritativeVersion)
    const terminal = chain.definitions.at(-1)
    return terminal?.kind === 'transform'
      && terminal.diagnosticOwner === 'predecessor'
      && chain.order.slice(0, -1).some(
        (layer) => layer.version === ownerVersion,
      )
  } catch {
    return false
  }
}

export function trustedNativeScoreChain(
  identity: ResolvedArchitectureIdentity,
): ResolvedScoreLayerChain | undefined {
  try {
    const order = identity.scoreLayerOrder
    const terminal = order.at(-1)
    if (!terminal) return undefined
    const chain = createConfiguredScoreLayerRegistry().resolve({
      terminal,
      declaredOrder: order,
    })
    const scoring = identity.configuredPipeline.scoring
    const expectedTerminal = [
      scoring.configuredScorer,
      ...scoring.configuredBaseChain,
    ].find(configuredNativeScorerVersion)
      ?? CANDIDATE_SCORER_VERSION
    if (
      scoring.invalidOutputFallback !== CANDIDATE_SCORER_VERSION
      || terminal.version !== expectedTerminal
    ) return undefined
    return chain
  } catch {
    return undefined
  }
}
