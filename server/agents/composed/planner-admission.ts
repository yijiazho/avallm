/**
 * The door a planner's answer comes back through.
 *
 * Planning is optional strategy layered over a decision the frame can already
 * make, so nothing here throws and nothing here widens what the planner was
 * offered. Collecting the admission rules in one module keeps that property
 * checkable: the candidate check, the reason-code check, the direction check and
 * the strategic-intent check all have to agree that a rejection is a typed
 * degradation, and a rule written next to decide() instead would be free to
 * quietly become a throw or to reach for state the planner never saw.
 */
import type {
  Decision,
  PlayerView,
} from '../../engine/types.ts'
import {
  renderComposedPolicyContext,
  type ComposedPolicyContext,
} from '../communication/composed-renderer.ts'
import {
  directionChannelFor,
  publicEvidenceExists,
  validCommunicationDirection,
  type CommunicationDirectionContext,
} from '../communication/direction-contract.ts'
import type {
  CandidatePlanner,
} from '../communication/planner-voice-adapter.ts'
import {
  plannerOverrideReasonCodes,
  selectedStrategicReasonCodes,
} from '../policy/communication-intent.ts'
import type {
  CompatibilityPlannerResolution,
} from '../policy/decision-frame.ts'
import type {
  PlannerCommunicationDirection,
  StrategicIntent,
} from '../policy/plan.ts'
import type { CandidateScore } from '../policy/score.ts'
import {
  projectLanguageInterpreterInput,
} from '../record/language-contract.ts'
import {
  validStrategicIntent,
} from '../record/strategic-intent-contract.ts'

function discussionIntentIsCoherent(
  decision: Decision,
  intent: StrategicIntent | undefined,
  communication: PlannerCommunicationDirection | undefined,
): boolean {
  if (decision.kind !== 'discuss' || intent === undefined) return true
  if (intent.objective === 'SUPPORT_TEAM') {
    return communication?.actCodes.includes('SUPPORT_CURRENT_TEAM') === true
  }
  if (intent.objective === 'OPPOSE_TEAM') {
    return communication?.actCodes.includes('OPPOSE_CURRENT_TEAM') === true
  }
  return true
}

/**
 * What this seat knows about the table, for the shared direction contract.
 *
 * The rules themselves live in communication/direction-contract.ts, which three
 * boundaries share. This seat can answer every question the contract asks, so
 * every optional capability is supplied: an unknown seat, a role that was never
 * dealt, and a citation of a fact the table cannot see are all rejected here
 * even though the reply parser upstream cannot see far enough to reject them.
 */
function plannerCommunicationContext(
  decision: Decision,
  view: PlayerView,
): CommunicationDirectionContext {
  const publicInput = projectLanguageInterpreterInput(view)
  const channel = directionChannelFor(
    decision.kind,
    decision.kind === 'finalize' ? decision.stick : undefined,
  )
  return {
    allowedChannels: channel === undefined ? [] : [channel],
    seatExists: (seat) => view.players.some((player) => player.seat === seat),
    rolesInPlay: view.rolesInPlay,
    evidenceExists: (reference) => publicEvidenceExists(reference, publicInput),
  }
}

function validPlannerReasons(
  reasons: readonly string[] | undefined,
  chosenScore: CandidateScore,
  scores: readonly CandidateScore[],
  structuredCandidateId: string,
): reasons is readonly string[] {
  if (reasons === undefined) {
    return chosenScore.candidateId === structuredCandidateId
  }
  const permitted = chosenScore.candidateId === structuredCandidateId
    ? selectedStrategicReasonCodes(chosenScore, scores)
    : plannerOverrideReasonCodes(chosenScore, scores)
  if (
    !Array.isArray(reasons)
    || new Set(reasons).size !== reasons.length
    || reasons.some(
      (code) =>
        typeof code !== 'string'
        || !permitted.includes(code),
    )
  ) {
    return false
  }
  return chosenScore.candidateId === structuredCandidateId || reasons.length > 0
}

/**
 * Offer the scored candidate set to the planner and admit at most one bounded
 * choice from it.
 *
 * Every failure is a typed rejection rather than a throw, including a planner
 * that throws, because planning is optional strategy layered over a decision the
 * frame can already make: selection falls back to the structured choice and the
 * decision still happens. The admission rules are narrow by design. A planner may
 * name only a candidate that scored viable, may cite only reasons its own score
 * supports, and loses invalid communication on its own without losing the
 * candidate, so a planner cannot widen the candidate set or reopen the mechanical
 * action it was handed. If discussion strategy and speech contradict each
 * other, both are discarded together so plan memory cannot preserve one half
 * of an incoherent pair.
 */
export async function resolvePlannerChoice(input: {
  planner: CandidatePlanner
  context: ComposedPolicyContext
  scores: readonly CandidateScore[]
  structuredCandidateId: string
  view: PlayerView
}): Promise<CompatibilityPlannerResolution> {
  const { context, scores, structuredCandidateId, view } = input
  // The catch deliberately spans the clone and the validators, not just
  // choose(). A planner that returns something structuredClone rejects, or a
  // malformed output that trips a validator, is the same optional-strategy
  // failure as one that throws outright, and must degrade rather than end the
  // decision.
  try {
    const supplied = await input.planner.choose({
      context: structuredClone(context),
      renderedContext: renderComposedPolicyContext(context),
      structuredCandidateId,
    })
    const planned = supplied === undefined
      ? undefined
      : structuredClone(supplied)
    if (!planned) {
      return { kind: 'rejected', degradationCode: 'planner-no-choice' }
    }
    const plannedScore = scores.find(
      (score) => score.candidateId === planned.candidateId,
    )
    const plannedCandidate = context.viableCandidates.find(
      (candidate) => candidate.id === planned.candidateId,
    )
    if (!plannedCandidate || !plannedScore) {
      return {
        kind: 'rejected',
        degradationCode: 'planner-invalid-candidate',
        attemptedCandidateId: planned.candidateId,
      }
    }
    if (!validPlannerReasons(
      planned.reasonCodes,
      plannedScore,
      scores,
      structuredCandidateId,
    )) {
      return {
        kind: 'rejected',
        degradationCode: 'planner-invalid-reason',
        attemptedCandidateId: planned.candidateId,
      }
    }
    const validatedCommunication = planned.communication !== undefined
      && validCommunicationDirection(
        planned.communication,
        plannerCommunicationContext(plannedCandidate.decision, view),
      )
      ? structuredClone(planned.communication)
      : undefined
    const validatedStrategicIntent = planned.strategicIntent !== undefined
      && validStrategicIntent(
        planned.strategicIntent,
        plannerCommunicationContext(plannedCandidate.decision, view),
      )
      ? structuredClone(planned.strategicIntent)
      : undefined
    const coherentIntent = discussionIntentIsCoherent(
      plannedCandidate.decision,
      validatedStrategicIntent,
      validatedCommunication,
    )
    const communication = coherentIntent
      ? validatedCommunication
      : undefined
    const strategicIntent = coherentIntent
      ? validatedStrategicIntent
      : undefined
    return {
      kind: 'accepted',
      candidateId: planned.candidateId,
      ...(planned.reasonCodes === undefined
        ? {}
        : { reasonCodes: [...planned.reasonCodes] }),
      ...(strategicIntent ? { strategicIntent } : {}),
      ...(communication ? { communication } : {}),
      ...(planned.strategicIntent !== undefined && !strategicIntent
        ? {
            degradationCode: coherentIntent
              ? 'planner-invalid-strategic-intent'
              : 'planner-invalid-communication',
          }
        : planned.communication !== undefined && !communication
          ? { degradationCode: 'planner-invalid-communication' }
          : {}),
    }
  } catch {
    return { kind: 'rejected', degradationCode: 'planner-failed' }
  }
}
