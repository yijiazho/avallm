import { isDeepStrictEqual } from 'node:util'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import { analyzeSituation } from '../analysis/situation.ts'
import type { SituationAnalysis } from '../analysis/types.ts'
import { visibleEventCursor } from '../belief/exact.ts'
import type { BeliefSnapshot } from '../belief/types.ts'
import type { CognitionState } from '../cognition/types.ts'
import {
  EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT,
  EVIL_QUEST_CARD_ROBUST_COMPONENT,
} from '../components/legacy-role-adapters.ts'
import {
  advanceDecisionComponentRun,
  attributeComponentPolicyUse,
  componentPayload,
  runDecisionComponents,
  type DecisionComponentInvocation,
  type DecisionComponentRun,
  type DecisionComponentTrustedHostInputProviders,
} from '../components/kernel.ts'
import type { ResolvedComposedBrain } from '../components/resolved-brain.ts'
import type { ComponentToken } from '../components/types.ts'
import {
  executePreparedScoreLayerRun,
  prepareScoreLayerRunLease,
} from './score-layer/runner.ts'
import type {
  ScoreLayerAnalysisRef,
  ScoreLayerRow,
  ScoreLayerRun,
  ScoreLayerRunLease,
} from './score-layer/types.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
  validateCandidateRequest,
} from './candidates.ts'
import type { PrivateEvilQuestCardPolicy } from './evil-quest-card.ts'
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
export const LEGACY_D3_QUEST_CARD_VERSION =
  'legacy-d3-quest-card-compatibility-v1'
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
}

interface ScoreSurface {
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

export interface LegacyD3QuestCardState {
  readonly version: typeof LEGACY_D3_QUEST_CARD_VERSION
  readonly component: Readonly<{ id: string; version: string }>
  readonly policy: Immutable<PrivateEvilQuestCardPolicy>
  readonly selectedCandidateId: string
}

export type LegacyD3QuestCardDecisionFrame =
  Stage<
    'legacy-d3-quest-card',
    CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface & {
      readonly legacyD3: Immutable<LegacyD3QuestCardState>
    }
  >

export type PostComponentDecisionFrame =
  | ComponentsResolvedDecisionFrame
  | LegacyD3QuestCardDecisionFrame

export interface ViableCandidate {
  readonly candidate: Immutable<PolicyCandidate>
  readonly score: Immutable<CandidateScore & { viable: true }>
}

type ScoredData =
  CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface
  & ScoreSurface & {
    readonly legacyD3: Immutable<LegacyD3QuestCardState> | null
  }

export type ScoredDecisionFrame = Stage<'scored', ScoredData>

type NativeScoreLayersResolvedData =
  CandidateSurface & AnalysisSurface & ForcedSurface & ComponentSurface & {
    readonly legacyD3: Immutable<LegacyD3QuestCardState> | null
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

export interface LegacyScoredPolicyProjection {
  readonly candidates: readonly PolicyCandidate[]
  readonly scores: readonly CandidateScore[]
  readonly forced: ForcedPolicyResult
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
  readonly plan: DecisionPlan
}

export type DecisionAnalysisPlan =
  | 'candidate-teams'
  | 'good-proposal'
  | 'good-vote'

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

export interface DecisionVoiceInput {
  readonly version: string
  readonly result: Decision
  readonly degradationCode?: string
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
  plan: DecisionAnalysisPlan,
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
  const policyTeams = candidateTeams(
    legacy<readonly PolicyCandidate[]>(frame.legalCandidates),
    view,
  )
  const alternatives = plan === 'good-vote'
    ? hypotheticalProposalCandidates(view)
    : undefined
  const analysis = analyzeSituation(view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    policyCandidateTeams: policyTeams,
    ...(plan === 'good-proposal'
      ? { policyCandidateAssessments: policyTeams }
      : {}),
    ...(alternatives
      ? {
          policyCandidateAssessments: candidateTeams(alternatives, view),
          goodVote: true,
        }
      : {}),
  })
  return Object.freeze({
    ...frame,
    stage: 'analyzed',
    belief: cognition.belief as Immutable<BeliefSnapshot>,
    analysis: analysis as Immutable<SituationAnalysis>,
    hypotheticalTeamCandidates: alternatives
      ? detachTrustedPolicyData(alternatives)
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

type LegacyD3Token = ComponentToken<PrivateEvilQuestCardPolicy>

export function withLegacyD3QuestCard(
  frame: ComponentsResolvedDecisionFrame,
  token: LegacyD3Token,
): LegacyD3QuestCardDecisionFrame {
  if (
    (
      token !== EVIL_QUEST_CARD_ROBUST_COMPONENT
      && token !== EVIL_QUEST_CARD_EXACT_QUOTA_COMPONENT
    )
    || frame.request.kind !== 'quest'
    || frame.view.alignment !== 'evil'
    || frame.view.role === 'oberon'
    || frame.universalForced.selectedCandidateId !== undefined
  ) throw new Error('legacy D3 is ineligible after universal policy')
  const run = legacy<DecisionComponentRun>(frame.componentRun)
  const policy = componentPayload(run, token)
  if (
    !policy?.applicable
    || !policy.selectedCard
    || !isDeepStrictEqual(policy.request, frame.request)
  ) throw new Error('legacy D3 component did not produce a bound policy')
  const effectiveForced = detachTrustedPolicyData(applyForcedPolicy(
    legacy<DecisionRequest>(frame.request),
    legacy<PlayerView>(frame.view),
    legacy<SituationAnalysis>(frame.analysis),
    legacy<readonly PolicyCandidate[]>(frame.legalCandidates),
    { evilQuestCardPolicy: policy },
  ))
  const selectedCandidateId = candidateIdForDecision({
    kind: 'quest',
    card: policy.selectedCard,
  })
  if (effectiveForced.selectedCandidateId !== selectedCandidateId) {
    throw new Error('legacy D3 did not resolve the effective forced choice')
  }
  const attributed = advanceDecisionComponentRun(
    run,
    attributeComponentPolicyUse(run, token, 'action-selection'),
  )
  return Object.freeze({
    ...frame,
    stage: 'legacy-d3-quest-card',
    componentRun: attributed as Immutable<DecisionComponentRun>,
    effectiveForced,
    legacyD3: detachTrustedPolicyData<LegacyD3QuestCardState>({
      version: LEGACY_D3_QUEST_CARD_VERSION,
      component: { id: token.id, version: token.version },
      policy,
      selectedCandidateId,
    }),
  }) as LegacyD3QuestCardDecisionFrame
}

/** Run the C4B scorer/fallback owner synchronously against one exact frame. */
export function withLegacyScoring(
  frame: PostComponentDecisionFrame,
  bindings: (run: DecisionComponentRun) => LegacyScoringBindings,
  resolve: (
    context: Readonly<CandidateScoringContext>,
    run: DecisionComponentRun,
  ) => LegacyScoringResolution,
): ScoredDecisionFrame {
  const run = legacy<DecisionComponentRun>(frame.componentRun)
  const supplied = bindings(run)
  const context: CandidateScoringContext = Object.freeze({
    ...supplied,
    request: legacy<DecisionRequest>(frame.request),
    view: legacy<PlayerView>(frame.view),
    analysis: legacy<SituationAnalysis>(frame.analysis),
    candidates: legacy<readonly PolicyCandidate[]>(frame.legalCandidates),
    forced: legacy<ForcedPolicyResult>(frame.effectiveForced),
    ...(frame.hypotheticalTeamCandidates
      ? {
          hypotheticalTeamCandidates:
            legacy<readonly PolicyCandidate[]>(
              frame.hypotheticalTeamCandidates,
            ),
        }
      : {}),
  })
  const resolution = resolve(context, run)
  validateCandidateScores(
    context,
    resolution.scores,
    resolution.appliedScorer.version,
  )
  const nextRun = advanceDecisionComponentRun(run, resolution.componentRun)
  const scores = nonEmpty(
    detachTrustedPolicyData(resolution.scores),
    'scorer must return a nonempty surface',
  )
  const survivors = new Map(
    frame.forcedSurvivors.map((candidate) => [candidate.id, candidate]),
  )
  const viableCandidates = nonEmpty(
    Object.freeze(scores.flatMap((score) => {
      const candidate = survivors.get(score.candidateId)
      return score.viable && candidate ? [{ candidate, score }] : []
    })) as readonly Immutable<ViableCandidate>[],
    'scorer must retain a viable forced survivor',
  )
  const structured = frame.effectiveForced.selectedCandidateId
    ? scores.find((score) =>
        score.candidateId === frame.effectiveForced.selectedCandidateId)
    : structuredChoice(legacy<readonly CandidateScore[]>(scores))
  if (!structured?.viable) {
    throw new Error('structured policy selected a nonviable candidate')
  }
  return Object.freeze({
    ...frame,
    stage: 'scored',
    componentRun: nextRun as Immutable<DecisionComponentRun>,
    legacyD3: frame.stage === 'legacy-d3-quest-card'
      ? frame.legacyD3
      : null,
    scores,
    viableCandidates,
    structuredCandidateId: structured.candidateId,
    scorerVersion: resolution.appliedScorer.version,
    degradation: detachTrustedPolicyData(resolution.degradation),
  }) as ScoredDecisionFrame
}

/** Detached DTO for the compatibility planner and plan builders. */
export function projectScoredFrameForLegacy(
  frame: ScoredDecisionFrame,
): LegacyScoredPolicyProjection {
  return structuredClone({
    candidates: frame.legalCandidates,
    scores: frame.scores,
    forced: frame.effectiveForced,
    structuredCandidateId: frame.structuredCandidateId,
  }) as LegacyScoredPolicyProjection
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
  #boundFrame: ComponentsResolvedDecisionFrame | undefined

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
      componentRun: frame.componentRun,
      deterministicSeed: host.deterministicSeed,
      compatibilityCandidateId: host.compatibilityCandidateId,
      hypotheticalTeamCandidates: frame.hypotheticalTeamCandidates,
    })
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

/** Future native scoring transition. The live path remains legacy until A2. */
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
  const structured = frame.effectiveForced.selectedCandidateId
    ? scores.find((score) =>
        score.candidateId === frame.effectiveForced.selectedCandidateId)
    : viableCandidates.map((entry) => entry.score).reduce((best, score) =>
        score.value > best.value
          || (
            score.value === best.value
            && score.candidateId < best.candidateId
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
    legacyD3: frame.stage === 'legacy-d3-quest-card'
      ? frame.legacyD3
      : null,
    scoreLayerRun: run as Immutable<ScoreLayerRun>,
    survivorCandidateIds: run.surface.survivorCandidateIds,
    scores,
    viableCandidates,
    structuredCandidateId: structured.candidateId,
  }) as NativeScoreLayersResolvedDecisionFrame
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
    && frame.effectiveForced.selectedCandidateId !== undefined
  ) throw new Error('planner cannot override an effective forced choice')
  const id = planner.kind === 'accepted'
    ? planner.candidateId
    : frame.structuredCandidateId
  const selected = frame.viableCandidates.find(
    (candidate) => candidate.candidate.id === id,
  )
  if (!selected) throw new Error('planner selected a nonviable candidate')
  const componentRun = (
      planner.kind !== 'accepted'
      && frame.effectiveForced.selectedCandidateId === undefined
      && frame.legacyD3 === null
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
    plan: frame.plan,
  }) as LegacyVoicedOutputProjection
}
