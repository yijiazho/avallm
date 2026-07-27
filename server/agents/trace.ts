import type {
  Decision,
  DecisionRequest,
  PlayerView,
  Seat,
} from '../engine/types.ts'
import type { SituationAnalysis, SituationTeamAssessment } from './analysis/types.ts'
import type { BeliefSnapshot } from './belief/types.ts'

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
  statedReasoning?: string
}

export function decisionTraceId(
  req: DecisionRequest,
  view: PlayerView,
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
