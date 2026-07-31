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
import type {
  ResolvedArchitectureDescriptor,
  ResolvedComposedBrain,
} from '../components/resolved-brain.ts'
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
  ScoreLayerTrace,
  ScoreLayerRunLease,
} from './score-layer/types.ts'
import { projectLayerRun } from './layer-registry-common.ts'
import {
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
  selectTopViableScore,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './score.ts'
import { validateCandidateScores } from './candidate-score-validation.ts'
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
  /**
   * The frozen data-only descriptor of the brain that resolved this run. A
   * later transition proves brain agreement by comparing this one reference, so
   * no mutable binding state is needed to establish that the run and the
   * score-layer chain came from the same brain.
   */
  readonly resolvedArchitecture: ResolvedArchitectureDescriptor
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
  /** Present for the native authority; absent for custom compatibility scorers. */
  readonly scoreLayerRun?: Immutable<ScoreLayerRun>
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

export type CompatibilityPlannerResolution =
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
  readonly planner: Immutable<CompatibilityPlannerResolution>
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

export interface DecisionFrameTrace {
  readonly version: typeof DECISION_FRAME_VERSION
  readonly committedMechanicalAction: Decision
  readonly voice: {
    readonly version: string
    readonly applied: boolean
  }
}

export interface CompatibilityVoicedOutputProjection {
  readonly action: Decision
  readonly scores: readonly CandidateScore[]
  readonly forced: ForcedPolicyResult
  readonly structuredCandidateId: string
  readonly selectedCandidateId: string
  readonly scorerVersion: string
  readonly degradation: readonly string[]
  readonly componentRun: DecisionComponentRun
  readonly decisionLayerRun: DecisionLayerRun
  readonly scoreLayerRun?: ScoreLayerTrace
  readonly decisionFrame: DecisionFrameTrace
  readonly plan: DecisionPlan
}

/**
 * Caller-supplied scoring inputs threaded to both the custom and native
 * scoring authorities. This is the live seam that carries the deterministic
 * seed and the role-utility feature reads into whichever authority scores the
 * frame.
 */
export type CompatibilityScoringBindings = Readonly<
  Pick<
    CandidateScoringContext,
    | 'deterministicSeed'
    | 'compatibilityCandidateId'
    | 'roleUtility'
    | 'evilRoleUtility'
    | 'morganaRoleUtility'
  >
>

export interface CompatibilityScoringResolution {
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
  supplied: CompatibilityScoringBindings,
): CandidateScoringContext {
  return Object.freeze({
    ...supplied,
    request: unbrand<DecisionRequest>(frame.request),
    view: unbrand<PlayerView>(frame.view),
    analysis: unbrand<SituationAnalysis>(frame.analysis),
    candidates: unbrand<readonly PolicyCandidate[]>(frame.legalCandidates),
    forced: unbrand<ForcedPolicyResult>(frame.effectiveForced),
    candidateBoundary: unbrand<DecisionCandidateBoundary>(
      candidateBoundaryFor(frame),
    ),
    ...(frame.hypotheticalTeamCandidates
      ? {
          hypotheticalTeamCandidates:
            unbrand<readonly PolicyCandidate[]>(
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
  supplied: CompatibilityScoringBindings,
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
    unbrand<DecisionComponentRun>(frame.componentRun),
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
  const { survivors, viable } = deriveViableCandidates(
    frame.legalCandidates,
    resolution.survivorCandidateIds,
    scores,
    false,
  )
  const viableCandidates = nonEmpty(
    viable as readonly Immutable<ViableCandidate>[],
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

/** Drop the Immutable brand to hand frozen frame data to a plain-typed API. */
function unbrand<T>(value: Immutable<T>): T {
  return value as T
}

/**
 * Join the survivor legal candidates to their scores and keep the viable ones,
 * paired with the survivor lookup both scoring authorities also consult for
 * their structured-choice guard. Native entries are individually frozen; the
 * custom path leaves them unfrozen, matching each authority's prior shape.
 */
function deriveViableCandidates<
  S extends { readonly candidateId: string; readonly viable: boolean },
>(
  legalCandidates: readonly Immutable<PolicyCandidate>[],
  survivorCandidateIds: readonly string[],
  scores: readonly S[],
  freezeEntry: boolean,
): {
  readonly survivors: ReadonlyMap<string, Immutable<PolicyCandidate>>
  readonly viable: readonly {
    readonly candidate: Immutable<PolicyCandidate>
    readonly score: S
  }[]
} {
  const survivorIds = new Set(survivorCandidateIds)
  const survivors = new Map(
    legalCandidates
      .filter((candidate) => survivorIds.has(candidate.id))
      .map((candidate) => [candidate.id, candidate] as const),
  )
  const viable = Object.freeze(scores.flatMap((score) => {
    const candidate = survivors.get(score.candidateId)
    if (!score.viable || !candidate) return []
    const entry = { candidate, score }
    return [freezeEntry ? Object.freeze(entry) : entry]
  }))
  return { survivors, viable }
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
      unbrand<DecisionRequest>(frame.request),
      unbrand<PlayerView>(frame.view),
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
  const view = unbrand<PlayerView>(frame.view)
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
    legalCandidates: unbrand<readonly PolicyCandidate[]>(
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
    unbrand<DecisionRequest>(frame.request),
    unbrand<PlayerView>(frame.view),
    unbrand<SituationAnalysis>(frame.analysis),
    unbrand<readonly PolicyCandidate[]>(frame.legalCandidates),
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
    unbrand<DecisionRequest>(frame.request),
    unbrand<PlayerView>(frame.view),
    invocation,
    trusted?.(frame),
  )
  return Object.freeze({
    ...frame,
    stage: 'components-resolved',
    componentRun: run as Immutable<DecisionComponentRun>,
    effectiveForced: frame.universalForced,
    resolvedArchitecture: brain.description,
  }) as ComponentsResolvedDecisionFrame
}

/**
 * Execute the one ordered strategic boundary after components and universal
 * policy. An empty order is an explicit behavior-neutral run.
 */
export function withResolvedDecisionLayers(
  frame: ComponentsResolvedDecisionFrame,
  brain: ResolvedComposedBrain,
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
  return Object.freeze({
    ...frame,
    stage: 'decision-layers-resolved',
    componentRun: run.componentRun,
    decisionLayerRun: run as Immutable<DecisionLayerRun>,
  }) as DecisionLayersResolvedDecisionFrame
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
    ?? selectTopViableScore(scores).candidateId
}

/** Run the custom scorer/fallback owner synchronously against one exact frame. */
export function withCustomScoring(
  frame: PostComponentDecisionFrame,
  bindings: (run: DecisionComponentRun) => CompatibilityScoringBindings,
  resolve: (
    context: Readonly<CandidateScoringContext>,
    run: DecisionComponentRun,
  ) => CompatibilityScoringResolution,
): ScoredDecisionFrame {
  const run = unbrand<DecisionComponentRun>(frame.componentRun)
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

/**
 * The frame and brain one native scoring preparation belongs to, alongside the
 * single branded run capability that `score-layer/runner.ts` issues.
 *
 * This is plain frozen data rather than a second branded capability. The run
 * lease it carries is already unforgeable, and the coordinates below are what
 * the later transition checks the frame against, so wrapping them in another
 * one-shot class only duplicated that guarantee.
 */
export interface PreparedNativeScoreLayers {
  readonly version: 'native-score-layer-preparation-v1'
  readonly requirements: readonly ScoreLayerAnalysisRef[]
  readonly brain: ResolvedComposedBrain
  readonly request: CandidateDecisionFrame['request']
  readonly view: CandidateDecisionFrame['view']
  readonly legalCandidates: CandidateDecisionFrame['legalCandidates']
  readonly run: ScoreLayerRunLease
}

/**
 * Reject a preparation that was not built from this frame's exact coordinates
 * or from the brain that resolved this frame's components.
 *
 * The coordinate check replaces the former stateful frame-instance binding: a
 * preparation carries only the score-layer chain and the analysis requirements
 * derived from (request, view), so any component run over the same coordinates
 * scores identically. The configured-component comparison keeps the guarantee
 * that actually mattered, which is that the run and the chain came from one
 * brain, without needing mutable binding state to prove it.
 */
function ownsFrame(
  prepared: PreparedNativeScoreLayers,
  frame: PostComponentDecisionFrame,
): void {
  if (
    frame.request !== prepared.request
    || frame.view !== prepared.view
    || frame.legalCandidates !== prepared.legalCandidates
  ) {
    throw new Error(
      'native score layer preparation does not belong to this decision frame',
    )
  }
  if (frame.resolvedArchitecture !== prepared.brain.description) {
    throw new Error(
      'native score layer preparation belongs to a different brain',
    )
  }
}

/**
 * Prepare one native scoring run after legal candidates exist and before
 * analysis planning consumes its bounded requirements.
 */
export function prepareNativeScoreLayers(
  frame: CandidateDecisionFrame,
  brain: ResolvedComposedBrain,
): PreparedNativeScoreLayers {
  if (!brain.scoreLayerChain) {
    throw new Error('native score layers require a resolved score-layer chain')
  }
  const run = prepareScoreLayerRunLease({
    chain: brain.scoreLayerChain,
    componentDefinitions: brain.configuredDefinitions,
    request: frame.request,
    view: frame.view,
  })
  return Object.freeze({
    version: 'native-score-layer-preparation-v1',
    requirements: run.requirements,
    brain,
    request: frame.request,
    view: frame.view,
    legalCandidates: frame.legalCandidates,
    run,
  })
}

/** Resolve the sole built-in scoring authority through its ordered layers. */
export function withNativeScoreLayers(
  frame: PostComponentDecisionFrame,
  prepared: PreparedNativeScoreLayers,
  host: NativeScoreLayerHostContext,
): NativeScoreLayersResolvedDecisionFrame {
  ownsFrame(prepared, frame)
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
  const run = executePreparedScoreLayerRun(prepared.run, {
    analysis: frame.analysis,
    candidates: frame.legalCandidates,
    forced: frame.effectiveForced,
    candidateBoundary: candidateBoundaryFor(frame),
    componentRun: frame.componentRun,
    deterministicSeed: host.deterministicSeed,
    compatibilityCandidateId: host.compatibilityCandidateId,
    hypotheticalTeamCandidates: frame.hypotheticalTeamCandidates,
  })
  const scores = nonEmpty(
    run.surface.scores,
    'native score layers must produce a nonempty score surface',
  )
  const { survivors, viable } = deriveViableCandidates(
    frame.legalCandidates,
    run.surface.survivorCandidateIds,
    scores,
    true,
  )
  const viableCandidates = nonEmpty(
    viable as readonly Immutable<NativeViableCandidate>[],
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
  bindings: CompatibilityScoringBindings,
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
      componentRun: unbrand<DecisionComponentRun>(frame.componentRun),
      structuredCandidateId: frame.structuredCandidateId,
    },
  )
}

export function selectDecisionCandidate(
  frame: ScoredDecisionFrame,
  planner: CompatibilityPlannerResolution,
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
        unbrand<DecisionComponentRun>(frame.componentRun),
        attributeStructuredChoice(
          unbrand<DecisionComponentRun>(frame.componentRun),
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

export function mechanicalDecision(decision: Decision): Decision {
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
  return structuredClone(mechanicalDecision(
    unbrand<Decision>(frame.selected.candidate.decision),
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
    mechanicalDecision(input.result),
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

/** Detached DTO for the compatibility trace, memory, and agent-output consumers. */
export function projectVoicedFrameForCompatibility(
  frame: VoicedDecisionFrame,
): CompatibilityVoicedOutputProjection {
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
    ...(frame.scoreLayerRun
      ? {
          scoreLayerRun: projectLayerRun(
            unbrand<ScoreLayerRun>(frame.scoreLayerRun),
          ),
        }
      : {}),
    decisionFrame: {
      version: frame.version,
      committedMechanicalAction: frame.mechanicalDecision,
      voice: frame.voice,
    },
    plan: frame.plan,
  }) as CompatibilityVoicedOutputProjection
}
