// Compact, machine-readable architecture comparison report.
//
// The report is intentionally narrower than report.ts: it summarizes only the
// role seat selected by each architecture-bank case and groups operational
// results by role, decision/call kind, model, and component-version bundle.

import fs from 'node:fs'
import {
  parseArgs,
} from 'node:util'
import {
  isDeepStrictEqual,
} from 'node:util'
import {
  isProxy,
} from 'node:util/types'
import {
  pathToFileURL,
} from 'node:url'
import {
  MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES,
  readArtifacts,
} from './artifact.ts'
import {
  computeMetrics,
} from './metrics.ts'
import {
  addVoteConfusion,
  countVoteByDirection,
  emptyVoteConfusion,
  teamIsDirty,
  voteRateCount,
} from './vote-direction.ts'
import type {
  VoteConfusionCounts,
  VoteConfusionRate,
} from './vote-direction.ts'
import {
  mean,
  median,
  nearestRank,
  pairedBootstrapRateDelta,
  rate,
  seededRandom,
  sumOf,
} from './statistics.ts'
import type {
  RateDeltaEstimate,
  RateEstimate,
} from './statistics.ts'
import {
  fixed,
  renderDelta,
  renderMilliseconds,
  renderRate,
} from './report-format.ts'
import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from './artifact.ts'
import type {
  DecisionKind,
  Role,
} from '../engine/types.ts'
import {
  isComposedPolicy,
  isNonComposedPolicy,
} from '../agents/brain.ts'
import {
  LANGUAGE_FACTOR_BUNDLE_VERSION,
} from '../agents/belief/language-factor.ts'
import {
  validatePublicObserverSnapshot,
} from '../agents/analysis/observer.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
  isComposedTrace,
  type DecisionTrace,
} from '../agents/trace.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../agents/analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  validatePrivateIdentityHostJoin,
} from '../agents/belief/identity.ts'
import {
  PLAN_MEMORY_VERSION,
  validateAppliedPlanOutcomeHostJoin,
} from '../agents/cognition/plan-memory.ts'
import {
  COHERENCE_MODEL_VERSION,
  isCoherenceIntent,
} from '../agents/cognition/coherence.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../agents/analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
} from '../agents/analysis/role-objectives.ts'
import {
  buildEvilRoleObjectiveSnapshot,
} from '../agents/analysis/evil-objectives.ts'
import {
  EVIL_ROLE_OBJECTIVE_DEGRADATION,
  EVIL_ROLE_OBJECTIVE_MODEL_VERSION,
  ROLE_OBJECTIVE_ROUTER_VERSION,
} from '../agents/analysis/evil-objective-types.ts'
import {
  routedRoleObjectiveModel,
} from '../agents/analysis/role-objective-router.ts'
import {
  ROLE_UTILITY_DEGRADATION,
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../agents/analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../agents/analysis/evil-role-utility.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
} from '../agents/policy/score.ts'
import {
  legalCandidates,
} from '../agents/policy/candidates.ts'
import type {
  DecisionSnapshot,
} from './replay.ts'
import {
  authoritativeDecisionReplay,
  decisionTraceReplayJoin,
  exactTargetTraceCoverage,
  selectedDecisionReplayJoin,
  type AuthoritativeDecisionReplay,
} from './trace-replay.ts'
import {
  admitCanonicalDecisionTrace,
  snapshotDecisionTraceInput,
  type DecisionTraceAdmissionResult,
  type DecisionTraceSnapshotResult,
} from '../agents/admission/composed-trace.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../agents/policy/evil-quest-card.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
} from '../agents/analysis/morgana-counterfeit-types.ts'
import {
  EXACT_BELIEF_MODEL_VERSION,
} from '../agents/belief/types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../agents/analysis/morgana-role-utility.ts'
import {
  architectureIdentityDecisionPlan,
  architectureIdentityVersions,
} from '../agents/components/architecture-metadata.ts'
import {
  exactOwnDataRecord as exactCurrentArchitectureRecord,
} from '../agents/components/canonical-json.ts'
import {
  admitResolvedArchitectureIdentity,
  resolvedArchitectureIdentityDigest,
  type ResolvedArchitectureIdentity,
} from '../agents/components/resolved-brain.ts'
import {
  validateDecisionComponentPlan,
  type DecisionComponentPlan,
} from '../agents/components/kernel.ts'

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

interface ArchitectureSafetyAdmission {
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

/**
 * A composed architecture is named by its policy, the one field that is 1:1 with
 * the agent kind. Manifests and traces each declare it, so both sides stay
 * independently checkable without a second, redundant mode label.
 */
function isComposedComponents(
  components: Record<string, string>,
): boolean {
  return isComposedPolicy(components.policy)
}

interface GameObservation {
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

function increment(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount)
}

function actionKind(a: GameArtifact, type: string, seat: unknown): DecisionKind | undefined {
  const target = a.architecture!.targetSeat
  if (seat !== target) return undefined
  switch (type) {
    case 'utterance': return 'discuss'
    case 'proposal': return 'propose'
    case 'proposalLocked':
    case 'proposalRevised': return 'finalize'
    case 'voteCast': return 'vote'
    case 'questCard': return 'quest'
    case 'assassination': return 'assassinate'
    default: return undefined
  }
}

function canonicalRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && !isProxy(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}

/**
 * Scan privacy on the canonical transport snapshot, independently of whether
 * host admission accepts that trace as evidence. The snapshot boundary makes
 * property access inert; these shape checks keep malformed diagnostics from
 * throwing or acquiring admission semantics.
 */
function canonicalTracePrivacyScan(
  traces: readonly unknown[],
): Readonly<{ checks: number; violations: number }> {
  let checks = 0
  let violations = 0
  for (const value of traces) {
    const trace = canonicalRecord(value)
    const action = canonicalRecord(trace?.action)
    let speech = ''
    if (action?.kind === 'discuss' && typeof action.say === 'string') {
      speech = action.say
    } else if (
      action?.kind === 'propose'
      && typeof action.pitch === 'string'
    ) {
      speech = action.pitch
    } else if (
      action?.kind === 'finalize'
      && action.stick === false
      && typeof action.reason === 'string'
    ) {
      speech = action.reason
    }
    if (!speech) continue
    checks++

    const forbidden: string[] = ['role-composite-decision']
    if (typeof trace?.beliefModelVersion === 'string') {
      forbidden.push(trace.beliefModelVersion)
    }
    if (Array.isArray(trace?.topHypotheses)) {
      for (const hypothesisValue of trace.topHypotheses) {
        const hypothesis = canonicalRecord(hypothesisValue)
        if (typeof hypothesis?.worldKey === 'string') {
          forbidden.push(hypothesis.worldKey)
        }
      }
    }
    const intent = canonicalRecord(trace?.communicationIntent)
    if (Array.isArray(intent?.conceal)) {
      for (const value of intent.conceal) {
        if (typeof value === 'string') forbidden.push(value)
      }
    }
    const uncertainty = canonicalRecord(intent?.uncertainty)
    if (uncertainty) {
      for (const value of Object.values(uncertainty)) {
        if (
          typeof value === 'number'
          && Number.isFinite(value)
          && !Number.isInteger(value)
        ) {
          forbidden.push(String(value))
        }
      }
    }
    if (Array.isArray(trace?.beliefPlayerMarginals)) {
      for (const marginalValue of trace.beliefPlayerMarginals) {
        const marginal = canonicalRecord(marginalValue)
        for (const value of [
          marginal?.goodProbability,
          marginal?.evilProbability,
        ]) {
          if (
            typeof value === 'number'
            && Number.isFinite(value)
            && !Number.isInteger(value)
          ) {
            forbidden.push(String(value))
          }
        }
      }
    }
    if (
      forbidden.some((secret) =>
        secret.length > 0 && speech.includes(secret))
    ) {
      violations++
    }
  }
  return Object.freeze({ checks, violations })
}

function artifactWithCanonicalDecisionTraces(
  artifact: GameArtifact,
  traces: readonly Readonly<DecisionTrace>[],
): GameArtifact {
  return {
    ...artifact,
    decisionTraces: Object.freeze([...traces]) as DecisionTrace[],
  }
}

function planOutcomeHostJoin(
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

function legacyExactOwnDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (!isDeepStrictEqual(Object.keys(descriptors).sort(), [...expectedKeys].sort())) {
    return undefined
  }
  const record: Record<string, unknown> = {}
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]
    if (
      !descriptor
      || descriptor.enumerable !== true
      || !Object.hasOwn(descriptor, 'value')
      || descriptor.get !== undefined
      || descriptor.set !== undefined
    ) {
      return undefined
    }
    record[key] = descriptor.value
  }
  return record
}

function denseOwnDataArray(value: unknown): readonly unknown[] | undefined {
  if (
    !Array.isArray(value)
    || isProxy(value)
    || Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return undefined
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const expected = Array.from(
    { length: value.length },
    (_, index) => `${index}`,
  )
  if (
    !isDeepStrictEqual(
      Object.keys(descriptors).filter((key) => key !== 'length').sort(),
      expected,
    )
    || expected.some((key) => {
      const descriptor = descriptors[key]
      return (
        !descriptor
        || descriptor.enumerable !== true
        || !Object.hasOwn(descriptor, 'value')
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      )
    })
  ) {
    return undefined
  }
  return expected.map((key) => descriptors[key].value)
}

type ArtifactArchitectureAdmission =
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

function artifactArchitectureAdmission(
  artifact: GameArtifact,
): ArtifactArchitectureAdmission {
  try {
    const strategy = artifact.strategyVersions
    const currentDescriptor = strategy
      ? Object.getOwnPropertyDescriptor(strategy, 'resolvedArchitecture')
      : undefined
    if (currentDescriptor) {
      if (
        !Object.hasOwn(currentDescriptor, 'value')
        || currentDescriptor.get !== undefined
        || currentDescriptor.set !== undefined
      ) {
        throw new Error('current architecture manifest must be own data')
      }
      const current = exactCurrentArchitectureRecord(
        currentDescriptor.value,
        [
        'identity',
        'identityDigest',
        'schema',
        'targetSeat',
        ],
      )
      const identity = admitResolvedArchitectureIdentity(current?.identity)
      if (
        !current
        || current.schema !== 1
        || current.targetSeat !== artifact.architecture?.targetSeat
        || !identity
        || current.identityDigest
          !== resolvedArchitectureIdentityDigest(identity)
      ) {
        throw new Error('current architecture manifest is invalid')
      }
      return {
        provenance: 'descriptor-host-manifest-admitted',
        plan: architectureIdentityDecisionPlan(identity),
        identity,
      }
    }
    const legacy = admitLegacyHostComponentManifest(artifact)
    if (
      legacy.provenance === 'historical-absent'
      && isNonComposedPolicy(artifact.architecture?.components.policy)
    ) {
      return { provenance: 'non-composed-host-metadata-admitted' }
    }
    return legacy
  } catch (error) {
    if (
      error instanceof Error
      && error.message.startsWith('current architecture manifest')
    ) {
      throw error
    }
    return { provenance: 'legacy-host-manifest-invalid' }
  }
}

/**
 * Historical schema-1 adapter. Current descriptors never enter this reader
 * and a current-manifest failure cannot fall back to it.
 */
function admitLegacyHostComponentManifest(
  artifact: GameArtifact,
): ArtifactArchitectureAdmission {
  try {
    const strategy = artifact.strategyVersions
    const descriptor = strategy
      ? Object.getOwnPropertyDescriptor(strategy, 'decisionComponents')
      : undefined
    if (!descriptor) return { provenance: 'historical-absent' }
    const manifest = Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined
    const record = legacyExactOwnDataRecord(manifest, ['schema', 'seats'])
    const seats = denseOwnDataArray(record?.seats)
    if (
      !record
      || record.schema !== 1
      || !seats
      || !seats.length
      || seats.length > artifact.playerCount
    ) {
      return { provenance: 'legacy-host-manifest-invalid' }
    }
    const plans = new Map<number, DecisionComponentPlan>()
    const normalizedSeats: Array<{
      seat: number
      plan: DecisionComponentPlan
    }> = []
    let previousSeat = -1
    for (const candidate of seats) {
      const entry = legacyExactOwnDataRecord(candidate, ['plan', 'seat'])
      if (
        !entry
        || !Number.isInteger(entry.seat)
        || (entry.seat as number) < 0
        || (entry.seat as number) >= artifact.playerCount
        || (entry.seat as number) <= previousSeat
        || !validateDecisionComponentPlan(entry.plan)
      ) {
        return { provenance: 'legacy-host-manifest-invalid' }
      }
      previousSeat = entry.seat as number
      plans.set(
        entry.seat as number,
        entry.plan as DecisionComponentPlan,
      )
      normalizedSeats.push({
        seat: entry.seat as number,
        plan: entry.plan as DecisionComponentPlan,
      })
    }
    if (
      Buffer.byteLength(
        JSON.stringify({ schema: 1, seats: normalizedSeats }),
        'utf8',
      ) > MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES
    ) {
      return { provenance: 'legacy-host-manifest-invalid' }
    }
    const target = artifact.architecture?.targetSeat
    const plan = target === undefined ? undefined : plans.get(target)
    return plan
      ? { provenance: 'legacy-host-manifest-admitted', plan }
      : { provenance: 'legacy-host-manifest-invalid' }
  } catch {
    return { provenance: 'legacy-host-manifest-invalid' }
  }
}

function hasComponentManifestClaim(
  admission: ArtifactArchitectureAdmission,
): boolean {
  return admission.provenance !== 'historical-absent'
    && admission.provenance !== 'non-composed-host-metadata-admitted'
}

const PRIVATE_ARCHITECTURE_TELEMETRY =
  /decisionTrace|decisionComponents|decision-component-run|componentPlan|policyUse|componentEvidence|hostInput|candidateScores|roleObjectiveFeatures|evilRoleObjectiveFeatures|morganaRoleObjectiveFeatures|topHypotheses|communicationIntent|beliefProvenance|beliefPlayerMarginals|beliefTeamAssessments|publicObserver|privateIdentity|identityModel|privateRoleObjective|privateEvilRoleObjective|evilRoleObjective|roleObjectiveRouter|roleObjective|privateRoleUtility|roleUtility|privateEvilRoleUtility|evilRoleUtility|privateMorganaRoleUtility|morganaRoleUtility|evilQuestCardPolicy|publicMorganaCounterfeitRead|privateMorganaCounterfeitObjective|morganaCounterfeit|configuredScorer|privatePlanOutcome|planMemory|coherence|coherenceIntent/

/**
 * Retired schemas remain privacy signatures after their semantic readers are
 * deleted. Public logs must never regain these private D3 payload names merely
 * because current trace admission treats them as closed-ingress tombstones.
 */
const RETIRED_PRIVATE_D3_TELEMETRY =
  /privateEvilQuestCardPolicy|configuredEvilQuestCardPolicy|orderedVisibleEvilAboard|visibleEvilAboardCount|sourceFingerprint/

function containsPrivateArchitectureTelemetry(value: string): boolean {
  return PRIVATE_ARCHITECTURE_TELEMETRY.test(value)
    || RETIRED_PRIVATE_D3_TELEMETRY.test(value)
}

function currentArchitectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: Extract<
    ArtifactArchitectureAdmission,
    { provenance: 'descriptor-host-manifest-admitted' }
  >,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = containsPrivateArchitectureTelemetry(
    JSON.stringify(
      artifact.log.filter((event) => event.visibility === 'public'),
    ),
  ) ? 1 : 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const rejectedSnapshots = traceCandidates.filter(
    (candidate) => candidate.kind === 'rejected',
  )
  const canonicalCandidates = traceCandidates.filter(
    (candidate) =>
      candidate.kind === 'canonical-decision-trace-candidate',
  )
  const traces = canonicalCandidates.map((candidate) => candidate.trace)
  const tracePrivacy = canonicalTracePrivacyScan(traces)
  hiddenInformationChecks += tracePrivacy.checks
  hiddenInformationViolations += tracePrivacy.violations
  traceAttributionChecks += rejectedSnapshots.length
  traceAttributionViolations += rejectedSnapshots.length
  const trustedAdmissions: DecisionTraceAdmissionResult[] = []
  const admittedTraces: Readonly<DecisionTrace>[] = []
  const canonicalArtifact = artifactWithCanonicalDecisionTraces(
    artifact,
    traces,
  )
  let replay: AuthoritativeDecisionReplay | undefined
  try {
    replay = authoritativeDecisionReplay(
      canonicalArtifact,
      meta.targetSeat,
      traces,
    )
    traceAttributionChecks++
    if (!exactTargetTraceCoverage(
      replay.snapshots,
      traces,
      meta.targetSeat,
    )) {
      traceAttributionViolations++
    }
  } catch {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  const planCoherenceEnabled =
    admission.identity.configuredPipeline.planCoherence.memory !== 'off'
    && admission.identity.configuredPipeline.planCoherence.model !== 'off'
  for (const candidate of canonicalCandidates) {
    traceAttributionChecks++
    const pendingTrace = candidate.trace
    const snapshot = replay?.snapshots.get(pendingTrace.decisionId)
    if (!snapshot) {
      traceAttributionViolations++
      continue
    }
    const traceAdmission = admitCanonicalDecisionTrace({
      kind: 'finalized-artifact',
      trace: candidate,
      req: snapshot.req,
      view: snapshot.view,
      authoritativeAction: snapshot.original,
      deterministicSeed: artifact.seed,
      expectComponentTrace: true,
      expectedComponentPlan: admission.plan,
      expectedArchitectureIdentity: admission.identity,
    })
    trustedAdmissions.push(traceAdmission)
    if (traceAdmission.kind !== 'trusted-exact') {
      traceAttributionViolations++
      continue
    }
    const trace = traceAdmission.trace
    admittedTraces.push(trace)
    const planAttributionValid = planCoherenceEnabled
      ? (
          trace.componentVersions?.planMemory
            === admission.identity.configuredPipeline.planCoherence.memory
          && trace.componentVersions?.coherence
            === admission.identity.configuredPipeline.planCoherence.model
          && trace.coherenceIntent
            === admission.identity.configuredPipeline.planCoherence.intent
          && !!snapshot
          && decisionTraceReplayJoin(snapshot, trace)
          && (
            trace.privatePlanOutcome === undefined
              ? trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
              : (
                  !!replay
                  && planOutcomeHostJoin(artifact, replay, trace)
                  && isDeepStrictEqual(
                    trace.privatePlanOutcome.request,
                    trace.request,
                  )
                  && isDeepStrictEqual(
                    trace.privatePlanOutcome.appliedDecision,
                    trace.action,
                  )
                )
          )
        )
      : (
          trace.privatePlanOutcome === undefined
          && trace.componentVersions?.planMemory === undefined
          && trace.componentVersions?.coherence === undefined
          && trace.coherenceIntent === undefined
          && !trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
        )
    if (
      trace.viewerSeat !== meta.targetSeat
      || !planAttributionValid
    ) {
      traceAttributionViolations++
    }
  }
  return {
    traces: Object.freeze(admittedTraces),
    safety: {
      hiddenInformationChecks,
      hiddenInformationViolations,
      traceAttributionChecks,
      traceAttributionViolations,
      promotionEvidenceEligible: (
        trustedAdmissions.length === traces.length
        && trustedAdmissions.length > 0
        && trustedAdmissions.every((result) =>
          result.kind === 'trusted-exact'
          && result.promotionEvidenceEligible)
        && hiddenInformationViolations === 0
        && traceAttributionViolations === 0
      ),
    },
  }
}

/**
 * Historical compatibility reader for schema-1 manifests and absent
 * manifests. Current descriptor evidence never enters this role-aware path.
 */
function legacyArchitectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  architectureAdmission: ArtifactArchitectureAdmission,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const publicLog = JSON.stringify(
    artifact.log.filter((event) => event.visibility === 'public'),
  )
  if (containsPrivateArchitectureTelemetry(publicLog)) {
    hiddenInformationViolations++
  }
  const rejectedSnapshots = traceCandidates.filter(
    (candidate) => candidate.kind === 'rejected',
  )
  const canonicalCandidates = traceCandidates.filter(
    (candidate) =>
      candidate.kind === 'canonical-decision-trace-candidate',
  )
  const traces = canonicalCandidates.map((candidate) => candidate.trace)
  const tracePrivacy = canonicalTracePrivacyScan(traces)
  hiddenInformationChecks += tracePrivacy.checks
  hiddenInformationViolations += tracePrivacy.violations
  traceAttributionChecks += rejectedSnapshots.length
  traceAttributionViolations += rejectedSnapshots.length
  const admittedTraces: Readonly<DecisionTrace>[] = []
  const componentManifestClaim = hasComponentManifestClaim(
    architectureAdmission,
  )
  const hostRequiresComponentEvidence = isComposedComponents(
    meta.components,
  )
  const validComponentManifest =
    architectureAdmission.provenance
      === 'descriptor-host-manifest-admitted'
    || architectureAdmission.provenance
      === 'legacy-host-manifest-admitted'
  const expectedComponentPlan: DecisionComponentPlan | undefined =
    validComponentManifest ? architectureAdmission.plan : undefined
  const genericComponentClaim = traces.some((trace) =>
    trace.version === COMPONENT_DECISION_TRACE_VERSION
    || trace.componentPlan !== undefined
    || trace.components !== undefined
    || trace.componentVersions?.decisionComponents !== undefined)
  if (componentManifestClaim && genericComponentClaim) {
    traceAttributionChecks++
    if (
      !validComponentManifest
      || !expectedComponentPlan
    ) {
      traceAttributionViolations++
    }
  }
  const declaresBoundedLanguage =
    meta.components.languageEvidence === LANGUAGE_FACTOR_BUNDLE_VERSION
  const declaresPublicObserver =
    meta.components.observerModel === PUBLIC_OBSERVER_MODEL_VERSION
  const declaresJointIdentity =
    meta.components.identityModel === JOINT_IDENTITY_MODEL_VERSION
  const declaresRoleObjectiveRouter =
    meta.components.roleObjectiveRouter === ROLE_OBJECTIVE_ROUTER_VERSION
  const routedObjective = declaresRoleObjectiveRouter
    ? routedRoleObjectiveModel(meta.targetRole)
    : 'off'
  const declaresRoleObjective =
    meta.components.roleObjective === ROLE_OBJECTIVE_MODEL_VERSION
  const roleObjectiveApplicable =
    routedObjective === ROLE_OBJECTIVE_MODEL_VERSION
    || (
      declaresRoleObjective
      && (meta.targetRole === 'merlin' || meta.targetRole === 'percival')
    )
  const evilRoleObjectiveApplicable =
    routedObjective === EVIL_ROLE_OBJECTIVE_MODEL_VERSION
  const declaresRoleUtility =
    meta.components.roleUtility === ROLE_UTILITY_PROJECTION_VERSION
  const roleUtilityApplicable = declaresRoleUtility && roleObjectiveApplicable
  const declaresEvilRoleUtility =
    meta.components.evilRoleUtility
      === EVIL_ROLE_UTILITY_PROJECTION_VERSION
  const evilRoleUtilityApplicable =
    declaresEvilRoleUtility && evilRoleObjectiveApplicable
  const declaredEvilQuestCardPolicy =
    meta.components.evilQuestCardPolicy
  const declaresEvilQuestCardPolicy =
    declaredEvilQuestCardPolicy === EVIL_QUEST_ROBUST_POLICY_VERSION
  const invalidEvilQuestCardPolicyDeclaration =
    declaredEvilQuestCardPolicy === undefined
      ? meta.components.populationAssumption !== undefined
      : (
          !declaresEvilQuestCardPolicy
          || meta.components.populationAssumption
            !== 'heterogeneous-independent'
        )
  const declaresMorganaCounterfeit =
    meta.components.morganaCounterfeitObjective
      === MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
  const invalidMorganaCounterfeitDeclaration =
    meta.components.morganaCounterfeitObjective !== undefined
    && (
      !declaresMorganaCounterfeit
      || !declaresPublicObserver
      || meta.components.belief !== EXACT_BELIEF_MODEL_VERSION
      || meta.components.factors !== 'off'
      || meta.components.languageEvidence !== 'off'
      || !isComposedComponents(meta.components)
    )
  const declaresMorganaRoleUtility =
    meta.components.morganaRoleUtility
      === MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  const invalidMorganaRoleUtilityDeclaration =
    meta.components.morganaRoleUtility !== undefined
    && (
      !declaresMorganaRoleUtility
      || !declaresMorganaCounterfeit
      || !declaresEvilRoleUtility
      || !declaresRoleObjectiveRouter
      || ![
        MORGANA_ROLE_SCORER_VERSION,
        MORGANA_ROLE_SEEDED_SCORER_VERSION,
      ].includes(
        meta.components.scorer as typeof MORGANA_ROLE_SCORER_VERSION,
      )
    )
  const declaredCoherenceIntent = meta.components.coherenceIntent
  const declaresPlanMemory =
    meta.components.planMemory === PLAN_MEMORY_VERSION
    && meta.components.coherence === COHERENCE_MODEL_VERSION
    && isCoherenceIntent(declaredCoherenceIntent)
  const invalidPlanDeclaration =
    (
      meta.components.planMemory !== undefined
      || meta.components.coherence !== undefined
      || meta.components.coherenceIntent !== undefined
    )
    && !declaresPlanMemory
  const invalidIdentityDeclaration =
    meta.components.identityModel !== undefined
    && !declaresJointIdentity
  const invalidRoleObjectiveDeclaration =
    (
      meta.components.roleObjective !== undefined
      && !declaresRoleObjective
    )
    || (
      meta.components.roleObjectiveRouter !== undefined
      && !declaresRoleObjectiveRouter
    )
    || (
      declaresRoleObjectiveRouter
      && (
        meta.components.roleObjective !== undefined
        || !declaresPublicObserver
        || !declaresJointIdentity
      )
    )
  const invalidRoleUtilityDeclaration =
    (
      meta.components.roleUtility !== undefined
      && !declaresRoleUtility
    )
    || (
      declaresRoleUtility
      && (
        (!declaresRoleObjective && !declaresRoleObjectiveRouter)
        || ![
          ROLE_OBJECTIVE_SCORER_VERSION,
          ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          meta.components.scorer as typeof ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    )
    || (
      declaresRoleObjective
      && (
        !declaresJointIdentity
        || !declaresPublicObserver
      )
    )
  const invalidEvilRoleUtilityDeclaration =
    (
      meta.components.evilRoleUtility !== undefined
      && !declaresEvilRoleUtility
    )
    || (
      declaresEvilRoleUtility
      && (
        !declaresRoleObjectiveRouter
        || ![
          EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
          EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
          MORGANA_ROLE_SCORER_VERSION,
          MORGANA_ROLE_SEEDED_SCORER_VERSION,
        ].includes(
          meta.components.scorer as typeof EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
        )
      )
    )
  const coverageRequired =
    traces.length > 0
    || hostRequiresComponentEvidence
    || componentManifestClaim
    || declaresBoundedLanguage
    || declaresPublicObserver
    || declaresJointIdentity
    || declaresPlanMemory
    || declaresRoleObjective
    || declaresRoleObjectiveRouter
    || declaresRoleUtility
    || declaresEvilRoleUtility
    || declaresEvilQuestCardPolicy
    || declaresMorganaCounterfeit
    || declaresMorganaRoleUtility
    || invalidIdentityDeclaration
    || invalidPlanDeclaration
    || invalidRoleObjectiveDeclaration
    || invalidRoleUtilityDeclaration
    || invalidEvilRoleUtilityDeclaration
    || invalidEvilQuestCardPolicyDeclaration
    || invalidMorganaCounterfeitDeclaration
    || invalidMorganaRoleUtilityDeclaration
  const componentEvidenceApplicable = (
    hostRequiresComponentEvidence
    || componentManifestClaim
    || genericComponentClaim
    || traces.some((trace) =>
      isComposedTrace(trace))
  )
  const canonicalArtifact = artifactWithCanonicalDecisionTraces(
    artifact,
    traces,
  )
  let targetReplay: AuthoritativeDecisionReplay | undefined
  let targetSnapshots: ReadonlyMap<string, DecisionSnapshot> = new Map()
  let invalidTraceCoverage = false
  if (coverageRequired) {
    try {
      targetReplay = authoritativeDecisionReplay(
        canonicalArtifact,
        meta.targetSeat,
        traces,
      )
      targetSnapshots = targetReplay.snapshots
      invalidTraceCoverage = !exactTargetTraceCoverage(
        targetSnapshots,
        traces,
        meta.targetSeat,
      )
    } catch {
      invalidTraceCoverage = true
    }
  }
  const planSnapshots = declaresPlanMemory
    ? targetSnapshots
    : new Map<string, DecisionSnapshot>()
  const artifactIdentities = artifact.strategyVersions?.identities
  const invalidIdentityManifest = declaresJointIdentity
    ? (
        !artifactIdentities
        || artifactIdentities.length !== 1
        || artifactIdentities[0] !== JOINT_IDENTITY_MODEL_VERSION
      )
    : artifactIdentities !== undefined && artifactIdentities.length > 0
  const artifactPlanMemories = artifact.strategyVersions?.planMemories
  const artifactCoherences = artifact.strategyVersions?.coherences
  const invalidPlanManifest = declaresPlanMemory
    ? (
        artifactPlanMemories?.length !== 1
        || artifactPlanMemories[0] !== PLAN_MEMORY_VERSION
        || artifactCoherences?.length !== 1
        || artifactCoherences[0] !== COHERENCE_MODEL_VERSION
      )
    : (
        (artifactPlanMemories?.length ?? 0) > 0
        || (artifactCoherences?.length ?? 0) > 0
      )
  const artifactRoleObjectives = artifact.strategyVersions?.roleObjectives
  const expectedObjectiveManifest = routedObjective === 'off'
    ? declaresRoleObjective ? [ROLE_OBJECTIVE_MODEL_VERSION] : []
    : [routedObjective]
  const invalidRoleObjectiveManifest = expectedObjectiveManifest.length
    ? (
      artifactRoleObjectives?.length !== 1
        || artifactRoleObjectives[0] !== expectedObjectiveManifest[0]
      )
    : (artifactRoleObjectives?.length ?? 0) > 0
  const artifactRoleObjectiveRouters =
    artifact.strategyVersions?.roleObjectiveRouters
  const invalidRoleObjectiveRouterManifest = declaresRoleObjectiveRouter
    ? (
        artifactRoleObjectiveRouters?.length !== 1
        || artifactRoleObjectiveRouters[0] !== ROLE_OBJECTIVE_ROUTER_VERSION
      )
    : (artifactRoleObjectiveRouters?.length ?? 0) > 0
  const artifactRoleUtilities = artifact.strategyVersions?.roleUtilities
  const invalidRoleUtilityManifest = declaresRoleUtility
    ? (
        artifactRoleUtilities?.length !== 1
        || artifactRoleUtilities[0] !== ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactRoleUtilities?.length ?? 0) > 0
  const artifactEvilRoleUtilities =
    artifact.strategyVersions?.evilRoleUtilities
  const invalidEvilRoleUtilityManifest = declaresEvilRoleUtility
    ? (
        artifactEvilRoleUtilities?.length !== 1
        || artifactEvilRoleUtilities[0]
          !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactEvilRoleUtilities?.length ?? 0) > 0
  const artifactEvilQuestCardPolicies =
    artifact.strategyVersions?.evilQuestCardPolicies
  const invalidEvilQuestCardPolicyManifest = declaresEvilQuestCardPolicy
    ? (
        artifactEvilQuestCardPolicies?.length !== 1
        || artifactEvilQuestCardPolicies[0]
          !== declaredEvilQuestCardPolicy
      )
    : (artifactEvilQuestCardPolicies?.length ?? 0) > 0
  const artifactMorganaCounterfeitObjectives =
    artifact.strategyVersions?.morganaCounterfeitObjectives
  const invalidMorganaCounterfeitManifest = declaresMorganaCounterfeit
    ? (
        artifactMorganaCounterfeitObjectives?.length !== 1
        || artifactMorganaCounterfeitObjectives[0]
          !== MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
      )
    : (artifactMorganaCounterfeitObjectives?.length ?? 0) > 0
  const artifactMorganaRoleUtilities =
    artifact.strategyVersions?.morganaRoleUtilities
  const invalidMorganaRoleUtilityManifest = declaresMorganaRoleUtility
    ? (
        artifactMorganaRoleUtilities?.length !== 1
        || artifactMorganaRoleUtilities[0]
          !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
      )
    : (artifactMorganaRoleUtilities?.length ?? 0) > 0
  if (invalidIdentityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidPlanManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleObjectiveManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleObjectiveRouterManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidEvilRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidEvilQuestCardPolicyManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidMorganaCounterfeitManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidMorganaRoleUtilityManifest) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  if (invalidTraceCoverage) {
    traceAttributionChecks++
    traceAttributionViolations++
  }
  for (const candidate of canonicalCandidates) {
    traceAttributionChecks++
    const pendingTrace = candidate.trace
    const hostSnapshot = targetSnapshots.get(pendingTrace.decisionId)
    if (!hostSnapshot) {
      traceAttributionViolations++
      continue
    }
    const pendingStrictComposedTrace = isComposedTrace(pendingTrace)
    const traceAdmission = admitCanonicalDecisionTrace({
      kind: 'finalized-artifact',
      trace: candidate,
      req: hostSnapshot.req,
      view: hostSnapshot.view,
      authoritativeAction: hostSnapshot.original,
      deterministicSeed: artifact.seed,
      ...(expectedComponentPlan
        ? {
            expectComponentTrace: true,
            expectedComponentPlan,
          }
        : {}),
      ...(
        pendingTrace.version !== COMPONENT_DECISION_TRACE_VERSION
        && pendingStrictComposedTrace
          ? { diagnosticVerification: 'exact' as const }
          : {}
      ),
    })
    if (traceAdmission.kind === 'rejected') {
      traceAttributionViolations++
      continue
    }
    const trace = traceAdmission.trace
    admittedTraces.push(trace)
    const strictComposedTrace = isComposedTrace(trace)
    const versions = trace.componentVersions
    const languageEnabled = declaresBoundedLanguage
    const stableKeys = [
      'brain',
      'factors',
      'languageEvidence',
      ...(meta.components.observerModel === undefined
        ? []
        : ['observerModel']),
      ...(declaresJointIdentity ? ['identityModel'] : []),
      ...(declaresPlanMemory ? ['planMemory', 'coherence'] : []),
      ...(
        roleObjectiveApplicable && !declaresRoleObjectiveRouter
          ? ['roleObjective']
          : []
      ),
      ...(declaresRoleObjectiveRouter ? ['roleObjectiveRouter'] : []),
      'policy',
      'planner',
      'voice',
      ...(languageEnabled
        ? ['mechanicalBelief', 'beliefPipeline']
        : ['belief']),
    ]
    const invalidDeclaration = languageEnabled
      ? (
          meta.components.belief !== undefined
          || !meta.components.mechanicalBelief
          || !meta.components.beliefPipeline
        )
      : (
          meta.components.mechanicalBelief !== undefined
          || meta.components.beliefPipeline !== undefined
        )
    const invalidTraceShape = languageEnabled
      ? (
          !versions?.mechanicalBelief
          || !versions.beliefPipeline
        )
      : (
          versions?.mechanicalBelief !== undefined
          || versions?.beliefPipeline !== undefined
        )
    if (
      trace.viewerSeat !== meta.targetSeat
      || !versions
      || (
        expectedComponentPlan !== undefined
        && trace.version !== COMPONENT_DECISION_TRACE_VERSION
      )
      || versions.belief !== trace.beliefModelVersion
      || versions.roleObjective !== (
        roleObjectiveApplicable
          ? ROLE_OBJECTIVE_MODEL_VERSION
          : evilRoleObjectiveApplicable
            ? EVIL_ROLE_OBJECTIVE_MODEL_VERSION
            : undefined
      )
      || invalidDeclaration
      || invalidIdentityDeclaration
      || invalidPlanDeclaration
      || invalidRoleObjectiveDeclaration
      || invalidRoleUtilityDeclaration
      || invalidEvilRoleUtilityDeclaration
      || invalidEvilQuestCardPolicyDeclaration
      || invalidMorganaCounterfeitDeclaration
      || invalidMorganaRoleUtilityDeclaration
      || invalidTraceShape
      || (
        declaresEvilQuestCardPolicy
          ? traceAdmission.facts.evilQuestCardPolicy.state
            === 'not-configured'
          : traceAdmission.facts.evilQuestCardPolicy.state
            !== 'not-configured'
      )
      || versions.configuredMorganaCounterfeitObjective
        !== (
          declaresMorganaCounterfeit
            ? MORGANA_COUNTERFEIT_OBJECTIVE_VERSION
            : undefined
        )
      || versions.configuredMorganaRoleUtility
        !== (
          declaresMorganaRoleUtility
            ? MORGANA_ROLE_UTILITY_PROJECTION_VERSION
            : undefined
        )
      || (
        declaresMorganaRoleUtility
        && meta.targetRole === 'morgana'
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // The retired flat E1B payload can no longer be present, so an
          // applicable Morgana decision can only ever declare the degradation.
          ? true
          : (
              versions.morganaRoleUtility !== undefined
              || trace.degradation.includes(
                MORGANA_ROLE_UTILITY_DEGRADATION,
              )
            )
      )
      || (
        declaresPublicObserver
          ? (
              trace.publicObserver === undefined
                ? !strictComposedTrace
                : !validatePublicObserverSnapshot(trace.publicObserver)
            )
          : trace.publicObserver !== undefined
      )
      || (() => {
        // A retired flat utility payload can never be present, so no historical
        // decision reports an applied flat role, evil, or Morgana utility. The
        // expected scorer is therefore always the base scorer its declared role
        // family falls back to.
        const seeded =
          meta.components.scorer
            === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === MORGANA_ROLE_SEEDED_SCORER_VERSION
        const expectedScorer = seeded
          ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
          : (
              meta.components.scorer === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
              || meta.components.scorer === ROLE_OBJECTIVE_SCORER_VERSION
              || meta.components.scorer === MORGANA_ROLE_SCORER_VERSION
            )
            ? GOOD_PROPOSAL_VOTE_SCORER_VERSION
            : meta.components.scorer
        return versions.scorer !== expectedScorer
          || versions.configuredScorer !== (
            expectedScorer === meta.components.scorer
              ? undefined
              : meta.components.scorer
          )
      })()
      || (
        declaresPlanMemory
          ? (
              !isCoherenceIntent(trace.coherenceIntent)
          || trace.coherenceIntent !== declaredCoherenceIntent
          || !decisionTraceReplayJoin(
                planSnapshots.get(trace.decisionId),
                trace,
              )
              || (
                trace.privatePlanOutcome === undefined
                  ? !trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
                  : (
                      !targetReplay
                      || !planOutcomeHostJoin(
                        artifact,
                        targetReplay,
                        trace,
                      )
                    )
              )
              || JSON.stringify(trace.privatePlanOutcome?.request)
                !== (
                  trace.privatePlanOutcome === undefined
                    ? undefined
                    : JSON.stringify(trace.request)
                )
              || JSON.stringify(trace.privatePlanOutcome?.appliedDecision)
                !== (
                  trace.privatePlanOutcome === undefined
                    ? undefined
                    : JSON.stringify(trace.action)
                )
            )
          : (
              trace.privatePlanOutcome !== undefined
              || versions.planMemory !== undefined
              || versions.coherence !== undefined
              || trace.coherenceIntent !== undefined
              || trace.degradation.includes(APPLIED_OUTCOME_DEGRADATION)
            )
      )
      || (
        roleUtilityApplicable
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // The retired flat C2 payload can no longer be present, so an
          // applicable decision must declare the degradation and nothing else.
          ? (
              versions.roleUtility !== undefined
              || !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
            )
          : (
              versions.roleUtility !== undefined
              || trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
            )
      )
      || (
        evilRoleUtilityApplicable
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          // With the retired flat D2 payload gone, the only remaining check is
          // that an atomic weighted dependency failure is declared coherently.
          ? (() => {
              const dependencyDegradation = [
                'identity-projection-failed',
                EVIL_ROLE_OBJECTIVE_DEGRADATION,
                EVIL_ROLE_UTILITY_DEGRADATION,
              ]
              const expectedBaseScorer =
                meta.components.scorer
                  === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
                  ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
                  : GOOD_PROPOSAL_VOTE_SCORER_VERSION
              return !(
                trace.quality === 'weighted'
                && trace.privateIdentity === undefined
                && versions.evilRoleUtility === undefined
                && versions.scorer === expectedBaseScorer
                && versions.configuredScorer === meta.components.scorer
                && trace.degradation.length
                  === dependencyDegradation.length
                && dependencyDegradation.every((code) =>
                  trace.degradation.includes(code))
              )
            })()
          : (
              versions.evilRoleUtility !== undefined
              || trace.degradation.includes(
                EVIL_ROLE_UTILITY_DEGRADATION,
              )
            )
      )
      || (
        declaresJointIdentity
          ? (
              trace.privateIdentity === undefined
                ? !trace.degradation.includes('identity-projection-failed')
                : (
                    trace.degradation.includes(
                      'identity-projection-failed',
                    )
                    || !validatePrivateIdentityHostJoin(
                      trace.privateIdentity,
                      artifact.roles,
                      trace.beliefPlayerMarginals,
                    )
                    || trace.privateIdentity.sourceBelief.modelVersion
                      !== trace.beliefModelVersion
                    || trace.privateIdentity.sourceBelief.throughSeq
                      !== trace.beliefThroughSeq
                    || trace.privateIdentity.sourceBelief.quality !== trace.quality
                    || (
                      evilRoleObjectiveApplicable
                      && (
                        !trace.privateIdentity.scope.hiddenTeam
                        || trace.privateIdentity.hiddenTeamPosterior
                          === undefined
                      )
                    )
                  )
            )
          : (
              trace.privateIdentity !== undefined
              || versions.identityModel !== undefined
            )
      )
      || (
        roleObjectiveApplicable
          // The retired flat C1 payload can no longer be present, so only the
          // absent-objective path survives.
          ? (
              !trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
              || (
                trace.privateIdentity === undefined
                  ? !trace.degradation.includes(
                      'identity-projection-failed',
                    )
                  : (() => {
                      const snapshot = targetSnapshots.get(
                        trace.decisionId,
                      )
                      if (!snapshot || !trace.publicObserver) return true
                      try {
                        buildRoleObjectiveSnapshot({
                          req: snapshot.req,
                          view: snapshot.view,
                          identity: trace.privateIdentity,
                          observer: trace.publicObserver,
                          candidates: legalCandidates(
                            snapshot.req,
                            snapshot.view,
                          ),
                        })
                        return true
                      } catch {
                        return false
                      }
                    })()
              )
            )
          : trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
      )
      || (
        evilRoleObjectiveApplicable
          // The retired flat D1 payload can no longer be present, so only the
          // absent-objective path survives.
          ? (() => {
              const snapshot = targetSnapshots.get(trace.decisionId)
              if (
                !trace.degradation.includes(
                  EVIL_ROLE_OBJECTIVE_DEGRADATION,
                )
                || !snapshot
                || !trace.publicObserver
              ) return true
              if (!trace.privateIdentity) {
                return !trace.degradation.includes(
                  'identity-projection-failed',
                )
              }
              try {
                buildEvilRoleObjectiveSnapshot({
                  req: snapshot.req,
                  view: snapshot.view,
                  identity: trace.privateIdentity,
                  observer: trace.publicObserver,
                  candidates: legalCandidates(snapshot.req, snapshot.view),
                })
                return true
              } catch {
                return false
              }
            })()
          : trace.degradation.includes(
              EVIL_ROLE_OBJECTIVE_DEGRADATION,
            )
      )
      || stableKeys.some(
        (key) =>
          versions[key as keyof typeof versions]
          !== meta.components[key],
      )
    ) {
      traceAttributionViolations++
    }
  }
  return {
    traces: Object.freeze(admittedTraces),
    safety: {
      hiddenInformationChecks,
      hiddenInformationViolations,
      traceAttributionChecks,
      traceAttributionViolations,
      ...(componentEvidenceApplicable
        ? {
            // This path has no current out-of-band architecture identity.
            // Canonical diagnostic fields cannot mint promotion evidence.
            promotionEvidenceEligible: false,
          }
        : {}),
    },
  }
}

function architectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: ArtifactArchitectureAdmission,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  return admission.provenance === 'descriptor-host-manifest-admitted'
    ? currentArchitectureSafety(artifact, meta, admission, traceCandidates)
    : legacyArchitectureSafety(
        artifact,
        meta,
        admission,
        traceCandidates,
      )
}

function observe(a: GameArtifact): GameObservation {
  const meta = a.architecture
  if (!meta) throw new Error(`artifact ${a.id} has no architecture metadata`)
  const architectureAdmission = artifactArchitectureAdmission(a)
  const traceCandidates = (a.decisionTraces ?? []).map((trace) =>
    snapshotDecisionTraceInput(trace))
  const player = a.players[meta.targetSeat]
  if (!player || player.role !== meta.targetRole) {
    throw new Error(`${a.id}: architecture target seat/role does not match the archived deal`)
  }
  const traceSafety = architectureSafety(
    a,
    meta,
    architectureAdmission,
    traceCandidates,
  )
  const decisionTraces = traceSafety.traces
  const metrics = computeMetrics(a)
  const seatMetrics = metrics.seats[meta.targetSeat]
  const decisions = new Map<string, number>()
  let cleanInitialProposals = 0
  let initialProposals = 0
  const voteConfusion = emptyVoteConfusion()
  for (const ev of a.log) {
    const p = ev.payload
    const seat = ev.type === 'proposal' || ev.type === 'proposalLocked' || ev.type === 'proposalRevised'
      ? p.leader
      : ev.type === 'assassination'
        ? p.assassin
        : p.seat
    const kind = actionKind(a, ev.type, seat)
    if (kind) increment(decisions, kind)
    if (ev.type === 'proposal' && p.leader === meta.targetSeat) {
      initialProposals++
      if (
        (p.team as number[]).every(
          (teamSeat) => a.players[teamSeat].alignment === 'good',
        )
      ) {
        cleanInitialProposals++
      }
    }
    if (ev.type === 'voteReveal') {
      const targetVote = (
        p.votes as Array<{ seat: number; vote: string }>
      ).find((vote) => vote.seat === meta.targetSeat)
      if (targetVote) {
        countVoteByDirection(
          voteConfusion,
          targetVote.vote,
          teamIsDirty(a.players, p.team as number[], a.id),
        )
      }
    }
  }

  let plannerOverrides = 0
  let plannerSelections = 0
  let seededVoteVariations = 0
  let scoredVotes = 0
  const proposalCleanProbabilities: number[] = []
  const proposalPosteriorRegrets: number[] = []
  const voteUtilityRegrets: number[] = []
  for (const trace of decisionTraces) {
    if (
      trace.plannerCandidateId
      && trace.plannerCandidateId === trace.chosenCandidateId
    ) {
      plannerSelections++
      if (trace.chosenCandidateId !== trace.structuredCandidateId) {
        plannerOverrides++
      }
    }
    const chosen = trace.candidateScores?.find(
      (score) => score.candidateId === trace.chosenCandidateId,
    )
    if (chosen?.features?.version === 'good-proposal-features-v1') {
      proposalCleanProbabilities.push(chosen.features.cleanProbability)
      const best = Math.max(
        ...trace.candidateScores!
          .filter(
            (score) =>
              score.viable
              && score.features?.version === 'good-proposal-features-v1',
          )
          .flatMap((score) =>
            score.features?.version === 'good-proposal-features-v1'
              ? [score.features.cleanProbability]
              : []),
      )
      proposalPosteriorRegrets.push(
        Math.max(0, best - chosen.features.cleanProbability),
      )
    }
    if (chosen?.features?.version === 'good-vote-features-v1') {
      scoredVotes++
      if (
        chosen.features.selectionMode === 'seeded-band'
        && chosen.features.inViableBand
        && chosen.features.seedBucket !== undefined
      ) {
        seededVoteVariations++
      }
      const best = Math.max(
        ...trace.candidateScores!
          .filter(
            (score) =>
              score.features?.version === 'good-vote-features-v1',
          )
          .flatMap((score) =>
            score.features?.version === 'good-vote-features-v1'
              ? [score.features.baseUtility]
              : []),
      )
      voteUtilityRegrets.push(
        Math.max(0, best - chosen.features.baseUtility),
      )
    }
  }
  const latencyMs = (
    a.telemetry?.decisionLatency?.samples ?? []
  ).map((sample) => sample.milliseconds).filter(
    (milliseconds) =>
      Number.isFinite(milliseconds) && milliseconds >= 0,
  )

  const calls = new Map<string, { calls: number; cost: number }>()
  const models = new Map<string, ArchitectureModelSummary>()
  let cost = 0
  let callCount = 0
  for (const [tag, spend] of Object.entries(a.telemetry?.llm?.tags ?? {})) {
    const kind = tag.slice(tag.lastIndexOf('/') + 1)
    const kindAgg = calls.get(kind) ?? { calls: 0, cost: 0 }
    kindAgg.calls += spend.calls
    kindAgg.cost += spend.cost
    calls.set(kind, kindAgg)
    const model = meta.components.model ?? spend.model
    const modelAgg = models.get(model) ?? {
      model, calls: 0, cost: 0, promptTokens: 0, completionTokens: 0,
      reasoningTokens: 0, reasoningLeaks: 0,
    }
    modelAgg.calls += spend.calls
    modelAgg.cost += spend.cost
    modelAgg.promptTokens += spend.prompt
    modelAgg.completionTokens += spend.completion
    modelAgg.reasoningTokens += spend.reasoning
    modelAgg.reasoningLeaks += spend.reasoningLeakCalls
    models.set(model, modelAgg)
    cost += spend.cost
    callCount += spend.calls
  }

  return {
    artifact: a,
    decisionTraces,
    meta,
    architectureAdmission,
    won: player.alignment === a.winner,
    voteScore: seatMetrics.voteScore,
    forced: seatMetrics.forcedPlayViolations,
    degraded: a.degraded.filter((d) => d.seat === meta.targetSeat).length,
    decisions,
    calls,
    models,
    cost,
    callCount,
    cleanInitialProposals,
    initialProposals,
    voteConfusion,
    plannerOverrides,
    plannerSelections,
    seededVoteVariations,
    scoredVotes,
    proposalCleanProbabilities,
    proposalPosteriorRegrets,
    voteUtilityRegrets,
    latencyMs,
    safety: traceSafety.safety,
  }
}

function latency(games: readonly GameObservation[]): LatencySummary {
  const values = games.flatMap((game) => game.latencyMs)
  // Ordered once for all three figures. Both estimators sort defensively, but
  // sorting an already-ordered array is a linear pass, and the maximum is then
  // just the last element rather than Math.max(...values) whose spread makes
  // every sample an argument and overflows the stack on a large enough corpus.
  const ordered = [...values].sort((left, right) => left - right)
  return {
    samples: ordered.length,
    medianMs: median(ordered),
    p95Ms: nearestRank(ordered, 0.95),
    maxMs: ordered.length ? ordered[ordered.length - 1] : null,
  }
}

function decisionQuality(
  games: readonly GameObservation[],
): ArchitectureDecisionQuality {
  const sum = (select: (game: GameObservation) => number) =>
    sumOf(games, select)
  // Not a sum: this folds per-game confusion counts into one record, so it
  // stays a reduce rather than becoming a sumOf.
  const votes = games.reduce(
    (counts, game) => addVoteConfusion(counts, game.voteConfusion),
    emptyVoteConfusion(),
  )
  const voteRate = (of: VoteConfusionRate): RateEstimate => {
    const { successes, trials } = voteRateCount(votes, of)
    return rate(successes, trials)
  }
  return {
    targetWinRate: rate(
      games.filter((game) => game.won).length,
      games.length,
    ),
    cleanInitialProposalRate: rate(
      sum((game) => game.cleanInitialProposals),
      sum((game) => game.initialProposals),
    ),
    voteTruthAccuracy: voteRate('truth'),
    voteDirtyTeamApproveRate: voteRate('dirty-team-approve'),
    voteCleanTeamRejectRate: voteRate('clean-team-reject'),
    plannerOverrideRate: rate(
      sum((game) => game.plannerOverrides),
      sum((game) => game.plannerSelections),
    ),
    seededVoteVariationRate: rate(
      sum((game) => game.seededVoteVariations),
      sum((game) => game.scoredVotes),
    ),
    voteApproveRate: voteRate('approve'),
    meanProposalCleanProbability: mean(
      games.flatMap((game) => game.proposalCleanProbabilities),
    ),
    meanProposalPosteriorRegret: mean(
      games.flatMap((game) => game.proposalPosteriorRegrets),
    ),
    meanVoteUtilityRegret: mean(
      games.flatMap((game) => game.voteUtilityRegrets),
    ),
  }
}

function safety(
  games: readonly GameObservation[],
): ArchitectureSafetySummary {
  const summary = games.reduce<ArchitectureSafetySummary>(
    (current, game) => ({
      hiddenInformationChecks:
        current.hiddenInformationChecks
        + game.safety.hiddenInformationChecks,
      hiddenInformationViolations:
        current.hiddenInformationViolations
        + game.safety.hiddenInformationViolations,
      traceAttributionChecks:
        current.traceAttributionChecks
        + game.safety.traceAttributionChecks,
      traceAttributionViolations:
        current.traceAttributionViolations
        + game.safety.traceAttributionViolations,
    }),
    {
      hiddenInformationChecks: 0,
      hiddenInformationViolations: 0,
      traceAttributionChecks: 0,
      traceAttributionViolations: 0,
    },
  )
  const eligibility = games.map(
    (game) => game.safety.promotionEvidenceEligible,
  )
  return eligibility.some((value) => value !== undefined)
    ? {
        ...summary,
        promotionEvidenceEligible: eligibility.every(
          (value) => value === true,
        ),
      }
    : summary
}

function componentEvidence(
  games: readonly GameObservation[],
): ArchitectureComponentEvidenceSummary {
  const admissions = games.map((game) => game.architectureAdmission)
  const current = admissions.every((admission) =>
    admission.provenance === 'descriptor-host-manifest-admitted')
  const legacy = admissions.every((admission) =>
    admission.provenance === 'legacy-host-manifest-admitted')
  const hasComposedClaim = games.some((game) =>
    isComposedComponents(game.meta.components)
    || hasComponentManifestClaim(game.architectureAdmission)
    || game.decisionTraces.some((trace) =>
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || trace.componentPlan !== undefined
      || trace.components !== undefined
      || isComposedTrace(trace)))
  const traces = games.flatMap((game) =>
    game.decisionTraces.filter(
      (trace) => trace.viewerSeat === game.meta.targetSeat,
    ))
  const entries = traces.flatMap((trace) =>
    trace.components?.entries ?? [])
  const policyUses = traces.flatMap((trace) =>
    trace.components?.policyUse ?? [])
  return {
    trust: current
      ? 'descriptor-host-manifest-admitted'
      : legacy
        ? 'legacy-host-manifest-admitted'
      : hasComposedClaim
        ? 'unverified-composed'
        : 'not-applicable',
    promotionEvidenceEligible: games.every(
      (game) => game.safety.promotionEvidenceEligible === true,
    ),
    decisions: traces.filter((trace) => trace.components !== undefined).length,
    configured: (
      admissions[0].provenance === 'descriptor-host-manifest-admitted'
      || admissions[0].provenance === 'legacy-host-manifest-admitted'
    ) ? admissions[0].plan.configured.length : 0,
    admitted: entries.filter((entry) => entry.status === 'admitted').length,
    inapplicable: entries.filter(
      (entry) => entry.status === 'inapplicable',
    ).length,
    suppressed: entries.filter((entry) => entry.status === 'suppressed').length,
    degraded: entries.filter((entry) => entry.status === 'degraded').length,
    exact: entries.filter(
      (entry) => entry.status === 'admitted' && entry.verification === 'exact',
    ).length,
    structural: entries.filter(
      (entry) =>
        entry.status === 'admitted' && entry.verification === 'structural',
    ).length,
    promotable: entries.filter(
      (entry) => entry.status === 'admitted' && entry.promotionEligible,
    ).length,
    policyUses: policyUses.filter((use) => use.used).length,
    policyStages: policyUses.reduce(
      (total, use) => total + use.stages.length,
      0,
    ),
  }
}

function observationPromotionEvidenceEligible(
  game: GameObservation,
): boolean {
  if (
    game.safety.hiddenInformationViolations !== 0
    || game.safety.traceAttributionViolations !== 0
  ) {
    return false
  }
  if (isComposedComponents(game.meta.components)) {
    return game.safety.promotionEvidenceEligible === true
  }
  if (isNonComposedPolicy(game.meta.components.policy)) {
    return game.safety.promotionEvidenceEligible !== false
  }
  return false
}

function summarizeVariant(id: string, games: GameObservation[]): ArchitectureVariantSummary {
  const architectureAdmissions = games.map(
    (game) => game.architectureAdmission,
  )
  const reportComponents = architectureAdmissions.map(
    (admission, index) =>
      admission.provenance === 'descriptor-host-manifest-admitted'
        ? architectureIdentityVersions(admission.identity)
        : games[index].meta.components,
  )
  const componentKeys = architectureAdmissions.map(
    (admission, index) =>
      admission.provenance === 'descriptor-host-manifest-admitted'
        ? `identity:${resolvedArchitectureIdentityDigest(
            admission.identity,
          )}`
        : `legacy:${JSON.stringify(reportComponents[index])}`,
  )
  if (new Set(componentKeys).size !== 1) {
    throw new Error(`variant ${id} has inconsistent component versions`)
  }
  const decisionComponentPlans = architectureAdmissions.map(
    (admission) => JSON.stringify(
      admission.provenance === 'descriptor-host-manifest-admitted'
        || admission.provenance === 'legacy-host-manifest-admitted'
        ? admission.plan
        : undefined,
    ))
  if (new Set(decisionComponentPlans).size !== 1) {
    throw new Error(
      `variant ${id} has inconsistent decision component manifests`,
    )
  }
  const firstAdmission = architectureAdmissions[0]
  const decisionComponentPlan =
    firstAdmission.provenance === 'descriptor-host-manifest-admitted'
    || firstAdmission.provenance === 'legacy-host-manifest-admitted'
      ? firstAdmission.plan
      : undefined
  const hasComponentEvidence = games.some((game) =>
    isComposedComponents(game.meta.components)
    || hasComponentManifestClaim(game.architectureAdmission)
    || game.decisionTraces.some((trace) =>
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || trace.componentPlan !== undefined
      || trace.components !== undefined
      || isComposedTrace(trace)))
  const roles = [...new Set(games.map((g) => g.meta.targetRole))].sort()
  const kinds = [...new Set(games.flatMap((g) => [
    ...g.decisions.keys(),
    ...g.calls.keys(),
    ...g.artifact.degraded
      .filter((d) => d.seat === g.meta.targetSeat)
      .map((d) => d.kind),
  ]))].sort()
  const modelIds = [...new Set(games.flatMap((g) => [...g.models.keys()]))].sort()

  return {
    id,
    components: { ...reportComponents[0] },
    ...(decisionComponentPlan
      ? {
          decisionComponents: decisionComponentPlan.configured.map(
            (component) => `${component.id}@${component.version}`,
          ),
        }
      : {}),
    ...(hasComponentEvidence
      ? { componentEvidence: componentEvidence(games) }
      : {}),
    games: games.length,
    wins: games.filter((g) => g.won).length,
    forcedViolations: sumOf(games, (g) => g.forced),
    degraded: sumOf(games, (g) => g.degraded),
    calls: sumOf(games, (g) => g.callCount),
    cost: sumOf(games, (g) => g.cost),
    decisionQuality: decisionQuality(games),
    latency: latency(games),
    safety: safety(games),
    byRole: roles.map((role) => {
      const selected = games.filter((g) => g.meta.targetRole === role)
      return {
        role,
        games: selected.length,
        wins: selected.filter((g) => g.won).length,
        voteScore: mean(selected.map((g) => g.voteScore).filter((v): v is number => v !== null)),
        forcedViolations: sumOf(selected, (g) => g.forced),
        degraded: sumOf(selected, (g) => g.degraded),
        calls: sumOf(selected, (g) => g.callCount),
        cost: sumOf(selected, (g) => g.cost),
        decisionQuality: decisionQuality(selected),
        latency: latency(selected),
        safety: safety(selected),
      }
    }),
    byKind: kinds.map((kind) => ({
      kind,
      decisions: sumOf(games, (g) => (g.decisions.get(kind) ?? 0)),
      calls: sumOf(games, (g) => (g.calls.get(kind)?.calls ?? 0)),
      degraded: games.reduce(
        (sum, g) => sum + g.artifact.degraded.filter(
          (d) => d.seat === g.meta.targetSeat && d.kind === kind,
        ).length,
        0,
      ),
      cost: sumOf(games, (g) => (g.calls.get(kind)?.cost ?? 0)),
    })),
    byModel: modelIds.map((model) => {
      const entries = games.map((g) => g.models.get(model)).filter((v): v is ArchitectureModelSummary => !!v)
      return {
        model,
        calls: sumOf(entries, (entry) => entry.calls),
        cost: sumOf(entries, (entry) => entry.cost),
        promptTokens: sumOf(entries, (entry) => entry.promptTokens),
        completionTokens: sumOf(entries, (entry) => entry.completionTokens),
        reasoningTokens: sumOf(entries, (entry) => entry.reasoningTokens),
        reasoningLeaks: sumOf(entries, (entry) => entry.reasoningLeaks),
      }
    }),
  }
}

/**
 * The minimum an observation must expose to be checked for matching. Any
 * paired-variant report can satisfy this, so the law below has one definition
 * rather than one per report.
 */
export interface MatchedVariantInput {
  artifact: Pick<GameArtifact, 'seed' | 'playerCount' | 'roles' | 'talk' | 'players'>
  meta: Pick<ArchitectureRunMetadata, 'caseId' | 'targetRole' | 'targetSeat'>
}

const matchedFacets = (game: MatchedVariantInput) => ({
  caseId: game.meta.caseId,
  seed: game.artifact.seed,
  playerCount: game.artifact.playerCount,
  roles: game.artifact.roles,
  talk: game.artifact.talk,
  deal: game.artifact.players.map((p) => p.role),
  targetRole: game.meta.targetRole,
  targetSeat: game.meta.targetSeat,
  names: game.artifact.players.map((p) => p.name),
  opponents: game.artifact.players.map(
    (p) => p.seat === game.meta.targetSeat ? '<variant>' : p.agent,
  ),
})

/**
 * A paired delta is only meaningful when the two games differ solely at the
 * target seat. Comparing the configured role list is not enough: the dealt
 * seat-to-role assignment, the seat names the prompts render, and the agent at
 * every other seat all change play, so every one of them is compared here.
 * The case identity is compared too. Both current callers look the baseline up
 * by the candidate's case, which makes it redundant there, but this is the
 * exported law and a caller that pairs some other way must not lose the check.
 */
export function assertMatchedVariants(
  a: MatchedVariantInput,
  b: MatchedVariantInput,
): void {
  if (JSON.stringify(matchedFacets(a)) !== JSON.stringify(matchedFacets(b))) {
    throw new Error(`${a.meta.caseId}: variants are not matched on deal and table configuration`)
  }
}

export function architectureReport(artifacts: readonly GameArtifact[]): ArchitectureBenchmarkReport {
  if (!artifacts.length) throw new Error('architecture report requires at least one artifact')
  const games = artifacts.map(observe)
  const banks = new Set(games.map((g) => g.meta.bank))
  if (banks.size !== 1) throw new Error('architecture report cannot mix seed banks')
  const cells = new Set<string>()
  for (const game of games) {
    const cell = `${game.meta.variant}\0${game.meta.caseId}`
    if (cells.has(cell)) {
      throw new Error(
        `duplicate architecture result for variant ${game.meta.variant}, case ${game.meta.caseId}`,
      )
    }
    cells.add(cell)
  }
  const caseIds = [...new Set(games.map((g) => g.meta.caseId))].sort()
  // Preserve artifact order: the runner writes the declared baseline first.
  // Alphabetical sorting can silently turn "candidate" into the baseline.
  const variantIds = [...new Set(games.map((g) => g.meta.variant))]
  const byVariant = new Map(
    variantIds.map((id) => [id, games.filter((game) => game.meta.variant === id)]),
  )
  const variants = variantIds.map((id) => summarizeVariant(id, byVariant.get(id)!))

  const comparisons: ArchitectureComparison[] = []
  if (variantIds.length > 1) {
    const baseline = variantIds[0]
    const baselineByCase = new Map(byVariant.get(baseline)!.map((g) => [g.meta.caseId, g]))
    for (const candidate of variantIds.slice(1)) {
      const pairs = byVariant.get(candidate)!.flatMap((candidateGame) => {
        const baselineGame = baselineByCase.get(candidateGame.meta.caseId)
        if (!baselineGame) return []
        assertMatchedVariants(baselineGame, candidateGame)
        return [{
          baseline: baselineGame,
          candidate: candidateGame,
        }]
      })
      const deltas = pairs.map(({ baseline: base, candidate: next }) => ({
        wins: Number(next.won) - Number(base.won),
        forced: next.forced - base.forced,
        degraded: next.degraded - base.degraded,
        cost: next.cost - base.cost,
      }))
      comparisons.push({
        baseline,
        candidate,
        matchedCases: deltas.length,
        wins: sumOf(deltas, (delta) => delta.wins),
        forcedViolations: sumOf(deltas, (delta) => delta.forced),
        degraded: sumOf(deltas, (delta) => delta.degraded),
        cost: sumOf(deltas, (delta) => delta.cost),
        promotionEvidenceEligible: pairs.every(
          ({ baseline: base, candidate: next }) =>
            observationPromotionEvidenceEligible(base)
            && observationPromotionEvidenceEligible(next),
        ),
        targetWinRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: Number(game.won),
            trials: 1,
          }),
          seededRandom(
            `${games[0].meta.bank}:${baseline}:${candidate}:wins`,
          ),
        ),
        cleanInitialProposalRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.cleanInitialProposals,
            trials: game.initialProposals,
          }),
          seededRandom(
            `${games[0].meta.bank}:${baseline}:${candidate}:proposals`,
          ),
        ),
        voteTruthAccuracyDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'truth'),
          seededRandom(
            `${games[0].meta.bank}:${baseline}:${candidate}:votes`,
          ),
        ),
        voteDirtyTeamApproveRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'dirty-team-approve'),
          seededRandom(
            `${games[0].meta.bank}:${baseline}:${candidate}:dirty-team-approve`,
          ),
        ),
        voteCleanTeamRejectRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => voteRateCount(game.voteConfusion, 'clean-team-reject'),
          seededRandom(
            `${games[0].meta.bank}:${baseline}:${candidate}:clean-team-reject`,
          ),
        ),
      })
    }
  }

  return {
    schema: ARCHITECTURE_REPORT_SCHEMA,
    bank: games[0].meta.bank,
    cases: caseIds,
    variants,
    comparisons,
  }
}

export function renderArchitectureReport(report: ArchitectureBenchmarkReport): string {
  const lines = [
    `ARCHITECTURE ${report.bank}  ${report.cases.length} cases`,
  ]
  for (const variant of report.variants) {
    lines.push(
      `${variant.id}: ${variant.wins}/${variant.games} target-side wins, `
      + `${variant.forcedViolations} forced, ${variant.degraded} degraded, `
      + `${variant.calls} calls, $${fixed(variant.cost)}`,
    )
    lines.push(`  components ${Object.entries(variant.components).map(([k, v]) => `${k}=${v}`).join(' ')}`)
    if (variant.decisionComponents) {
      lines.push(
        `  decision-components ${
          variant.decisionComponents.length
            ? variant.decisionComponents.join(' ')
            : '(empty)'
        }`,
      )
    }
    if (variant.componentEvidence) {
      lines.push(
        `  component-evidence ${variant.componentEvidence.trust}, `
        + `${variant.componentEvidence.promotionEvidenceEligible
          ? 'promotion-eligible'
          : 'promotion-ineligible'}, `
        + `${variant.componentEvidence.decisions} decisions, `
        + `${variant.componentEvidence.admitted} admitted `
        + `(${variant.componentEvidence.exact} exact, `
        + `${variant.componentEvidence.structural} structural), `
        + `${variant.componentEvidence.degraded} degraded, `
        + `${variant.componentEvidence.policyUses} causal uses/`
        + `${variant.componentEvidence.policyStages} stages`,
      )
    }
    lines.push(`  roles ${variant.byRole.map((r) =>
      `${r.role}:${r.wins}/${r.games},d${r.degraded},$${fixed(r.cost)}`).join(' ')}`)
    lines.push(
      `  quality win ${renderRate(variant.decisionQuality.targetWinRate)}; `
      + `clean-proposal ${renderRate(
        variant.decisionQuality.cleanInitialProposalRate,
      )}; vote-truth ${renderRate(
        variant.decisionQuality.voteTruthAccuracy,
      )}`,
    )
    lines.push(
      // NB-013: the symmetric accuracy above averages these two, and their game
      // value is not equal. A promotion gate reads dirty-approve, not vote-truth.
      `  vote-errors dirty-approve ${renderRate(
        variant.decisionQuality.voteDirtyTeamApproveRate,
      )}; clean-reject ${renderRate(
        variant.decisionQuality.voteCleanTeamRejectRate,
      )}`,
    )
    lines.push(
      `  variation planner-override ${renderRate(
        variant.decisionQuality.plannerOverrideRate,
      )}; seeded-vote ${renderRate(
        variant.decisionQuality.seededVoteVariationRate,
      )}; approve ${renderRate(variant.decisionQuality.voteApproveRate)}`,
    )
    lines.push(
      `  values proposal-clean ${
        variant.decisionQuality.meanProposalCleanProbability?.toFixed(4)
        ?? 'n/a'
      } proposal-regret ${
        variant.decisionQuality.meanProposalPosteriorRegret?.toFixed(4)
        ?? 'n/a'
      } vote-regret ${
        variant.decisionQuality.meanVoteUtilityRegret?.toFixed(4)
        ?? 'n/a'
      }`,
    )
    lines.push(
      `  latency ${variant.latency.samples} samples, median `
      + `${renderMilliseconds(variant.latency.medianMs)}, p95 `
      + `${renderMilliseconds(variant.latency.p95Ms)}, max `
      + renderMilliseconds(variant.latency.maxMs),
    )
    lines.push(
      `  safety hidden ${variant.safety.hiddenInformationViolations}/`
      + `${variant.safety.hiddenInformationChecks}, attribution `
      + `${variant.safety.traceAttributionViolations}/`
      + variant.safety.traceAttributionChecks
      + (
        variant.safety.promotionEvidenceEligible === undefined
          ? ''
          : `, component-evidence ${
              variant.safety.promotionEvidenceEligible
                ? 'promotion-eligible'
                : 'promotion-ineligible'
            }`
      ),
    )
    lines.push(`  kinds ${variant.byKind.map((k) =>
      `${k.kind}:${k.decisions}d/${k.calls}c/${k.degraded}x/$${fixed(k.cost)}`).join(' ')}`)
    if (variant.byModel.length) {
      lines.push(`  models ${variant.byModel.map((m) =>
        `${m.model}:${m.calls}c/$${fixed(m.cost)}`).join(' ')}`)
    }
  }
  for (const comparison of report.comparisons) {
    lines.push(
      `DELTA ${comparison.candidate} - ${comparison.baseline} (${comparison.matchedCases} matched): `
      + `wins ${comparison.wins >= 0 ? '+' : ''}${comparison.wins}, `
      + `forced ${comparison.forcedViolations >= 0 ? '+' : ''}${comparison.forcedViolations}, `
      + `degraded ${comparison.degraded >= 0 ? '+' : ''}${comparison.degraded}, `
      + `cost ${comparison.cost >= 0 ? '+' : ''}$${fixed(comparison.cost)}`,
    )
    lines.push(
      `  promotion-evidence ${
        comparison.promotionEvidenceEligible ? 'eligible' : 'ineligible'
      }`,
    )
    lines.push(
      `  rate deltas win ${renderDelta(comparison.targetWinRateDelta)}; `
      + `clean-proposal ${renderDelta(
        comparison.cleanInitialProposalRateDelta,
      )}; vote-truth ${renderDelta(
        comparison.voteTruthAccuracyDelta,
      )}`,
    )
    lines.push(
      `  vote-error deltas dirty-approve ${renderDelta(
        comparison.voteDirtyTeamApproveRateDelta,
      )}; clean-reject ${renderDelta(
        comparison.voteCleanTeamRejectRateDelta,
      )}`,
    )
  }
  return lines.join('\n')
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  })
  if (!positionals.length) {
    console.error('usage: node server/eval/architecture-report.ts <artifacts.jsonl> [...more] [--json] [--out file]')
    process.exit(1)
  }
  const report = architectureReport(positionals.flatMap((file) => readArtifacts(file)))
  const rendered = values.json
    ? `${JSON.stringify(report, null, 2)}\n`
    : `${renderArchitectureReport(report)}\n`
  if (values.out) fs.writeFileSync(values.out, rendered)
  else process.stdout.write(rendered)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
