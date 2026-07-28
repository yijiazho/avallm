import {
  brainComponents,
  resolveBrain,
  type BrainSource,
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
import {
  canonicalizeJson,
  denseOwnDataArrayValues,
  exactOwnDataRecord,
} from './canonical-json.ts'

export const RESOLVED_COMPOSED_BRAIN_VERSION =
  'resolved-composed-brain-v1'
export const RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION =
  'resolved-architecture-descriptor-v1'

export interface ResolvedConfiguredPipeline {
  readonly belief: Readonly<{
    readonly model: string
    readonly factors: string
    readonly languageInterpreter: string
    readonly languageFactor: string
  }>
  readonly analysis: Readonly<{
    readonly situation: string
  }>
  readonly candidateGeneration: Readonly<{
    readonly legalCandidates: string
  }>
  readonly forcedPolicy: Readonly<{
    readonly policy: string
  }>
  readonly scoring: Readonly<{
    readonly configuredScorer: string
    /** Declared baseScorer links, in resolution order. */
    readonly configuredBaseChain: readonly string[]
    /** Total hard fallback after an invalid selected scorer output. */
    readonly invalidOutputFallback: string
  }>
  readonly planning: Readonly<{
    /** Stable protocol only. Mutable adapter identity belongs to each run. */
    readonly protocol: string
    readonly decisionPlan: string
  }>
  readonly prompt: Readonly<{
    readonly prompt: string
    readonly renderer: string
  }>
  readonly communication: Readonly<{
    readonly intent: string
    /** Stable protocol only. Mutable adapter identity belongs to each run. */
    readonly voiceProtocol: string
  }>
  readonly planCoherence: Readonly<{
    readonly memory: string
    readonly model: string
    readonly intent: string
  }>
}

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
  readonly configuredPipeline: ResolvedConfiguredPipeline
  /**
   * Temporary, read-only projection of the role-specific configuration that
   * B3 adapters will migrate. It must contain data only, never callbacks.
   */
  readonly compatibility?: Readonly<Record<string, CompatibilityValue>>
  readonly languageEvidenceEnabled?: boolean
  readonly publicObserverConfigured?: boolean
}

/**
 * The sole construction-time metadata owner for one composed agent.
 *
 * This is private agent state. Consumers that cannot receive migration data
 * must use projectPrivateArchitectureDebug rather than serializing it.
 */
export interface ResolvedArchitectureDescriptor {
  readonly version: typeof RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION
  readonly base: BrainSpec
  readonly components: ResolvedComponentGraph
  /** Stable contributions declared by the resolved component graph. */
  readonly componentContributions: Readonly<{
    readonly observerModel:
      | typeof PUBLIC_OBSERVER_MODEL_VERSION
      | 'off'
  }>
  /**
   * Data-only invocation roots required by the configured graph. Values and
   * validator implementations never enter this description.
   */
  readonly requiredHostInputs: readonly ComponentHostInputRef[]
  readonly scoreLayerOrder: readonly ComponentRef[]
  readonly decisionLayerOrder: readonly ComponentRef[]
  readonly configuredPipeline: ResolvedConfiguredPipeline
  readonly migration: Readonly<{
    readonly compatibility: Readonly<Record<string, CompatibilityValue>>
  }>
}

/** @deprecated Use ResolvedArchitectureDescriptor. */
export type ResolvedComposedBrainDescription =
  ResolvedArchitectureDescriptor

export type PrivateArchitectureDebugProjection = Readonly<
  Omit<ResolvedArchitectureDescriptor, 'migration'>
>

export interface PrivateResolvedComposedBrainLegacyProjection {
  readonly version: typeof RESOLVED_COMPOSED_BRAIN_VERSION
  readonly base: BrainSpec
  readonly baseComponentVersions: Readonly<Record<string, string>>
  readonly components: ResolvedComponentGraph
  readonly requiredHostInputs: readonly ComponentHostInputRef[]
  readonly scoreLayerOrder: readonly ComponentRef[]
  readonly decisionLayerOrder: readonly ComponentRef[]
  readonly compatibility: Readonly<Record<string, CompatibilityValue>>
}

export interface ResolvedComposedBrain {
  /** Data-only construction description for later trace/manifest projection. */
  readonly description: ResolvedArchitectureDescriptor
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

function freezeConfiguredPipeline(
  source: ResolvedConfiguredPipeline,
): ResolvedConfiguredPipeline {
  const canonical = canonicalizeJson(source, 16_384)
  if (!canonical.ok) {
    throw new Error(
      `configuredPipeline is not safe JSON: ${canonical.failureCode}`,
    )
  }
  const root = exactOwnDataRecord(canonical.payload, [
    'belief',
    'analysis',
    'candidateGeneration',
    'forcedPolicy',
    'scoring',
    'planning',
    'prompt',
    'communication',
    'planCoherence',
  ])
  const belief = exactOwnDataRecord(root?.belief, [
    'model',
    'factors',
    'languageInterpreter',
    'languageFactor',
  ])
  const analysis = exactOwnDataRecord(root?.analysis, ['situation'])
  const candidateGeneration = exactOwnDataRecord(
    root?.candidateGeneration,
    ['legalCandidates'],
  )
  const forcedPolicy = exactOwnDataRecord(root?.forcedPolicy, ['policy'])
  const scoring = exactOwnDataRecord(root?.scoring, [
    'configuredScorer',
    'configuredBaseChain',
    'invalidOutputFallback',
  ])
  const planning = exactOwnDataRecord(root?.planning, [
    'protocol',
    'decisionPlan',
  ])
  const prompt = exactOwnDataRecord(root?.prompt, ['prompt', 'renderer'])
  const communication = exactOwnDataRecord(root?.communication, [
    'intent',
    'voiceProtocol',
  ])
  const planCoherence = exactOwnDataRecord(root?.planCoherence, [
    'memory',
    'model',
    'intent',
  ])
  if (
    !root
    || !belief
    || !analysis
    || !candidateGeneration
    || !forcedPolicy
    || !scoring
    || !planning
    || !prompt
    || !communication
    || !planCoherence
  ) {
    throw new Error('configuredPipeline has an invalid shape')
  }
  const versionPattern = /^[a-z0-9][a-z0-9._+-]{0,99}$/
  const version = (
    record: Readonly<Record<string, unknown>>,
    key: string,
  ): string => {
    const value = record[key]
    if (typeof value !== 'string' || !versionPattern.test(value)) {
      throw new Error(
        `configuredPipeline.${key} must be a valid version string`,
      )
    }
    return value
  }
  const configuredBaseValues = denseOwnDataArrayValues(
    scoring.configuredBaseChain,
    64,
  )
  if (!configuredBaseValues) {
    throw new Error(
      'configuredPipeline.configuredBaseChain must be a dense array',
    )
  }
  const configuredBaseChain = configuredBaseValues.map((value, index) => {
    if (typeof value !== 'string' || !versionPattern.test(value)) {
      throw new Error(
        `configuredPipeline.configuredBaseChain[${index}]`
        + ' must be a valid version string',
      )
    }
    return value
  })
  return Object.freeze({
    belief: Object.freeze({
      model: version(belief, 'model'),
      factors: version(belief, 'factors'),
      languageInterpreter: version(belief, 'languageInterpreter'),
      languageFactor: version(belief, 'languageFactor'),
    }),
    analysis: Object.freeze({
      situation: version(analysis, 'situation'),
    }),
    candidateGeneration: Object.freeze({
      legalCandidates: version(
        candidateGeneration,
        'legalCandidates',
      ),
    }),
    forcedPolicy: Object.freeze({
      policy: version(forcedPolicy, 'policy'),
    }),
    scoring: Object.freeze({
      configuredScorer: version(scoring, 'configuredScorer'),
      configuredBaseChain: Object.freeze(configuredBaseChain),
      invalidOutputFallback: version(scoring, 'invalidOutputFallback'),
    }),
    planning: Object.freeze({
      protocol: version(planning, 'protocol'),
      decisionPlan: version(planning, 'decisionPlan'),
    }),
    prompt: Object.freeze({
      prompt: version(prompt, 'prompt'),
      renderer: version(prompt, 'renderer'),
    }),
    communication: Object.freeze({
      intent: version(communication, 'intent'),
      voiceProtocol: version(communication, 'voiceProtocol'),
    }),
    planCoherence: Object.freeze({
      memory: version(planCoherence, 'memory'),
      model: version(planCoherence, 'model'),
      intent: version(planCoherence, 'intent'),
    }),
  })
}

/**
 * Private, data-only construction metadata for trusted diagnostics.
 * Migration-only compatibility configuration is deliberately absent, but
 * the component graph and host-input roots remain seat-private metadata.
 */
export function projectPrivateArchitectureDebug(
  descriptor: ResolvedArchitectureDescriptor,
): PrivateArchitectureDebugProjection {
  return Object.freeze({
    version: descriptor.version,
    base: descriptor.base,
    components: descriptor.components,
    componentContributions: descriptor.componentContributions,
    requiredHostInputs: descriptor.requiredHostInputs,
    scoreLayerOrder: descriptor.scoreLayerOrder,
    decisionLayerOrder: descriptor.decisionLayerOrder,
    configuredPipeline: descriptor.configuredPipeline,
  })
}

/** Private projection for trusted in-process diagnostics and migration code. */
export function projectResolvedArchitecturePrivate(
  descriptor: ResolvedArchitectureDescriptor,
): ResolvedArchitectureDescriptor {
  return descriptor
}

/**
 * Exact private historical construction shape. This is a compatibility edge,
 * not a second metadata source: every field is derived from the descriptor.
 */
export function projectPrivateResolvedComposedBrainLegacy(
  descriptor: ResolvedArchitectureDescriptor,
): PrivateResolvedComposedBrainLegacyProjection {
  const migration = descriptor.migration.compatibility
  const requests = Object.hasOwn(migration, 'requests')
    ? migration.requests as Readonly<Record<string, CompatibilityValue>>
    : undefined
  const remainingMigration = Object.fromEntries(
    Object.entries(migration).filter(([key]) => key !== 'requests'),
  )
  const pipeline = descriptor.configuredPipeline
  const legacyRequests = requests === undefined
    ? undefined
    : {
        ...requests,
        planMemory: pipeline.planCoherence.memory !== 'off',
        coherenceIntent: pipeline.planCoherence.intent,
      }
  const compatibility = freezeCompatibilityValue({
    ...remainingMigration,
    beliefModel: Object.freeze({
      version: pipeline.belief.model,
      factorsVersion: pipeline.belief.factors,
    }),
    languageInterpreterVersion: pipeline.belief.languageInterpreter,
    languageFactorVersion: pipeline.belief.languageFactor,
    scorerVersions: Object.freeze([
      pipeline.scoring.configuredScorer,
      ...pipeline.scoring.configuredBaseChain,
    ]),
    ...(legacyRequests === undefined ? {} : { requests: legacyRequests }),
  }, 'legacyCompatibility') as Readonly<
    Record<string, CompatibilityValue>
  >
  return Object.freeze({
    version: RESOLVED_COMPOSED_BRAIN_VERSION,
    base: descriptor.base,
    baseComponentVersions: Object.freeze(brainComponents(descriptor.base)),
    components: descriptor.components,
    requiredHostInputs: descriptor.requiredHostInputs,
    scoreLayerOrder: descriptor.scoreLayerOrder,
    decisionLayerOrder: descriptor.decisionLayerOrder,
    compatibility,
  })
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
    : requiredObserverModels[0] === PUBLIC_OBSERVER_MODEL_VERSION
      ? PUBLIC_OBSERVER_MODEL_VERSION
      : undefined
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
  const compatibility = freezeCompatibilityValue(
    config.compatibility ?? {},
    'compatibility',
  ) as Readonly<Record<string, CompatibilityValue>>
  const reservedCompatibilityKeys = [
    'beliefModel',
    'languageInterpreterVersion',
    'languageFactorVersion',
    'scorerVersions',
  ]
  for (const key of reservedCompatibilityKeys) {
    if (Object.hasOwn(compatibility, key)) {
      throw new Error(
        `compatibility.${key} duplicates configuredPipeline`,
      )
    }
  }
  const migrationRequests = compatibility.requests
  if (migrationRequests !== undefined) {
    if (
      !migrationRequests
      || typeof migrationRequests !== 'object'
      || Array.isArray(migrationRequests)
    ) {
      throw new Error('compatibility.requests must be a plain object')
    }
    for (const key of ['planMemory', 'coherenceIntent']) {
      if (Object.hasOwn(migrationRequests, key)) {
        throw new Error(
          `compatibility.requests.${key} duplicates configuredPipeline`,
        )
      }
    }
  }
  const description: ResolvedArchitectureDescriptor = Object.freeze({
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
    migration: Object.freeze({ compatibility }),
  })
  return Object.freeze({
    description,
    configuredDefinitions,
    eligibleDefinitions,
    hostInputDefinitions,
  })
}
