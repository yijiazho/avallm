/**
 * Turning a committed plan into table speech, without letting speech touch the
 * plan.
 *
 * Voice runs after the mechanical decision is already committed, so the risk it
 * carries is not a bad answer but a decorated one: an output that quietly moves
 * a seat number or a team while attaching prose. Every path here returns the
 * committed action with at most speech attached, and the projection handed to
 * the voice is built from the public record rather than from the PlayerView, so
 * a voice plugin cannot see this seat's role or private knowledge in the first
 * place. Keeping all three functions together is what makes that reviewable: the
 * projection, the decoration and the failure paths are the whole surface.
 */
import type {
  Decision,
  PlayerView,
} from '../../engine/types.ts'
import {
  renderCommittedVoicePlan,
} from '../communication/composed-renderer.ts'
import type {
  PlanVoice,
  VoiceOutput,
} from '../communication/planner-voice-adapter.ts'
import {
  voiceUncertainty,
} from '../policy/communication-intent.ts'
import type {
  CommittedVoicePlan,
  DecisionPlan,
} from '../policy/plan.ts'
import {
  projectLanguageInterpreterInput,
  recentPublicUtterances,
} from '../record/language-contract.ts'

function withVoice(decision: Decision, output: VoiceOutput | undefined): Decision {
  const voiced = structuredClone(decision)
  const text = output?.text?.trim()
  if (voiced.kind === 'discuss') voiced.say = text ?? ''
  else if (voiced.kind === 'propose' && text) voiced.pitch = text
  else if (voiced.kind === 'finalize' && !voiced.stick && text) voiced.reason = text
  if (output?.thinking?.trim()) voiced.thinking = output.thinking.trim()
  return voiced
}

function committedVoicePlan(
  plan: DecisionPlan,
  view: PlayerView,
): CommittedVoicePlan {
  const publicInput = projectLanguageInterpreterInput(view)
  const communication = plan.communication
    ? (() => {
        const {
          conceal: _conceal,
          uncertainty,
          ...publicIntent
        } = plan.communication
        return structuredClone({
          ...publicIntent,
          strategicReasonCodes: publicIntent.strategicReasonCodes.filter(
            (reason) => reason !== 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK',
          ),
          ...(uncertainty
            ? { uncertainty: voiceUncertainty(uncertainty) }
            : {}),
        })
      })()
    : undefined
  return {
    version: plan.version,
    // Voice has to translate the committed seat-number action into table
    // speech. Names are public, and supplying the whole public roster keeps it
    // from inventing referents for otherwise anonymous numbers.
    players: view.players.map(({ seat, name }) => ({ seat, name })),
    // Reuse the language interpreter's public-only projection instead of
    // handing voice a PlayerView, which also carries this seat's private role
    // and knowledge. The rolling window matches the raw-LLM speech context.
    publicContext: {
      record: publicInput.publicContext,
      recentUtterances: recentPublicUtterances(publicInput),
    },
    decision: structuredClone(plan.decision),
    candidateId: plan.candidateId,
    ...(communication ? { communication } : {}),
  }
}

/**
 * Speak the committed plan, when a voice is configured and the plan has anything
 * to say.
 *
 * Voice can decorate the committed action but never replace it, so every path
 * here returns the mechanical decision with at most speech attached, and each
 * failure names itself. The caller feeds the result through withDecisionVoice(),
 * which independently rejects a result that altered the committed mechanics, so
 * this function is the polite half of that contract rather than its enforcement.
 */
export async function speakCommittedPlan(input: {
  voice: PlanVoice | undefined
  plan: DecisionPlan
  view: PlayerView
  mechanicalDecision: Decision
  onSpeak: () => void
}): Promise<Readonly<{ action: Decision; degradationCode?: string }>> {
  const { voice, plan, view, mechanicalDecision } = input
  if (
    !voice
    || !plan.communication
    || plan.communication.actCodes.includes('PASS')
  ) {
    return { action: structuredClone(mechanicalDecision) }
  }
  input.onSpeak()
  try {
    const voicePlan = committedVoicePlan(plan, view)
    const output = await voice.speak({
      plan: structuredClone(voicePlan),
      renderedPlan: renderCommittedVoicePlan(voicePlan),
    })
    return output
      ? { action: withVoice(plan.decision, output) }
      : {
          action: structuredClone(mechanicalDecision),
          degradationCode: 'voice-no-output',
        }
  } catch {
    // Cloned from the plan's own decision, so the failure path is sourced from
    // the committed plan regardless of where the attempt died. This is belt and
    // braces, not a guard against a half-decorated action: withVoice() is
    // consumed by a single assignment, so a throw inside it never yields a
    // partial value to return in the first place.
    return {
      action: structuredClone(plan.decision),
      degradationCode: 'voice-failed',
    }
  }
}
