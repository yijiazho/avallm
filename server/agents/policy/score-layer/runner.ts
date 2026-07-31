import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import type { Immutable } from '../trusted-data.ts'
import {
  createScoreLayerComponentRuntime,
  frozenScoreLayerReadRefs,
  scoreLayerReadJournal,
  type ScoreLayerReadJournal,
} from './components.ts'
import {
  prepareScoreLayerRequirements,
  type PreparedScoreLayerRequirements,
} from './preparation.ts'
import {
  canonicalCandidateBoundary,
  canonicalForcedPolicy,
  createScoreLayerSurfaceRuntime,
} from './surface.ts'
import type {
  ScoreLayerApplicabilityContext,
  ScoreLayerAnalysisAdmissionContext,
  ScoreLayerAnalysisRef,
  ScoreLayerDefinition,
  ScoreLayerExecutionContext,
  ScoreLayerJournalEntry,
  ScoreLayerOperationCounts,
  ScoreLayerRef,
  ResolvedScoreLayerChain,
  ScoreLayerRootResult,
  ScoreLayerRun,
  ScoreLayerRunCompletion,
  ScoreLayerRunLease,
  ScoreLayerRunPreparation,
  ScoreLayerTransformDefinition,
  ScoreLayerTransformResult,
} from './types.ts'

export {
  SCORE_LAYER_POLICY_USE_STAGE,
} from './components.ts'
export {
  MAX_SCORE_LAYER_ANALYSIS_REFS,
} from './preparation.ts'
export {
  MAX_SCORE_LAYER_REASON_CODES,
  MAX_SCORE_LAYER_STRING_BYTES,
  MAX_SCORE_LAYER_SURFACE_JSON_BYTES,
  SCORE_LAYER_SURFACE_VERSION,
} from './surface.ts'

export const SCORE_LAYER_RUN_VERSION = 'score-layer-run-v1'
export const SCORE_LAYER_RUN_LEASE_VERSION = 'score-layer-run-lease-v1'

interface TrustedScoreLayerRunInput
extends ScoreLayerRunPreparation, ScoreLayerRunCompletion {}

class LocalScoreLayerRunLease {
  readonly version = SCORE_LAYER_RUN_LEASE_VERSION
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly #preparation: ScoreLayerRunPreparation
  readonly #prepared: PreparedScoreLayerRequirements
  #consumed = false

  constructor(preparation: ScoreLayerRunPreparation) {
    this.#preparation = Object.freeze({
      chain: preparation.chain,
      componentDefinitions: preparation.componentDefinitions,
      request: preparation.request,
      view: preparation.view,
    })
    this.#prepared = prepareScoreLayerRequirements(this.#preparation.chain, {
      request: this.#preparation.request,
      view: this.#preparation.view,
    })
    this.requirements = this.#prepared.requirements
    Object.freeze(this)
  }

  static consume(
    lease: ScoreLayerRunLease,
    completion: ScoreLayerRunCompletion,
  ): ScoreLayerRun {
    if (!(lease instanceof LocalScoreLayerRunLease)) {
      throw new Error('score layer run requires its local prepared lease')
    }
    if (lease.#consumed) {
      throw new Error('score layer run lease was already consumed')
    }
    lease.#consumed = true
    return runPreparedScoreLayers({
      ...lease.#preparation,
      ...completion,
    }, lease.#prepared)
  }
}

/**
 * Prepare bounded analysis requirements without executing analysis,
 * components, or policy. Production callers enter through DecisionFrame.
 */
export function prepareScoreLayerRunLease(
  preparation: ScoreLayerRunPreparation,
): ScoreLayerRunLease {
  return new LocalScoreLayerRunLease(
    preparation,
  ) as unknown as ScoreLayerRunLease
}

/**
 * Internal execution hook for the staged DecisionFrame transition.
 * Architecture fitness forbids other production imports.
 */
export function executePreparedScoreLayerRun(
  lease: ScoreLayerRunLease,
  completion: ScoreLayerRunCompletion,
): ScoreLayerRun {
  return LocalScoreLayerRunLease.consume(lease, completion)
}

/**
 * Resolve diagnostic semantics independently from authoritative scorer
 * identity. Only an explicitly declared attribution terminal may delegate to
 * its last active predecessor.
 */
export function scoreLayerDiagnosticOwnerVersion(
  run: ScoreLayerRun,
  chain: ResolvedScoreLayerChain,
): string {
  if (
    run.configured.length !== chain.order.length
    || run.journal.length !== chain.definitions.length
  ) throw new Error('score diagnostic ownership requires one resolved chain')
  let activeIndex = -1
  for (let index = 0; index < run.journal.length; index++) {
    const configured = run.configured[index]
    const definition = chain.definitions[index]
    const entry = run.journal[index]
    if (
      configured.id !== definition.token.id
      || configured.version !== definition.token.version
      || entry.layer.id !== configured.id
      || entry.layer.version !== configured.version
    ) throw new Error('score diagnostic ownership chain mismatch')
    if (entry.status === 'applied' || entry.status === 'generated') {
      activeIndex = index
    }
  }
  if (activeIndex < 0) {
    throw new Error('score diagnostic ownership requires an active scorer')
  }
  const active = run.journal[activeIndex]
  const definition = chain.definitions[activeIndex]
  if (
    definition.kind !== 'transform'
    || definition.diagnosticOwner !== 'predecessor'
  ) return active.layer.version
  for (let index = activeIndex - 1; index >= 0; index--) {
    const prior = run.journal[index]
    if (prior.status === 'applied' || prior.status === 'generated') {
      return prior.layer.version
    }
  }
  return active.layer.version
}

// The mutable accumulator over the run: the frozen ScoreLayerOperationCounts
// with every counter made writable. Mapping off that interface keeps the two in
// lockstep, so a new counter cannot be tallied here without also being declared
// on the exported shape.
type MutableOperationCounts = {
  -readonly [K in keyof ScoreLayerOperationCounts]:
    ScoreLayerOperationCounts[K]
}

function frozenRef(ref: ScoreLayerRef): ScoreLayerRef {
  return Object.freeze({ id: ref.id, version: ref.version })
}

function rootResult(value: unknown): ScoreLayerRootResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as Partial<ScoreLayerRootResult>
  return result.status === 'generated'
    ? result as ScoreLayerRootResult
    : undefined
}

function transformResult(
  value: unknown,
): ScoreLayerTransformResult | undefined {
  if (!value || typeof value !== 'object') return undefined
  const result = value as Partial<ScoreLayerTransformResult>
  if (result.status === 'degraded') return result as ScoreLayerTransformResult
  return result.status === 'applied'
    ? result as ScoreLayerTransformResult
    : undefined
}

function degraded(
  definition: ScoreLayerTransformDefinition,
  journal: ScoreLayerReadJournal,
  analysisRequirements: readonly ScoreLayerAnalysisRef[],
  failureCode: Extract<
    ScoreLayerJournalEntry,
    { status: 'degraded' }
  >['failureCode'],
  analysisAdmission:
    | 'admitted'
    | 'failed'
    | 'not-run' = 'admitted',
): ScoreLayerJournalEntry {
  return Object.freeze({
    layer: frozenRef(definition.token),
    status: 'degraded',
    analysisRequirements,
    analysisAdmission,
    componentLookups: frozenScoreLayerReadRefs(journal.lookups),
    componentReads: frozenScoreLayerReadRefs(journal.reads),
    degradationCode: definition.degradationCode,
    failureCode,
  })
}

function analysisAdmitted(
  definition: ScoreLayerDefinition,
  requirements: readonly ScoreLayerAnalysisRef[],
  input: TrustedScoreLayerRunInput,
  operations: MutableOperationCounts,
): boolean {
  operations.analysisAdmissionEvaluations++
  const context: ScoreLayerAnalysisAdmissionContext = Object.freeze({
    request: input.request,
    view: input.view,
    analysis: input.analysis,
    requirements,
    candidates: input.candidates,
    hypotheticalTeamCandidates: input.hypotheticalTeamCandidates,
  })
  try {
    if (definition.admitAnalysis(context) === true) return true
  } catch {
    // Family-owned admission failure is handled by layer criticality below.
  }
  operations.analysisAdmissionFailures++
  return false
}

function runPreparedScoreLayers(
  input: TrustedScoreLayerRunInput,
  prepared: PreparedScoreLayerRequirements,
): ScoreLayerRun {
  const operations: MutableOperationCounts = {
    analysisRequirementEvaluations: prepared.evaluations,
    analysisRequirementFailures: prepared.failures,
    analysisRefsVisited: prepared.refsVisited,
    analysisAdmissionEvaluations: 0,
    analysisAdmissionFailures: 0,
    forcedCandidateIdsVisited: 0,
    candidateBoundaryIdsVisited: 0,
    legalCandidatesVisited: 0,
    applicabilityEvaluations: 0,
    layersExecuted: 0,
    componentLookupAttempts: 0,
    componentPayloadIndexEntriesVisited: 0,
    componentPayloadReads: 0,
    componentPayloadsMaterialized: 0,
    componentDefinitionIndexEntriesVisited: 0,
    scoreLayerComponentRequirementsIndexed: 0,
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
    surfaceRowsVisited: 0,
    surfaceReasonsVisited: 0,
    surfaceBytesConstructed: 0,
  }
  const canonicalForced = canonicalForcedPolicy(input, operations)
  const candidateBoundary = canonicalCandidateBoundary(input, operations)
  const baseContext: ScoreLayerApplicabilityContext = Object.freeze({
    request: input.request,
    view: input.view,
    analysis: input.analysis,
    candidates: input.candidates,
    candidateBoundary,
    forced: canonicalForced,
    deterministicSeed: input.deterministicSeed,
    compatibilityCandidateId: input.compatibilityCandidateId,
    hypotheticalTeamCandidates: input.hypotheticalTeamCandidates,
  })
  const componentRuntime = createScoreLayerComponentRuntime(
    input.componentDefinitions,
    input.componentRun,
    input.chain.definitions,
    operations,
  )
  const surfaceRuntime = createScoreLayerSurfaceRuntime(
    input.candidates,
    candidateBoundary,
    operations,
  )
  const journal: ScoreLayerJournalEntry[] = []
  let componentRun: Immutable<DecisionComponentRun> = input.componentRun

  const rootCandidate = input.chain.definitions[0]
  if (rootCandidate.kind !== 'root') {
    throw new Error('score layer chain does not begin with its total root')
  }
  const root = rootCandidate
  const rootReads = scoreLayerReadJournal()
  if (!analysisAdmitted(
    root,
    prepared.entries[0].requirements,
    input,
    operations,
  )) throw new Error('total score layer root analysis admission failed')
  operations.layersExecuted++
  let rawRoot: unknown
  const rootSurface = surfaceRuntime.layer(undefined)
  try {
    const context: ScoreLayerExecutionContext = Object.freeze({
      ...baseContext,
      surface: rootSurface.factory,
      components: componentRuntime.reader(root, rootReads),
    })
    rawRoot = root.execute(context)
  } catch (error) {
    throw new Error('total score layer root failed', { cause: error })
  }
  const generated = rootResult(rawRoot)
  if (!generated) {
    throw new Error('total score layer root returned malformed result')
  }
  if (!rootSurface.accepts(generated.surface)) {
    throw new Error('total score layer root returned foreign surface')
  }
  let surface = generated.surface
  const rootAttribution = componentRuntime.attribute(rootReads.reads)
  journal.push(Object.freeze({
    layer: frozenRef(root.token),
    status: 'generated',
    analysisRequirements: prepared.entries[0].requirements,
    analysisAdmission: 'admitted',
    componentLookups: frozenScoreLayerReadRefs(rootReads.lookups),
    componentReads: frozenScoreLayerReadRefs(rootReads.reads),
    attributedComponents: rootAttribution,
  }))

  const executed = new Set<string>([
    `${root.token.id}@${root.token.version}`,
  ])
  for (
    let layerIndex = 1;
    layerIndex < input.chain.definitions.length;
    layerIndex++
  ) {
    const candidate = input.chain.definitions[layerIndex]
    if (candidate.kind !== 'transform') {
      throw new Error('score layer chain has a second root')
    }
    const definition = candidate
    const key = `${definition.token.id}@${definition.token.version}`
    if (executed.has(key)) {
      throw new Error(`score layer executed twice: ${key}`)
    }
    executed.add(key)
    const reads = scoreLayerReadJournal()
    const analysisPreparation = prepared.entries[layerIndex]
    if (analysisPreparation.status === 'disabled') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'analysis-requirement-failed',
        'not-run',
      ))
      continue
    }
    if (!analysisAdmitted(
      definition,
      analysisPreparation.requirements,
      input,
      operations,
    )) {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'analysis-admission-failed',
        'failed',
      ))
      continue
    }
    operations.applicabilityEvaluations++
    let applicable: boolean
    try {
      applicable = definition.applies(baseContext)
    } catch {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'applicability-failed',
      ))
      continue
    }
    if (typeof applicable !== 'boolean') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'applicability-failed',
      ))
      continue
    }
    if (!applicable) {
      journal.push(Object.freeze({
        layer: frozenRef(definition.token),
        status: 'inapplicable',
        analysisRequirements: analysisPreparation.requirements,
        analysisAdmission: 'admitted',
        componentLookups: Object.freeze([]),
        componentReads: Object.freeze([]),
      }))
      continue
    }
    operations.layersExecuted++
    let raw: unknown
    const transformSurface = surfaceRuntime.layer(surface)
    try {
      raw = definition.execute(Object.freeze({
        ...baseContext,
        prior: surface,
        surface: transformSurface.factory,
        components: componentRuntime.reader(definition, reads),
      }))
    } catch {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'execution-failed',
      ))
      continue
    }
    let result: ScoreLayerTransformResult | undefined
    try {
      result = transformResult(raw)
    } catch {
      result = undefined
    }
    if (!result) {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'malformed-result',
      ))
      continue
    }
    if (result.status === 'degraded') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'layer-degraded',
      ))
      continue
    }
    if (!transformSurface.accepts(result.surface)) {
      journal.push(degraded(
        definition,
        reads,
        analysisPreparation.requirements,
        'invalid-score-surface',
      ))
      continue
    }
    const attribution = componentRuntime.attribute(reads.reads)
    surface = result.surface
    journal.push(Object.freeze({
      layer: frozenRef(definition.token),
      status: 'applied',
      analysisRequirements: analysisPreparation.requirements,
      analysisAdmission: 'admitted',
      componentLookups: frozenScoreLayerReadRefs(reads.lookups),
      componentReads: frozenScoreLayerReadRefs(reads.reads),
      attributedComponents: attribution,
    }))
  }

  componentRun = componentRuntime.finalize(componentRun)
  const frozenOperations: ScoreLayerOperationCounts =
    Object.freeze({ ...operations })
  return Object.freeze({
    version: SCORE_LAYER_RUN_VERSION,
    configured: Object.freeze(input.chain.order.map(frozenRef)),
    journal: Object.freeze(journal),
    surface,
    componentRun,
    operations: frozenOperations,
  })
}
