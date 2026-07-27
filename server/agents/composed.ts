import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../engine/types.ts'
import { SITUATION_ANALYSIS_VERSION } from './analysis/types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import {
  brainComponents,
  COMPOSED_POLICY_VERSION,
  resolveBrain,
} from './brain.ts'
import { advanceCognition } from './cognition/state.ts'
import type { CognitionState } from './cognition/types.ts'
import {
  COMPOSED_RENDERER_VERSION,
  COMPOSED_PROMPT_VERSION,
  composedPolicyContext,
  renderComposedPolicyContext,
  type ComposedPolicyContext,
} from './communication/composed-renderer.ts'
import { heuristicDecide } from './heuristic.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from './policy/candidates.ts'
import { applyForcedPolicy } from './policy/forced.ts'
import {
  COMMUNICATION_INTENT_VERSION,
  DECISION_PLAN_VERSION,
  communicationFactProjection,
  defaultCommunicationIntent,
  type CommunicationIntent,
  type DecisionPlan,
} from './policy/plan.ts'
import {
  CANDIDATE_SCORER_VERSION,
  scoreCandidates,
  structuredChoice,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScorer,
  type CandidateScoringContext,
} from './policy/score.ts'
import {
  FORCED_POLICY_VERSION,
  LEGAL_CANDIDATE_VERSION,
  type ForcedPolicyResult,
  type PolicyCandidate,
} from './policy/types.ts'
import { createDecisionTrace, type DecisionTrace } from './trace.ts'
import type { AgentDecision, AvalonAgent } from './types.ts'

export const NO_PLANNER_VERSION = 'planner-off'
export const NO_VOICE_VERSION = 'voice-off'

export interface PlannerInput {
  request: DecisionRequest
  view: PlayerView
  context: ComposedPolicyContext
  renderedContext: string
  structuredCandidateId: string
}

export interface PlannerOutput {
  candidateId: string
  communication?: CommunicationIntent
}

export interface CandidatePlanner {
  version: string
  choose(input: PlannerInput): Promise<PlannerOutput | undefined>
}

/** A real LLM adapter implements this bounded contract; tests inject fakes. */
export type LlmCandidatePlanner = CandidatePlanner

export interface VoiceInput {
  request: DecisionRequest
  view: PlayerView
  plan: DecisionPlan
  context: ComposedPolicyContext
  renderedContext: string
}

export interface VoiceOutput {
  text?: string
  thinking?: string
}

export interface PlanVoice {
  version: string
  speak(input: VoiceInput): Promise<VoiceOutput | undefined>
}

export type ComposedStage =
  | 'cognition'
  | 'analysis'
  | 'candidates'
  | 'forced-policy'
  | 'scoring'
  | 'planner'
  | 'plan-committed'
  | 'voice'

export interface ComposedAgentOptions {
  seed: string
  planner?: CandidatePlanner
  voice?: PlanVoice
  onDecisionTrace?: (trace: DecisionTrace) => void
  onStage?: (stage: ComposedStage) => void
  scorer?: CandidateScorer
  /** Compatibility policy used by the intentionally basic Phase 3 scorer. */
  compatibilityDecision?: (
    req: DecisionRequest,
    view: PlayerView,
    seed: string,
  ) => Decision
}

export interface ComposedAvalonAgent extends AvalonAgent {
  setPlanner(planner: CandidatePlanner | undefined): void
  setVoice(voice: PlanVoice | undefined): void
  cognitionCursor(): number | undefined
}

function byId(
  candidates: readonly PolicyCandidate[],
  candidateId: string,
): PolicyCandidate {
  const candidate = candidates.find((entry) => entry.id === candidateId)
  if (!candidate) throw new Error(`composed policy selected absent candidate ${candidateId}`)
  return candidate
}

function validComponentVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function silenceMechanicalCommunication(decision: Decision): Decision {
  const copy = structuredClone(decision)
  if (copy.kind === 'discuss') copy.say = ''
  if (copy.kind === 'propose') delete copy.pitch
  if (copy.kind === 'finalize' && !copy.stick) delete copy.reason
  return copy
}

function validCommunicationIntent(
  value: CommunicationIntent | undefined,
  decision: Decision,
  factCodes: readonly string[],
  view: PlayerView,
): value is CommunicationIntent {
  const expectedChannel =
    decision.kind === 'discuss' ? 'discussion'
      : decision.kind === 'propose' ? 'proposal-pitch'
        : decision.kind === 'finalize' && !decision.stick
          ? 'revision-reason'
          : undefined
  const projection = communicationFactProjection(factCodes)
  const publicFacts = new Set(projection.safeFactCodes)
  const requiredConceal = new Set(projection.conceal)
  return (
    expectedChannel !== undefined
    &&
    value?.version === COMMUNICATION_INTENT_VERSION
    && value.channel === expectedChannel
    && (
      decision.kind !== 'discuss'
      || value.desiredLean === undefined
      || value.desiredLean === decision.lean
    )
    && (decision.kind === 'discuss' || value.desiredLean === undefined)
    && Array.isArray(value.targetSeats)
    && value.targetSeats.every(
      (seat) => Number.isInteger(seat)
        && view.players.some((player) => player.seat === seat),
    )
    && Array.isArray(value.claims)
    && value.claims.every((claim) => typeof claim === 'string')
    && Array.isArray(value.safeFactCodes)
    && value.safeFactCodes.every(
      (code) => typeof code === 'string' && publicFacts.has(code),
    )
    && Array.isArray(value.conceal)
    && value.conceal.every((code) => typeof code === 'string')
    && [...requiredConceal].every((code) => value.conceal.includes(code))
    && value.tone === 'natural'
  )
}

function withVoice(decision: Decision, output: VoiceOutput | undefined): Decision {
  const voiced = structuredClone(decision)
  const text = output?.text?.trim()
  if (voiced.kind === 'discuss') voiced.say = text ?? ''
  else if (voiced.kind === 'propose' && text) voiced.pitch = text
  else if (voiced.kind === 'finalize' && !voiced.stick && text) voiced.reason = text
  if (output?.thinking?.trim()) voiced.thinking = output.thinking.trim()
  return voiced
}

function composedTrace(
  req: DecisionRequest,
  view: PlayerView,
  cognition: CognitionState,
  analysis: ReturnType<typeof analyzeSituation>,
  action: Decision,
  scores: readonly CandidateScore[],
  chosenCandidateId: string,
  forced: ForcedPolicyResult,
  plannerVersion: string,
  voiceVersion: string,
  scorerVersion: string,
  degradation: readonly string[],
  plannerCandidateId?: string,
): DecisionTrace {
  const brain = brainComponents(resolveBrain({ type: 'composed' }))
  return {
    ...createDecisionTrace(
      req,
      view,
      cognition.belief,
      analysis,
      action,
      degradation,
    ),
    componentVersions: {
      brain: brain.brain,
      belief: brain.belief,
      beliefVisibility: brain.beliefVisibility,
      factors: 'off',
      languageEvidence: brain.languageEvidence,
      observerModel: brain.observerModel,
      analysis: SITUATION_ANALYSIS_VERSION,
      candidates: LEGAL_CANDIDATE_VERSION,
      forcedPolicy: FORCED_POLICY_VERSION,
      policy: brain.policy,
      scorer: scorerVersion,
      planner: plannerVersion,
      prompt: COMPOSED_PROMPT_VERSION,
      renderer: COMPOSED_RENDERER_VERSION,
      communication: brain.communication,
      voice: voiceVersion,
    },
    candidateScores: scores,
    chosenCandidateId,
    ...(plannerCandidateId ? { plannerCandidateId } : {}),
    decisionPlanVersion: DECISION_PLAN_VERSION,
    forcedPolicyResult: structuredClone(forced),
  }
}

/**
 * Opt-in Phase 3 hybrid. It owns strategic state independently of planner,
 * model, persona, and voice identity and never receives a raw Game.
 */
export function createComposedAgent(
  options: ComposedAgentOptions,
): ComposedAvalonAgent {
  let cognition: CognitionState | undefined
  let planner = options.planner
  let voice = options.voice
  const compatibilityDecision =
    options.compatibilityDecision ?? heuristicDecide
  const scorer: CandidateScorer = options.scorer ?? {
    version: CANDIDATE_SCORER_VERSION,
    score: scoreCandidates,
  }
  const stage = (value: ComposedStage): void => options.onStage?.(value)

  return {
    setPlanner(next) {
      planner = next
    },
    setVoice(next) {
      voice = next
    },
    cognitionCursor() {
      return cognition?.throughSeq
    },
    recordDecisionTrace(trace) {
      options.onDecisionTrace?.(trace)
    },
    async decide(
      req: DecisionRequest,
      view: PlayerView,
    ): Promise<AgentDecision> {
      const degradation: string[] = []
      const activePlanner = planner && validComponentVersion(planner.version)
        ? planner
        : undefined
      const activeVoice = voice && validComponentVersion(voice.version)
        ? voice
        : undefined
      if (planner && !activePlanner) degradation.push('planner-invalid-version')
      if (voice && !activeVoice) degradation.push('voice-invalid-version')
      cognition = advanceCognition(cognition, view)
      stage('cognition')
      let analysis = analyzeSituation(view, {
        belief: cognition.belief,
        evidence: cognition.evidence,
      })
      stage('analysis')
      const candidates = legalCandidates(req, view)
      stage('candidates')
      const policyTeams = candidateTeams(candidates, view)
      const wantsJointProposalAssessments =
        (
          scorer.analysisRequirement === 'joint-proposal-team-assessments'
          || scorer.analysisRequirement
            === 'joint-proposal-vote-team-assessments'
        )
        && req.kind === 'propose'
        && view.alignment === 'good'
      const wantsJointVoteAssessments =
        scorer.analysisRequirement
          === 'joint-proposal-vote-team-assessments'
        && req.kind === 'vote'
        && view.alignment === 'good'
      const hypotheticalTeamCandidates = wantsJointVoteAssessments
        ? hypotheticalProposalCandidates(view)
        : undefined
      const hypotheticalTeams = hypotheticalTeamCandidates
        ? candidateTeams(hypotheticalTeamCandidates, view)
        : undefined
      analysis = analyzeSituation(view, {
        belief: cognition.belief,
        evidence: cognition.evidence,
        policyCandidateTeams: policyTeams,
        ...(wantsJointProposalAssessments
          ? { policyCandidateAssessments: policyTeams }
          : {}),
        ...(hypotheticalTeams
          ? {
              policyCandidateAssessments: hypotheticalTeams,
              goodVote: true,
            }
          : {}),
      })
      const forced = applyForcedPolicy(req, view, analysis, candidates)
      stage('forced-policy')

      const compatibility = compatibilityDecision(req, view, options.seed)
      const compatibilityCandidateId = candidateIdForDecision(compatibility)
      const scoringContext = {
        deterministicSeed: options.seed,
        request: req,
        view,
        analysis,
        candidates,
        ...(hypotheticalTeamCandidates
          ? { hypotheticalTeamCandidates }
          : {}),
        forced,
        compatibilityCandidateId,
      }
      let scorerVersion = scorer.version
      let scores: readonly CandidateScore[]
      try {
        const suppliedScores = scorer.score(structuredClone(scoringContext))
        validateCandidateScores(scoringContext, suppliedScores, scorerVersion)
        scores = structuredClone(suppliedScores)
      } catch {
        degradation.push('scorer-invalid-output')
        scorerVersion = CANDIDATE_SCORER_VERSION
        scores = scoreCandidates(scoringContext)
        validateCandidateScores(
          scoringContext,
          scores,
          CANDIDATE_SCORER_VERSION,
        )
      }
      const structured = forced.selectedCandidateId
        ? scores.find((score) => score.candidateId === forced.selectedCandidateId)
        : structuredChoice(scores)
      if (!structured || !structured.viable) {
        throw new Error('forced policy selected a non-viable candidate')
      }
      stage('scoring')

      const context = composedPolicyContext(
        view,
        analysis,
        candidates,
        forced,
        scores,
      )
      const viableIds = new Set(
        context.viableCandidates.map((candidate) => candidate.id),
      )
      let chosenCandidateId = structured.candidateId
      let plannerCandidateId: string | undefined
      let communication: CommunicationIntent | undefined
      if (activePlanner && !forced.selectedCandidateId) {
        stage('planner')
        try {
          const planned = await activePlanner.choose({
            request: req,
            view,
            context,
            renderedContext: renderComposedPolicyContext(context),
            structuredCandidateId: structured.candidateId,
          })
          if (planned) {
            plannerCandidateId = planned.candidateId
            if (!viableIds.has(planned.candidateId)) {
              degradation.push('planner-invalid-candidate')
            } else {
              chosenCandidateId = planned.candidateId
              if (planned.communication !== undefined) {
                if (validCommunicationIntent(
                  planned.communication,
                  byId(candidates, planned.candidateId).decision,
                  analysis.factCodes,
                  view,
                )) {
                  communication = structuredClone(planned.communication)
                } else {
                  degradation.push('planner-invalid-communication')
                }
              }
            }
          }
        } catch {
          degradation.push('planner-failed')
        }
      }

      const candidate = byId(candidates, chosenCandidateId)
      const mechanicalDecision = silenceMechanicalCommunication(candidate.decision)
      const plan: DecisionPlan = {
        version: DECISION_PLAN_VERSION,
        request: { ...req },
        decision: structuredClone(mechanicalDecision),
        candidateId: chosenCandidateId,
        policyId: COMPOSED_POLICY_VERSION,
        reasons: forced.reasonCodes,
        beliefThroughSeq: cognition.throughSeq,
        candidateScores: scores,
        ...((communication ?? defaultCommunicationIntent(
          mechanicalDecision,
          analysis.factCodes,
        ))
          ? {
              communication: communication ?? defaultCommunicationIntent(
                mechanicalDecision,
                analysis.factCodes,
              ),
            }
          : {}),
      }
      stage('plan-committed')

      let action = structuredClone(plan.decision)
      if (activeVoice && plan.communication) {
        stage('voice')
        try {
          const output = await activeVoice.speak({
            request: req,
            view,
            plan: structuredClone(plan),
            context,
            renderedContext: renderComposedPolicyContext(context, plan),
          })
          action = withVoice(plan.decision, output)
        } catch {
          degradation.push('voice-failed')
          action = structuredClone(plan.decision)
        }
      }

      const chosenTeamAnalysis = (
        action.kind === 'propose'
        || (action.kind === 'finalize' && !action.stick)
      )
        ? analyzeSituation(view, {
            belief: cognition.belief,
            evidence: cognition.evidence,
            candidateTeams: [action.team],
          })
        : undefined
      const traceAnalysis = chosenTeamAnalysis
        ? {
            ...analysis,
            candidateTeams: chosenTeamAnalysis.candidateTeams,
          }
        : analysis
      const trace = composedTrace(
        req,
        view,
        cognition,
        traceAnalysis,
        action,
        scores,
        chosenCandidateId,
        forced,
        activePlanner?.version ?? NO_PLANNER_VERSION,
        activeVoice?.version ?? NO_VOICE_VERSION,
        scorerVersion,
        degradation,
        plannerCandidateId,
      )
      return { decision: action, trace }
    },
  }
}
