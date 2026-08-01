// Folding per-game observations into the per-variant summary the report
// publishes.
//
// Every function here is an aggregation and nothing here reads an artifact
// directly, which is the line between this module and observe.ts. The reason to
// hold that line is that aggregation is where a promotion gate is decided: a
// variant is promotion-eligible only if every game in it is, and safety
// eligibility deliberately stays absent rather than false when no game had an
// opinion. Mixing those folds in with the per-game walk made it easy to lose
// the difference between "no evidence" and "evidence says no".
//
// summarizeVariant also enforces that a variant is one architecture. Games that
// disagree about their component versions or their decision-component manifest
// throw rather than averaging, because a summary over two architectures is a
// number with no subject.

import {
  mean,
  median,
  nearestRank,
  rate,
  sumOf,
} from '../core/statistics.ts'
import type {
  RateEstimate,
} from '../core/statistics.ts'
import {
  addVoteConfusion,
  emptyVoteConfusion,
  voteRateCount,
} from '../runs/vote-direction.ts'
import type {
  VoteConfusionRate,
} from '../runs/vote-direction.ts'
import {
  isNonComposedPolicy,
} from '../../agents/brain.ts'
import {
  COMPONENT_DECISION_TRACE_VERSION,
  isComposedTrace,
} from '../../agents/trace.ts'
import {
  architectureIdentityVersions,
} from '../../agents/components/architecture-metadata.ts'
import {
  resolvedArchitectureIdentityDigest,
} from '../../agents/components/resolved-brain.ts'
import type {
  ArchitectureComponentEvidenceSummary,
  ArchitectureDecisionQuality,
  ArchitectureModelSummary,
  ArchitectureSafetySummary,
  ArchitectureVariantSummary,
  GameObservation,
  LatencySummary,
} from './types.ts'
import {
  hasComponentManifestClaim,
} from './artifact-admission.ts'
import {
  isComposedComponents,
} from './host-join.ts'

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
    maxMs: ordered.length ? ordered[ordered.length - 1]! : null,
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
      admissions[0]!.provenance === 'descriptor-host-manifest-admitted'
      || admissions[0]!.provenance === 'legacy-host-manifest-admitted'
    ) ? admissions[0]!.plan.configured.length : 0,
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

export function observationPromotionEvidenceEligible(
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

export function summarizeVariant(id: string, games: GameObservation[]): ArchitectureVariantSummary {
  const architectureAdmissions = games.map(
    (game) => game.architectureAdmission,
  )
  const reportComponents = architectureAdmissions.map(
    (admission, index) =>
      admission.provenance === 'descriptor-host-manifest-admitted'
        ? architectureIdentityVersions(admission.identity)
        : games[index]!.meta.components,
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
  const firstAdmission = architectureAdmissions[0]!
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
