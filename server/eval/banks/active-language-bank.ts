// API-free active-language architecture evaluation.
//
// This fake is intentionally evaluation-only. It converts a narrow public
// utterance DTO into deterministic, low-confidence reads without consulting
// hidden roles, raw Game state, prompts, providers, or model APIs.

import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
} from '../../agents/belief/language-factor.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../../agents/belief/types.ts'
import { createComposedAgent } from '../../agents/composed.ts'
import {
  LANGUAGE_EVIDENCE_VERSION,
  type LanguageEvidence,
  type LanguageInterpreter,
} from '../../agents/record/language-types.ts'
import type { Seat } from '../../engine/types.ts'
import type { ArchitectureVariant } from '../harness/architecture-bench.ts'

export const ACTIVE_LANGUAGE_EVALUATION_INTERPRETER_VERSION =
  'deterministic-public-dialogue-eval-v1'
export const ACTIVE_LANGUAGE_EVALUATION_PIPELINE =
  `${EXACT_BELIEF_MODEL_VERSION}+${LANGUAGE_FACTOR_BUNDLE_VERSION}`

export interface ActiveLanguageEvaluationStats {
  calls: number
  emittedReads: number
}

export function createActiveLanguageEvaluationInterpreter(
  viewerSeat: Seat,
  stats?: ActiveLanguageEvaluationStats,
): LanguageInterpreter {
  return {
    interpreterVersion: ACTIVE_LANGUAGE_EVALUATION_INTERPRETER_VERSION,
    async interpret(input) {
      if (stats) stats.calls++
      const evidence: LanguageEvidence[] = input.newUtterances
        .filter((utterance) => utterance.speaker.seat !== viewerSeat)
        .map((utterance) => ({
          schemaVersion: LANGUAGE_EVIDENCE_VERSION,
          sourceSeq: utterance.sourceSeq,
          subject: utterance.speaker.seat,
          // Deterministic stand-in for real interpretation, so the bank
          // exercises belief reads without an API call. It used to key off the
          // declared lean; with talk carrying the position instead, it keys off
          // the speech itself. Attributed utterances are never empty (the
          // language contract drops wordless turns), so this always yields a
          // read rather than 'unchanged'.
          direction: utterance.text.length % 2 === 0 ? 'moreEvil' : 'moreGood',
          class: 'other',
          confidence: 'low',
          publicRationale:
            'Deterministic API-free interpretation of a public table signal.',
          interpreterVersion:
            ACTIVE_LANGUAGE_EVALUATION_INTERPRETER_VERSION,
        }))
      if (stats) {
        stats.emittedReads += evidence.filter(
          (read) => read.direction !== 'unchanged',
        ).length
      }
      return evidence
    },
  }
}

export function activeLanguageEvaluationVariant(
  stats?: ActiveLanguageEvaluationStats,
): ArchitectureVariant {
  return {
    id: 'bounded-language-active',
    descriptor: 'experiment:bounded-language-active',
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      mechanicalBelief: EXACT_BELIEF_MODEL_VERSION,
      beliefPipeline: ACTIVE_LANGUAGE_EVALUATION_PIPELINE,
      factors: LANGUAGE_FACTOR_BUNDLE_VERSION,
      languageEvidence: LANGUAGE_FACTOR_BUNDLE_VERSION,
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      onDecisionTrace: context.onDecisionTrace,
      languageInterpreter: createActiveLanguageEvaluationInterpreter(
        context.seat,
        stats,
      ),
    }),
  }
}
