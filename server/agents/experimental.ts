import type { PlayerView, Seat } from '../engine/types.ts'
import { analyzeSituation } from './analysis/situation.ts'
import type { SituationAnalysis } from './analysis/types.ts'
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
