import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../engine/types.ts'
import type { SituationAnalysis, SituationTeamAssessment } from './analysis/types.ts'
import type { BeliefSnapshot } from './belief/types.ts'
import type { CandidateScore } from './policy/score.ts'
import type { ForcedPolicyResult } from './policy/types.ts'
import type { AgentExecutionMode } from './brain.ts'
import type { CommunicationIntent } from './policy/plan.ts'

export const DECISION_TRACE_VERSION = 'decision-trace-v1'

export interface TraceHypothesis {
  worldKey: string
  probability: number
  evilSeats: readonly Seat[]
}

export interface DecisionTrace {
  version: typeof DECISION_TRACE_VERSION
  decisionId: string
  viewerSeat: Seat
  request: DecisionRequest
  beliefModelVersion: string
  beliefThroughSeq: number
  quality: BeliefSnapshot['quality']
  degradation: readonly string[]
  topHypotheses: readonly TraceHypothesis[]
  relevantTeam?: SituationTeamAssessment
  factCodes: SituationAnalysis['factCodes']
  reasonCodes: SituationAnalysis['forcedPlayReasonCodes']
  action: Decision
  /** Explicit experiment cell; do not infer it from component versions. */
  agentMode?: AgentExecutionMode
  statedReasoning?: string
  /** Complete ownership/version attribution for composed decisions. */
  componentVersions?: Readonly<{
    brain: string
    belief: string
    beliefVisibility: string
    factors: string
    languageEvidence: string
    observerModel: string
    analysis: string
    candidates: string
    forcedPolicy: string
    policy: string
    scorer: string
    planner: string
    prompt: string
    renderer: string
    communication: string
    voice: string
  }>
  candidateScores?: readonly CandidateScore[]
  /** Structured scorer choice before any admitted planner selection. */
  structuredCandidateId?: string
  chosenCandidateId?: string
  /** Last planner attempt, including attempts rejected by the boundary. */
  plannerCandidateId?: string
  /** Reason subset admitted for the chosen planner selection. */
  plannerReasonCodes?: readonly string[]
  decisionPlanVersion?: string
  forcedPolicyResult?: ForcedPolicyResult
  communicationIntent?: CommunicationIntent
}

export function decisionTraceId(
  req: DecisionRequest,
  view: PlayerView,
  beliefThroughSeq: number,
): string {
  return decisionTraceIdForRequest(req, beliefThroughSeq)
}

export function decisionTraceIdForRequest(
  req: DecisionRequest,
  beliefThroughSeq: number,
): string {
  return `decision:${req.seat}:${req.kind}:q${req.round}:p${req.proposalNum}:v${beliefThroughSeq}`
}

function relevantTeam(
  action: Decision,
  analysis: SituationAnalysis,
): SituationTeamAssessment | undefined {
  if (action.kind === 'propose' || (action.kind === 'finalize' && !action.stick)) {
    return analysis.candidateTeams[0]
  }
  return analysis.currentTeam
}

export function createDecisionTrace(
  req: DecisionRequest,
  view: PlayerView,
  belief: BeliefSnapshot,
  analysis: SituationAnalysis,
  action: Decision,
  degradation: readonly string[] = [],
): DecisionTrace {
  const recordedAction = structuredClone(action)
  if (
    recordedAction.kind === 'propose'
    || (recordedAction.kind === 'finalize' && !recordedAction.stick)
  ) {
    recordedAction.team.sort((a, b) => a - b)
  }
  if (
    recordedAction.kind === 'discuss'
    && recordedAction.lean !== undefined
    && view.seat === view.leaderSeat
  ) {
    delete recordedAction.lean
  }
  if (recordedAction.kind === 'quest' && view.alignment === 'good') {
    recordedAction.card = 'success'
  }
  return {
    version: DECISION_TRACE_VERSION,
    decisionId: decisionTraceId(req, view, belief.throughSeq),
    viewerSeat: view.seat,
    request: { ...req },
    beliefModelVersion: belief.modelVersion,
    beliefThroughSeq: belief.throughSeq,
    quality: belief.quality,
    degradation: [...degradation],
    topHypotheses: belief.topWorlds.slice(0, 3).map((weighted) => ({
      worldKey: weighted.world.key,
      probability: weighted.probability,
      evilSeats: weighted.world.alignmentBySeat
        .map((alignment, seat) => ({ alignment, seat }))
        .filter(({ alignment }) => alignment === 'evil')
        .map(({ seat }) => seat),
    })),
    ...(relevantTeam(action, analysis)
      ? { relevantTeam: relevantTeam(action, analysis) }
      : {}),
    factCodes: analysis.factCodes,
    reasonCodes: analysis.forcedPlayReasonCodes,
    action: recordedAction,
    ...(action.thinking ? { statedReasoning: action.thinking } : {}),
  }
}

/** Keep one ultimate trace per stable decision identity. */
export function upsertDecisionTrace(
  traces: DecisionTrace[],
  trace: DecisionTrace,
): void {
  const existing = traces.findIndex(
    (candidate) => candidate.decisionId === trace.decisionId,
  )
  if (existing === -1) traces.push(trace)
  else traces[existing] = trace
}
