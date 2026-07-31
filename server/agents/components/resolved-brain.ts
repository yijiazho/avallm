import { createHash } from 'node:crypto'
import {
  BRAIN_SPEC_VERSION,
  isComposedPolicy,
  resolveBrain,
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
  ComponentToken,
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
  EMPTY_DECISION_LAYER_REGISTRY,
  type DecisionLayerRegistry,
} from '../policy/decision-layer/registry.ts'
import type {
  DecisionLayerRef,
  ResolvedDecisionLayerOrder,
} from '../policy/decision-layer/types.ts'
import {
  canonicalizeJson,
  denseOwnDataArrayValues,
  exactOwnDataRecord,
} from './canonical-json.ts'

export const RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION =
  'resolved-architecture-descriptor-v1'
export const MAX_RESOLVED_ARCHITECTURE_IDENTITY_JSON_BYTES = 65_536

const ARCHITECTURE_VERSION_PATTERN =
  /^[a-z0-9][a-z0-9._+-]{0,99}$/

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

/**
 * Canonical stable identity shared by the in-process descriptor and detached
 * observability projections. It deliberately excludes implementations,
 * providers, and invocation-local values.
 */
export interface ResolvedArchitectureIdentity {
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
  readonly scoreLayerOrder: readonly ScoreLayerRef[]
  readonly decisionLayerOrder: readonly DecisionLayerRef[]
  readonly configuredPipeline: ResolvedConfiguredPipeline
}

/**
 * The sole construction-time metadata owner for one composed agent. Now that
 * migration-compatibility data is gone, it carries exactly the stable identity;
 * the alias is kept so trace, artifact, and report call sites keep naming the
 * private construction shape they consume.
 */
export type ResolvedArchitectureDescriptor = ResolvedArchitectureIdentity

export function resolvedArchitectureIdentityVersions(
  identity: ResolvedArchitectureIdentity,
): Record<string, string> {
  const pipeline = identity.configuredPipeline
  const languageEnabled =
    pipeline.belief.languageInterpreter !== 'off'
  return {
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
    isComposedPolicy(identity.base.policy)
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
  const version = (
    record: Readonly<Record<string, unknown>>,
    key: string,
  ): string => {
    const value = record[key]
    if (typeof value !== 'string' || !ARCHITECTURE_VERSION_PATTERN.test(value)) {
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
    if (
      typeof value !== 'string'
      || !ARCHITECTURE_VERSION_PATTERN.test(value)
    ) {
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
    'languageEvidence',
    'observerModel',
    'policy',
    'version',
  ])
  if (
    !record
    || record.version !== BRAIN_SPEC_VERSION
    || record.belief !== EXACT_BELIEF_MODEL_VERSION
    || record.beliefVisibility !== 'none'
    || !isComposedPolicy(record.policy)
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
      || !contributions
      || (
        contributions.observerModel !== 'off'
        && contributions.observerModel !== PUBLIC_OBSERVER_MODEL_VERSION
      )
    ) {
      return undefined
    }
    const components = decodeIdentityGraph(root.components)
    const scoreLayerOrder = decodeIdentityRefs(
      root.scoreLayerOrder,
      'scoreLayerOrder',
    )
    const decisionLayerOrder = decodeIdentityRefs(
      root.decisionLayerOrder,
      'decisionLayerOrder',
    )
    const identity: ResolvedArchitectureIdentity = Object.freeze({
      version: RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION,
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

/**
 * The eight stable identity fields, extracted once. Both projections below and
 * the two internal constructions name the same shape; this builder is the one
 * place the descriptor's fields are copied verbatim.
 */
function identityFields(
  source: ResolvedArchitectureIdentity,
): {
  version: typeof RESOLVED_ARCHITECTURE_DESCRIPTOR_VERSION
  base: BrainSpec
  components: ResolvedComponentGraph
  componentContributions: ResolvedArchitectureIdentity['componentContributions']
  requiredHostInputs: readonly ComponentHostInputRef[]
  scoreLayerOrder: readonly ScoreLayerRef[]
  decisionLayerOrder: readonly DecisionLayerRef[]
  configuredPipeline: ResolvedConfiguredPipeline
} {
  return {
    version: source.version,
    base: source.base,
    components: source.components,
    componentContributions: source.componentContributions,
    requiredHostInputs: source.requiredHostInputs,
    scoreLayerOrder: source.scoreLayerOrder,
    decisionLayerOrder: source.decisionLayerOrder,
    configuredPipeline: source.configuredPipeline,
  }
}

/**
 * Re-admit a trusted-typed descriptor through the semantic codec. The type
 * already says the fields are valid, but this path re-runs admission so a
 * descriptor that reached this call by an unchecked cast still cannot escape as
 * an identity the codec would reject. Its consumers hold the re-validated
 * result, not the descriptor they passed in.
 */
export function revalidatedArchitectureIdentity(
  descriptor: ResolvedArchitectureDescriptor,
): ResolvedArchitectureIdentity {
  const admitted = admitResolvedArchitectureIdentity(identityFields(descriptor))
  if (!admitted) {
    throw new Error('resolved architecture descriptor has invalid identity')
  }
  return admitted
}

/**
 * Trusted passthrough of the same identity for private diagnostics: it freezes
 * and returns the descriptor's fields as-is, without re-running admission,
 * because its caller already holds a codec-admitted descriptor. The component
 * graph and host-input roots remain seat-private metadata.
 */
export function trustedArchitectureIdentityDebug(
  descriptor: ResolvedArchitectureDescriptor,
): ResolvedArchitectureIdentity {
  return Object.freeze(identityFields(descriptor))
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
