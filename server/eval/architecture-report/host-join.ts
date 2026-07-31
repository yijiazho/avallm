// The two questions both safety readers ask about a trace, kept in one place so
// both get the same answer.
//
// A recorded plan outcome is the agent's own story about a decision. The join
// below is what makes that story checkable against the host's authoritative
// replay: the applied decision, the coherence intent, the selected plan's
// version and candidate, and the degradation the artifact actually recorded all
// have to line up before the trace counts as evidence. If the current and
// legacy readers each carried their own copy, a tightening applied to one would
// leave the other admitting traces the tightened rule rejects, and the looser
// copy is the one an artifact would be shaped to satisfy.
//
// isComposedComponents sits here for the same reason. It is the single
// definition of "this table is a composed architecture", and both readers plus
// the summarizer branch on it.

import {
  isDeepStrictEqual,
} from 'node:util'
import type {
  GameArtifact,
} from '../core/artifact.ts'
import {
  isComposedPolicy,
} from '../../agents/brain.ts'
import { validateAppliedPlanOutcomeHostJoin } from '../../agents/cognition/plan-memory-schema.ts'
import {
  selectedDecisionReplayJoin,
  type AuthoritativeDecisionReplay,
} from '../replay/trace-replay.ts'

/**
 * A composed architecture is named by its policy, the one field that is 1:1 with
 * the agent kind. Manifests and traces each declare it, so both sides stay
 * independently checkable without a second, redundant mode label.
 */
export function isComposedComponents(
  components: Record<string, string>,
): boolean {
  return isComposedPolicy(components.policy)
}

export function planOutcomeHostJoin(
  artifact: GameArtifact,
  replay: AuthoritativeDecisionReplay,
  trace: NonNullable<GameArtifact['decisionTraces']>[number],
): boolean {
  const snapshot = replay.snapshots.get(trace.decisionId)
  if (!snapshot || !trace.privatePlanOutcome) return false
  const outcome = trace.privatePlanOutcome
  const degraded = artifact.degraded.some(
    (entry) =>
      entry.seat === snapshot.seat
      && entry.kind === snapshot.kind
      && entry.atEvent >= snapshot.firstSeq
      && entry.atEvent <= snapshot.seq,
  )
  // A recorded summary always carries its plan, so an absent plan means an
  // absent selection and needs no separate test against `outcome.selected`.
  const plan = outcome.selected?.plan
  const selectedPlanMatches = plan === undefined
    || (
      plan.version === trace.decisionPlanVersion
      && plan.candidateId === trace.chosenCandidateId
      && plan.policyId === trace.componentVersions?.policy
      && plan.beliefThroughSeq === trace.beliefThroughSeq
    )
  const resolutionMatches = outcome.resolution === 'selected-applied'
    ? !degraded && outcome.selected !== undefined
    : degraded && (
        outcome.resolution === 'fallback-after-agent-error'
          ? outcome.selected === undefined
          : outcome.selected !== undefined
      )
  return (
    isDeepStrictEqual(outcome.appliedDecision, snapshot.original)
    && outcome.coherence.intent === trace.coherenceIntent
    && selectedPlanMatches
    && resolutionMatches
    && selectedDecisionReplayJoin(replay, snapshot, outcome)
    && validateAppliedPlanOutcomeHostJoin(
      outcome,
      snapshot.req,
      snapshot.original,
      snapshot.view,
    )
  )
}
