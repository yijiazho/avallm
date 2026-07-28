import {
  brainComponents,
  resolveBrain,
  type BrainSpec,
} from '../brain.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from '../belief/language-factor.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../analysis/observer-types.ts'
import type {
  ComponentHostInputDefinition,
  ComponentHostInputRef,
  ComponentRef,
  DecisionComponentDefinition,
  HostCapability,
  ResolvedComponentGraph,
} from './types.ts'
import type { DecisionComponentRegistry } from './registry.ts'

export const RESOLVED_COMPOSED_BRAIN_VERSION =
  'resolved-composed-brain-v1'

export type CompatibilityScalar =
  | boolean
  | number
  | string
  | null
  | undefined

export type CompatibilityValue =
  | CompatibilityScalar
  | readonly CompatibilityValue[]
  | Readonly<{ [key: string]: CompatibilityValue }>

export interface ComposedBrainConfig {
  readonly requestedComponents?: readonly ComponentRef[]
  readonly hostCapabilities?: readonly HostCapability[]
  readonly scoreLayerOrder?: readonly ComponentRef[]
  readonly decisionLayerOrder?: readonly ComponentRef[]
  /**
   * Temporary, read-only projection of the role-specific configuration that
   * B3 adapters will migrate. It must contain data only, never callbacks.
   */
  readonly compatibility?: Readonly<Record<string, CompatibilityValue>>
  readonly languageEvidenceEnabled?: boolean
  readonly publicObserverConfigured?: boolean
}

export interface ResolvedComposedBrainDescription {
  readonly version: typeof RESOLVED_COMPOSED_BRAIN_VERSION
  readonly base: BrainSpec
  readonly baseComponentVersions: Readonly<Record<string, string>>
  readonly components: ResolvedComponentGraph
  /**
   * Data-only invocation roots required by the configured graph. Values and
   * validator implementations never enter this description.
   */
  readonly requiredHostInputs: readonly ComponentHostInputRef[]
  readonly scoreLayerOrder: readonly ComponentRef[]
  readonly decisionLayerOrder: readonly ComponentRef[]
  readonly compatibility: Readonly<Record<string, CompatibilityValue>>
}

export interface ResolvedComposedBrain {
  /** Data-only construction description for later trace/manifest projection. */
  readonly description: ResolvedComposedBrainDescription
  /** Frozen implementations in dependency-first order for the B2 kernel. */
  readonly configuredDefinitions:
    readonly DecisionComponentDefinition<any>[]
  /** Construction-eligible subset of configuredDefinitions. */
  readonly eligibleDefinitions:
    readonly DecisionComponentDefinition<any>[]
  /** Frozen validators for required invocation roots, never their values. */
  readonly hostInputDefinitions:
    readonly ComponentHostInputDefinition<any>[]
}

function freezeRef(ref: ComponentRef): ComponentRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

function freezeHostInputRef(
  ref: ComponentHostInputRef,
): ComponentHostInputRef {
  return Object.freeze({
    id: ref.id,
    version: ref.version,
    privacy: ref.privacy,
  })
}

function freezeCompatibilityValue(
  value: CompatibilityValue,
  path: string,
): CompatibilityValue {
  if (
    value === undefined
    || value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${path} must not contain a non-finite number`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((entry, index) =>
        freezeCompatibilityValue(entry, `${path}[${index}]`)),
    )
  }
  if (
    typeof value !== 'object'
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(`${path} must contain data-only plain objects`)
  }
  const result: Record<string, CompatibilityValue> = {}
  for (const key of Object.keys(value).sort()) {
    result[key] = freezeCompatibilityValue(
      (value as Readonly<Record<string, CompatibilityValue>>)[key],
      `${path}.${key}`,
    )
  }
  return Object.freeze(result)
}

function freezeLayerOrder(
  label: string,
  source: readonly ComponentRef[] | undefined,
  eligible: ReadonlySet<string>,
): readonly ComponentRef[] {
  const entries = (source ?? []).map(freezeRef)
  const keys = entries.map((entry) => `${entry.id}@${entry.version}`)
  if (new Set(keys).size !== keys.length) {
    throw new Error(`${label} contains a duplicate component`)
  }
  for (let index = 0; index < entries.length; index++) {
    if (!eligible.has(keys[index])) {
      throw new Error(
        `${label} component ${keys[index]} is not construction-time eligible`,
      )
    }
  }
  return Object.freeze(entries)
}

export function resolveComposedBrain(
  config: ComposedBrainConfig,
  registry: DecisionComponentRegistry,
): ResolvedComposedBrain {
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
  for (const request of [
    ...(config.scoreLayerOrder ?? []),
    ...(config.decisionLayerOrder ?? []),
  ]) {
    const key = `${request.id}@${request.version}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueRequests.push(request)
    }
  }
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
    : requiredObserverModels[0]
  const scoreLayerOrder = freezeLayerOrder(
    'scoreLayerOrder',
    config.scoreLayerOrder,
    eligible,
  )
  const decisionLayerOrder = freezeLayerOrder(
    'decisionLayerOrder',
    config.decisionLayerOrder,
    eligible,
  )
  const base = Object.freeze(resolveBrain({
    type: 'composed',
    ...(config.languageEvidenceEnabled
      ? { languageEvidence: LANGUAGE_FACTOR_BUNDLE_VERSION }
      : {}),
    ...(resolvedObserverModel
      ? { observerModel: resolvedObserverModel }
      : {}),
  }))
  const compatibility = freezeCompatibilityValue(
    config.compatibility ?? {},
    'compatibility',
  ) as Readonly<Record<string, CompatibilityValue>>
  const description: ResolvedComposedBrainDescription = Object.freeze({
    version: RESOLVED_COMPOSED_BRAIN_VERSION,
    base,
    baseComponentVersions: Object.freeze(brainComponents(base)),
    components,
    requiredHostInputs,
    scoreLayerOrder,
    decisionLayerOrder,
    compatibility,
  })
  return Object.freeze({
    description,
    configuredDefinitions,
    eligibleDefinitions,
    hostInputDefinitions,
  })
}
