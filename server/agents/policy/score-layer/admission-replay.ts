import type { DecisionRequest, PlayerView } from '../../../engine/types.ts'
import type { SituationAnalysis } from '../../analysis/types.ts'
import type { DecisionComponentRun } from '../../components/kernel.ts'
import type { DecisionComponentDefinition } from '../../components/types.ts'
import { detachTrustedPolicyData } from '../trusted-data.ts'
import type { ForcedPolicyResult, PolicyCandidate } from '../types.ts'
import {
  executePreparedScoreLayerRun,
  prepareScoreLayerRunLease,
} from './runner.ts'
import type {
  ResolvedScoreLayerChain,
  ScoreLayerJournalEntry,
  ScoreLayerRow,
} from './types.ts'

export interface NativeScoreAdmissionReplayInput {
  readonly chain: ResolvedScoreLayerChain
  readonly request: DecisionRequest
  readonly view: PlayerView
  readonly analysis: SituationAnalysis
  readonly candidates: readonly PolicyCandidate[]
  readonly hypotheticalTeamCandidates?: readonly PolicyCandidate[]
  readonly forced: ForcedPolicyResult
  readonly deterministicSeed: string
  readonly compatibilityCandidateId: string
  /** Optional assertion for focused low-level replay tests. */
  readonly expectedScorerVersion?: string
  readonly componentDefinitions:
    readonly DecisionComponentDefinition<any>[]
  readonly componentRun: DecisionComponentRun
}

export interface NativeScoreAdmissionReplay {
  readonly rows: readonly ScoreLayerRow[]
  readonly survivorCandidateIds: readonly string[]
  readonly journal: readonly ScoreLayerJournalEntry[]
  readonly componentRun: DecisionComponentRun
  readonly resolvedScorerVersion: string
}

/** Replay one configured native chain from detached authoritative host input. */
export function replayNativeScoresForAdmission(
  input: NativeScoreAdmissionReplayInput,
): NativeScoreAdmissionReplay {
  const coordinates = detachTrustedPolicyData({
    request: input.request,
    view: input.view,
  })
  const lease = prepareScoreLayerRunLease({
    chain: input.chain,
    componentDefinitions: input.componentDefinitions,
    request: coordinates.request,
    view: coordinates.view,
  })
  const run = executePreparedScoreLayerRun(lease, {
    analysis: detachTrustedPolicyData(input.analysis),
    candidates: detachTrustedPolicyData(input.candidates),
    forced: detachTrustedPolicyData(input.forced),
    deterministicSeed: input.deterministicSeed,
    compatibilityCandidateId: input.compatibilityCandidateId,
    hypotheticalTeamCandidates: input.hypotheticalTeamCandidates
      ? detachTrustedPolicyData(input.hypotheticalTeamCandidates)
      : null,
    componentRun: detachTrustedPolicyData({
      ...input.componentRun,
      policyUse: input.componentRun.configured.map((component) => ({
        component,
        used: false,
        stages: [],
      })),
    }),
  })
  const active = [...run.journal].reverse().find(
    (entry) => entry.status === 'applied' || entry.status === 'generated',
  )
  if (!active) {
    throw new Error('native score admission replay resolved no scorer')
  }
  if (
    input.expectedScorerVersion !== undefined
    && active.layer.version !== input.expectedScorerVersion
  ) {
    throw new Error('native score admission replay resolved another scorer')
  }
  return Object.freeze({
    rows: run.surface.scores,
    survivorCandidateIds: run.surface.survivorCandidateIds,
    journal: run.journal,
    componentRun: run.componentRun,
    resolvedScorerVersion: active.layer.version,
  })
}
