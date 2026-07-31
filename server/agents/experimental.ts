// Despite the name, this is a STATICALLY-LIVE rendering path, not dead or
// throwaway code. It is imported directly by the raw-LLM agent (llm.ts) and the
// prompt builder (prompts.ts), and drives the belief block for live play,
// editor preview, and eval replay alike. It runs whenever an agent's
// `beliefVisibility === BELIEF_RENDERER_VERSION` selects the compact belief
// summary. The "experimental" name is historical; treat this as a shared live
// dependency when changing it.

import type { PlayerView, Seat } from '../engine/types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import type { SituationAnalysis } from './analysis/situation-types.ts'
import {
  advanceCognition,
  reconstructCognition,
} from './cognition/state.ts'
import type { CognitionState } from './cognition/types.ts'
import { renderBeliefSummary } from './communication/belief-summary.ts'

export interface ExperimentalBeliefContext {
  cognition: CognitionState
  analysis: SituationAnalysis
  rendered: string
}

/** Shared live, preview, replay, and offline rendering path. */
export function experimentalBeliefContext(
  view: PlayerView,
  candidateTeams: readonly (readonly Seat[])[] = [],
  earlier?: CognitionState,
): ExperimentalBeliefContext {
  const cognition = earlier
    ? advanceCognition(earlier, view)
    : reconstructCognition(view)
  const analysis = analyzeSituation(view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    candidateTeams,
  })
  return {
    cognition,
    analysis,
    rendered: renderBeliefSummary(view, cognition.belief, analysis),
  }
}
