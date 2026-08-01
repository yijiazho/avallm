import type {
  ComponentRef,
} from '../../components/types.ts'
import {
  createPolicyComponentRuntime,
  frozenPolicyComponentRefs,
  policyComponentReadJournal,
  type PolicyComponentReadJournal,
  type PolicyComponentRuntime,
} from '../component-runtime.ts'
import { isCanonicalCode } from '../layer-registry-common.ts'
import type { Immutable } from '../trusted-data.ts'
import type {
  DecisionLayerDefinition,
  DecisionLayerJournalBase,
  DecisionLayerJournalEntry,
  DecisionLayerOperationCounts,
  DecisionLayerRef,
  DecisionLayerResult,
  DecisionLayerRun,
  DecisionLayerRunInput,
  DecisionLayerSurface,
  DecisionLayerSurfaceDraft,
  DecisionLayerSurfaceFactory,
} from './types.ts'

export const DECISION_LAYER_RUN_VERSION = 'decision-layer-run-v1'
export const DECISION_LAYER_SURFACE_VERSION = 'decision-layer-surface-v1'
export const DECISION_LAYER_POLICY_USE_STAGE = 'strategic-decision'
export const MAX_DECISION_LAYER_REASON_CODES = 32
export const MAX_DECISION_LAYER_STRING_BYTES = 128
export const MAX_DECISION_LAYER_SURFACE_JSON_BYTES = 65_536

// The mutable accumulator over the run: the frozen DecisionLayerOperationCounts
// with every counter made writable. Mapping off that interface keeps the two in
// lockstep, so a new counter cannot be tallied here without also being declared
// on the exported shape.
type MutableOperationCounts = {
  -readonly [K in keyof DecisionLayerOperationCounts]:
    DecisionLayerOperationCounts[K]
}

function frozenRef(ref: DecisionLayerRef): DecisionLayerRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

function canonicalText(value: unknown): value is string {
  return isCanonicalCode(value, MAX_DECISION_LAYER_STRING_BYTES)
}

function parseResult(value: unknown): DecisionLayerResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as Partial<DecisionLayerResult>
  if (result.status === 'degraded') return result as DecisionLayerResult
  return result.status === 'applied' && result.surface
    ? result as DecisionLayerResult
    : undefined
}

function createInitialSurface(
  input: DecisionLayerRunInput,
  operations: MutableOperationCounts,
): Immutable<DecisionLayerSurface> {
  const legal = new Set<string>()
  for (const candidate of input.candidates) {
    operations.legalCandidatesVisited++
    if (legal.has(candidate.id)) {
      throw new Error('decision layers require unique legal candidate ids')
    }
    legal.add(candidate.id)
  }
  const survivors: string[] = []
  const seen = new Set<string>()
  for (const id of input.universalForced.allowedCandidateIds) {
    operations.universalCandidateIdsVisited++
    if (!legal.has(id) || seen.has(id)) {
      throw new Error(
        'universal forced policy has an invalid survivor boundary',
      )
    }
    seen.add(id)
    survivors.push(id)
  }
  if (survivors.length === 0) {
    throw new Error('universal forced policy must retain a candidate')
  }
  const selected = input.universalForced.selectedCandidateId
  if (selected !== undefined && !seen.has(selected)) {
    throw new Error('universal forced selection is outside its survivors')
  }
  return Object.freeze({
    version: DECISION_LAYER_SURFACE_VERSION,
    survivorCandidateIds: Object.freeze(survivors),
    ...(selected === undefined ? {} : { selectedCandidateId: selected }),
    reasonCodes: Object.freeze([]),
  }) as unknown as Immutable<DecisionLayerSurface>
}

interface LayerSurfaceRuntime {
  readonly factory: DecisionLayerSurfaceFactory
  accepts(surface: unknown): surface is Immutable<DecisionLayerSurface>
}

function createSurfaceRuntime(
  prior: Immutable<DecisionLayerSurface>,
  legalOrder: readonly string[],
  operations: MutableOperationCounts,
): LayerSurfaceRuntime {
  const issued = new WeakSet<object>()
  const priorSet = new Set(prior.survivorCandidateIds)
  const legalIndex = new Map(legalOrder.map((id, index) => [id, index]))
  const factory: DecisionLayerSurfaceFactory = Object.freeze({
    create(draft: DecisionLayerSurfaceDraft) {
      operations.surfaceBuildAttempts++
      if (
        !draft
        || typeof draft !== 'object'
        || !Array.isArray(draft.survivorCandidateIds)
        || !Array.isArray(draft.reasonCodes)
      ) throw new Error('decision layer returned a malformed surface draft')
      const survivors: string[] = []
      const seen = new Set<string>()
      let priorPosition = -1
      for (const priorId of prior.survivorCandidateIds) {
        operations.surfacePriorSurvivorsVisited++
        if (!legalIndex.has(priorId)) {
          throw new Error('decision layer prior is outside legal candidates')
        }
      }
      for (const id of draft.survivorCandidateIds) {
        operations.surfaceDraftSurvivorsVisited++
        if (
          typeof id !== 'string'
          || !priorSet.has(id)
          || seen.has(id)
        ) throw new Error('decision layer did not monotonically narrow')
        const position = legalIndex.get(id)!
        if (position <= priorPosition) {
          throw new Error('decision layer changed canonical candidate order')
        }
        priorPosition = position
        seen.add(id)
        survivors.push(id)
      }
      if (survivors.length === 0) {
        throw new Error('decision layer removed every candidate')
      }
      const selected = draft.selectedCandidateId
      if (
        selected !== undefined
        && (
          typeof selected !== 'string'
          || !seen.has(selected)
        )
      ) throw new Error('decision layer selected outside its survivors')
      if (
        prior.selectedCandidateId !== undefined
        && selected !== prior.selectedCandidateId
      ) throw new Error('decision layer overrode an earlier selection')
      if (selected !== undefined && survivors.length !== 1) {
        throw new Error('decision layer selection must be its sole survivor')
      }
      const reasons: string[] = []
      const reasonSeen = new Set<string>()
      for (const reason of draft.reasonCodes) {
        operations.surfaceReasonsVisited++
        if (
          !canonicalText(reason)
          || reasonSeen.has(reason)
          || reasons.length >= MAX_DECISION_LAYER_REASON_CODES
        ) throw new Error('decision layer returned invalid reason codes')
        reasonSeen.add(reason)
        reasons.push(reason)
      }
      const source = {
        version: DECISION_LAYER_SURFACE_VERSION,
        survivorCandidateIds: survivors,
        ...(selected === undefined
          ? {}
          : { selectedCandidateId: selected }),
        reasonCodes: reasons,
      }
      const bytes = Buffer.byteLength(JSON.stringify(source), 'utf8')
      if (bytes > MAX_DECISION_LAYER_SURFACE_JSON_BYTES) {
        throw new Error('decision layer surface exceeds its byte budget')
      }
      operations.surfaceBytesConstructed += bytes
      const surface = Object.freeze({
        ...source,
        survivorCandidateIds: Object.freeze(survivors),
        reasonCodes: Object.freeze(reasons),
      }) as Immutable<DecisionLayerSurface>
      issued.add(surface as object)
      return surface
    },
  })
  return Object.freeze({
    factory,
    accepts(surface: unknown): surface is Immutable<DecisionLayerSurface> {
      return !!surface
        && typeof surface === 'object'
        && issued.has(surface as object)
    },
  })
}

function journalBase(
  definition: DecisionLayerDefinition,
  prior: Immutable<DecisionLayerSurface>,
  reads: PolicyComponentReadJournal,
): DecisionLayerJournalBase {
  return {
    layer: frozenRef(definition.token),
    priorSurvivorCandidateIds: prior.survivorCandidateIds,
    ...(prior.selectedCandidateId === undefined
      ? {}
      : { priorSelectedCandidateId: prior.selectedCandidateId }),
    componentLookups: frozenPolicyComponentRefs(reads.lookups),
    componentReads: frozenPolicyComponentRefs(reads.reads),
  }
}

function degraded(
  definition: DecisionLayerDefinition,
  prior: Immutable<DecisionLayerSurface>,
  reads: PolicyComponentReadJournal,
  failureCode: Extract<
    DecisionLayerJournalEntry,
    { status: 'degraded' }
  >['failureCode'],
): DecisionLayerJournalEntry {
  return Object.freeze({
    ...journalBase(definition, prior, reads),
    status: 'degraded',
    degradationCode: definition.degradationCode,
    failureCode,
  })
}

/** Execute one resolved ordered strategic boundary. */
export function runDecisionLayers(
  input: DecisionLayerRunInput,
): DecisionLayerRun {
  const operations: MutableOperationCounts = {
    universalCandidateIdsVisited: 0,
    legalCandidatesVisited: 0,
    layersVisited: 0,
    layersSuppressed: 0,
    applicabilityEvaluations: 0,
    layersExecuted: 0,
    componentLookupAttempts: 0,
    componentPayloadIndexEntriesVisited: 0,
    componentPayloadReads: 0,
    componentPayloadsMaterialized: 0,
    componentDefinitionIndexEntriesVisited: 0,
    decisionLayerComponentRequirementsIndexed: 0,
    componentClosureRootsVisited: 0,
    componentDependencyEdgesVisited: 0,
    componentClosureComponentsEmitted: 0,
    componentAttributionUnionTokensVisited: 0,
    componentAttributionTokensVisited: 0,
    componentAttributionEntriesVisited: 0,
    componentAttributionPolicyUseEntriesVisited: 0,
    surfaceBuildAttempts: 0,
    surfacePriorSurvivorsVisited: 0,
    surfaceDraftSurvivorsVisited: 0,
    surfaceReasonsVisited: 0,
    surfaceBytesConstructed: 0,
  }
  if (
    input.order.order.length !== input.order.definitions.length
    || input.order.order.some((ref, index) =>
      ref.id !== input.order.definitions[index]!.token.id
      || ref.version !== input.order.definitions[index]!.token.version)
  ) throw new Error('decision layer definitions are out of order')
  const legalOrder = input.candidates.map((candidate) => candidate.id)
  let surface = createInitialSurface(input, operations)
  let componentRun: Immutable<typeof input.componentRun> =
    input.componentRun
  let componentRuntime:
    PolicyComponentRuntime<DecisionLayerDefinition> | undefined
  const journal: DecisionLayerJournalEntry[] = []
  const executed = new Set<string>()
  for (const definition of input.order.definitions) {
    operations.layersVisited++
    const key = `${definition.token.id}@${definition.token.version}`
    if (executed.has(key)) {
      throw new Error(`decision layer executed twice: ${key}`)
    }
    executed.add(key)
    const reads = policyComponentReadJournal()
    if (surface.selectedCandidateId !== undefined) {
      operations.layersSuppressed++
      journal.push(Object.freeze({
        ...journalBase(definition, surface, reads),
        status: 'suppressed',
        suppressionCode: input.universalForced.selectedCandidateId
          !== undefined
          ? 'universal-policy-selected'
          : 'prior-strategic-selection',
      }))
      continue
    }
    const base = Object.freeze({
      request: input.request,
      view: input.view,
      analysis: input.analysis,
      candidates: input.candidates,
      universalForced: input.universalForced,
      prior: surface,
    })
    operations.applicabilityEvaluations++
    let applicable: boolean
    try {
      applicable = definition.applies(base)
    } catch {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'applicability-failed',
      ))
      continue
    }
    if (typeof applicable !== 'boolean') {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'applicability-failed',
      ))
      continue
    }
    if (!applicable) {
      journal.push(Object.freeze({
        ...journalBase(definition, surface, reads),
        status: 'inapplicable',
      }))
      continue
    }
    operations.layersExecuted++
    componentRuntime ??= createPolicyComponentRuntime({
      owner: 'decision layer',
      stage: DECISION_LAYER_POLICY_USE_STAGE,
      componentDefinitions: input.componentDefinitions,
      componentRun,
      layerDefinitions: input.order.definitions,
      requirementCounter: 'decisionLayerComponentRequirementsIndexed',
      operations,
    })
    const runtime = createSurfaceRuntime(surface, legalOrder, operations)
    let raw: unknown
    try {
      raw = definition.execute(Object.freeze({
        ...base,
        components: componentRuntime.reader(definition, reads),
        surface: runtime.factory,
      }))
    } catch {
      journal.push(degraded(
        definition,
        surface,
        reads,
        reads.lookups.size > 0 && reads.reads.size === 0
          ? 'dependency-unavailable'
          : 'execution-failed',
      ))
      continue
    }
    const result = parseResult(raw)
    if (!result) {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'malformed-result',
      ))
      continue
    }
    if (result.status === 'degraded') {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'layer-degraded',
      ))
      continue
    }
    if (!runtime.accepts(result.surface)) {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'invalid-surface',
      ))
      continue
    }
    let attributedComponents: readonly ComponentRef[]
    try {
      attributedComponents = componentRuntime.attribute(reads.reads)
    } catch {
      journal.push(degraded(
        definition,
        surface,
        reads,
        'dependency-unavailable',
      ))
      continue
    }
    const prior = surface
    surface = result.surface
    journal.push(Object.freeze({
      ...journalBase(definition, prior, reads),
      status: 'applied',
      survivorCandidateIds: surface.survivorCandidateIds,
      ...(surface.selectedCandidateId === undefined
        ? {}
        : { selectedCandidateId: surface.selectedCandidateId }),
      reasonCodes: surface.reasonCodes,
      attributedComponents,
    }))
  }
  if (componentRuntime) {
    componentRun = componentRuntime.finalize(componentRun)
  }
  const frozenOperations: DecisionLayerOperationCounts =
    Object.freeze({ ...operations })
  return Object.freeze({
    version: DECISION_LAYER_RUN_VERSION,
    configured: Object.freeze(input.order.order.map(frozenRef)),
    journal: Object.freeze(journal),
    surface,
    componentRun,
    operations: frozenOperations,
  })
}
