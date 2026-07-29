import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import { componentIdentityKey } from '../../components/registry.ts'
import type {
  DecisionComponentDefinition,
} from '../../components/types.ts'
import type { Immutable } from '../trusted-data.ts'
import {
  createScoreLayerComponentRuntime,
  frozenScoreLayerReadRefs,
  scoreLayerReadJournal,
  type ScoreLayerReadJournal,
} from './components.ts'
import {
  canonicalScoreLayerChain,
  consumeScoreLayerPreflight,
} from './preflight.ts'
import {
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
  ScoreLayerRootResult,
  ScoreLayerRun,
  ScoreLayerRunInput,
  ScoreLayerTransformDefinition,
  ScoreLayerTransformResult,
} from './types.ts'

export {
  SCORE_LAYER_POLICY_USE_STAGE,
} from './components.ts'
export {
  MAX_SCORE_LAYER_ANALYSIS_REFS,
  preflightScoreLayers,
  SCORE_LAYER_PREFLIGHT_VERSION,
} from './preflight.ts'
export {
  MAX_SCORE_LAYER_REASON_CODES,
  MAX_SCORE_LAYER_STRING_BYTES,
  MAX_SCORE_LAYER_SURFACE_JSON_BYTES,
} from './surface.ts'

export const SCORE_LAYER_RUN_VERSION = 'score-layer-run-v1'

interface MutableOperationCounts {
  analysisRequirementEvaluations: number
  analysisRequirementFailures: number
  analysisRefsVisited: number
  analysisAdmissionEvaluations: number
  analysisAdmissionFailures: number
  forcedCandidateIdsVisited: number
  legalCandidatesVisited: number
  applicabilityEvaluations: number
  layersExecuted: number
  componentLookupAttempts: number
  componentPayloadIndexEntriesVisited: number
  componentPayloadReads: number
  componentPayloadsMaterialized: number
  componentDefinitionIndexEntriesVisited: number
  scoreLayerComponentRequirementsIndexed: number
  componentClosureRootsVisited: number
  componentDependencyEdgesVisited: number
  componentClosureComponentsEmitted: number
  componentAttributionUnionTokensVisited: number
  componentAttributionTokensVisited: number
  componentAttributionEntriesVisited: number
  componentAttributionPolicyUseEntriesVisited: number
  surfaceBuildAttempts: number
  surfacePriorSurvivorsVisited: number
  surfaceDraftSurvivorsVisited: number
  surfaceRowsVisited: number
  surfaceReasonsVisited: number
  surfaceBytesConstructed: number
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
  if (
    result.status === 'inapplicable' || result.status === 'degraded'
  ) return result as ScoreLayerTransformResult
  return result.status === 'applied'
    ? result as ScoreLayerTransformResult
    : undefined
}

function canonicalRunInputs(input: ScoreLayerRunInput): boolean {
  if (!canonicalScoreLayerChain(input.chain)) return false

  const definitionKeys = input.componentDefinitions.map(
    (definition) => componentIdentityKey(definition.token),
  )
  const configuredKeys = input.componentRun.configured.map(
    componentIdentityKey,
  )
  const entryKeys = input.componentRun.entries.map(
    (entry) => componentIdentityKey(entry.component),
  )
  const policyUseKeys = input.componentRun.policyUse.map(
    (entry) => componentIdentityKey(entry.component),
  )
  if (
    definitionKeys.length !== configuredKeys.length
    || definitionKeys.some((key, index) => key !== configuredKeys[index])
    || entryKeys.length !== configuredKeys.length
    || entryKeys.some((key, index) => key !== configuredKeys[index])
    || input.componentDefinitions.some((definition, index) =>
      definition.token.kind !== input.componentRun.entries[index].kind
      || definition.token.privacy !== input.componentRun.entries[index].privacy)
    || policyUseKeys.length !== configuredKeys.length
    || policyUseKeys.some((key, index) => key !== configuredKeys[index])
  ) return false
  const seen = new Set<string>()
  for (const definition of input.componentDefinitions) {
    if (definition.dependencies.some(
      (dependency) => !seen.has(componentIdentityKey(dependency)),
    )) return false
    seen.add(componentIdentityKey(definition.token))
  }
  return true
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
  input: ScoreLayerRunInput,
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

export function runScoreLayers(input: ScoreLayerRunInput): ScoreLayerRun {
  if (
    !input
    || typeof input !== 'object'
    || !canonicalRunInputs(input)
  ) throw new Error('score layer run requires one resolved canonical chain')
  const preflight = consumeScoreLayerPreflight(input)

  const operations: MutableOperationCounts = {
    analysisRequirementEvaluations: preflight.evaluations,
    analysisRequirementFailures: preflight.failures,
    analysisRefsVisited: preflight.refsVisited,
    analysisAdmissionEvaluations: 0,
    analysisAdmissionFailures: 0,
    forcedCandidateIdsVisited: 0,
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
  const baseContext: ScoreLayerApplicabilityContext = Object.freeze({
    request: input.request,
    view: input.view,
    analysis: input.analysis,
    candidates: input.candidates,
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
    canonicalForced,
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
    preflight.entries[0].requirements,
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
    analysisRequirements: preflight.entries[0].requirements,
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
      throw new Error('score layer chain contains a non-root root')
    }
    const definition = candidate
    const key = `${definition.token.id}@${definition.token.version}`
    if (executed.has(key)) {
      throw new Error(`score layer executed twice: ${key}`)
    }
    executed.add(key)
    const reads = scoreLayerReadJournal()
    const analysisPreflight = preflight.entries[layerIndex]
    if (analysisPreflight.status === 'disabled') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreflight.requirements,
        'analysis-requirement-failed',
        'not-run',
      ))
      continue
    }
    if (!analysisAdmitted(
      definition,
      analysisPreflight.requirements,
      input,
      operations,
    )) {
      journal.push(degraded(
        definition,
        reads,
        analysisPreflight.requirements,
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
        analysisPreflight.requirements,
        'applicability-failed',
      ))
      continue
    }
    if (typeof applicable !== 'boolean') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreflight.requirements,
        'applicability-failed',
      ))
      continue
    }
    if (!applicable) {
      journal.push(Object.freeze({
        layer: frozenRef(definition.token),
        status: 'inapplicable',
        analysisRequirements: analysisPreflight.requirements,
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
        analysisPreflight.requirements,
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
        analysisPreflight.requirements,
        'malformed-result',
      ))
      continue
    }
    if (result.status === 'inapplicable') {
      journal.push(Object.freeze({
        layer: frozenRef(definition.token),
        status: 'inapplicable',
        analysisRequirements: analysisPreflight.requirements,
        analysisAdmission: 'admitted',
        componentLookups: frozenScoreLayerReadRefs(reads.lookups),
        componentReads: frozenScoreLayerReadRefs(reads.reads),
      }))
      continue
    }
    if (result.status === 'degraded') {
      journal.push(degraded(
        definition,
        reads,
        analysisPreflight.requirements,
        'layer-degraded',
      ))
      continue
    }
    if (!transformSurface.accepts(result.surface)) {
      journal.push(degraded(
        definition,
        reads,
        analysisPreflight.requirements,
        'invalid-score-surface',
      ))
      continue
    }
    const attribution = componentRuntime.attribute(reads.reads)
    surface = result.surface
    journal.push(Object.freeze({
      layer: frozenRef(definition.token),
      status: 'applied',
      analysisRequirements: analysisPreflight.requirements,
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
