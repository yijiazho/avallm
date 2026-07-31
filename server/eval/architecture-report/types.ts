// The vocabulary every other module in this report speaks.
//
// The report was one file, and the reason it stayed one file was that its
// summary shapes, its admission shapes, and its per-game accumulator were all
// mutually visible. Splitting the work into siblings only stays acyclic if the
// shapes live somewhere neither the producers nor the consumers own: observe.ts
// fills a GameObservation, summarize.ts drains one, and safety-current.ts and
// safety-legacy.ts both return an ArchitectureSafetyAdmission. Give any of them
// the type and the other two have to import back through it, which is exactly
// the cycle tools/import-cycles.mjs exists to reject.
//
// So this module holds shapes and one schema number and nothing else. It has no
// behavior to drift, which is what lets everyone depend on it.

import type {
  RateDeltaEstimate,
  RateEstimate,
} from '../core/statistics.ts'
import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from '../core/artifact.ts'
import type {
  Role,
} from '../../engine/types.ts'
import type {
  DecisionTrace,
} from '../../agents/trace.ts'
import type {
  VoteConfusionCounts,
} from '../runs/vote-direction.ts'
import type {
  DecisionComponentPlan,
} from '../../agents/components/kernel.ts'
import type {
  ResolvedArchitectureIdentity,
} from '../../agents/components/resolved-brain.ts'

export const ARCHITECTURE_REPORT_SCHEMA = 3

export interface LatencySummary {
  samples: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface ArchitectureDecisionQuality {
  targetWinRate: RateEstimate
  cleanInitialProposalRate: RateEstimate
  /**
   * Symmetric agreement with the deal. NB-013: it weights a wrongly rejected
   * clean team the same as a wrongly approved dirty team, and it rose while the
   * win rate fell, so it is reported for continuity and cannot gate a
   * promotion. Gate on `voteDirtyTeamApproveRate` falling instead.
   */
  voteTruthAccuracy: RateEstimate
  /** The costly vote error, over the dirty teams this seat was offered. */
  voteDirtyTeamApproveRate: RateEstimate
  /** The cheap vote error, over the clean teams this seat was offered. */
  voteCleanTeamRejectRate: RateEstimate
  plannerOverrideRate: RateEstimate
  seededVoteVariationRate: RateEstimate
  voteApproveRate: RateEstimate
  meanProposalCleanProbability: number | null
  meanProposalPosteriorRegret: number | null
  meanVoteUtilityRegret: number | null
}

export interface ArchitectureSafetySummary {
  hiddenInformationChecks: number
  hiddenInformationViolations: number
  traceAttributionChecks: number
  traceAttributionViolations: number
  /** Trusted, exact generic component evidence suitable for promotion gates. */
  promotionEvidenceEligible?: boolean
}

export interface ArchitectureSafetyAdmission {
  readonly safety: ArchitectureSafetySummary
  readonly traces: readonly Readonly<DecisionTrace>[]
}

export interface ArchitectureComponentEvidenceSummary {
  trust:
    | 'descriptor-host-manifest-admitted'
    | 'legacy-host-manifest-admitted'
    | 'unverified-composed'
    | 'not-applicable'
  promotionEvidenceEligible: boolean
  decisions: number
  configured: number
  admitted: number
  inapplicable: number
  suppressed: number
  degraded: number
  exact: number
  structural: number
  promotable: number
  policyUses: number
  policyStages: number
}

export interface ArchitectureRoleSummary {
  role: Role
  games: number
  wins: number
  voteScore: number | null
  forcedViolations: number
  degraded: number
  calls: number
  cost: number
  decisionQuality: ArchitectureDecisionQuality
  latency: LatencySummary
  safety: ArchitectureSafetySummary
}

export interface ArchitectureKindSummary {
  kind: string
  decisions: number
  calls: number
  degraded: number
  cost: number
}

export interface ArchitectureModelSummary {
  model: string
  calls: number
  cost: number
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  reasoningLeaks: number
}

export interface ArchitectureVariantSummary {
  id: string
  components: Record<string, string>
  /** Generic configured graph from the trusted producer manifest. */
  decisionComponents?: readonly string[]
  componentEvidence?: ArchitectureComponentEvidenceSummary
  games: number
  wins: number
  forcedViolations: number
  degraded: number
  calls: number
  cost: number
  decisionQuality: ArchitectureDecisionQuality
  latency: LatencySummary
  safety: ArchitectureSafetySummary
  byRole: ArchitectureRoleSummary[]
  byKind: ArchitectureKindSummary[]
  byModel: ArchitectureModelSummary[]
}

export interface ArchitectureComparison {
  baseline: string
  candidate: string
  matchedCases: number
  wins: number
  forcedViolations: number
  degraded: number
  cost: number
  promotionEvidenceEligible: boolean
  targetWinRateDelta: RateDeltaEstimate
  cleanInitialProposalRateDelta: RateDeltaEstimate
  /** Symmetric, and therefore not a promotion gate. See NB-013. */
  voteTruthAccuracyDelta: RateDeltaEstimate
  /** The gated direction: a promotion requires this to fall. */
  voteDirtyTeamApproveRateDelta: RateDeltaEstimate
  voteCleanTeamRejectRateDelta: RateDeltaEstimate
}

export interface ArchitectureBenchmarkReport {
  schema: number
  bank: string
  cases: string[]
  variants: ArchitectureVariantSummary[]
  comparisons: ArchitectureComparison[]
}

export type ArtifactArchitectureAdmission =
  | Readonly<{
      provenance: 'descriptor-host-manifest-admitted'
      plan: DecisionComponentPlan
      identity: ResolvedArchitectureIdentity
    }>
  | Readonly<{
      provenance: 'legacy-host-manifest-admitted'
      plan: DecisionComponentPlan
    }>
  | Readonly<{
      provenance: 'historical-absent' | 'legacy-host-manifest-invalid'
    }>
  | Readonly<{
      provenance: 'non-composed-host-metadata-admitted'
    }>

export interface GameObservation {
  artifact: GameArtifact
  decisionTraces: readonly Readonly<DecisionTrace>[]
  meta: ArchitectureRunMetadata
  architectureAdmission: ArtifactArchitectureAdmission
  won: boolean
  voteScore: number | null
  forced: number
  degraded: number
  decisions: Map<string, number>
  calls: Map<string, { calls: number; cost: number }>
  models: Map<string, ArchitectureModelSummary>
  cost: number
  callCount: number
  cleanInitialProposals: number
  initialProposals: number
  /** Owns every vote count; see vote-direction.ts for the single definition. */
  voteConfusion: VoteConfusionCounts
  plannerOverrides: number
  plannerSelections: number
  seededVoteVariations: number
  scoredVotes: number
  proposalCleanProbabilities: number[]
  proposalPosteriorRegrets: number[]
  voteUtilityRegrets: number[]
  latencyMs: number[]
  safety: ArchitectureSafetySummary
}
