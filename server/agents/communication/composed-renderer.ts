import type {
  Decision,
  DecisionRequest,
  PlayerView,
  PrivateInfo,
  Seat,
} from '../../engine/types.ts'
import type { PublicAttributedUtterance } from './language-types.ts'
import type { PublicRecord } from './public-record.ts'
import {
  projectLanguageInterpreterInput,
  recentPublicUtterances,
} from './language-contract.ts'
import type { SituationAnalysis } from '../analysis/situation-types.ts'
import type {
  CognitionState,
  PublicCommitment,
} from '../cognition/types.ts'
import {
  type CommittedVoicePlan,
  type StrategicIntent,
} from '../policy/plan.ts'
import {
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
} from '../policy/communication-intent.ts'
import type { CandidateScore } from '../policy/score.ts'
import type {
  DecisionCandidateBoundary,
} from '../policy/decision-layer/types.ts'
import type { ForcedPolicyResult, PolicyCandidate } from '../policy/types.ts'
import type {
  EvilExposureRead,
  PrivatePinRead,
} from '../analysis/private-pin-types.ts'

export const COMPOSED_RENDERER_VERSION = 'composed-policy-renderer-v4'
export const COMPOSED_PROMPT_VERSION = 'composed-typed-context-v4'

export type QualitativeAlignmentRead =
  | 'known-good'
  | 'lean-good'
  | 'uncertain'
  | 'lean-evil'
  | 'known-evil'

export type PlannerMechanicalDecision =
  | { kind: 'discuss' }
  | { kind: 'propose'; team: readonly Seat[] }
  | { kind: 'finalize'; stick: true }
  | { kind: 'finalize'; stick: false; team: readonly Seat[] }
  | { kind: 'vote'; vote: 'approve' | 'reject' }
  | { kind: 'quest'; card: 'success' | 'fail' }
  | { kind: 'assassinate'; target: Seat }

export interface PlannerCognitionProjection {
  visibility: 'private-planning-only'
  privateKnowledge: PrivateInfo
  belief: {
    modelVersion: string
    throughSeq: number
    quality: CognitionState['belief']['quality']
    players: readonly {
      seat: Seat
      alignment: QualitativeAlignmentRead
    }[]
  }
  currentCommitments: readonly {
    id: string
    sourceSeq: number
    actor: Seat
    kind: PublicCommitment['kind']
    context: PublicCommitment['context']
    payload:
      | Extract<PublicCommitment, { kind: 'team' }>['payload']
      | Extract<PublicCommitment, { kind: 'vote' }>['payload']
      | {
          type: 'utterance'
          channel: Extract<
            PublicCommitment,
            { kind: 'utterance' }
          >['payload']['channel']
        }
  }[]
  recentAppliedPlans: readonly {
    id: string
    request: DecisionRequest
    selected?: {
      candidateId: string
      strategicIntent?: StrategicIntent
    }
    appliedDecision: PlannerMechanicalDecision
    resolution: NonNullable<
      CognitionState['planMemory']
    >['history'][number]['resolution']
    coherence: Pick<
      NonNullable<CognitionState['planMemory']>['history'][number]['coherence'],
      'classification' | 'conflictCodes'
    >
  }[]
}

export interface ComposedPolicyContext {
  version: typeof COMPOSED_RENDERER_VERSION
  seat: number
  role: PlayerView['role']
  phase: PlayerView['phase']
  publicContext: {
    record: PublicRecord
    recentUtterances: readonly PublicAttributedUtterance[]
  }
  analysisFacts: {
    visibility: 'private-planning-only'
    codes: SituationAnalysis['factCodes']
    /**
     * Private pin reads, present only when their components resolved (planner
     * decisions). Advisory context for planning: alignments this seat is
     * certain of that the table is not, and the good seats certain this (evil)
     * seat is evil. Never a public claim, so it stays under this
     * private-planning-only section and is never handed to voice.
     */
    pins?: {
      readonly leverageEvil: readonly number[]
      readonly leverageGood: readonly number[]
      readonly exposedTo: readonly number[]
    }
  }
  plannerCognition: PlannerCognitionProjection
  forcedPolicy: {
    version: string
    applied: boolean
    reasonCodes: readonly string[]
    allowedCandidateIds: readonly string[]
    selectedCandidateId?: string
  }
  viableCandidates: readonly {
    id: string
    decision: PolicyCandidate['decision']
    score: number
    reasonCodes: readonly string[]
  }[]
}

/**
 * Typed renderer for composed planning and voice. Forced rules are rendered
 * from their executable result rather than re-deriving the strategic triggers
 * that produced them. The viable-candidate list is the exception: it is
 * filtered here from the scored candidates, the planner-override reason codes,
 * and the decision boundary's survivors. The raw-LLM ASKS renderer remains
 * untouched as a frozen baseline.
 */
/**
 * The private pin summary for the planning context, or nothing when neither
 * read resolved. Leverage rows exclude the acting seat's own row (its cover),
 * so they name only what the seat knows about OTHERS; exposure names the good
 * seats certain the acting seat is evil.
 */
function pinAnalysisFacts(
  actingSeat: number,
  privatePin: PrivatePinRead | undefined,
  evilExposure: EvilExposureRead | undefined,
): Pick<ComposedPolicyContext['analysisFacts'], 'pins'> {
  if (!privatePin && !evilExposure) return {}
  const others = privatePin
    ? privatePin.rows.filter((row) => row.seat !== actingSeat)
    : []
  return {
    pins: {
      leverageEvil: others
        .filter((row) => row.pin === 'evil').map((row) => row.seat),
      leverageGood: others
        .filter((row) => row.pin === 'good').map((row) => row.seat),
      exposedTo: evilExposure
        ? evilExposure.pinners.map((pinner) => pinner.seat)
        : [],
    },
  }
}

export function composedPolicyContext(
  view: PlayerView,
  analysis: SituationAnalysis,
  candidates: readonly PolicyCandidate[],
  forced: ForcedPolicyResult,
  candidateBoundary: DecisionCandidateBoundary,
  scores: readonly CandidateScore[],
  structuredCandidateId?: string,
  privatePin?: PrivatePinRead,
  evilExposure?: EvilExposureRead,
  cognition?: CognitionState,
): ComposedPolicyContext {
  const byScore = new Map(scores.map((score) => [score.candidateId, score]))
  const publicInput = projectLanguageInterpreterInput(view)
  return {
    version: COMPOSED_RENDERER_VERSION,
    seat: view.seat,
    role: view.role,
    phase: view.phase,
    publicContext: {
      record: publicInput.publicContext,
      recentUtterances: recentPublicUtterances(publicInput),
    },
    analysisFacts: {
      visibility: 'private-planning-only',
      codes: analysis.factCodes,
      ...pinAnalysisFacts(view.seat, privatePin, evilExposure),
    },
    plannerCognition: plannerCognitionProjection(view, cognition),
    forcedPolicy: {
      version: forced.version,
      applied: forced.applied,
      reasonCodes: forced.reasonCodes,
      allowedCandidateIds: forced.allowedCandidateIds,
      ...(forced.selectedCandidateId
        ? { selectedCandidateId: forced.selectedCandidateId }
        : {}),
    },
    viableCandidates: candidates.flatMap((candidate) => {
      const score = byScore.get(candidate.id)
      const plannerReasons = score && structuredCandidateId
        && candidate.id !== structuredCandidateId
        ? plannerOverrideReasonCodes(score, scores)
        : score ? selectedStrategicReasonCodes(score, scores) : []
      const plannerViable = score?.features?.version === 'good-vote-features-v1'
        ? score.viable
        : candidate.id === structuredCandidateId
          || plannerReasons.length > 0
      return score?.viable
        && plannerViable
        && candidateBoundary.survivorCandidateIds.includes(candidate.id)
        ? [{
            id: candidate.id,
            decision: structuredClone(candidate.decision),
            score: score.value,
            reasonCodes: plannerReasons,
          }]
        : []
    }),
  }
}

function qualitativeAlignment(
  goodProbability: number,
): QualitativeAlignmentRead {
  if (goodProbability >= 0.99) return 'known-good'
  if (goodProbability >= 0.65) return 'lean-good'
  if (goodProbability <= 0.01) return 'known-evil'
  if (goodProbability <= 0.35) return 'lean-evil'
  return 'uncertain'
}

function plannerMechanicalDecision(
  decision: Decision,
): PlannerMechanicalDecision {
  if (decision.kind === 'discuss') return { kind: 'discuss' }
  if (decision.kind === 'propose') {
    return { kind: 'propose', team: decision.team.slice() }
  }
  if (decision.kind === 'finalize') {
    return decision.stick
      ? { kind: 'finalize', stick: true }
      : { kind: 'finalize', stick: false, team: decision.team.slice() }
  }
  if (decision.kind === 'vote') {
    return { kind: 'vote', vote: decision.vote }
  }
  if (decision.kind === 'quest') {
    return { kind: 'quest', card: decision.card }
  }
  return { kind: 'assassinate', target: decision.target }
}

function plannerCommitment(
  commitment: PublicCommitment,
): PlannerCognitionProjection['currentCommitments'][number] {
  const base = {
    id: commitment.id,
    sourceSeq: commitment.sourceSeq,
    actor: commitment.actor,
    kind: commitment.kind,
    context: structuredClone(commitment.context),
  }
  if (commitment.kind === 'utterance') {
    return {
      ...base,
      kind: 'utterance',
      payload: {
        type: 'utterance',
        channel: commitment.payload.channel,
      },
    }
  }
  return {
    ...base,
    kind: commitment.kind,
    payload: structuredClone(commitment.payload),
  } as PlannerCognitionProjection['currentCommitments'][number]
}

function plannerCognitionProjection(
  view: PlayerView,
  cognition: CognitionState | undefined,
): PlannerCognitionProjection {
  const marginals = cognition?.belief.playerMarginals ?? []
  const commitments = (cognition?.commitments ?? [])
    .filter((commitment) => commitment.status === 'current')
    .slice(-16)
    .map(plannerCommitment)
  const recentAppliedPlans = (cognition?.planMemory?.history ?? [])
    .slice(-8)
    .map((entry) => ({
      id: entry.id,
      request: structuredClone(entry.request),
      ...(entry.selected
        ? {
            selected: {
              candidateId: entry.selected.plan.candidateId,
              ...(entry.selected.plan.strategicIntent
                ? {
                    strategicIntent: structuredClone(
                      entry.selected.plan.strategicIntent,
                    ),
                  }
                : {}),
            },
          }
        : {}),
      appliedDecision: plannerMechanicalDecision(entry.appliedDecision),
      resolution: entry.resolution,
      coherence: {
        classification: entry.coherence.classification,
        conflictCodes: [...entry.coherence.conflictCodes],
      },
    }))
  return {
    visibility: 'private-planning-only',
    privateKnowledge: structuredClone(view.privateInfo),
    belief: {
      modelVersion: cognition?.belief.modelVersion ?? 'unavailable',
      throughSeq: cognition?.belief.throughSeq ?? -1,
      quality: cognition?.belief.quality ?? 'degraded',
      players: marginals.map((marginal) => ({
        seat: marginal.seat,
        alignment: qualitativeAlignment(marginal.goodProbability),
      })),
    },
    currentCommitments: commitments,
    recentAppliedPlans,
  }
}

export function renderComposedPolicyContext(
  context: ComposedPolicyContext,
): string {
  return JSON.stringify(context)
}

export function renderCommittedVoicePlan(
  plan: CommittedVoicePlan,
): string {
  return JSON.stringify({ committedPlan: plan })
}
