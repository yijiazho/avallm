import type {
  DecisionRequest,
  PlayerView,
} from '../../../engine/types.ts'
import type { SituationAnalysis } from '../../analysis/types.ts'
import type {
  DecisionComponentDefinition,
} from '../../components/types.ts'
import type {
  DecisionComponentRun,
} from '../../components/kernel.ts'
import type {
  ComponentRef,
  ComponentToken,
} from '../../components/types.ts'
import type { Immutable } from '../trusted-data.ts'
import type {
  ForcedPolicyResult,
  PolicyCandidate,
} from '../types.ts'
import type {
  DecisionCandidateBoundary,
} from '../decision-layer/types.ts'

declare const SCORE_LAYER_TOKEN_BRAND: unique symbol
declare const SCORE_LAYER_SURFACE_BRAND: unique symbol
declare const SCORE_LAYER_RUN_LEASE_BRAND: unique symbol

export interface ScoreLayerRef {
  readonly id: string
  readonly version: string
}

export interface ScoreLayerToken extends ScoreLayerRef {
  readonly [SCORE_LAYER_TOKEN_BRAND]: true
}

/** Create the only branded score-layer token; the brand is erased at runtime. */
export function scoreLayerToken(
  id: string,
  version: string,
): ScoreLayerToken {
  return Object.freeze({ id, version }) as ScoreLayerToken
}

export interface ScoreLayerSurface {
  readonly version: 'score-layer-surface-v1'
  readonly scores: readonly Immutable<ScoreLayerRow>[]
  /**
   * Hard policy survivors in legal-candidate order. Layers may narrow this
   * set, but ScoreLayerRow.viable remains a layer-local ranking signal.
   */
  readonly survivorCandidateIds: readonly string[]
  readonly [SCORE_LAYER_SURFACE_BRAND]: true
}

/** Common native score row. Family-owned diagnostics stay outside this seam. */
export interface ScoreLayerRow {
  readonly candidateId: string
  readonly value: number
  readonly viable: boolean
  readonly reasonCodes: readonly string[]
}

export interface ScoreLayerRowDraft {
  readonly candidateId: string
  readonly value: number
  readonly viable: boolean
  readonly reasonCodes: readonly string[]
}

export interface ScoreLayerSurfaceDraft {
  readonly scores: readonly ScoreLayerRowDraft[]
  readonly survivorCandidateIds: readonly string[]
}

export interface ScoreLayerSurfaceFactory {
  create(draft: ScoreLayerSurfaceDraft): Immutable<ScoreLayerSurface>
}

export interface ScoreLayerComponentReader {
  get<Payload>(
    token: ComponentToken<Payload>,
  ): Immutable<Payload> | undefined
  require<Payload>(token: ComponentToken<Payload>): Immutable<Payload>
}

export interface ScoreLayerApplicabilityContext {
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
  readonly analysis: Immutable<SituationAnalysis>
  readonly candidates: readonly Immutable<PolicyCandidate>[]
  /** Hard survivors after universal policy and strategic decision layers. */
  readonly candidateBoundary: Immutable<DecisionCandidateBoundary>
  /** Universal policy remains separately attributable and is never relabeled. */
  readonly forced: Immutable<ForcedPolicyResult>
  readonly deterministicSeed: string
  readonly compatibilityCandidateId: string
  readonly hypotheticalTeamCandidates:
    | readonly Immutable<PolicyCandidate>[]
    | null
}

export interface ScoreLayerAnalysisRef extends ScoreLayerRef {}

export interface ScoreLayerAnalysisRequirementContext {
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
}

/**
 * Family-owned proof that the post-analysis frame actually fulfills the
 * opaque profiles requested before analysis ran.
 */
export interface ScoreLayerAnalysisAdmissionContext
extends ScoreLayerAnalysisRequirementContext {
  readonly analysis: Immutable<SituationAnalysis>
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly candidates: readonly Immutable<PolicyCandidate>[]
  readonly hypotheticalTeamCandidates:
    | readonly Immutable<PolicyCandidate>[]
    | null
}

export interface ScoreLayerExecutionContext
extends ScoreLayerApplicabilityContext {
  /** Only declared, admitted decision-component payloads are readable. */
  readonly components: ScoreLayerComponentReader
  readonly surface: ScoreLayerSurfaceFactory
}

export interface ScoreLayerTransformContext
extends ScoreLayerExecutionContext {
  readonly prior: Immutable<ScoreLayerSurface>
}

export interface ScoreLayerRootResult {
  readonly status: 'generated'
  readonly surface: Immutable<ScoreLayerSurface>
}

export type ScoreLayerTransformResult =
  | Readonly<{
      status: 'applied'
      surface: Immutable<ScoreLayerSurface>
    }>
  | Readonly<{
      status: 'degraded'
    }>

interface ScoreLayerDefinitionBase {
  readonly token: ScoreLayerToken
  readonly requiredComponents: readonly ComponentToken[]
  analysisRequirements(
    context: ScoreLayerAnalysisRequirementContext,
  ): readonly ScoreLayerAnalysisRef[]
  admitAnalysis(context: ScoreLayerAnalysisAdmissionContext): boolean
}

export interface ScoreLayerRootDefinition
extends ScoreLayerDefinitionBase {
  readonly kind: 'root'
  execute(context: ScoreLayerExecutionContext): ScoreLayerRootResult
}

export interface ScoreLayerTransformDefinition
extends ScoreLayerDefinitionBase {
  readonly kind: 'transform'
  /** One predecessor produces a chain; multiple parents are not representable. */
  readonly predecessor: ScoreLayerRef
  readonly degradationCode: string
  applies(context: ScoreLayerApplicabilityContext): boolean
  execute(context: ScoreLayerTransformContext): ScoreLayerTransformResult
}

export type ScoreLayerDefinition =
  | ScoreLayerRootDefinition
  | ScoreLayerTransformDefinition

export interface ResolvedScoreLayerChain {
  readonly terminal: ScoreLayerRef
  readonly order: readonly ScoreLayerRef[]
  readonly definitions: readonly ScoreLayerDefinition[]
}

interface ScoreLayerJournalBase {
  readonly layer: ScoreLayerRef
  readonly analysisRequirements: readonly ScoreLayerAnalysisRef[]
  readonly analysisAdmission: 'admitted' | 'failed' | 'not-run'
  readonly componentLookups: readonly ComponentRef[]
  readonly componentReads: readonly ComponentRef[]
}

export type ScoreLayerJournalEntry =
  | Readonly<ScoreLayerJournalBase & {
      status: 'generated'
      attributedComponents: readonly ComponentRef[]
    }>
  | Readonly<ScoreLayerJournalBase & {
      status: 'inapplicable'
    }>
  | Readonly<ScoreLayerJournalBase & {
      status: 'applied'
      attributedComponents: readonly ComponentRef[]
    }>
  | Readonly<ScoreLayerJournalBase & {
      status: 'degraded'
      degradationCode: string
      failureCode:
        | 'analysis-requirement-failed'
        | 'analysis-admission-failed'
        | 'applicability-failed'
        | 'execution-failed'
        | 'layer-degraded'
        | 'malformed-result'
        | 'invalid-score-surface'
    }>

export interface ScoreLayerOperationCounts {
  readonly analysisRequirementEvaluations: number
  readonly analysisRequirementFailures: number
  readonly analysisRefsVisited: number
  readonly analysisAdmissionEvaluations: number
  readonly analysisAdmissionFailures: number
  readonly forcedCandidateIdsVisited: number
  readonly candidateBoundaryIdsVisited: number
  readonly legalCandidatesVisited: number
  readonly applicabilityEvaluations: number
  readonly layersExecuted: number
  readonly componentLookupAttempts: number
  readonly componentPayloadIndexEntriesVisited: number
  /** Unique run-wide component entry resolutions, including unavailable ones. */
  readonly componentPayloadReads: number
  /** Unique admitted payloads placed in the invocation cache. */
  readonly componentPayloadsMaterialized: number
  readonly componentDefinitionIndexEntriesVisited: number
  readonly scoreLayerComponentRequirementsIndexed: number
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
  readonly surfaceRowsVisited: number
  readonly surfaceReasonsVisited: number
  /** Exact JSON bytes of all successfully constructed invocation surfaces. */
  readonly surfaceBytesConstructed: number
}

export interface ScoreLayerRunLease {
  readonly version: 'score-layer-run-lease-v1'
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly [SCORE_LAYER_RUN_LEASE_BRAND]: true
}

export interface ScoreLayerRun {
  readonly version: 'score-layer-run-v1'
  readonly configured: readonly ScoreLayerRef[]
  readonly journal: readonly ScoreLayerJournalEntry[]
  readonly surface: Immutable<ScoreLayerSurface>
  readonly componentRun: Immutable<DecisionComponentRun>
  readonly operations: ScoreLayerOperationCounts
}

export interface ScoreLayerRunCompletion {
  readonly analysis: Immutable<SituationAnalysis>
  readonly candidates: readonly Immutable<PolicyCandidate>[]
  readonly candidateBoundary: Immutable<DecisionCandidateBoundary>
  readonly forced: Immutable<ForcedPolicyResult>
  readonly deterministicSeed: string
  readonly compatibilityCandidateId: string
  readonly hypotheticalTeamCandidates:
    | readonly Immutable<PolicyCandidate>[]
    | null
  readonly componentRun: Immutable<DecisionComponentRun>
}

export interface ScoreLayerRunPreparation {
  readonly chain: ResolvedScoreLayerChain
  readonly componentDefinitions:
    readonly DecisionComponentDefinition<any>[]
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
}
