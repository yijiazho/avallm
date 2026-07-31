import type {
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import type { SituationAnalysis } from '../../analysis/types.ts'
import type {
  ComponentRef,
  ComponentToken,
  DecisionComponentDefinition,
} from '../../components/types.ts'
import type { DecisionComponentRun } from '../../components/run-types.ts'
import type {
  LayerRef,
  LayerRunTrace,
  LayerToken,
} from '../layer-registry-common.ts'
import { layerToken } from '../layer-registry-common.ts'
import type { Immutable } from '../trusted-data.ts'
import type {
  ForcedPolicyResult,
  PolicyCandidate,
} from '../types.ts'

declare const DECISION_LAYER_SURFACE_BRAND: unique symbol

export interface DecisionLayerRef extends LayerRef {}

export type DecisionLayerToken = LayerToken<'decision-layer'>

export function decisionLayerToken(
  id: string,
  version: string,
): DecisionLayerToken {
  return layerToken<'decision-layer'>(id, version)
}

/**
 * The hard strategic boundary after universal policy. It is deliberately not
 * a ForcedPolicyResult: strategic layers may narrow or select, but cannot
 * relabel universal authority.
 */
export interface DecisionLayerSurface {
  readonly version: 'decision-layer-surface-v1'
  readonly survivorCandidateIds: readonly string[]
  readonly selectedCandidateId?: string
  readonly reasonCodes: readonly string[]
  readonly [DECISION_LAYER_SURFACE_BRAND]: true
}

/**
 * Unbranded downstream view of the hard strategic candidate boundary.
 * Runtime decisions pass DecisionLayerRun.surface itself; no alternate
 * strategic writer synthesizes this boundary.
 */
export interface DecisionCandidateBoundary {
  readonly survivorCandidateIds: readonly string[]
  readonly selectedCandidateId?: string
  readonly reasonCodes: readonly string[]
}

export interface DecisionLayerSurfaceDraft {
  readonly survivorCandidateIds: readonly string[]
  readonly selectedCandidateId?: string
  readonly reasonCodes: readonly string[]
}

export interface DecisionLayerSurfaceFactory {
  create(draft: DecisionLayerSurfaceDraft): Immutable<DecisionLayerSurface>
}

export interface DecisionLayerComponentReader {
  get<Payload>(
    token: ComponentToken<Payload>,
  ): Immutable<Payload> | undefined
  require<Payload>(token: ComponentToken<Payload>): Immutable<Payload>
}

export interface DecisionLayerApplicabilityContext {
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
  readonly analysis: Immutable<SituationAnalysis>
  readonly candidates: readonly Immutable<PolicyCandidate>[]
  readonly universalForced: Immutable<ForcedPolicyResult>
  readonly prior: Immutable<DecisionLayerSurface>
}

export interface DecisionLayerExecutionContext
extends DecisionLayerApplicabilityContext {
  /** Only declared, admitted component payloads are readable. */
  readonly components: DecisionLayerComponentReader
  /** The only capability that can mint an admissible successor surface. */
  readonly surface: DecisionLayerSurfaceFactory
}

export type DecisionLayerResult =
  | Readonly<{
      status: 'applied'
      surface: Immutable<DecisionLayerSurface>
    }>
  | Readonly<{
      status: 'degraded'
    }>

export interface DecisionLayerDefinition {
  readonly token: DecisionLayerToken
  readonly requiredComponents: readonly ComponentToken[]
  readonly degradationCode: string
  applies(context: DecisionLayerApplicabilityContext): boolean
  execute(context: DecisionLayerExecutionContext): DecisionLayerResult
}

export interface ResolvedDecisionLayerOrder {
  readonly order: readonly DecisionLayerRef[]
  readonly definitions: readonly DecisionLayerDefinition[]
}

export interface DecisionLayerJournalBase {
  readonly layer: DecisionLayerRef
  readonly priorSurvivorCandidateIds: readonly string[]
  readonly priorSelectedCandidateId?: string
  readonly componentLookups: readonly ComponentRef[]
  readonly componentReads: readonly ComponentRef[]
}

export type DecisionLayerJournalEntry =
  | Readonly<DecisionLayerJournalBase & {
      status: 'inapplicable'
    }>
  | Readonly<DecisionLayerJournalBase & {
      status: 'suppressed'
      suppressionCode:
        | 'universal-policy-selected'
        | 'prior-strategic-selection'
    }>
  | Readonly<DecisionLayerJournalBase & {
      status: 'applied'
      survivorCandidateIds: readonly string[]
      selectedCandidateId?: string
      reasonCodes: readonly string[]
      attributedComponents: readonly ComponentRef[]
    }>
  | Readonly<DecisionLayerJournalBase & {
      status: 'degraded'
      degradationCode: string
      failureCode:
        | 'applicability-failed'
        | 'execution-failed'
        | 'layer-degraded'
        | 'malformed-result'
        | 'invalid-surface'
        | 'dependency-unavailable'
    }>

export interface DecisionLayerOperationCounts {
  readonly universalCandidateIdsVisited: number
  readonly legalCandidatesVisited: number
  readonly layersVisited: number
  readonly layersSuppressed: number
  readonly applicabilityEvaluations: number
  readonly layersExecuted: number
  readonly componentLookupAttempts: number
  readonly componentPayloadIndexEntriesVisited: number
  readonly componentPayloadReads: number
  readonly componentPayloadsMaterialized: number
  readonly componentDefinitionIndexEntriesVisited: number
  readonly decisionLayerComponentRequirementsIndexed: number
  readonly componentClosureRootsVisited: number
  readonly componentDependencyEdgesVisited: number
  readonly componentClosureComponentsEmitted: number
  readonly componentAttributionUnionTokensVisited: number
  readonly componentAttributionTokensVisited: number
  readonly componentAttributionEntriesVisited: number
  readonly componentAttributionPolicyUseEntriesVisited: number
  readonly surfaceBuildAttempts: number
  readonly surfacePriorSurvivorsVisited: number
  readonly surfaceDraftSurvivorsVisited: number
  readonly surfaceReasonsVisited: number
  readonly surfaceBytesConstructed: number
}

export interface DecisionLayerRun {
  readonly version: 'decision-layer-run-v1'
  readonly configured: readonly DecisionLayerRef[]
  readonly journal: readonly DecisionLayerJournalEntry[]
  readonly surface: Immutable<DecisionLayerSurface>
  readonly componentRun: Immutable<DecisionComponentRun>
  readonly operations: DecisionLayerOperationCounts
}

/** Detached observability projection; component payloads remain in one trace field. */
export type DecisionLayerTrace = LayerRunTrace<DecisionLayerRun>

export interface DecisionLayerRunInput {
  readonly order: ResolvedDecisionLayerOrder
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
  readonly analysis: Immutable<SituationAnalysis>
  readonly candidates: readonly Immutable<PolicyCandidate>[]
  readonly universalForced: Immutable<ForcedPolicyResult>
  readonly componentDefinitions:
    readonly DecisionComponentDefinition<any>[]
  readonly componentRun: Immutable<DecisionComponentRun>
}
