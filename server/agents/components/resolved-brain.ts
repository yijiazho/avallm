import { createHash } from 'node:crypto'
import {
  BRAIN_SPEC_VERSION,
  COMPOSED_POLICY_VERSION,
  PLAN_COMMUNICATION_VERSION,
  brainComponents,
  resolveBrain,
  type AgentExecutionMode,
  type BrainSource,
  type BrainSpec,
} from '../brain.ts'
import {
  combinedLanguageFactorBundleVersion,
  LANGUAGE_FACTOR_BUNDLE_VERSION,
  languageBeliefPipelineVersion,
} from '../belief/language-factor.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../belief/types.ts'
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
  EMPTY_SCORE_LAYER_REGISTRY,
  type ScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import type {
  ScoreLayerRef,
  ResolvedScoreLayerChain,
} from '../policy/score-layer/types.ts'
import {
  canonicalizeJson,
  denseOwnDataArrayValues,
  exactOwnDataRecord,
} from './canonical-json.ts'

export const RESOLVED_COMPOSED_BRAIN_VERSION =
  'resolved-composed-brain-v1'
export const RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION =
  'resolved-architecture-descriptor-v1'
export const MAX_RESOLVED_ARCHITECTURE_IDENTITY_JSON_BYTES = 65_536

const ARCHITECTURE_VERSION_PATTERN =
  /^[a-z0-9][a-z0-9._+-]{0,99}$/
const ARCHITECTURE_MODES: readonly AgentExecutionMode[] = [
  'raw-llm',
  'heuristic',
  'random',
  'external',
  'compatibility',
  'structured-only',
  'hybrid',
]

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
  /** The registry derives the only valid predecessor-first chain. */
  readonly scoreLayerTerminal?: ScoreLayerRef
  /** Optional construction assertion; a nonempty order requires a terminal. */
  readonly scoreLayerOrder?: readonly ScoreLayerRef[]
  readonly decisionLayerOrder?: readonly ComponentRef[]
  readonly configuredPipeline: ResolvedConfiguredPipeline
  readonly executionMode?: Extract<
    AgentExecutionMode,
    'compatibility' | 'structured-only' | 'hybrid'
  >
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
/**
 * Canonical stable identity shared by the in-process descriptor and detached
 * observability projections. It deliberately excludes migration compatibility
 * data, implementations, providers, and invocation-local values.
 */
export interface ResolvedArchitectureIdentity {
  readonly version: typeof RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION
  readonly executionMode: Extract<
    AgentExecutionMode,
    'compatibility' | 'structured-only' | 'hybrid'
  >
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
  readonly scoreLayerOrder: readonly ScoreLayerRef[]
  readonly decisionLayerOrder: readonly ComponentRef[]
  readonly configuredPipeline: ResolvedConfiguredPipeline
}

export interface ResolvedArchitectureDescriptor
extends ResolvedArchitectureIdentity {
  readonly migration: Readonly<{
    readonly compatibility: Readonly<Record<string, CompatibilityValue>>
  }>
}

export function resolvedArchitectureIdentityVersions(
  identity: ResolvedArchitectureIdentity,
): Record<string, string> {
  const pipeline = identity.configuredPipeline
  const languageEnabled =
    pipeline.belief.languageInterpreter !== 'off'
  return {
    mode: identity.executionMode,
    brain: identity.base.version,
    ...(languageEnabled
      ? {
          mechanicalBelief: pipeline.belief.model,
          beliefPipeline: languageBeliefPipelineVersion(
            pipeline.belief.model,
          ),
        }
      : { belief: pipeline.belief.model }),
    factors: languageEnabled
      ? combinedLanguageFactorBundleVersion(pipeline.belief.factors)
      : pipeline.belief.factors,
    languageEvidence: identity.base.languageEvidence,
    languageInterpreter: pipeline.belief.languageInterpreter,
    languageFactor: pipeline.belief.languageFactor,
    observerModel: identity.base.observerModel,
    observerContribution: identity.componentContributions.observerModel,
    policy: identity.base.policy,
    communication: identity.base.communication,
    analysis: pipeline.analysis.situation,
    candidates: pipeline.candidateGeneration.legalCandidates,
    forcedPolicy: pipeline.forcedPolicy.policy,
    scorer: pipeline.scoring.configuredScorer,
    scorerBaseChain: pipeline.scoring.configuredBaseChain.join(',') || 'none',
    scorerFallback: pipeline.scoring.invalidOutputFallback,
    planner: pipeline.planning.protocol,
    decisionPlan: pipeline.planning.decisionPlan,
    prompt: pipeline.prompt.prompt,
    renderer: pipeline.prompt.renderer,
    communicationIntent: pipeline.communication.intent,
    voice: pipeline.communication.voiceProtocol,
    planMemory: pipeline.planCoherence.memory,
    coherence: pipeline.planCoherence.model,
    coherenceIntent: pipeline.planCoherence.intent,
    decisionComponents: identity.components.configured
      .map((entry) => `${entry.id}@${entry.version}`)
      .join(',') || 'none',
  }
}

function resolvedArchitectureIdentityInvariants(
  identity: ResolvedArchitectureIdentity,
): boolean {
  const pipeline = identity.configuredPipeline
  return (
    identity.executionMode === identity.base.mode
    && (
      identity.componentContributions.observerModel === 'off'
      || identity.componentContributions.observerModel
        === identity.base.observerModel
    )
    && (
      identity.base.languageEvidence === 'off'
        ? pipeline.belief.languageInterpreter === 'off'
        : pipeline.belief.languageInterpreter !== 'off'
    )
    && (
      (pipeline.planCoherence.memory === 'off')
      === (pipeline.planCoherence.model === 'off')
    )
  )
}

/** @deprecated Use ResolvedArchitectureDescriptor. */
export type ResolvedComposedBrainDescription =
  ResolvedArchitectureDescriptor

export type PrivateArchitectureDebugProjection = Readonly<
  ResolvedArchitectureIdentity
>

export interface PrivateResolvedComposedBrainLegacyProjection {
  readonly version: typeof RESOLVED_COMPOSED_BRAIN_VERSION
  readonly base: BrainSpec
  readonly baseComponentVersions: Readonly<Record<string, string>>
  readonly components: ResolvedComponentGraph
  readonly requiredHostInputs: readonly ComponentHostInputRef[]
  readonly scoreLayerOrder: readonly ScoreLayerRef[]
  readonly decisionLayerOrder: readonly ComponentRef[]
  readonly compatibility: Readonly<Record<string, CompatibilityValue>>
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

function identityCode(value: unknown): value is string {
  return typeof value === 'string'
    && ARCHITECTURE_VERSION_PATTERN.test(value)
}

function decodeIdentityRefs(
  value: unknown,
  label: string,
): readonly ComponentRef[] {
  const candidates = denseOwnDataArrayValues(value, 256)
  if (!candidates) throw new Error(`${label} must be a dense array`)
  const seen = new Set<string>()
  return Object.freeze(candidates.map((candidate, index) => {
    const record = exactOwnDataRecord(candidate, ['id', 'version'])
    if (!record || !identityCode(record.id) || !identityCode(record.version)) {
      throw new Error(`${label}[${index}] must be a component reference`)
    }
    const ref = freezeRef({
      id: record.id,
      version: record.version,
    })
    const key = `${ref.id}@${ref.version}`
    if (seen.has(key)) throw new Error(`${label} contains a duplicate`)
    seen.add(key)
    return ref
  }))
}

function decodeIdentityHostInputs(
  value: unknown,
): readonly ComponentHostInputRef[] {
  const candidates = denseOwnDataArrayValues(value, 256)
  if (!candidates) {
    throw new Error('requiredHostInputs must be a dense array')
  }
  const seen = new Set<string>()
  return Object.freeze(candidates.map((candidate, index) => {
    const record = exactOwnDataRecord(candidate, [
      'id',
      'privacy',
      'version',
    ])
    if (
      !record
      || !identityCode(record.id)
      || !identityCode(record.version)
      || (record.privacy !== 'public' && record.privacy !== 'private')
    ) {
      throw new Error(
        `requiredHostInputs[${index}] must be a host-input reference`,
      )
    }
    const ref = freezeHostInputRef({
      id: record.id,
      version: record.version,
      privacy: record.privacy,
    })
    const key = `${ref.id}@${ref.version}`
    if (seen.has(key)) {
      throw new Error('requiredHostInputs contains a duplicate')
    }
    seen.add(key)
    return ref
  }))
}

function decodeIdentityBrain(value: unknown): BrainSpec {
  const record = exactOwnDataRecord(value, [
    'belief',
    'beliefVisibility',
    'communication',
    'languageEvidence',
    'mode',
    'observerModel',
    'policy',
    'version',
  ])
  if (
    !record
    || record.version !== BRAIN_SPEC_VERSION
    || ![
      'compatibility',
      'structured-only',
      'hybrid',
    ].includes(record.mode as string)
    || record.belief !== EXACT_BELIEF_MODEL_VERSION
    || record.beliefVisibility !== 'none'
    || record.policy !== COMPOSED_POLICY_VERSION
    || record.communication !== PLAN_COMMUNICATION_VERSION
    || ![
      'off',
      LANGUAGE_FACTOR_BUNDLE_VERSION,
    ].includes(record.languageEvidence as string)
    || ![
      'off',
      PUBLIC_OBSERVER_MODEL_VERSION,
    ].includes(record.observerModel as string)
  ) {
    throw new Error('architecture identity has an invalid base brain')
  }
  return Object.freeze(record as unknown as BrainSpec)
}

function decodeIdentityGraph(value: unknown): ResolvedComponentGraph {
  const record = exactOwnDataRecord(value, [
    'configured',
    'eligible',
    'ineligible',
    'requested',
  ])
  if (!record) throw new Error('architecture identity has an invalid graph')
  const requested = decodeIdentityRefs(record.requested, 'requested')
  const configured = decodeIdentityRefs(record.configured, 'configured')
  const eligible = decodeIdentityRefs(record.eligible, 'eligible')
  const configuredKeys = new Set(
    configured.map((entry) => `${entry.id}@${entry.version}`),
  )
  if (
    requested.some((entry) =>
      !configuredKeys.has(`${entry.id}@${entry.version}`))
    || eligible.some((entry) =>
      !configuredKeys.has(`${entry.id}@${entry.version}`))
  ) {
    throw new Error('requested and eligible components must be configured')
  }
  const ineligibleValues = denseOwnDataArrayValues(record.ineligible, 256)
  if (!ineligibleValues) {
    throw new Error('ineligible must be a dense array')
  }
  const ineligible = Object.freeze(ineligibleValues.map(
    (candidate, index) => {
      const entry = exactOwnDataRecord(candidate, [
        'component',
        'ineligibleDependencies',
        'missingHostRequirements',
      ])
      const component = entry
        ? decodeIdentityRefs([entry.component], `ineligible[${index}]`)[0]
        : undefined
      const missing = denseOwnDataArrayValues(
        entry?.missingHostRequirements,
        256,
      )
      if (
        !entry
        || !component
        || !configuredKeys.has(`${component.id}@${component.version}`)
        || !missing
        || !missing.every(identityCode)
        || new Set(missing).size !== missing.length
        || (
          missing.length === 0
          && Array.isArray(entry.ineligibleDependencies)
          && entry.ineligibleDependencies.length === 0
        )
      ) {
        throw new Error(`ineligible[${index}] has an invalid shape`)
      }
      return Object.freeze({
        component,
        missingHostRequirements: Object.freeze(
          missing as string[],
        ),
        ineligibleDependencies: decodeIdentityRefs(
          entry.ineligibleDependencies,
          `ineligible[${index}].ineligibleDependencies`,
        ),
      })
    },
  ))
  const eligibleKeys = new Set(
    eligible.map((entry) => `${entry.id}@${entry.version}`),
  )
  const ineligibleKeys = new Set(
    ineligible.map(
      (entry) => `${entry.component.id}@${entry.component.version}`,
    ),
  )
  const configuredIndex = new Map<string, number>(
    configured.map(
      (entry, index) => [`${entry.id}@${entry.version}`, index] as const,
    ),
  )
  if (
    ineligibleKeys.size !== ineligible.length
    || [...ineligibleKeys].some((key) => eligibleKeys.has(key))
    || configuredKeys.size !== eligibleKeys.size + ineligibleKeys.size
    || [...configuredKeys].some((key) =>
      !eligibleKeys.has(key) && !ineligibleKeys.has(key))
    || ineligible.some((entry) => {
      const ownKey =
        `${entry.component.id}@${entry.component.version}`
      const ownIndex = configuredIndex.get(ownKey)
      return entry.ineligibleDependencies.some((dependency) => {
        const key = `${dependency.id}@${dependency.version}`
        const dependencyIndex = configuredIndex.get(key)
        return (
          key === ownKey
          || !ineligibleKeys.has(key)
          || dependencyIndex === undefined
          || ownIndex === undefined
          || dependencyIndex >= ownIndex
        )
      })
    })
  ) {
    throw new Error(
      'eligible and ineligible entries must exactly partition configured components',
    )
  }
  return Object.freeze({ requested, configured, eligible, ineligible })
}

/**
 * The sole semantic codec for stable resolved architecture identity. Runtime
 * construction and persisted hostile input both cross this boundary.
 */
export function admitResolvedArchitectureIdentity(
  value: unknown,
): ResolvedArchitectureIdentity | undefined {
  const canonical = canonicalizeJson(
    value,
    MAX_RESOLVED_ARCHITECTURE_IDENTITY_JSON_BYTES,
  )
  if (!canonical.ok) return undefined
  try {
    const root = exactOwnDataRecord(canonical.payload, [
      'base',
      'componentContributions',
      'components',
      'configuredPipeline',
      'decisionLayerOrder',
      'executionMode',
      'requiredHostInputs',
      'scoreLayerOrder',
      'version',
    ])
    const contributions = exactOwnDataRecord(
      root?.componentContributions,
      ['observerModel'],
    )
    if (
      !root
      || root.version !== RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION
      || !['compatibility', 'structured-only', 'hybrid'].includes(
        String(root.executionMode),
      )
      || !contributions
      || (
        contributions.observerModel !== 'off'
        && contributions.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
      )
    ) {
      return undefined
    }
    const components = decodeIdentityGraph(root.components)
    const eligible = new Set(
      components.eligible.map(
        (entry) => `${entry.id}@${entry.version}`,
      ),
    )
    const scoreLayerOrder = decodeIdentityRefs(
      root.scoreLayerOrder,
      'scoreLayerOrder',
    )
    const decisionLayerOrder = decodeIdentityRefs(
      root.decisionLayerOrder,
      'decisionLayerOrder',
    )
    if (decisionLayerOrder.some((entry) =>
      !eligible.has(`${entry.id}@${entry.version}`))
    ) {
      return undefined
    }
    const identity: ResolvedArchitectureIdentity = Object.freeze({
      version: RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
      executionMode: root.executionMode as
        ResolvedArchitectureIdentity['executionMode'],
      base: decodeIdentityBrain(root.base),
      components,
      componentContributions: Object.freeze({
        observerModel: contributions.observerModel,
      }),
      requiredHostInputs: decodeIdentityHostInputs(
        root.requiredHostInputs,
      ),
      scoreLayerOrder,
      decisionLayerOrder,
      configuredPipeline: freezeConfiguredPipeline(
        root.configuredPipeline as ResolvedConfiguredPipeline,
      ),
    })
    return resolvedArchitectureIdentityInvariants(identity)
      ? identity
      : undefined
  } catch {
    return undefined
  }
}

export function resolvedArchitectureIdentityDigest(
  identity: ResolvedArchitectureIdentity,
): string {
  // The typed argument is the product of the architecture identity trust
  // boundary. Downstream projection, joins, and grouping must not re-admit it.
  return createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')
}

export function projectResolvedArchitectureIdentity(
  descriptor: ResolvedArchitectureDescriptor,
): ResolvedArchitectureIdentity {
  const admitted = admitResolvedArchitectureIdentity({
    version: descriptor.version,
    executionMode: descriptor.executionMode,
    base: descriptor.base,
    components: descriptor.components,
    componentContributions: descriptor.componentContributions,
    requiredHostInputs: descriptor.requiredHostInputs,
    scoreLayerOrder: descriptor.scoreLayerOrder,
    decisionLayerOrder: descriptor.decisionLayerOrder,
    configuredPipeline: descriptor.configuredPipeline,
  })
  if (!admitted) {
    throw new Error('resolved architecture descriptor has invalid identity')
  }
  return admitted
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
    executionMode: descriptor.executionMode,
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
  scoreLayerRegistry: ScoreLayerRegistry = EMPTY_SCORE_LAYER_REGISTRY,
): ResolvedComposedBrain {
  if (!config.scoreLayerTerminal && (config.scoreLayerOrder?.length ?? 0) > 0) {
    throw new Error('nonempty scoreLayerOrder requires scoreLayerTerminal')
  }
  const scoreLayerChain = config.scoreLayerTerminal
    ? scoreLayerRegistry.resolve({
        terminal: config.scoreLayerTerminal,
        ...(config.scoreLayerOrder
          ? { declaredOrder: config.scoreLayerOrder }
          : {}),
      })
    : undefined
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
    ...(config.decisionLayerOrder ?? []),
  ]) {
    const key = `${request.id}@${request.version}`
    if (!seen.has(key)) {
      seen.add(key)
      uniqueRequests.push(request)
    }
  }
  for (const layer of scoreLayerChain?.definitions ?? []) {
    for (const required of layer.requiredComponents) {
      const key = `${required.id}@${required.version}`
      const registered = registry.definition(required)
      if (!registered) {
        throw new Error(
          `score layer ${layer.token.id}@${layer.token.version} requires `
            + `missing registry component ${key}`,
        )
      }
      if (
        registered.token.kind !== required.kind
        || registered.token.privacy !== required.privacy
      ) {
        throw new Error(
          `score layer ${layer.token.id}@${layer.token.version} substitutes `
            + `component tag ${key}`,
        )
      }
      if (!seen.has(key)) {
        seen.add(key)
        uniqueRequests.push(required)
      }
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
  const scoreLayerOrder = scoreLayerChain?.order ?? Object.freeze([])
  if (scoreLayerChain) {
    const configuredByKey = new Map(configuredDefinitions.map(
      (definition) => [
        `${definition.token.id}@${definition.token.version}`,
        definition,
      ],
    ))
    for (const layer of scoreLayerChain.definitions) {
      for (const required of layer.requiredComponents) {
        const key = `${required.id}@${required.version}`
        const component = configuredByKey.get(key)
        if (!component) {
          throw new Error(
            `score layer ${layer.token.id}@${layer.token.version} requires `
              + `unconfigured component ${key}`,
          )
        }
        if (!eligible.has(key)) {
          throw new Error(
            `score layer ${layer.token.id}@${layer.token.version} requires `
              + `construction-ineligible component ${key}`,
          )
        }
        if (
          component.token.kind !== required.kind
          || component.token.privacy !== required.privacy
        ) {
          throw new Error(
            `score layer ${layer.token.id}@${layer.token.version} substitutes `
              + `component tag ${key}`,
          )
        }
      }
    }
  }
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
  const executionMode = config.executionMode ?? 'compatibility'
  const base = Object.freeze({
    ...resolveBrain(source),
    mode: executionMode,
  })
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
  const identity = admitResolvedArchitectureIdentity({
    version: RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
    executionMode,
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
  const description: ResolvedArchitectureDescriptor = Object.freeze({
    ...identity,
    migration: Object.freeze({ compatibility }),
  })
  return Object.freeze({
    description,
    configuredDefinitions,
    eligibleDefinitions,
    hostInputDefinitions,
    scoreLayerChain: scoreLayerChain ?? null,
  })
}
