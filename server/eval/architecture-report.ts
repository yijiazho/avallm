// Compact, machine-readable architecture comparison report.
//
// The report is intentionally narrower than report.ts: it summarizes only the
// role seat selected by each architecture-bank case and groups operational
// results by role, decision/call kind, model, and component-version bundle.

import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { isDeepStrictEqual } from 'node:util'
import { isProxy } from 'node:util/types'
import { pathToFileURL } from 'node:url'
import {
  MAX_ARTIFACT_DECISION_COMPONENT_MANIFEST_JSON_BYTES,
  readArtifacts,
} from './artifact.ts'
import { computeMetrics } from './metrics.ts'
import type { ArchitectureRunMetadata, GameArtifact } from './artifact.ts'
import type { DecisionKind, Role } from '../engine/types.ts'
import { LANGUAGE_FACTOR_BUNDLE_VERSION } from '../agents/belief/language-factor.ts'
import {
  validatePublicObserverSnapshot,
} from '../agents/analysis/observer.ts'
import {
  APPLIED_OUTCOME_DEGRADATION,
  COMPONENT_DECISION_TRACE_VERSION,
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
import { COHERENCE_MODEL_VERSION } from '../agents/cognition/coherence.ts'
import {
  ROLE_OBJECTIVE_DEGRADATION,
  ROLE_OBJECTIVE_MODEL_VERSION,
} from '../agents/analysis/role-objective-types.ts'
import {
  buildRoleObjectiveSnapshot,
  validatePrivateRoleObjectiveHostJoin,
} from '../agents/analysis/role-objectives.ts'
import {
  buildEvilRoleObjectiveSnapshot,
  validatePrivateEvilRoleObjectiveHostJoin,
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
  buildRoleUtilityProjection,
  validatePrivateRoleUtilityHostJoin,
} from '../agents/analysis/role-utility.ts'
import {
  EVIL_ROLE_UTILITY_DEGRADATION,
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
  buildEvilRoleUtilityProjection,
  validatePrivateEvilRoleUtilityHostJoin,
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
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../agents/policy/candidates.ts'
import type { DecisionSnapshot } from './replay.ts'
import {
  authoritativeDecisionReplay,
  decisionTraceReplayJoin,
  exactTargetTraceCoverage,
  selectedDecisionReplayJoin,
  type AuthoritativeDecisionReplay,
} from './trace-replay.ts'
import {
  validateComposedTraceHostJoin,
  validateSuppressedEvilQuestCardPolicyHostJoin,
} from '../agents/admission/composed-trace.ts'
import {
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../agents/policy/evil-quest-card.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
} from '../agents/analysis/morgana-counterfeit-types.ts'
import { EXACT_BELIEF_MODEL_VERSION } from '../agents/belief/types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../agents/analysis/morgana-role-utility.ts'
import {
  architectureIdentityDecisionPlan,
  architectureIdentityVersions,
  resolvedArchitectureIdentityTraceJoin,
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

export const ARCHITECTURE_REPORT_SCHEMA = 2

export interface RateEstimate {
  successes: number
  trials: number
  rate: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface RateDeltaEstimate {
  delta: number | null
  interval95: Readonly<{ low: number; high: number }> | null
}

export interface LatencySummary {
  samples: number
  medianMs: number | null
  p95Ms: number | null
  maxMs: number | null
}

export interface ArchitectureDecisionQuality {
  targetWinRate: RateEstimate
  cleanInitialProposalRate: RateEstimate
  voteTruthAccuracy: RateEstimate
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
  voteTruthAccuracyDelta: RateDeltaEstimate
}

export interface ArchitectureBenchmarkReport {
  schema: number
  bank: string
  cases: string[]
  variants: ArchitectureVariantSummary[]
  comparisons: ArchitectureComparison[]
}

function isComposedArchitectureMode(value: unknown): boolean {
  return (
    value === 'compatibility'
    || value === 'structured-only'
    || value === 'hybrid'
  )
}

interface GameObservation {
  artifact: GameArtifact
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
  correctVotes: number
  votes: number
  plannerOverrides: number
  plannerSelections: number
  seededVoteVariations: number
  scoredVotes: number
  approveVotes: number
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

function publicSpeech(trace: NonNullable<GameArtifact['decisionTraces']>[number]): string {
  const action = trace.action
  if (action.kind === 'discuss') return action.say ?? ''
  if (action.kind === 'propose') return action.pitch ?? ''
  if (action.kind === 'finalize') {
    return action.stick === false ? action.reason ?? '' : ''
  }
  return ''
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
  const plan = outcome.selected?.plan
  const selectedPlanMatches = outcome.selected === undefined
    ? plan === undefined
    : (
        !!plan
        && plan.version === trace.decisionPlanVersion
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
      mode: 'raw-llm' | 'heuristic' | 'random' | 'external'
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
      && (
        artifact.architecture?.components.mode === 'raw-llm'
        || artifact.architecture?.components.mode === 'heuristic'
        || artifact.architecture?.components.mode === 'random'
        || artifact.architecture?.components.mode === 'external'
      )
    ) {
      return {
        provenance: 'non-composed-host-metadata-admitted',
        mode: artifact.architecture.components.mode,
      }
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
  /decisionTrace|decisionComponents|decision-component-run|componentPlan|policyUse|componentEvidence|hostInput|candidateScores|roleObjectiveFeatures|evilRoleObjectiveFeatures|morganaRoleObjectiveFeatures|topHypotheses|communicationIntent|beliefProvenance|beliefPlayerMarginals|beliefTeamAssessments|publicObserver|privateIdentity|identityModel|privateRoleObjective|privateEvilRoleObjective|evilRoleObjective|roleObjectiveRouter|roleObjective|privateRoleUtility|roleUtility|privateEvilRoleUtility|evilRoleUtility|privateMorganaRoleUtility|morganaRoleUtility|privateEvilQuestCardPolicy|evilQuestCardPolicy|configuredEvilQuestCardPolicy|publicMorganaCounterfeitRead|privateMorganaCounterfeitObjective|morganaCounterfeit|orderedVisibleEvilAboard|visibleEvilAboardCount|sourceFingerprint|configuredScorer|privatePlanOutcome|planMemory|coherence|coherenceIntent/

function currentArchitectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: Extract<
    ArtifactArchitectureAdmission,
    { provenance: 'descriptor-host-manifest-admitted' }
  >,
): ArchitectureSafetySummary {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = PRIVATE_ARCHITECTURE_TELEMETRY.test(
    JSON.stringify(
      artifact.log.filter((event) => event.visibility === 'public'),
    ),
  ) ? 1 : 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const traces = artifact.decisionTraces ?? []
  let replay: AuthoritativeDecisionReplay | undefined
  try {
    replay = authoritativeDecisionReplay(
      artifact,
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
  for (const trace of traces) {
    traceAttributionChecks++
    const snapshot = replay?.snapshots.get(trace.decisionId)
    const selectedDecision =
      trace.privatePlanOutcome?.selected?.decision
      ?? snapshot?.original
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
      || !snapshot
      || !selectedDecision
      || !planAttributionValid
      || !resolvedArchitectureIdentityTraceJoin(
        admission.identity,
        trace,
      )
      || !validateComposedTraceHostJoin({
        trace,
        req: snapshot.req,
        view: snapshot.view,
        authoritativeAction: snapshot.original,
        selectedDecision,
        deterministicSeed: artifact.seed,
        expectComponentTrace: true,
        expectedComponentPlan: admission.plan,
        expectedArchitectureIdentity: admission.identity,
      })
    ) {
      traceAttributionViolations++
    }
    const speech = publicSpeech(trace)
    if (!speech) continue
    hiddenInformationChecks++
    const intent = trace.communicationIntent
    const numericSecrets = [
      ...(intent?.uncertainty
        ? Object.values(intent.uncertainty)
            .filter(
              (value): value is number =>
                typeof value === 'number'
                && Number.isFinite(value)
                && !Number.isInteger(value),
            )
            .map(String)
        : []),
      ...((trace.beliefPlayerMarginals ?? [])
        .flatMap((marginal) => [
          marginal.goodProbability,
          marginal.evilProbability,
        ])
        .filter((value) => !Number.isInteger(value))
        .map(String)),
    ]
    const forbidden = [
      trace.beliefModelVersion,
      'role-composite-decision',
      ...trace.topHypotheses.map((hypothesis) => hypothesis.worldKey),
      ...(intent?.conceal ?? []),
      ...numericSecrets,
    ].filter((value) => value.length > 0)
    if (forbidden.some((value) => speech.includes(value))) {
      hiddenInformationViolations++
    }
  }
  const genericEvidence = traces.length > 0 && traces.every((trace) =>
    trace.components !== undefined)
  return {
    hiddenInformationChecks,
    hiddenInformationViolations,
    traceAttributionChecks,
    traceAttributionViolations,
    promotionEvidenceEligible: (
      genericEvidence
      && traces.every((trace) =>
        trace.components?.entries.every((entry) =>
          entry.status !== 'degraded'
          && (
            entry.status !== 'admitted'
            || entry.promotionEligible
          )) === true)
      && hiddenInformationViolations === 0
      && traceAttributionViolations === 0
    ),
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
): ArchitectureSafetySummary {
  let hiddenInformationChecks = 1
  let hiddenInformationViolations = 0
  let traceAttributionChecks = 0
  let traceAttributionViolations = 0
  const publicLog = JSON.stringify(
    artifact.log.filter((event) => event.visibility === 'public'),
  )
  if (PRIVATE_ARCHITECTURE_TELEMETRY.test(publicLog)) {
    hiddenInformationViolations++
  }
  const traces = artifact.decisionTraces ?? []
  const componentManifestClaim = hasComponentManifestClaim(
    architectureAdmission,
  )
  const hostRequiresComponentEvidence = isComposedArchitectureMode(
    meta.components.mode,
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
    declaredEvilQuestCardPolicy === EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
    || declaredEvilQuestCardPolicy === EVIL_QUEST_ROBUST_POLICY_VERSION
  const invalidEvilQuestCardPolicyDeclaration =
    declaredEvilQuestCardPolicy === undefined
      ? meta.components.populationAssumption !== undefined
      : declaredEvilQuestCardPolicy
          === EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION
        ? true
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
      || !['compatibility', 'structured-only', 'hybrid'].includes(
        meta.components.mode,
      )
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
    && ['maintain', 'conceal', 'deceive'].includes(
      String(declaredCoherenceIntent),
    )
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
      isComposedArchitectureMode(trace.agentMode))
  )
  let targetReplay: AuthoritativeDecisionReplay | undefined
  let targetSnapshots: ReadonlyMap<string, DecisionSnapshot> = new Map()
  let invalidTraceCoverage = false
  if (coverageRequired) {
    try {
      targetReplay = authoritativeDecisionReplay(
        artifact,
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
  for (const trace of traces) {
    traceAttributionChecks++
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
    const hostSnapshot = targetSnapshots.get(trace.decisionId)
    const selectedDecision =
      trace.privatePlanOutcome?.selected?.decision
      ?? hostSnapshot?.original
    const strictComposedTrace = (
      trace.agentMode === 'compatibility'
      || trace.agentMode === 'structured-only'
      || trace.agentMode === 'hybrid'
    )
    if (
      trace.viewerSeat !== meta.targetSeat
      || trace.agentMode !== meta.components.mode
      || !versions
      || !hostSnapshot
      || !selectedDecision
      || (
        strictComposedTrace
        && !validateComposedTraceHostJoin({
          trace,
          req: hostSnapshot.req,
          view: hostSnapshot.view,
          authoritativeAction: hostSnapshot.original,
          selectedDecision,
          deterministicSeed: artifact.seed,
          ...(expectedComponentPlan
            ? {
                expectComponentTrace: true,
                expectedComponentPlan,
              }
            : {}),
        })
      )
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
        trace.request.kind === 'quest'
        && !['merlin', 'percival', 'servant', 'oberon']
          .includes(meta.targetRole)
          ? (
              declaresEvilQuestCardPolicy
                ? !(
                    (
                      versions.evilQuestCardPolicy
                        === declaredEvilQuestCardPolicy
                      && trace.privateEvilQuestCardPolicy?.policyVersion
                        === declaredEvilQuestCardPolicy
                    )
                    || (
                      versions.evilQuestCardPolicy === undefined
                      && trace.privateEvilQuestCardPolicy === undefined
                      && hostSnapshot !== undefined
                      && validateSuppressedEvilQuestCardPolicyHostJoin(
                        trace,
                        hostSnapshot.req,
                        hostSnapshot.view,
                      )
                    )
                  )
                : (
                    versions.evilQuestCardPolicy !== undefined
                    || trace.privateEvilQuestCardPolicy !== undefined
                  )
            )
          : (
              versions.evilQuestCardPolicy !== undefined
              || trace.privateEvilQuestCardPolicy !== undefined
            )
      )
      || versions.configuredEvilQuestCardPolicy
        !== declaredEvilQuestCardPolicy
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
          ? (
              trace.privateMorganaRoleUtility === undefined
              || versions.morganaRoleUtility
                !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
              || trace.degradation.includes(
                MORGANA_ROLE_UTILITY_DEGRADATION,
              )
            )
          : (
              trace.privateMorganaRoleUtility !== undefined
              || versions.morganaRoleUtility !== undefined
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
        const applicable =
          roleUtilityApplicable
          && (
            trace.request.kind === 'propose'
            || trace.request.kind === 'vote'
          )
        const applied =
          applicable
          && trace.privateRoleUtility !== undefined
          && !trace.degradation.includes('role-objective-scorer-failed')
        const evilApplicable =
          evilRoleUtilityApplicable
          && (
            trace.request.kind === 'propose'
            || trace.request.kind === 'vote'
          )
        const evilApplied =
          evilApplicable
          && trace.privateEvilRoleUtility !== undefined
          && !trace.degradation.includes(
            'evil-role-objective-scorer-failed',
          )
        const morganaApplied =
          declaresMorganaRoleUtility
          && meta.targetRole === 'morgana'
          && (
            trace.request.kind === 'propose'
            || trace.request.kind === 'vote'
          )
          && trace.privateMorganaRoleUtility !== undefined
          && !trace.degradation.includes(
            MORGANA_ROLE_UTILITY_DEGRADATION,
          )
          && !trace.degradation.includes(
            'morgana-role-objective-scorer-failed',
          )
        const seeded =
          meta.components.scorer
            === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
          || meta.components.scorer
            === MORGANA_ROLE_SEEDED_SCORER_VERSION
        const expectedScorer = morganaApplied
          ? meta.components.scorer
          : evilApplied
            ? meta.components.scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
              ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
              : meta.components.scorer === MORGANA_ROLE_SCORER_VERSION
                ? EVIL_ROLE_OBJECTIVE_SCORER_VERSION
                : meta.components.scorer
          : applied
            ? meta.components.scorer
                === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
              || meta.components.scorer
                === MORGANA_ROLE_SEEDED_SCORER_VERSION
              ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
              : meta.components.scorer
                  === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
                || meta.components.scorer === MORGANA_ROLE_SCORER_VERSION
                ? ROLE_OBJECTIVE_SCORER_VERSION
                : meta.components.scorer
            : seeded
              ? GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
              : (
                  meta.components.scorer
                    === EVIL_ROLE_OBJECTIVE_SCORER_VERSION
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
              !['maintain', 'conceal', 'deceive'].includes(
                String(trace.coherenceIntent),
              )
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
          ? (() => {
              const snapshot = targetSnapshots.get(trace.decisionId)
              if (trace.privateRoleUtility === undefined) {
                if (
                  versions.roleUtility !== undefined
                  || !trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
                ) return true
                if (
                  snapshot
                  && trace.privateRoleObjective
                  && trace.publicObserver
                ) {
                  try {
                    buildRoleUtilityProjection({
                      req: snapshot.req,
                      view: snapshot.view,
                      objective: trace.privateRoleObjective,
                      observer: trace.publicObserver,
                      candidates: legalCandidates(snapshot.req, snapshot.view),
                    })
                    return true
                  } catch {
                    return false
                  }
                }
                return false
              }
              return (
                versions.roleUtility !== ROLE_UTILITY_PROJECTION_VERSION
                || !snapshot
                || !trace.privateRoleObjective
                || !trace.privateIdentity
                || !trace.publicObserver
                || !validatePrivateRoleUtilityHostJoin(
                  trace.privateRoleUtility,
                  {
                    req: snapshot.req,
                    view: snapshot.view,
                    objective: trace.privateRoleObjective,
                    identity: trace.privateIdentity,
                    observer: trace.publicObserver,
                    candidates: legalCandidates(snapshot.req, snapshot.view),
                  },
                )
              )
            })()
          : (
              trace.privateRoleUtility !== undefined
              || versions.roleUtility !== undefined
              || trace.degradation.includes(ROLE_UTILITY_DEGRADATION)
            )
      )
      || (
        evilRoleUtilityApplicable
        && (
          trace.request.kind === 'propose'
          || trace.request.kind === 'vote'
        )
          ? (() => {
              const snapshot = targetSnapshots.get(trace.decisionId)
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
              const atomicWeightedDependencyFailure =
                trace.quality === 'weighted'
                && trace.privateIdentity === undefined
                && trace.privateEvilRoleObjective === undefined
                && trace.privateEvilRoleUtility === undefined
                && versions.evilRoleUtility === undefined
                && versions.scorer === expectedBaseScorer
                && versions.configuredScorer === meta.components.scorer
                && trace.degradation.length
                  === dependencyDegradation.length
                && dependencyDegradation.every((code) =>
                  trace.degradation.includes(code))
              if (atomicWeightedDependencyFailure) return false
              if (
                dependencyDegradation.some((code) =>
                  trace.degradation.includes(code))
              ) return true
              if (
                !snapshot
                || !trace.privateEvilRoleObjective
                || !trace.privateIdentity
                || !trace.publicObserver
              ) return true
              const alternativeObjective =
                trace.request.kind === 'vote'
                  ? buildEvilRoleObjectiveSnapshot({
                      req: { ...trace.request, kind: 'propose' },
                      view: snapshot.view,
                      identity: trace.privateIdentity,
                      observer: trace.publicObserver,
                      candidates:
                        hypotheticalProposalCandidates(snapshot.view),
                    })
                  : undefined
              if (trace.privateEvilRoleUtility === undefined) {
                if (
                  versions.evilRoleUtility !== undefined
                  || !trace.degradation.includes(
                    EVIL_ROLE_UTILITY_DEGRADATION,
                  )
                ) return true
                try {
                  buildEvilRoleUtilityProjection({
                    req: snapshot.req,
                    view: snapshot.view,
                    objective: trace.privateEvilRoleObjective,
                    candidates: legalCandidates(
                      snapshot.req,
                      snapshot.view,
                    ),
                    ...(alternativeObjective
                      ? { alternativeObjective }
                      : {}),
                    ...(alternativeObjective
                      ? {
                          alternativeCandidates:
                            hypotheticalProposalCandidates(snapshot.view),
                        }
                      : {}),
                  })
                  return true
                } catch {
                  return false
                }
              }
              return (
                versions.evilRoleUtility
                  !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
                || !validatePrivateEvilRoleUtilityHostJoin(
                  trace.privateEvilRoleUtility,
                  {
                    req: snapshot.req,
                    view: snapshot.view,
                    objective: trace.privateEvilRoleObjective,
                    identity: trace.privateIdentity,
                    observer: trace.publicObserver,
                    candidates: legalCandidates(
                      snapshot.req,
                      snapshot.view,
                    ),
                    ...(alternativeObjective
                      ? { alternativeObjective }
                      : {}),
                    ...(alternativeObjective
                      ? {
                          alternativeCandidates:
                            hypotheticalProposalCandidates(snapshot.view),
                        }
                      : {}),
                  },
                )
              )
            })()
          : (
              trace.privateEvilRoleUtility !== undefined
              || versions.evilRoleUtility !== undefined
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
                    !validatePrivateIdentityHostJoin(
                      trace.privateIdentity,
                      artifact.roles,
                      trace.beliefPlayerMarginals,
                    )
                    || trace.privateIdentity.sourceBelief.modelVersion
                      !== trace.beliefModelVersion
                    || trace.privateIdentity.sourceBelief.throughSeq
                      !== trace.beliefThroughSeq
                    || trace.privateIdentity.sourceBelief.quality !== trace.quality
                  )
            )
          : (
              trace.privateIdentity !== undefined
              || versions.identityModel !== undefined
            )
      )
      || (
        roleObjectiveApplicable
          ? (
              trace.privateRoleObjective === undefined
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
                : (() => {
                    const snapshot = targetSnapshots.get(trace.decisionId)
                    return (
                      !snapshot
                      || !trace.privateIdentity
                      || !trace.publicObserver
                      || trace.degradation.includes(
                        ROLE_OBJECTIVE_DEGRADATION,
                      )
                      || !validatePrivateRoleObjectiveHostJoin(
                        trace.privateRoleObjective,
                        {
                          req: snapshot.req,
                          view: snapshot.view,
                          identity: trace.privateIdentity,
                          observer: trace.publicObserver,
                          candidates: legalCandidates(
                            snapshot.req,
                            snapshot.view,
                          ),
                        },
                      )
                    )
                  })()
            )
          : (
              trace.privateRoleObjective !== undefined
              || trace.degradation.includes(ROLE_OBJECTIVE_DEGRADATION)
            )
      )
      || (
        evilRoleObjectiveApplicable
          ? (() => {
              const snapshot = targetSnapshots.get(trace.decisionId)
              if (trace.privateEvilRoleObjective === undefined) {
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
              }
              return (
                !snapshot
                || !trace.publicObserver
                || !trace.privateIdentity
                || trace.degradation.includes(
                  EVIL_ROLE_OBJECTIVE_DEGRADATION,
                )
                || !validatePrivateEvilRoleObjectiveHostJoin(
                  trace.privateEvilRoleObjective,
                  {
                    req: snapshot.req,
                    view: snapshot.view,
                    identity: trace.privateIdentity,
                    observer: trace.publicObserver,
                    candidates: legalCandidates(snapshot.req, snapshot.view),
                  },
                )
              )
            })()
          : (
              trace.privateEvilRoleObjective !== undefined
              || trace.degradation.includes(
                EVIL_ROLE_OBJECTIVE_DEGRADATION,
              )
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
    const speech = publicSpeech(trace)
    if (!speech) continue
    hiddenInformationChecks++
    const intent = trace.communicationIntent
    const numericSecrets = [
      ...(intent?.uncertainty
        ? Object.values(intent.uncertainty)
            .filter(
              (value): value is number =>
                typeof value === 'number'
                && Number.isFinite(value)
                && !Number.isInteger(value),
            )
            .map(String)
        : []),
      ...((trace.beliefPlayerMarginals ?? [])
        .flatMap((marginal) => [
          marginal.goodProbability,
          marginal.evilProbability,
        ])
        .filter((value) => !Number.isInteger(value))
        .map(String)),
    ]
    const forbidden = [
      trace.beliefModelVersion,
      'role-composite-decision',
      ...trace.topHypotheses.map((hypothesis) => hypothesis.worldKey),
      ...(intent?.conceal ?? []),
      ...numericSecrets,
    ].filter((value) => value.length > 0)
    if (forbidden.some((value) => speech.includes(value))) {
      hiddenInformationViolations++
    }
  }
  return {
    hiddenInformationChecks,
    hiddenInformationViolations,
    traceAttributionChecks,
    traceAttributionViolations,
    ...(componentEvidenceApplicable
      ? {
          promotionEvidenceEligible: (
            architectureAdmission.provenance
              === 'descriptor-host-manifest-admitted'
            &&
            expectedComponentPlan !== undefined
            && genericComponentClaim
            && traces.every((trace) =>
              trace.version === COMPONENT_DECISION_TRACE_VERSION
              && trace.components?.entries.every((entry) =>
                entry.status !== 'degraded'
                && (
                  entry.status !== 'admitted'
                  || entry.promotionEligible
                )) === true)
            && hiddenInformationViolations === 0
            && traceAttributionViolations === 0
          ),
        }
      : {}),
  }
}

function architectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: ArtifactArchitectureAdmission,
): ArchitectureSafetySummary {
  return admission.provenance === 'descriptor-host-manifest-admitted'
    ? currentArchitectureSafety(artifact, meta, admission)
    : legacyArchitectureSafety(artifact, meta, admission)
}

function observe(a: GameArtifact): GameObservation {
  const meta = a.architecture
  if (!meta) throw new Error(`artifact ${a.id} has no architecture metadata`)
  const architectureAdmission = artifactArchitectureAdmission(a)
  const player = a.players[meta.targetSeat]
  if (!player || player.role !== meta.targetRole) {
    throw new Error(`${a.id}: architecture target seat/role does not match the archived deal`)
  }
  const metrics = computeMetrics(a)
  const seatMetrics = metrics.seats[meta.targetSeat]
  const decisions = new Map<string, number>()
  let cleanInitialProposals = 0
  let initialProposals = 0
  let correctVotes = 0
  let votes = 0
  let approveVotes = 0
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
        const teamHasEvil = (p.team as number[]).some(
          (teamSeat) => a.players[teamSeat].alignment === 'evil',
        )
        votes++
        if (targetVote.vote === 'approve') approveVotes++
        if ((targetVote.vote === 'reject') === teamHasEvil) {
          correctVotes++
        }
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
  for (const trace of a.decisionTraces ?? []) {
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
    correctVotes,
    votes,
    plannerOverrides,
    plannerSelections,
    seededVoteVariations,
    scoredVotes,
    approveVotes,
    proposalCleanProbabilities,
    proposalPosteriorRegrets,
    voteUtilityRegrets,
    latencyMs,
    safety: architectureSafety(a, meta, architectureAdmission),
  }
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function rate(successes: number, trials: number): RateEstimate {
  if (!trials) {
    return { successes, trials, rate: null, interval95: null }
  }
  const estimate = successes / trials
  const z = 1.959963984540054
  const z2 = z * z
  const denominator = 1 + z2 / trials
  const center = (estimate + z2 / (2 * trials)) / denominator
  const radius = z * Math.sqrt(
    estimate * (1 - estimate) / trials
    + z2 / (4 * trials * trials),
  ) / denominator
  return {
    successes,
    trials,
    rate: estimate,
    interval95: {
      low: Math.max(0, center - radius),
      high: Math.min(1, center + radius),
    },
  }
}

function nearestRank(values: readonly number[], probability: number): number | null {
  if (!values.length) return null
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.max(
    0,
    Math.ceil(probability * ordered.length) - 1,
  )]
}

interface RateCount {
  successes: number
  trials: number
}

function seededState(value: string): number {
  let state = 2166136261
  for (const character of value) {
    state ^= character.charCodeAt(0)
    state = Math.imul(state, 16777619)
  }
  return state >>> 0 || 1
}

function pairedBootstrapRateDelta(
  pairs: readonly Readonly<{
    baseline: GameObservation
    candidate: GameObservation
  }>[],
  select: (game: GameObservation) => RateCount,
  seed: string,
): RateDeltaEstimate {
  const aggregate = (
    selected: readonly GameObservation[],
  ): RateCount => selected.reduce<RateCount>(
    (total, game) => {
      const value = select(game)
      return {
        successes: total.successes + value.successes,
        trials: total.trials + value.trials,
      }
    },
    { successes: 0, trials: 0 },
  )
  const baseline = aggregate(pairs.map((pair) => pair.baseline))
  const candidate = aggregate(pairs.map((pair) => pair.candidate))
  if (!pairs.length || !baseline.trials || !candidate.trials) {
    return { delta: null, interval95: null }
  }
  const delta =
    candidate.successes / candidate.trials
    - baseline.successes / baseline.trials
  let state = seededState(seed)
  const random = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
  const samples: number[] = []
  for (let repetition = 0; repetition < 5_000; repetition++) {
    const selected: Array<(typeof pairs)[number]> = []
    for (let index = 0; index < pairs.length; index++) {
      selected.push(pairs[Math.floor(random() * pairs.length)])
    }
    const sampledBaseline = aggregate(
      selected.map((pair) => pair.baseline),
    )
    const sampledCandidate = aggregate(
      selected.map((pair) => pair.candidate),
    )
    if (!sampledBaseline.trials || !sampledCandidate.trials) continue
    samples.push(
      sampledCandidate.successes / sampledCandidate.trials
      - sampledBaseline.successes / sampledBaseline.trials,
    )
  }
  return {
    delta,
    interval95: samples.length
      ? {
          low: nearestRank(samples, 0.025)!,
          high: nearestRank(samples, 0.975)!,
        }
      : null,
  }
}

function latency(games: readonly GameObservation[]): LatencySummary {
  const values = games.flatMap((game) => game.latencyMs)
  return {
    samples: values.length,
    medianMs: values.length
      ? values.length % 2
        ? [...values].sort((left, right) => left - right)[
            Math.floor(values.length / 2)
          ]
        : (() => {
            const ordered = [...values].sort((left, right) => left - right)
            const middle = values.length / 2
            return (ordered[middle - 1] + ordered[middle]) / 2
          })()
      : null,
    p95Ms: nearestRank(values, 0.95),
    maxMs: values.length ? Math.max(...values) : null,
  }
}

function decisionQuality(
  games: readonly GameObservation[],
): ArchitectureDecisionQuality {
  const sum = (select: (game: GameObservation) => number) =>
    games.reduce((total, game) => total + select(game), 0)
  return {
    targetWinRate: rate(
      games.filter((game) => game.won).length,
      games.length,
    ),
    cleanInitialProposalRate: rate(
      sum((game) => game.cleanInitialProposals),
      sum((game) => game.initialProposals),
    ),
    voteTruthAccuracy: rate(
      sum((game) => game.correctVotes),
      sum((game) => game.votes),
    ),
    plannerOverrideRate: rate(
      sum((game) => game.plannerOverrides),
      sum((game) => game.plannerSelections),
    ),
    seededVoteVariationRate: rate(
      sum((game) => game.seededVoteVariations),
      sum((game) => game.scoredVotes),
    ),
    voteApproveRate: rate(
      sum((game) => game.approveVotes),
      sum((game) => game.votes),
    ),
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
    isComposedArchitectureMode(game.meta.components.mode)
    || hasComponentManifestClaim(game.architectureAdmission)
    || (game.artifact.decisionTraces ?? []).some((trace) =>
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || trace.componentPlan !== undefined
      || trace.components !== undefined
      || isComposedArchitectureMode(trace.agentMode)))
  const traces = games.flatMap((game) =>
    (game.artifact.decisionTraces ?? []).filter(
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
  if (isComposedArchitectureMode(game.meta.components.mode)) {
    return game.safety.promotionEvidenceEligible === true
  }
  if (
    game.meta.components.mode === 'raw-llm'
    || game.meta.components.mode === 'heuristic'
    || game.meta.components.mode === 'random'
    || game.meta.components.mode === 'external'
  ) {
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
    isComposedArchitectureMode(game.meta.components.mode)
    || hasComponentManifestClaim(game.architectureAdmission)
    || (game.artifact.decisionTraces ?? []).some((trace) =>
      trace.version === COMPONENT_DECISION_TRACE_VERSION
      || trace.componentPlan !== undefined
      || trace.components !== undefined
      || isComposedArchitectureMode(trace.agentMode)))
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
    forcedViolations: games.reduce((sum, g) => sum + g.forced, 0),
    degraded: games.reduce((sum, g) => sum + g.degraded, 0),
    calls: games.reduce((sum, g) => sum + g.callCount, 0),
    cost: games.reduce((sum, g) => sum + g.cost, 0),
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
        forcedViolations: selected.reduce((sum, g) => sum + g.forced, 0),
        degraded: selected.reduce((sum, g) => sum + g.degraded, 0),
        calls: selected.reduce((sum, g) => sum + g.callCount, 0),
        cost: selected.reduce((sum, g) => sum + g.cost, 0),
        decisionQuality: decisionQuality(selected),
        latency: latency(selected),
        safety: safety(selected),
      }
    }),
    byKind: kinds.map((kind) => ({
      kind,
      decisions: games.reduce((sum, g) => sum + (g.decisions.get(kind) ?? 0), 0),
      calls: games.reduce((sum, g) => sum + (g.calls.get(kind)?.calls ?? 0), 0),
      degraded: games.reduce(
        (sum, g) => sum + g.artifact.degraded.filter(
          (d) => d.seat === g.meta.targetSeat && d.kind === kind,
        ).length,
        0,
      ),
      cost: games.reduce((sum, g) => sum + (g.calls.get(kind)?.cost ?? 0), 0),
    })),
    byModel: modelIds.map((model) => {
      const entries = games.map((g) => g.models.get(model)).filter((v): v is ArchitectureModelSummary => !!v)
      return {
        model,
        calls: entries.reduce((sum, entry) => sum + entry.calls, 0),
        cost: entries.reduce((sum, entry) => sum + entry.cost, 0),
        promptTokens: entries.reduce((sum, entry) => sum + entry.promptTokens, 0),
        completionTokens: entries.reduce((sum, entry) => sum + entry.completionTokens, 0),
        reasoningTokens: entries.reduce((sum, entry) => sum + entry.reasoningTokens, 0),
        reasoningLeaks: entries.reduce((sum, entry) => sum + entry.reasoningLeaks, 0),
      }
    }),
  }
}

function assertMatched(a: GameObservation, b: GameObservation): void {
  const comparable = {
    seed: a.artifact.seed,
    playerCount: a.artifact.playerCount,
    roles: a.artifact.roles,
    talk: a.artifact.talk,
    deal: a.artifact.players.map((p) => p.role),
    targetRole: a.meta.targetRole,
    targetSeat: a.meta.targetSeat,
    names: a.artifact.players.map((p) => p.name),
    opponents: a.artifact.players.map((p) => p.seat === a.meta.targetSeat ? '<variant>' : p.agent),
  }
  const other = {
    seed: b.artifact.seed,
    playerCount: b.artifact.playerCount,
    roles: b.artifact.roles,
    talk: b.artifact.talk,
    deal: b.artifact.players.map((p) => p.role),
    targetRole: b.meta.targetRole,
    targetSeat: b.meta.targetSeat,
    names: b.artifact.players.map((p) => p.name),
    opponents: b.artifact.players.map((p) => p.seat === b.meta.targetSeat ? '<variant>' : p.agent),
  }
  if (JSON.stringify(comparable) !== JSON.stringify(other)) {
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
        assertMatched(baselineGame, candidateGame)
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
        wins: deltas.reduce((sum, delta) => sum + delta.wins, 0),
        forcedViolations: deltas.reduce((sum, delta) => sum + delta.forced, 0),
        degraded: deltas.reduce((sum, delta) => sum + delta.degraded, 0),
        cost: deltas.reduce((sum, delta) => sum + delta.cost, 0),
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
          `${games[0].meta.bank}:${baseline}:${candidate}:wins`,
        ),
        cleanInitialProposalRateDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.cleanInitialProposals,
            trials: game.initialProposals,
          }),
          `${games[0].meta.bank}:${baseline}:${candidate}:proposals`,
        ),
        voteTruthAccuracyDelta: pairedBootstrapRateDelta(
          pairs,
          (game) => ({
            successes: game.correctVotes,
            trials: game.votes,
          }),
          `${games[0].meta.bank}:${baseline}:${candidate}:votes`,
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

const fixed = (value: number): string => value.toFixed(4)
const percent = (value: number): string => `${(value * 100).toFixed(1)}%`
const renderRate = (value: RateEstimate): string =>
  value.rate === null || !value.interval95
    ? `n/a (0/${value.trials})`
    : `${percent(value.rate)} (${value.successes}/${value.trials}, `
      + `95% ${percent(value.interval95.low)}-${percent(value.interval95.high)})`
const renderDelta = (value: RateDeltaEstimate): string =>
  value.delta === null || !value.interval95
    ? 'n/a'
    : `${value.delta >= 0 ? '+' : ''}${percent(value.delta)} `
      + `(95% ${percent(value.interval95.low)} to ${percent(value.interval95.high)})`
const renderMilliseconds = (value: number | null): string =>
  value === null ? 'n/a' : `${value.toFixed(2)}ms`

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
