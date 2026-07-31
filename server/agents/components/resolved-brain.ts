import {
  resolveBrain,
  type BrainSource,
} from '../brain.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from '../belief/language-factor.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../analysis/observer-types.ts'
import type {
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentRef,
  ComponentToken,
  DecisionComponentDefinition,
  HostCapability,
} from './types.ts'
import type { DecisionComponentRegistry } from './registry.ts'
import {
  EMPTY_SCORE_LAYER_REGISTRY,
  type ScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import type {
  ScoreLayerRef,
  ResolvedScoreLayerChain,
} from '../policy/score-layer/types.ts'
import {
  EMPTY_DECISION_LAYER_REGISTRY,
  type DecisionLayerRegistry,
} from '../policy/decision-layer/registry.ts'
import type {
  DecisionLayerRef,
  ResolvedDecisionLayerOrder,
} from '../policy/decision-layer/types.ts'
import {
  RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
  admitResolvedArchitectureIdentity,
  freezeConfiguredPipeline,
  freezeHostInputRef,
  freezeRef,
} from './architecture-identity.ts'
import type {
  ResolvedArchitectureDescriptor,
  ResolvedConfiguredPipeline,
} from './architecture-identity.ts'

// The identity data model and its codec live in architecture-identity.ts; they
// are re-exported here because callers have always read them from this module.
export {
  RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
  MAX_RESOLVED_ARCHITECTURE_IDENTITY_JSON_BYTES,
  admitResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
  resolvedArchitectureIdentityVersions,
  revalidatedArchitectureIdentity,
  trustedArchitectureIdentityDebug,
} from './architecture-identity.ts'
export type {
  ResolvedArchitectureDescriptor,
  ResolvedArchitectureIdentity,
  ResolvedConfiguredPipeline,
} from './architecture-identity.ts'

export interface ComposedBrainConfig {
  readonly requestedComponents?: readonly ComponentRef[]
  readonly hostCapabilities?: readonly HostCapability[]
  /**
   * The terminal is the whole stack: the registry derives the only valid
   * predecessor-first chain from it, and `description.scoreLayerOrder` reports
   * what it derived. A brain with no terminal has no stack, so there is no
   * separate declared order to hold one without the other.
   */
  readonly scoreLayerTerminal?: ScoreLayerRef
  readonly decisionLayerOrder?: readonly DecisionLayerRef[]
  readonly configuredPipeline: ResolvedConfiguredPipeline
  readonly languageEvidenceEnabled?: boolean
  readonly publicObserverConfigured?: boolean
}

export interface ResolvedComposedBrain {
  /** Data-only construction description for later trace/manifest projection. */
  readonly description: ResolvedArchitectureDescriptor
  /** Frozen implementations in dependency-first order for the B2 kernel. */
  readonly configuredDefinitions:
    readonly DecisionComponentDefinition<any>[]
  /**
   * Canonical built-in chain. Null is reserved for lower-level construction
   * without a configured native chain; createComposedAgent supplies custom
   * scorers with the canonical native fallback.
   */
  readonly scoreLayerChain: ResolvedScoreLayerChain | null
  /** Construction-resolved ordered strategic layers. */
  readonly decisionLayerOrder: ResolvedDecisionLayerOrder
  /** Construction-eligible subset of configuredDefinitions. */
  readonly eligibleDefinitions:
    readonly DecisionComponentDefinition<any>[]
  /** Frozen validators for required invocation roots, never their values. */
  readonly hostInputDefinitions:
    readonly ComponentHostInputDefinition<any>[]
}

/**
 * A score or decision layer paired with the components it declares. Both layer
 * families expose the same two fields, so the requirement checks below iterate
 * either one through this shape.
 */
interface LayerRequirementSource {
  readonly token: { readonly id: string; readonly version: string }
  readonly requiredComponents: readonly ComponentToken[]
}

/** The one kind/privacy substitution check shared by every requirement pass. */
function assertLayerComponentTag(
  layer: LayerRequirementSource,
  required: ComponentToken,
  actual: ComponentToken,
  family: string,
): void {
  if (actual.kind !== required.kind || actual.privacy !== required.privacy) {
    throw new Error(
      `${family} layer ${layer.token.id}@${layer.token.version} substitutes `
        + `component tag ${required.id}@${required.version}`,
    )
  }
}

/**
 * Fold each layer's required components into the request set, validating that
 * the registry has each one at the declared tag. New requirements are appended
 * to uniqueRequests in first-seen order.
 */
function collectLayerRequirements(
  layers: readonly LayerRequirementSource[],
  registry: DecisionComponentRegistry,
  family: string,
  seen: Set<string>,
  uniqueRequests: ComponentRef[],
): void {
  for (const layer of layers) {
    for (const required of layer.requiredComponents) {
      const key = `${required.id}@${required.version}`
      const registered = registry.definition(required)
      if (!registered) {
        throw new Error(
          `${family} layer ${layer.token.id}@${layer.token.version} requires `
            + `missing registry component ${key}`,
        )
      }
      assertLayerComponentTag(layer, required, registered.token, family)
      if (!seen.has(key)) {
        seen.add(key)
        uniqueRequests.push(required)
      }
    }
  }
}

/**
 * Assert each layer's required components are construction-eligible. When a
 * configured-definition map is supplied the check additionally requires the
 * component to be configured and to match its declared tag; without it, only
 * eligibility is asserted (the registry pass already proved the tag).
 */
function assertLayerComponentsEligible(
  layers: readonly LayerRequirementSource[],
  family: string,
  eligible: ReadonlySet<string>,
  configuredByKey?: ReadonlyMap<string, DecisionComponentDefinition<any>>,
): void {
  for (const layer of layers) {
    for (const required of layer.requiredComponents) {
      const key = `${required.id}@${required.version}`
      if (configuredByKey) {
        const component = configuredByKey.get(key)
        if (!component) {
          throw new Error(
            `${family} layer ${layer.token.id}@${layer.token.version} requires `
              + `unconfigured component ${key}`,
          )
        }
        if (!eligible.has(key)) {
          throw new Error(
            `${family} layer ${layer.token.id}@${layer.token.version} requires `
              + `construction-ineligible component ${key}`,
          )
        }
        assertLayerComponentTag(layer, required, component.token, family)
      } else if (!eligible.has(key)) {
        throw new Error(
          `${family} layer ${layer.token.id}@${layer.token.version} requires `
            + `construction-ineligible component ${key}`,
        )
      }
    }
  }
}

export function resolveComposedBrain(
  config: ComposedBrainConfig,
  registry: DecisionComponentRegistry,
  scoreLayerRegistry: ScoreLayerRegistry = EMPTY_SCORE_LAYER_REGISTRY,
  decisionLayerRegistry: DecisionLayerRegistry =
    EMPTY_DECISION_LAYER_REGISTRY,
): ResolvedComposedBrain {
  const scoreLayerChain = config.scoreLayerTerminal
    ? scoreLayerRegistry.resolve({ terminal: config.scoreLayerTerminal })
    : undefined
  const resolvedDecisionLayers = decisionLayerRegistry.resolve(
    config.decisionLayerOrder ?? [],
  )
  const uniqueRequests: ComponentRef[] = [
    ...(config.requestedComponents ?? []),
  ]
  const seen = new Set<string>()
  for (const request of uniqueRequests) {
    const key = `${request.id}@${request.version}`
    if (seen.has(key)) {
      throw new Error(
        `requestedComponents contains duplicate component ${key}`,
      )
    }
    seen.add(key)
  }
  collectLayerRequirements(
    resolvedDecisionLayers.definitions,
    registry,
    'decision',
    seen,
    uniqueRequests,
  )
  collectLayerRequirements(
    scoreLayerChain?.definitions ?? [],
    registry,
    'score',
    seen,
    uniqueRequests,
  )
  const components = registry.resolve({
    requested: uniqueRequests,
    hostCapabilities: [...(config.hostCapabilities ?? [])],
  })
  const eligible = new Set(
    components.eligible.map((entry) => `${entry.id}@${entry.version}`),
  )
  const configuredDefinitions = Object.freeze(
    components.configured.map((entry) => {
      const definition = registry.definition(entry)
      if (!definition) {
        throw new Error(
          `resolved component ${entry.id}@${entry.version} disappeared`,
        )
      }
      return definition
    }),
  )
  const eligibleDefinitions = Object.freeze(
    configuredDefinitions.filter((definition) =>
      eligible.has(
        `${definition.token.id}@${definition.token.version}`,
      )),
  )
  const requiredHostInputByKey = new Map<
    string,
    ComponentHostInputRef
  >()
  for (const definition of configuredDefinitions) {
    for (const input of definition.requiredHostInputs) {
      const key = `${input.id}@${input.version}`
      const existing = requiredHostInputByKey.get(key)
      if (existing && existing.privacy !== input.privacy) {
        throw new Error(
          `configured host input ${key} has conflicting privacy`,
        )
      }
      requiredHostInputByKey.set(key, freezeHostInputRef(input))
    }
  }
  const requiredHostInputs = Object.freeze(
    [...requiredHostInputByKey.values()].sort((left, right) =>
      `${left.id}@${left.version}`.localeCompare(
        `${right.id}@${right.version}`,
        'en',
      )),
  )
  const hostInputDefinitions = Object.freeze(
    requiredHostInputs.map((input) => {
      const definition = registry.hostInputDefinition(input)
      if (!definition) {
        throw new Error(
          `resolved host input ${input.id}@${input.version} disappeared`,
        )
      }
      return definition
    }),
  )
  const requiredObserverModels = [
    ...new Set(
      configuredDefinitions.flatMap((definition) =>
        definition.brainContribution?.observerModel
          ? [definition.brainContribution.observerModel]
          : []),
    ),
  ]
  if (requiredObserverModels.length > 1) {
    throw new Error(
      'resolved components declare conflicting observer models',
    )
  }
  if (
    config.publicObserverConfigured
    && requiredObserverModels[0] !== undefined
    && requiredObserverModels[0] !== PUBLIC_OBSERVER_MODEL_VERSION
  ) {
    throw new Error(
      'explicit observer model conflicts with configured component',
    )
  }
  const resolvedObserverModel = config.publicObserverConfigured
    ? PUBLIC_OBSERVER_MODEL_VERSION
    : requiredObserverModels[0] === PUBLIC_OBSERVER_MODEL_VERSION
      ? PUBLIC_OBSERVER_MODEL_VERSION
      : undefined
  const scoreLayerOrder = scoreLayerChain?.order ?? Object.freeze([])
  if (scoreLayerChain) {
    const configuredByKey = new Map(configuredDefinitions.map(
      (definition) => [
        `${definition.token.id}@${definition.token.version}`,
        definition,
      ],
    ))
    assertLayerComponentsEligible(
      scoreLayerChain.definitions,
      'score',
      eligible,
      configuredByKey,
    )
  }
  assertLayerComponentsEligible(
    resolvedDecisionLayers.definitions,
    'decision',
    eligible,
  )
  const decisionLayerOrder = Object.freeze(
    resolvedDecisionLayers.order.map(freezeRef),
  )
  const source: BrainSource = {
    type: 'composed',
    languageEvidence: config.languageEvidenceEnabled
      ? LANGUAGE_FACTOR_BUNDLE_VERSION
      : undefined,
    observerModel: resolvedObserverModel,
  }
  if (
    requiredObserverModels[0] !== undefined
    && requiredObserverModels[0] !== PUBLIC_OBSERVER_MODEL_VERSION
  ) {
    throw new Error('resolved component declares an unsupported observer model')
  }
  const base = Object.freeze(resolveBrain(source))
  const identity = admitResolvedArchitectureIdentity({
    version: RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
    base,
    components,
    componentContributions: Object.freeze({
      observerModel:
        requiredObserverModels[0] === PUBLIC_OBSERVER_MODEL_VERSION
          ? PUBLIC_OBSERVER_MODEL_VERSION
          : 'off',
    }),
    requiredHostInputs,
    scoreLayerOrder,
    decisionLayerOrder,
    configuredPipeline: freezeConfiguredPipeline(config.configuredPipeline),
  })
  if (!identity) {
    throw new Error('resolved architecture identity failed semantic admission')
  }
  const description: ResolvedArchitectureDescriptor = identity
  return Object.freeze({
    description,
    configuredDefinitions,
    eligibleDefinitions,
    hostInputDefinitions,
    scoreLayerChain: scoreLayerChain ?? null,
    decisionLayerOrder: resolvedDecisionLayers,
  })
}
