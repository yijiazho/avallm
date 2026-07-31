/**
 * The composed agent's one deliberately powerless computation.
 *
 * Nothing mechanical reads what this produces: `withNativeScoringAuthority`
 * rejects a projection that tries to restate value, viability, or reason codes,
 * so the module can only add rows for a reader to look at. It sits apart from
 * the spine because that powerlessness is the point, and because gathering its
 * three intermediate versions is what kept dragging score-layer plumbing into
 * decide().
 */
import type {
  ResolvedScoreLayerChain,
} from '../policy/score-layer/types.ts'
import {
  nativeDiagnosticOwnerVersion,
  nativeScorerVersion,
  projectScoringContext,
  type CompatibilityScoringBindings,
  type NativeScoreLayersResolvedDecisionFrame,
} from '../policy/decision-frame.ts'
import type { CandidateScore } from '../policy/score.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../score-diagnostics/project-score-diagnostics.ts'

/**
 * The additive per-candidate diagnostics the native score surface attaches.
 *
 * Every mechanical field still comes from the native layers; this only supplies
 * the private feature rows, and `withNativeScoringAuthority` rejects a
 * projection that tries to restate value, viability, or reason codes. The three
 * intermediate versions the projection needs are derived here rather than at the
 * call site because none of them outlives this computation.
 */
export function nativeScoreDiagnostics(
  frame: NativeScoreLayersResolvedDecisionFrame,
  chain: ResolvedScoreLayerChain,
  bindings: CompatibilityScoringBindings,
): readonly CandidateScore[] {
  return projectConfiguredScoreDiagnostics(
    projectScoringContext(frame, bindings),
    frame.scores,
    nativeScorerVersion(frame),
    frame.scoreLayerRun.configured.map((layer) => layer.version),
    nativeDiagnosticOwnerVersion(frame, chain),
  )
}
