import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import type {
  SituationAnalysisPlan,
} from '../analysis/situation-plan.ts'
import {
  buildScorerSituationSurface,
} from '../analysis/scorer-situation-surface.ts'
import { visibleEventCursor } from '../belief/exact.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { CognitionState } from '../cognition/types.ts'
import {
  advanceDecisionComponentRun,
  runDecisionComponents,
  type DecisionComponentInvocation,
  type DecisionComponentRun,
  type DecisionComponentTrustedHostInputProviders,
} from '../components/kernel.ts'
import type { ResolvedComposedBrain } from '../components/resolved-brain.ts'
import {
  executePreparedScoreLayerRun,
  prepareScoreLayerRunLease,
  scoreLayerDiagnosticOwnerVersion,
} from './score-layer/runner.ts'
import {
  runDecisionLayers,
} from './decision-layer/runner.ts'
import type {
  DecisionCandidateBoundary,
  DecisionLayerRun,
} from './decision-layer/types.ts'
import type {
  ResolvedScoreLayerChain,
  ScoreLayerAnalysisRef,
  ScoreLayerRow,
  ScoreLayerRun,
  ScoreLayerRunLease,
} from './score-layer/types.ts'
import {
  candidateIdForDecision,
  compareCandidateIds,
  legalCandidates,
  validateCandidateRequest,
} from './candidates.ts'
import { applyForcedPolicy } from './forced.ts'
import {
  DECISION_PLAN_VERSION,
  type PlannerCommunicationDirection,
  type DecisionPlan,
} from './plan.ts'
import {
  structuredChoice,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './score.ts'
import {
  detachTrustedPolicyData,
  type Immutable,
} from './trusted-data.ts'
import type {
  ForcedPolicyResult,
  PolicyCandidate,
} from './types.ts'

export const DECISION_FRAME_VERSION = 'decision-frame-v1'
/** Engine and simulator seeds are short; keep native policy host state bounded. */
export const MAX_NATIVE_SCORE_LAYER_SEED_LENGTH = 1_024
/** @deprecated Analysis-domain plans replace this migration alias. */
export type DecisionAnalysisPlan = SituationAnalysisPlan

export type { Immutable } from './trusted-data.ts'
export type NonEmptyReadonly<T> = readonly [T, ...T[]]

type Stage<Name extends string, Data> = Readonly<
  Coordinates & Data & { stage: Name }
>

interface Coordinates {
  readonly version: typeof DECISION_FRAME_VERSION
  readonly request: Immutable<DecisionRequest>
  readonly view: Immutable<PlayerView>
}

interface CandidateSurface {
  readonly legalCandidates: NonEmptyReadonly<Immutable<PolicyCandidate>>
}

interface AnalysisSurface {
  readonly belief: Immutable<BeliefSnapshot>
  readonly analysis: Immutable<SituationAnalysis>
  readonly hypotheticalTeamCandidates:
    | readonly Immutable<PolicyCandidate>[]
    | null
}

interface ForcedSurface {
  readonly universalForced: Immutable<ForcedPolicyResult>
  readonly forcedSurvivors: NonEmptyReadonly<Immutable<PolicyCandidate>>
}

interface ComponentSurface {
  readonly componentRun: Immutable<DecisionComponentRun>
  readonly effectiveForced: Immutable<ForcedPolicyResult>
}

interface DecisionLayerSurface {
  readonly decisionLayerRun: Immutable<DecisionLayerRun>
}

interface ScoreSurface {
  readonly candidateBoundary: Immutable<DecisionCandidateBoundary>
  readonly scores: NonEmptyReadonly<Immutable<CandidateScore>>
  readonly viableCandidates: NonEmptyReadonly<Immutable<ViableCandidate>>
  readonly structuredCandidateId: string
  readonly scorerVersion: string
  readonly degradation: readonly string[]
}

export type CanonicalDecisionFrame = Stage<'canonical', object>
export type CandidateDecisionFrame = Stage<'legal-candidates', CandidateSurface>
export type AnalyzedDecisionFrame =
  Stage<'analyzed', CandidateSurface & AnalysisSurface>
export type UniversalForcedDecisionFrame =
  Stage<
    'universal-forced',
    CandidateSurface & AnalysisSurface & ForcedSurface
  >
export type ComponentsResolvedDecisionFrame =
  Stage<
    'components-resolved',
    CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface
  >

export type DecisionLayersResolvedDecisionFrame =
  Stage<
    'decision-layers-resolved',
    CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface
      & DecisionLayerSurface
  >

export type PostComponentDecisionFrame =
  DecisionLayersResolvedDecisionFrame

export interface ViableCandidate {
  readonly candidate: Immutable<PolicyCandidate>
  readonly score: Immutable<CandidateScore & { viable: true }>
}

type ScoredData =
  CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface
  & DecisionLayerSurface & ScoreSurface

export type ScoredDecisionFrame = Stage<'scored', ScoredData>

type NativeScoreLayersResolvedData =
  CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface & {
    readonly decisionLayerRun: Immutable<DecisionLayerRun>
    readonly candidateBoundary: Immutable<DecisionCandidateBoundary>
    readonly scoreLayerRun: Immutable<ScoreLayerRun>
    readonly survivorCandidateIds: readonly string[]
    readonly scores: NonEmptyReadonly<Immutable<ScoreLayerRow>>
    readonly viableCandidates:
      NonEmptyReadonly<Immutable<NativeViableCandidate>>
    readonly structuredCandidateId: string
  }
export type NativeScoreLayersResolvedDecisionFrame =
  Stage<'native-score-layers-resolved', NativeScoreLayersResolvedData>

export interface NativeViableCandidate {
  readonly candidate: Immutable<PolicyCandidate>
  readonly score: Immutable<ScoreLayerRow & { viable: true }>
}

export interface ScoredPolicyCompatibilityDto {
  readonly candidates: readonly PolicyCandidate[]
  readonly scores: readonly CandidateScore[]
  readonly forced: ForcedPolicyResult
  readonly candidateBoundary: DecisionCandidateBoundary
  readonly structuredCandidateId: string
}

export type LegacyPlannerResolution =
  | Readonly<{ kind: 'not-run' }>
  | Readonly<{
      kind: 'accepted'
      candidateId: string
      reasonCodes?: readonly string[]
      communication?: PlannerCommunicationDirection
      degradationCode?: string
    }>
  | Readonly<{
      kind: 'rejected'
      degradationCode: string
      attemptedCandidateId?: string
    }>

type SelectedData = ScoredData & {
  readonly selected: Immutable<ViableCandidate>
  readonly planner: Immutable<LegacyPlannerResolution>
}
export type SelectedDecisionFrame = Stage<'selected', SelectedData>
type CommittedData = SelectedData & {
  readonly plan: Immutable<DecisionPlan>
  readonly mechanicalDecision: Immutable<Decision>
}
export type CommittedDecisionFrame = Stage<'committed', CommittedData>
export type VoicedDecisionFrame = Stage<'voiced', CommittedData & {
  readonly result: Immutable<Decision>
  readonly voice: Immutable<{ version: string; applied: boolean }>
}>

export interface LegacyVoicedOutputProjection {
  readonly action: Decision
  readonly scores: readonly CandidateScore[]
  readonly forced: ForcedPolicyResult
  readonly structuredCandidateId: string
  readonly selectedCandidateId: string
  readonly scorerVersion: string
  readonly degradation: readonly string[]
  readonly componentRun: DecisionComponentRun
  readonly decisionLayerRun: DecisionLayerRun
  readonly plan: DecisionPlan
}

/** 7R3 retires this compatibility adapter after scorer ownership extraction. */
export type LegacyScoringBindings = Readonly<
  Pick<
    CandidateScoringContext,
    | 'deterministicSeed'
    | 'compatibilityCandidateId'
    | 'roleUtility'
    | 'evilRoleUtility'
    | 'morganaRoleUtility'
  >
>

export interface LegacyScoringResolution {
  readonly appliedScorer: CandidateScorer
  readonly scores: readonly CandidateScore[]
  readonly degradation: readonly string[]
  readonly componentRun: DecisionComponentRun
}

/**
 * Additive private diagnostics for the native surface. Only the optional
 * feature fields are read: every mechanical field comes from the native score
 * layers, so a projection cannot restate value, viability, or reason codes.
 * `test/native-score-diagnostics.test.ts` pins that additive contract, and
 * trace admission independently replays the layers to verify the diagnostics.
 */
export interface NativeScoreDiagnostics {
  readonly scores: readonly CandidateScore[]
  readonly degradation: readonly string[]
}

interface ScoredFrameResolution {
  readonly authority: 'custom' | 'native'
  readonly scores: readonly CandidateScore[]
  readonly survivorCandidateIds: readonly string[]
  readonly scorerVersion: string
  readonly degradation: readonly string[]
  readonly componentRun: DecisionComponentRun
  /**
   * The choice its own scoring authority already made. Selection validates
   * this id rather than re-deriving the choice from a projected surface, so
   * the native and compatibility authorities cannot disagree on a tie.
   */
  readonly structuredCandidateId: string
}

export interface DecisionVoiceInput {
  readonly version: string
  readonly result: Decision
  readonly degradationCode?: string
}

function scoringContext(
  frame:
    | PostComponentDecisionFrame
    | NativeScoreLayersResolvedDecisionFrame,
  supplied: LegacyScoringBindings,
): CandidateScoringContext {
  return Object.freeze({
    ...supplied,
    request: legacy<DecisionRequest>(frame.request),
    view: legacy<PlayerView>(frame.view),
    analysis: legacy<SituationAnalysis>(frame.analysis),
    candidates: legacy<readonly PolicyCandidate[]>(frame.legalCandidates),
    forced: legacy<ForcedPolicyResult>(frame.effectiveForced),
    candidateBoundary: legacy<DecisionCandidateBoundary>(
      candidateBoundaryFor(frame),
    ),
    ...(frame.hypotheticalTeamCandidates
      ? {
          hypotheticalTeamCandidates:
            legacy<readonly PolicyCandidate[]>(
              frame.hypotheticalTeamCandidates,
            ),
        }
      : {}),
  })
}

function candidateBoundaryFor(
  frame:
    | PostComponentDecisionFrame
    | NativeScoreLayersResolvedDecisionFrame,
): Immutable<DecisionCandidateBoundary> {
  if ('candidateBoundary' in frame) return frame.candidateBoundary
  return frame.decisionLayerRun.surface
}

/** Detached compatibility view; native mechanics remain outside this DTO. */
export function projectScoringContext(
  frame:
    | PostComponentDecisionFrame
    | NativeScoreLayersResolvedDecisionFrame,
  supplied: LegacyScoringBindings,
): CandidateScoringContext {
  return structuredClone(scoringContext(frame, supplied))
}

function finalizeScoredDecisionFrame(
  frame:
    | PostComponentDecisionFrame
    | NativeScoreLayersResolvedDecisionFrame,
  context: CandidateScoringContext,
  resolution: ScoredFrameResolution,
): ScoredDecisionFrame {
  if (resolution.authority === 'custom') {
    validateCandidateScores(
      context,
      resolution.scores,
      resolution.scorerVersion,
    )
  }
  const nextRun = advanceDecisionComponentRun(
    legacy<DecisionComponentRun>(frame.componentRun),
    resolution.componentRun,
  )
  const scores = nonEmpty(
    detachTrustedPolicyData(resolution.scores),
    'scorer must return a nonempty surface',
  )
  const candidateBoundary = candidateBoundaryFor(frame)
  if (!isDeepStrictEqual(
    resolution.survivorCandidateIds,
    candidateBoundary.survivorCandidateIds,
  )) throw new Error('scored surface changed the hard candidate survivors')
  const survivors = new Map(
    frame.legalCandidates
      .filter((candidate) =>
        resolution.survivorCandidateIds.includes(candidate.id))
      .map((candidate) => [candidate.id, candidate]),
  )
  const viableCandidates = nonEmpty(
    Object.freeze(scores.flatMap((score) => {
      const candidate = survivors.get(score.candidateId)
      return score.viable && candidate ? [{ candidate, score }] : []
    })) as readonly Immutable<ViableCandidate>[],
    'scorer must retain a viable forced survivor',
  )
  const structured = scores.find((score) =>
    score.candidateId === resolution.structuredCandidateId)
  if (
    !structured?.viable
    || !survivors.has(structured.candidateId)
    || (
      candidateBoundary.selectedCandidateId !== undefined
      && structured.candidateId !== candidateBoundary.selectedCandidateId
    )
  ) {
    throw new Error('structured policy selected a nonviable candidate')
  }
  return Object.freeze({
    ...frame,
    stage: 'scored',
    componentRun: nextRun as Immutable<DecisionComponentRun>,
    candidateBoundary,
    scores,
    viableCandidates,
    structuredCandidateId: structured.candidateId,
    scorerVersion: resolution.scorerVersion,
    degradation: detachTrustedPolicyData(resolution.degradation),
  }) as ScoredDecisionFrame
}

function nonEmpty<T>(
  values: readonly T[],
  message: string,
): NonEmptyReadonly<T> {
  if (!values.length) throw new Error(message)
  return values as NonEmptyReadonly<T>
}

function legacy<T>(value: Immutable<T>): T {
  return value as T
}

function validVersion(value: string, owner: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${owner} must have a non-empty version`)
  }
}

export function canonicalDecisionFrame(
  request: DecisionRequest,
  view: PlayerView,
): CanonicalDecisionFrame {
  validateCandidateRequest(request, view)
  const coordinates = detachTrustedPolicyData({ request, view })
  return Object.freeze({
    stage: 'canonical',
    version: DECISION_FRAME_VERSION,
    request: coordinates.request,
    view: coordinates.view,
  }) as CanonicalDecisionFrame
}

export function withLegalCandidates(
  frame: CanonicalDecisionFrame,
): CandidateDecisionFrame {
  const legal = nonEmpty(
    detachTrustedPolicyData(legalCandidates(
      legacy<DecisionRequest>(frame.request),
      legacy<PlayerView>(frame.view),
    )),
    'legal candidate surface must be nonempty',
  )
  return Object.freeze({
    ...frame,
    stage: 'legal-candidates',
    legalCandidates: legal,
  }) as CandidateDecisionFrame
}

export function withDecisionAnalysis(
  frame: CandidateDecisionFrame,
  cognition: CognitionState,
  plan: SituationAnalysisPlan,
): AnalyzedDecisionFrame {
  const view = legacy<PlayerView>(frame.view)
  const cursor = visibleEventCursor(view)
  if (
    cognition.viewerSeat !== frame.view.seat
    || cognition.throughSeq !== cursor
    || cognition.belief.throughSeq !== cursor
  ) {
    throw new Error('cognition must match the decision seat and cursor')
  }
  const surface = buildScorerSituationSurface({
    view,
    belief: cognition.belief,
    evidence: cognition.evidence,
    legalCandidates: legacy<readonly PolicyCandidate[]>(
      frame.legalCandidates,
    ),
    plan,
  })
  return Object.freeze({
    ...frame,
    stage: 'analyzed',
    belief: cognition.belief as Immutable<BeliefSnapshot>,
    analysis: surface.analysis as Immutable<SituationAnalysis>,
    hypotheticalTeamCandidates: surface.hypotheticalTeamCandidates
      ? detachTrustedPolicyData(surface.hypotheticalTeamCandidates)
      : null,
  }) as AnalyzedDecisionFrame
}

export function withUniversalForcedPolicy(
  frame: AnalyzedDecisionFrame,
): UniversalForcedDecisionFrame {
  const forced = detachTrustedPolicyData(applyForcedPolicy(
    legacy<DecisionRequest>(frame.request),
    legacy<PlayerView>(frame.view),
    legacy<SituationAnalysis>(frame.analysis),
    legacy<readonly PolicyCandidate[]>(frame.legalCandidates),
  ))
  const allowed = new Set(forced.allowedCandidateIds)
  const survivors = nonEmpty(
    Object.freeze(frame.legalCandidates.filter((candidate) =>
      allowed.has(candidate.id))),
    'universal policy must retain a candidate',
  )
  return Object.freeze({
    ...frame,
    stage: 'universal-forced',
    universalForced: forced,
    forcedSurvivors: survivors,
  }) as UniversalForcedDecisionFrame
}

export async function withResolvedComponents(
  frame: UniversalForcedDecisionFrame,
  brain: ResolvedComposedBrain,
  invocation?: DecisionComponentInvocation,
  trusted?: (
    frame: UniversalForcedDecisionFrame,
  ) => DecisionComponentTrustedHostInputProviders,
): Promise<ComponentsResolvedDecisionFrame> {
  const run = await runDecisionComponents(
    brain,
    legacy<DecisionRequest>(frame.request),
    legacy<PlayerView>(frame.view),
    invocation,
    trusted?.(frame),
  )
  return Object.freeze({
    ...frame,
    stage: 'components-resolved',
    componentRun: run as Immutable<DecisionComponentRun>,
    effectiveForced: frame.universalForced,
  }) as ComponentsResolvedDecisionFrame
}

/**
 * Execute the one ordered strategic boundary after components and universal
 * policy. An empty order is an explicit behavior-neutral run.
 */
export function withResolvedDecisionLayers(
  frame: ComponentsResolvedDecisionFrame,
  brain: ResolvedComposedBrain,
  scoreLayerLease?: NativeScoreLayerLease,
): DecisionLayersResolvedDecisionFrame {
  const run = runDecisionLayers({
    order: brain.decisionLayerOrder,
    request: frame.request,
    view: frame.view,
    analysis: frame.analysis,
    candidates: frame.legalCandidates,
    universalForced: frame.universalForced,
    componentDefinitions: brain.eligibleDefinitions,
    componentRun: frame.componentRun,
  })
  const next = Object.freeze({
    ...frame,
    stage: 'decision-layers-resolved',
    componentRun: run.componentRun,
    decisionLayerRun: run as Immutable<DecisionLayerRun>,
  }) as DecisionLayersResolvedDecisionFrame
  if (scoreLayerLease) {
    LocalNativeScoreLayerLease.advanceDecisionLayers(
      scoreLayerLease,
      frame,
      next,
    )
  }
  return next
}

/**
 * The custom scoring authority's own choice rule. Native score layers choose
 * inside their run, so this rule belongs to caller-supplied scorers only.
 */
function customStructuredChoice(
  candidateBoundary: Immutable<DecisionCandidateBoundary>,
  scores: readonly CandidateScore[],
): string {
  return candidateBoundary.selectedCandidateId
    ?? structuredChoice(scores).candidateId
}

/** Run the C4B scorer/fallback owner synchronously against one exact frame. */
export function withCustomScoring(
  frame: PostComponentDecisionFrame,
  bindings: (run: DecisionComponentRun) => LegacyScoringBindings,
  resolve: (
    context: Readonly<CandidateScoringContext>,
    run: DecisionComponentRun,
  ) => LegacyScoringResolution,
): ScoredDecisionFrame {
  const run = legacy<DecisionComponentRun>(frame.componentRun)
  const supplied = bindings(run)
  const context = scoringContext(frame, supplied)
  const resolution = resolve(context, run)
  const candidateBoundary = candidateBoundaryFor(frame)
  return finalizeScoredDecisionFrame(frame, context, {
    authority: 'custom',
    scores: [...resolution.scores],
    survivorCandidateIds: candidateBoundary.survivorCandidateIds,
    scorerVersion: resolution.appliedScorer.version,
    degradation: resolution.degradation,
    componentRun: resolution.componentRun,
    structuredCandidateId: customStructuredChoice(
      candidateBoundary,
      resolution.scores,
    ),
  })
}

/** Detached DTO for the compatibility planner and plan builders. */
export function projectScoredFrameForCompatibility(
  frame: ScoredDecisionFrame,
): ScoredPolicyCompatibilityDto {
  return structuredClone({
    candidates: frame.legalCandidates,
    scores: frame.scores,
    forced: frame.effectiveForced,
    candidateBoundary: frame.candidateBoundary,
    structuredCandidateId: frame.structuredCandidateId,
  }) as ScoredPolicyCompatibilityDto
}

export interface NativeScoreLayerHostContext {
  readonly deterministicSeed: string
  readonly compatibilityCandidateId: string
}

declare const NATIVE_SCORE_LAYER_LEASE_BRAND: unique symbol

export interface NativeScoreLayerLease {
  readonly version: 'native-score-layer-lease-v1'
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly [NATIVE_SCORE_LAYER_LEASE_BRAND]: true
}

class LocalNativeScoreLayerLease {
  readonly version = 'native-score-layer-lease-v1'
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly #brain: ResolvedComposedBrain
  readonly #request: CandidateDecisionFrame['request']
  readonly #view: CandidateDecisionFrame['view']
  readonly #candidates: CandidateDecisionFrame['legalCandidates']
  readonly #lease: ScoreLayerRunLease
  #bindingStarted = false
  #boundFrame:
    | ComponentsResolvedDecisionFrame
    | PostComponentDecisionFrame
    | undefined

  constructor(
    frame: CandidateDecisionFrame,
    brain: ResolvedComposedBrain,
  ) {
    if (!brain.scoreLayerChain) {
      throw new Error('native score layers require a resolved score-layer chain')
    }
    this.#brain = brain
    this.#request = frame.request
    this.#view = frame.view
    this.#candidates = frame.legalCandidates
    this.#lease = prepareScoreLayerRunLease({
      chain: brain.scoreLayerChain,
      componentDefinitions: brain.configuredDefinitions,
      request: frame.request,
      view: frame.view,
    })
    this.requirements = this.#lease.requirements
    Object.freeze(this)
  }

  static async bindComponents(
    lease: NativeScoreLayerLease,
    frame: UniversalForcedDecisionFrame,
    brain: ResolvedComposedBrain,
    invocation?: DecisionComponentInvocation,
    trusted?: (
      frame: UniversalForcedDecisionFrame,
    ) => DecisionComponentTrustedHostInputProviders,
  ): Promise<ComponentsResolvedDecisionFrame> {
    if (!(lease instanceof LocalNativeScoreLayerLease)) {
      throw new Error('native score layers require their local prepared lease')
    }
    if (brain !== lease.#brain) {
      throw new Error('native score layer lease belongs to a different brain')
    }
    if (
      frame.request !== lease.#request
      || frame.view !== lease.#view
      || frame.legalCandidates !== lease.#candidates
    ) {
      throw new Error(
        'native score layer lease does not belong to this decision frame',
      )
    }
    if (lease.#bindingStarted) {
      throw new Error('native score layer lease was already bound')
    }
    lease.#bindingStarted = true
    const resolved = await withResolvedComponents(
      frame,
      brain,
      invocation,
      trusted,
    )
    lease.#boundFrame = resolved
    return resolved
  }

  static execute(
    lease: NativeScoreLayerLease,
    frame: PostComponentDecisionFrame,
    host: NativeScoreLayerHostContext,
  ): ScoreLayerRun {
    if (!(lease instanceof LocalNativeScoreLayerLease)) {
      throw new Error('native score layers require their local prepared lease')
    }
    if (!lease.#boundFrame) {
      throw new Error('native score layer lease has no bound component frame')
    }
    if (frame !== lease.#boundFrame) {
      throw new Error(
        'native score layer lease belongs to a different component frame',
      )
    }
    return executePreparedScoreLayerRun(lease.#lease, {
      analysis: frame.analysis,
      candidates: frame.legalCandidates,
      forced: frame.effectiveForced,
      candidateBoundary: candidateBoundaryFor(frame),
      componentRun: frame.componentRun,
      deterministicSeed: host.deterministicSeed,
      compatibilityCandidateId: host.compatibilityCandidateId,
      hypotheticalTeamCandidates: frame.hypotheticalTeamCandidates,
    })
  }

  static advanceDecisionLayers(
    lease: NativeScoreLayerLease,
    before: ComponentsResolvedDecisionFrame,
    after: DecisionLayersResolvedDecisionFrame,
  ): void {
    if (!(lease instanceof LocalNativeScoreLayerLease)) {
      throw new Error('native score layers require their local prepared lease')
    }
    if (lease.#boundFrame !== before) {
      throw new Error(
        'native score layer lease is not bound to the decision-layer input',
      )
    }
    if (
      after.stage !== 'decision-layers-resolved'
      || after.request !== before.request
      || after.view !== before.view
      || after.legalCandidates !== before.legalCandidates
      || after.analysis !== before.analysis
      || after.belief !== before.belief
      || after.universalForced !== before.universalForced
      || after.forcedSurvivors !== before.forcedSurvivors
      || after.effectiveForced !== before.effectiveForced
      || after.hypotheticalTeamCandidates
        !== before.hypotheticalTeamCandidates
    ) {
      throw new Error(
        'native score layer lease received a foreign decision-layer frame',
      )
    }
    lease.#boundFrame = after
  }
}

/**
 * Prepare one local native scoring capability after legal candidates exist
 * and before analysis planning consumes its bounded requirements.
 */
export function prepareNativeScoreLayers(
  frame: CandidateDecisionFrame,
  brain: ResolvedComposedBrain,
): NativeScoreLayerLease {
  return new LocalNativeScoreLayerLease(
    frame,
    brain,
  ) as unknown as NativeScoreLayerLease
}

/**
 * Bind the native lease to the sole component transition and its exact result.
 */
export async function withNativeResolvedComponents(
  frame: UniversalForcedDecisionFrame,
  brain: ResolvedComposedBrain,
  lease: NativeScoreLayerLease,
  invocation?: DecisionComponentInvocation,
  trusted?: (
    frame: UniversalForcedDecisionFrame,
  ) => DecisionComponentTrustedHostInputProviders,
): Promise<ComponentsResolvedDecisionFrame> {
  return LocalNativeScoreLayerLease.bindComponents(
    lease,
    frame,
    brain,
    invocation,
    trusted,
  )
}

/** Resolve the sole built-in scoring authority through its ordered layers. */
export function withNativeScoreLayers(
  frame: PostComponentDecisionFrame,
  lease: NativeScoreLayerLease,
  host: NativeScoreLayerHostContext,
): NativeScoreLayersResolvedDecisionFrame {
  if (
    typeof host.deterministicSeed !== 'string'
    || !host.deterministicSeed.trim()
    || host.deterministicSeed.length > MAX_NATIVE_SCORE_LAYER_SEED_LENGTH
  ) throw new Error('native score layers require a nonempty bounded seed')
  const legalCandidateIds = new Set(
    frame.legalCandidates.map((candidate) => candidate.id),
  )
  if (!legalCandidateIds.has(host.compatibilityCandidateId)) {
    throw new Error(
      'native score layers require a legal compatibility candidate',
    )
  }
  const run = LocalNativeScoreLayerLease.execute(lease, frame, host)
  const scores = nonEmpty(
    run.surface.scores,
    'native score layers must produce a nonempty score surface',
  )
  const survivorIds = new Set(run.surface.survivorCandidateIds)
  const survivors = new Map(
    frame.legalCandidates
      .filter((candidate) => survivorIds.has(candidate.id))
      .map((candidate) => [candidate.id, candidate]),
  )
  const viableCandidates = nonEmpty(
    Object.freeze(scores.flatMap((score) => {
      const candidate = survivors.get(score.candidateId)
      return score.viable && candidate
        ? [Object.freeze({ candidate, score })]
        : []
    })) as readonly Immutable<NativeViableCandidate>[],
    'native score layers must retain a viable hard survivor',
  )
  const candidateBoundary = candidateBoundaryFor(frame)
  const structured = candidateBoundary.selectedCandidateId
    ? scores.find((score) =>
        score.candidateId === candidateBoundary.selectedCandidateId)
    : viableCandidates.map((entry) => entry.score).reduce((best, score) =>
        score.value > best.value
          || (
            score.value === best.value
            && compareCandidateIds(score.candidateId, best.candidateId) < 0
          )
          ? score
          : best)
  if (!structured?.viable || !survivors.has(structured.candidateId)) {
    throw new Error('native score layers selected a nonviable hard survivor')
  }
  return Object.freeze({
    ...frame,
    stage: 'native-score-layers-resolved',
    componentRun: run.componentRun,
    candidateBoundary,
    scoreLayerRun: run as Immutable<ScoreLayerRun>,
    survivorCandidateIds: run.surface.survivorCandidateIds,
    scores,
    viableCandidates,
    structuredCandidateId: structured.candidateId,
  }) as NativeScoreLayersResolvedDecisionFrame
}

export function nativeScorerVersion(
  frame: NativeScoreLayersResolvedDecisionFrame,
): string {
  const active = [...frame.scoreLayerRun.journal].reverse().find(
    (entry) => entry.status === 'applied' || entry.status === 'generated',
  )
  if (!active) {
    throw new Error('native score layers produced no active scorer')
  }
  return active.layer.version
}

export function nativeDiagnosticOwnerVersion(
  frame: NativeScoreLayersResolvedDecisionFrame,
  chain: ResolvedScoreLayerChain,
): string {
  return scoreLayerDiagnosticOwnerVersion(frame.scoreLayerRun, chain)
}

/**
 * Admit the native score-layer result into the one scored frame consumed by
 * selection, planning, commitment, voice, and tracing. The native surface owns
 * every mechanical field and the choice its layers made; diagnostics only
 * attach private per-candidate features.
 */
export function withNativeScoringAuthority(
  frame: NativeScoreLayersResolvedDecisionFrame,
  bindings: LegacyScoringBindings,
  diagnostics: NativeScoreDiagnostics,
): ScoredDecisionFrame {
  const scorerVersion = nativeScorerVersion(frame)
  const diagnosticById = new Map(
    diagnostics.scores.map((score) => [score.candidateId, score]),
  )
  if (
    diagnosticById.size !== diagnostics.scores.length
    || diagnosticById.size !== frame.scores.length
  ) {
    throw new Error('native scoring diagnostics do not cover the native surface')
  }
  const scores = frame.scores.map((native): CandidateScore => {
    const diagnostic = diagnosticById.get(native.candidateId)
    if (!diagnostic) {
      throw new Error(
        `native scoring diagnostics omitted ${native.candidateId}`,
      )
    }
    return {
      ...structuredClone(diagnostic),
      version: scorerVersion,
      candidateId: native.candidateId,
      value: native.value,
      viable: native.viable,
      reasonCodes: [...native.reasonCodes],
    }
  })
  return finalizeScoredDecisionFrame(
    frame,
    scoringContext(frame, bindings),
    {
      authority: 'native',
      scores,
      survivorCandidateIds: frame.survivorCandidateIds,
      scorerVersion,
      degradation: diagnostics.degradation,
      componentRun: legacy<DecisionComponentRun>(frame.componentRun),
      structuredCandidateId: frame.structuredCandidateId,
    },
  )
}

export function selectDecisionCandidate(
  frame: ScoredDecisionFrame,
  planner: LegacyPlannerResolution,
  attributeStructuredChoice?: (
    run: DecisionComponentRun,
  ) => DecisionComponentRun,
): SelectedDecisionFrame {
  if (
    planner.kind === 'accepted'
    && frame.candidateBoundary.selectedCandidateId !== undefined
  ) throw new Error('planner cannot override a hard policy choice')
  const id = planner.kind === 'accepted'
    ? planner.candidateId
    : frame.structuredCandidateId
  const selected = frame.viableCandidates.find(
    (candidate) => candidate.candidate.id === id,
  )
  if (!selected) throw new Error('planner selected a nonviable candidate')
  const componentRun = (
      planner.kind !== 'accepted'
      && frame.candidateBoundary.selectedCandidateId === undefined
      && attributeStructuredChoice
    )
    ? advanceDecisionComponentRun(
        legacy<DecisionComponentRun>(frame.componentRun),
        attributeStructuredChoice(
          legacy<DecisionComponentRun>(frame.componentRun),
        ),
      )
    : frame.componentRun
  return Object.freeze({
    ...frame,
    stage: 'selected',
    selected,
    planner: detachTrustedPolicyData(planner),
    componentRun: componentRun as Immutable<DecisionComponentRun>,
    degradation: detachTrustedPolicyData([
      ...frame.degradation,
      ...(planner.kind !== 'not-run' && planner.degradationCode
        ? [planner.degradationCode]
        : []),
    ]),
  }) as SelectedDecisionFrame
}

function mechanical(decision: Decision): Decision {
  const result = structuredClone(decision)
  delete result.thinking
  delete result.notes
  if (result.kind === 'discuss') result.say = ''
  if (result.kind === 'propose') delete result.pitch
  if (result.kind === 'finalize' && !result.stick) delete result.reason
  return result
}

/** The selected frame is the sole owner of mechanical communication stripping. */
export function selectedMechanicalDecision(
  frame: SelectedDecisionFrame,
): Decision {
  return structuredClone(mechanical(
    legacy<Decision>(frame.selected.candidate.decision),
  ))
}

export function commitDecision(
  frame: SelectedDecisionFrame,
  supplied: DecisionPlan,
): CommittedDecisionFrame {
  const decision = selectedMechanicalDecision(frame)
  if (
    supplied.version !== DECISION_PLAN_VERSION
    || supplied.candidateId !== frame.selected.candidate.id
    || supplied.beliefThroughSeq !== frame.belief.throughSeq
    || !isDeepStrictEqual(supplied.request, frame.request)
    || !isDeepStrictEqual(supplied.decision, decision)
    || !isDeepStrictEqual(supplied.candidateScores, frame.scores)
  ) throw new Error('committed plan does not belong to the selected frame')
  validVersion(supplied.policyId, 'committed policy')
  const plan = detachTrustedPolicyData(supplied)
  return Object.freeze({
    ...frame,
    stage: 'committed',
    plan,
    mechanicalDecision: detachTrustedPolicyData(decision),
  }) as CommittedDecisionFrame
}

export function withDecisionVoice(
  frame: CommittedDecisionFrame,
  input: DecisionVoiceInput,
): VoicedDecisionFrame {
  validVersion(input.version, 'voice')
  if (!isDeepStrictEqual(
    mechanical(input.result),
    frame.mechanicalDecision,
  )) throw new Error('voice cannot alter committed mechanics')
  const applied = !isDeepStrictEqual(input.result, frame.mechanicalDecision)
  const result = detachTrustedPolicyData(input.result)
  return Object.freeze({
    ...frame,
    stage: 'voiced',
    result,
    voice: detachTrustedPolicyData({
      version: input.version,
      applied,
    }),
    degradation: detachTrustedPolicyData([
      ...frame.degradation,
      ...(input.degradationCode ? [input.degradationCode] : []),
    ]),
  }) as VoicedDecisionFrame
}

/** Detached DTO for legacy trace, memory, and agent-output consumers. */
export function projectVoicedFrameForLegacy(
  frame: VoicedDecisionFrame,
): LegacyVoicedOutputProjection {
  return structuredClone({
    action: frame.result,
    scores: frame.scores,
    forced: frame.effectiveForced,
    structuredCandidateId: frame.structuredCandidateId,
    selectedCandidateId: frame.selected.candidate.id,
    scorerVersion: frame.scorerVersion,
    degradation: frame.degradation,
    componentRun: frame.componentRun,
    decisionLayerRun: frame.decisionLayerRun,
    plan: frame.plan,
  }) as LegacyVoicedOutputProjection
}
