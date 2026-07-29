import {
  MORGANA_ROLE_SCORE_FEATURE_VERSION,
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_CONSTANTS,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/morgana-role-utility.ts'
import {
  EVIL_ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/evil-role-utility.ts'
import {
  calculateConfiguredDeterministicGoodBase,
} from '../score-layers/configured.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../analysis/role-utility.ts'
import type { ScoreLayerRow } from './score-layer/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_UTILITY_VERSION,
  stablePolicyBucket,
} from './good-score-contract.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
} from './evil-score-contract.ts'
import type {
  CandidateScore,
  CandidateScoringContext,
  EvilRoleObjectiveScoreFeatures,
  MorganaRoleObjectiveScoreFeatures,
  RoleObjectiveScoreFeatures,
} from './score.ts'

const GOOD_NATIVE_VERSIONS = new Set([
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
])

const mechanical = (
  rows: readonly ScoreLayerRow[],
  version: string,
): CandidateScore[] => rows.map((row) => ({
  version,
  candidateId: row.candidateId,
  value: row.value,
  viable: row.viable,
  reasonCodes: [...row.reasonCodes],
}))

function projectGood(
  context: CandidateScoringContext,
  rows: readonly ScoreLayerRow[],
  scorerVersion: string,
): readonly CandidateScore[] | undefined {
  if (!GOOD_NATIVE_VERSIONS.has(scorerVersion)) return undefined
  const plain = mechanical(rows, scorerVersion)
  if (scorerVersion === CANDIDATE_SCORER_VERSION) return plain
  const inScope =
    context.view.alignment === 'good'
    && (
      context.request.kind === 'propose'
      || (
        scorerVersion !== GOOD_PROPOSAL_SCORER_VERSION
        && context.request.kind === 'vote'
      )
    )
  if (!inScope) return plain
  const base = calculateConfiguredDeterministicGoodBase(context)
  const baseById = new Map(
    base.rows.map((entry) => [entry.score.candidateId, entry]),
  )
  if (baseById.size !== rows.length) {
    throw new Error('good diagnostics require a complete native surface')
  }
  if (
    scorerVersion === GOOD_PROPOSAL_SCORER_VERSION
    || scorerVersion === GOOD_PROPOSAL_VOTE_SCORER_VERSION
    || scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
  ) {
    const seeded =
      scorerVersion === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      && context.request.kind === 'vote'
    const allowed = new Set(
      context.candidateBoundary.survivorCandidateIds,
    )
    const voteFeatures = base.rows[0]?.features.version
      === GOOD_VOTE_FEATURE_VERSION
      ? base.rows[0].features
      : undefined
    const bandActive =
      seeded && voteFeatures?.inViableBand === true && allowed.size > 1
    const seedBucket = bandActive
      ? stablePolicyBucket([
          context.deterministicSeed,
          context.request.seat,
          context.request.kind,
          context.request.round,
          context.request.proposalNum,
          context.analysis.throughSeq,
        ].join(':'))
      : undefined
    const maxBase = Math.max(
      ...base.rows
        .filter((entry) => allowed.has(entry.score.candidateId))
        .map((entry) => entry.baseValue),
    )
    const seededVote = seedBucket === 0 ? 'approve' : 'reject'
    return plain.map((score) => {
      const baseRow = baseById.get(score.candidateId)
      if (!baseRow) throw new Error('good diagnostic row join mismatch')
      if (baseRow.features.version === GOOD_PROPOSAL_FEATURE_VERSION) {
        return { ...score, features: structuredClone(baseRow.features) }
      }
      return {
        ...score,
        features: {
          ...structuredClone(baseRow.features),
          selectionAdjustment:
            bandActive
            && context.candidates.find(
              (candidate) => candidate.id === score.candidateId,
            )?.decision.kind === 'vote'
            && (
              context.candidates.find(
                (candidate) => candidate.id === score.candidateId,
              )!.decision as { kind: 'vote'; vote: string }
            ).vote === seededVote
              ? maxBase - baseRow.baseValue + 1e-9
              : 0,
          selectionMode: seeded ? 'seeded-band' as const : 'top-utility' as const,
          ...(seedBucket === undefined ? {} : { seedBucket }),
        },
      }
    })
  }

  const projection = context.roleUtility
  if (
    !projection
    || projection.version !== ROLE_UTILITY_PROJECTION_VERSION
    || projection.role !== context.view.role
  ) throw new Error('good role diagnostics require admitted role utility')
  const utilityById = new Map(
    projection.assessments.map((entry) => [entry.candidateId, entry]),
  )
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
  const survivorMeanRoleValue = context.candidates
    .filter((candidate) => allowed.has(candidate.id))
    .reduce((sum, candidate) => {
      const utility = utilityById.get(candidate.id)
      if (!utility) throw new Error('good role diagnostic utility missing')
      return sum + utility.roleValue
    }, 0) / allowed.size
  const preliminary = context.candidates.map((candidate) => {
    const baseRow = baseById.get(candidate.id)
    const utility = utilityById.get(candidate.id)
    if (!baseRow || !utility) {
      throw new Error('good role diagnostic row join mismatch')
    }
    const roleAdjustment =
      ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
      * (utility.roleValue - survivorMeanRoleValue)
    return {
      candidate,
      baseRow,
      utility,
      roleAdjustment,
      combinedValue: baseRow.baseValue + roleAdjustment,
    }
  })
  const voteRows = context.request.kind === 'vote'
    ? preliminary.filter(({ candidate }) => allowed.has(candidate.id))
    : []
  const inViableBand =
    voteRows.length === 2
    && Math.abs(
      voteRows[0].combinedValue - voteRows[1].combinedValue,
    ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
  const seeded = scorerVersion === ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  const bandActive =
    !context.candidateBoundary.selectedCandidateId
      && seeded
      && inViableBand
  const seedBucket = bandActive
    ? stablePolicyBucket([
        context.deterministicSeed,
        context.request.seat,
        context.request.kind,
        context.request.round,
        context.request.proposalNum,
        context.analysis.throughSeq,
      ].join(':'))
    : undefined
  const maxCombined = Math.max(
    ...preliminary
      .filter(({ candidate }) => allowed.has(candidate.id))
      .map((entry) => entry.combinedValue),
  )
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'
  const byId = new Map(preliminary.map((entry) => [entry.candidate.id, entry]))
  return plain.map((score): CandidateScore => {
    const row = byId.get(score.candidateId)
    if (!row) throw new Error('good role diagnostic candidate missing')
    const roleObjectiveFeatures: RoleObjectiveScoreFeatures = {
      version: ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
      utilityVersion: ROLE_OBJECTIVE_UTILITY_VERSION,
      utilityProjectionVersion: projection.version,
      sourceObjectiveVersion: projection.source.roleObjectiveVersion,
      role: projection.role,
      candidateId: score.candidateId,
      kind: context.request.kind as 'propose' | 'vote',
      baseScorerVersion: GOOD_PROPOSAL_VOTE_SCORER_VERSION,
      baseFeatureVersion: row.baseRow.features.version,
      baseValue: row.baseRow.baseValue,
      roleValue: row.utility.roleValue,
      survivorMeanRoleValue,
      roleAdjustment: row.roleAdjustment,
      combinedValue: row.combinedValue,
      selectionMode: seeded
        ? 'seeded-composite-band'
        : 'top-composite',
      viableBand: ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand,
      inViableBand,
      selectionAdjustment:
        bandActive
        && row.candidate.decision.kind === 'vote'
        && row.candidate.decision.vote === seededVote
          ? maxCombined - row.combinedValue + 1e-9
          : 0,
      ...(seedBucket === undefined ? {} : { seedBucket }),
      utility: structuredClone(row.utility),
    }
    return {
      ...score,
      features: structuredClone(row.baseRow.features),
      roleObjectiveFeatures,
    }
  })
}

function projectEvil(
  context: CandidateScoringContext,
  rows: readonly ScoreLayerRow[],
  scorerVersion: string,
): readonly CandidateScore[] | undefined {
  if (
    scorerVersion !== EVIL_ROLE_OBJECTIVE_SCORER_VERSION
    && scorerVersion !== EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  ) return undefined
  const projection = context.evilRoleUtility
  if (
    !projection
    || projection.version !== EVIL_ROLE_UTILITY_PROJECTION_VERSION
    || projection.role !== context.view.role
    || (context.request.kind !== 'propose' && context.request.kind !== 'vote')
  ) throw new Error('evil diagnostics require admitted role utility')
  const requestKind = context.request.kind as 'propose' | 'vote'
  const utilityById = new Map(
    projection.assessments.map((entry) => [entry.candidateId, entry]),
  )
  if (
    utilityById.size !== rows.length
    || rows.some((row) => !utilityById.has(row.candidateId))
  ) throw new Error('evil diagnostic candidate join mismatch')
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
  const voteRows = requestKind === 'vote'
    ? projection.assessments.filter((entry) =>
        allowed.has(entry.candidateId))
    : []
  const inViableBand =
    voteRows.length === 2
    && Math.abs(voteRows[0].roleValue - voteRows[1].roleValue)
      <= EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
  const seeded =
    scorerVersion === EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
  const bandActive =
    !context.candidateBoundary.selectedCandidateId
      && seeded
      && inViableBand
  const seedBucket = bandActive
    ? stablePolicyBucket([
        context.deterministicSeed,
        context.request.seat,
        context.request.kind,
        context.request.round,
        context.request.proposalNum,
        context.analysis.throughSeq,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].join(':'))
    : undefined
  const maxValue = Math.max(...voteRows.map((entry) => entry.roleValue))
  const seededVote = seedBucket === 0 ? 'approve' : 'reject'
  return rows.map((row): CandidateScore => {
    const utility = utilityById.get(row.candidateId)
    if (!utility) throw new Error('evil diagnostic utility missing')
    const evilRoleObjectiveFeatures: EvilRoleObjectiveScoreFeatures = {
      version: EVIL_ROLE_OBJECTIVE_SCORE_FEATURE_VERSION,
      utilityVersion: EVIL_ROLE_OBJECTIVE_UTILITY_VERSION,
      utilityProjectionVersion: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
      sourceObjectiveVersion: projection.source.roleObjectiveVersion,
      role: projection.role,
      candidateId: row.candidateId,
      kind: requestKind,
      roleValue: utility.roleValue,
      selectionMode: seeded
        ? 'seeded-role-utility-band'
        : 'top-role-utility',
      viableBand: EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand,
      inViableBand,
      selectionAdjustment:
        bandActive
        && context.candidates.find(
          (candidate) => candidate.id === row.candidateId,
        )?.decision.kind === 'vote'
        && (
          context.candidates.find(
            (candidate) => candidate.id === row.candidateId,
          )!.decision as { kind: 'vote'; vote: string }
        ).vote === seededVote
          ? maxValue - utility.roleValue + 1e-9
          : 0,
      ...(seedBucket === undefined ? {} : { seedBucket }),
      utility: structuredClone(utility),
    }
    return {
      ...mechanical([row], scorerVersion)[0],
      evilRoleObjectiveFeatures,
    }
  })
}

function projectMorgana(
  context: CandidateScoringContext,
  rows: readonly ScoreLayerRow[],
  scorerVersion: string,
): readonly CandidateScore[] | undefined {
  if (
    scorerVersion !== MORGANA_ROLE_SCORER_VERSION
    && scorerVersion !== MORGANA_ROLE_SEEDED_SCORER_VERSION
  ) return undefined
  const projection = context.morganaRoleUtility
  if (
    !projection
    || projection.version !== MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    || projection.role !== 'morgana'
    || (context.request.kind !== 'propose' && context.request.kind !== 'vote')
  ) throw new Error('Morgana diagnostics require admitted role utility')
  const utilityById = new Map(
    projection.candidates.map((entry) => [entry.candidateId, entry]),
  )
  if (
    utilityById.size !== rows.length
    || rows.some((row) => !utilityById.has(row.candidateId))
  ) throw new Error('Morgana diagnostic candidate join mismatch')
  const requestKind = context.request.kind as 'propose' | 'vote'
  return rows.map((row): CandidateScore => {
    const utility = utilityById.get(row.candidateId)
    if (!utility) throw new Error('Morgana diagnostic utility missing')
    const selected = row.candidateId === projection.selectedCandidateId
    const morganaRoleObjectiveFeatures: MorganaRoleObjectiveScoreFeatures = {
      version: MORGANA_ROLE_SCORE_FEATURE_VERSION,
      utilityProjectionVersion: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
      sourceCounterfeitObjectiveVersion:
        projection.source.morganaCounterfeitObjectiveVersion,
      sourceEvilRoleUtilityVersion:
        projection.source.evilRoleUtilityVersion,
      candidateId: row.candidateId,
      kind: requestKind,
      d2RoleValue: utility.d2RoleValue,
      maxD2RoleValue: projection.maxD2RoleValue,
      d2BandFloor: projection.d2BandFloor,
      d2ViableBand: MORGANA_ROLE_UTILITY_CONSTANTS.d2ViableBand,
      inD2ViableBand: utility.inD2ViableBand,
      counterfeitValue: utility.counterfeitValue,
      counterfeitRank: utility.counterfeitRank,
      selectionMode: projection.selectionMode,
      seededVoteCounterfeitBand:
        MORGANA_ROLE_UTILITY_CONSTANTS.seededVoteCounterfeitBand,
      selectedByPolicy: selected,
      ...(projection.seedBucket === undefined
        ? {}
        : { seedBucket: projection.seedBucket }),
      utility: structuredClone(utility),
    }
    return {
      ...mechanical([row], scorerVersion)[0],
      morganaRoleObjectiveFeatures,
    }
  })
}

/**
 * Historical diagnostics are attached only after the native score-layer rows
 * have fixed every mechanical field.
 */
export function projectConfiguredScoreDiagnostics(
  context: CandidateScoringContext,
  rows: readonly ScoreLayerRow[],
  scorerVersion: string,
  admittedNativeScorerVersions: readonly string[] = [],
  diagnosticOwnerVersion: string = scorerVersion,
): readonly CandidateScore[] {
  const projected =
    projectMorgana(context, rows, diagnosticOwnerVersion)
    ?? projectEvil(context, rows, diagnosticOwnerVersion)
    ?? projectGood(context, rows, diagnosticOwnerVersion)
  if (projected) {
    return projected.map((score) => ({
      ...score,
      version: scorerVersion,
    }))
  }
  if (
    !admittedNativeScorerVersions.includes(scorerVersion)
    || (
      diagnosticOwnerVersion !== scorerVersion
      && !admittedNativeScorerVersions.includes(diagnosticOwnerVersion)
    )
  ) {
    throw new Error(`no admitted native diagnostic owner for ${scorerVersion}`)
  }
  return rows.map((row) => ({
    version: scorerVersion,
    candidateId: row.candidateId,
    value: row.value,
    viable: row.viable,
    reasonCodes: [...row.reasonCodes],
  }))
}
