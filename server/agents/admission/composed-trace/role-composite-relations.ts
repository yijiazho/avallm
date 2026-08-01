// The good, evil, and Morgana role-composite selection replays. All three
// re-derive a selection the policy already made and refuse a trace whose rows
// fail to reproduce it. They are the longest and most arithmetic validators in
// admission, and side by side the three read as variants of one replay, which is
// the only way a divergence between them stays noticeable.

import type {
  DecisionRequest,
} from '../../../engine/types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  validatePrivateMorganaRoleUtilityProjection,
} from '../../analysis/morgana-role-utility.ts'
import {
  compareCandidateIds,
} from '../../candidate/candidates.ts'
import {
  PROBABILITY_TOLERANCE,
} from '../../canonical/probability-arithmetic.ts'
import {
  componentPayload,
} from '../../components/kernel.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../../components/native-score-components.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  GOOD_PROPOSAL_FEATURE_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
} from '../../policy/score.ts'
import {
  scorerAdmitsDiagnosticOwner,
} from './production-registries.ts'
import {
  seededSelectionReplayInvalid,
} from './relation-context.ts'
import type {
  ComposedTraceContext,
} from './relation-context.ts'
import {
  isDeepStrictEqual,
} from 'node:util'

export function validGoodRoleCompositeSelection(ctx: ComposedTraceContext): boolean {
  const { trace, scores, roleFeatureScores, components, componentRun, structured }
    = ctx
  if (roleFeatureScores.length > 0) {
    // The retired flat C2 payload can never be present.
    const roleProjection = (
      componentRun
        ? componentPayload(componentRun, GOOD_ROLE_UTILITY_COMPONENT)
        : undefined
    ) as Record<string, unknown> | undefined
    const forced = trace.forcedPolicyResult as
      | Record<string, unknown>
      | undefined
    if (
      roleFeatureScores.length !== scores.length
      || !roleProjection
      || !forced
      || !Array.isArray(roleProjection.assessments)
      || ![
        ROLE_OBJECTIVE_SCORER_VERSION,
        ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].some((owner) =>
        scorerAdmitsDiagnosticOwner(components?.scorer, owner))
    ) return false
    const utilities = new Map(
      (roleProjection.assessments as Array<Record<string, unknown>>)
        .map((assessment) => [assessment.candidateId, assessment]),
    )
    const allowed = new Set(forced.allowedCandidateIds as string[])
    const allowedRole = roleFeatureScores.filter((score) =>
      allowed.has(score.candidateId as string))
    if (!allowedRole.length) return false
    const mean = allowedRole.reduce(
      (sum, score) =>
        sum + Number(
          (score.roleObjectiveFeatures as Record<string, unknown>).roleValue,
        ),
      0,
    ) / allowedRole.length
    for (const score of roleFeatureScores) {
      const role = score.roleObjectiveFeatures as Record<string, unknown>
      const utility = utilities.get(score.candidateId)
      const base = score.features as Record<string, unknown>
      const expectedBase = base.version === GOOD_PROPOSAL_FEATURE_VERSION
        ? base.cleanProbability
        : base.baseUtility
      if (
        !utility
        || !isDeepStrictEqual(role.utility, utility)
        || role.role !== roleProjection.role
        || role.kind !== (trace.request as DecisionRequest).kind
        || role.baseValue !== expectedBase
        || Math.abs(Number(role.survivorMeanRoleValue) - mean) > PROBABILITY_TOLERANCE
      ) return false
    }
    const mode = (
      roleFeatureScores[0]!.roleObjectiveFeatures as Record<string, unknown>
    ).selectionMode
    const expectedScorer = mode === 'seeded-composite-band'
      ? ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : ROLE_OBJECTIVE_SCORER_VERSION
    const maxCombined = Math.max(...allowedRole.map((score) =>
      Number(
        (score.roleObjectiveFeatures as Record<string, unknown>).combinedValue,
      )))
    const canonicalTop = allowedRole
      .filter((score) =>
        (score.roleObjectiveFeatures as Record<string, unknown>)
          .combinedValue === maxCombined)
      .map((score) => score.candidateId as string)
      .sort(compareCandidateIds)[0]
    const viable = roleFeatureScores.filter((score) => score.viable === true)
    const selectedByValue = viable.slice().sort((left, right) =>
      Number(right.value) - Number(left.value)
      || compareCandidateIds(
        String(left.candidateId),
        String(right.candidateId),
      ))[0]
    const forcedSelected = forced.selectedCandidateId as string | undefined
    const bandActive =
      !forcedSelected
      && mode === 'seeded-composite-band'
      && (trace.request as DecisionRequest).kind === 'vote'
      && allowedRole.length === 2
      && Math.abs(
        Number(
          (allowedRole[0]!.roleObjectiveFeatures as Record<string, unknown>)
            .combinedValue,
        )
        - Number(
          (allowedRole[1]!.roleObjectiveFeatures as Record<string, unknown>)
            .combinedValue,
        ),
      ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
    const firstRole =
      roleFeatureScores[0]!.roleObjectiveFeatures as Record<string, unknown>
    if (
      !scorerAdmitsDiagnosticOwner(components?.scorer, expectedScorer)
      || !selectedByValue
      || selectedByValue.candidateId !== structured
      || roleFeatureScores.some((score) => {
        const role = score.roleObjectiveFeatures as Record<string, unknown>
        return role.selectionMode !== mode
          || role.inViableBand !== (
            (trace.request as DecisionRequest).kind === 'vote'
            && allowedRole.length === 2
            && Math.abs(
              Number(
                (allowedRole[0]!.roleObjectiveFeatures as Record<string, unknown>)
                  .combinedValue,
              )
              - Number(
                (allowedRole[1]!.roleObjectiveFeatures as Record<string, unknown>)
                  .combinedValue,
              ),
            ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
          )
          || (
            !allowed.has(score.candidateId as string)
            && (
              score.value !== -Number.MAX_SAFE_INTEGER
              || score.viable === true
            )
          )
      })
      || seededSelectionReplayInvalid({
        rows: roleFeatureScores,
        viable,
        featuresOf: (score) =>
          score.roleObjectiveFeatures as Record<string, unknown>,
        valueKey: 'combinedValue',
        maxValue: maxCombined,
        forcedSelected,
        bandActive,
        seedBucket: firstRole.seedBucket,
        canonicalTop,
      })
    ) return false
  }
  return true
}

export function validEvilRoleCompositeSelection(ctx: ComposedTraceContext): boolean {
  const { trace, scores, evilRoleFeatureScores, components, componentRun } = ctx
  if (evilRoleFeatureScores.length > 0) {
    const projection = (
      componentRun
        ? componentPayload(componentRun, EVIL_ROLE_UTILITY_COMPONENT)
        : undefined
    ) as Record<string, unknown> | undefined
    const forced = trace.forcedPolicyResult as
      | Record<string, unknown>
      | undefined
    if (
      evilRoleFeatureScores.length !== scores.length
      || !projection
      || !forced
      || !Array.isArray(projection.assessments)
      || ![
        EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
        EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
      ].some((owner) =>
        scorerAdmitsDiagnosticOwner(components?.scorer, owner))
    ) return false
    const utilities = new Map(
      (projection.assessments as Array<Record<string, unknown>>)
        .map((assessment) => [assessment.candidateId, assessment]),
    )
    const allowed = new Set(forced.allowedCandidateIds as string[])
    const allowedRows = evilRoleFeatureScores.filter((score) =>
      allowed.has(score.candidateId as string))
    if (!allowedRows.length) return false
    for (const score of evilRoleFeatureScores) {
      const feature =
        score.evilRoleObjectiveFeatures as Record<string, unknown>
      const utility = utilities.get(score.candidateId)
      if (
        !utility
        || !isDeepStrictEqual(feature.utility, utility)
        || feature.role !== projection.role
        || feature.kind !== (trace.request as DecisionRequest).kind
        || feature.roleValue !== utility.roleValue
      ) return false
    }
    const first =
      evilRoleFeatureScores[0]!.evilRoleObjectiveFeatures as
        Record<string, unknown>
    const mode = first.selectionMode
    const expectedScorer = mode === 'seeded-role-utility-band'
      ? EVIL_ROLE_OBJECTIVE_SEEDED_SCORER_VERSION
      : EVIL_ROLE_OBJECTIVE_SCORER_VERSION
    const maxValue = Math.max(...allowedRows.map((score) =>
      Number(
        (score.evilRoleObjectiveFeatures as Record<string, unknown>)
          .roleValue,
      )))
    const canonicalTop = allowedRows
      .filter((score) =>
        (score.evilRoleObjectiveFeatures as Record<string, unknown>)
          .roleValue === maxValue)
      .map((score) => score.candidateId as string)
      .sort(compareCandidateIds)[0]
    const viable = evilRoleFeatureScores.filter(
      (score) => score.viable === true,
    )
    const forcedSelected = forced.selectedCandidateId as string | undefined
    const inBand =
      (trace.request as DecisionRequest).kind === 'vote'
      && allowedRows.length === 2
      && Math.abs(
        Number(
          (allowedRows[0]!.evilRoleObjectiveFeatures as Record<string, unknown>)
            .roleValue,
        ) - Number(
          (allowedRows[1]!.evilRoleObjectiveFeatures as Record<string, unknown>)
            .roleValue,
        ),
      ) <= EVIL_ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
    const bandActive =
      !forcedSelected
      && mode === 'seeded-role-utility-band'
      && inBand
    const seededBucket = first.seedBucket
    if (
      !scorerAdmitsDiagnosticOwner(components?.scorer, expectedScorer)
      || evilRoleFeatureScores.some((score) => {
        const feature =
          score.evilRoleObjectiveFeatures as Record<string, unknown>
        return feature.selectionMode !== mode
          || feature.inViableBand !== inBand
          || (
            !allowed.has(score.candidateId as string)
            && (
              score.value !== -Number.MAX_SAFE_INTEGER
              || score.viable === true
            )
          )
      })
      || seededSelectionReplayInvalid({
        rows: evilRoleFeatureScores,
        viable,
        featuresOf: (score) =>
          score.evilRoleObjectiveFeatures as Record<string, unknown>,
        valueKey: 'roleValue',
        maxValue,
        forcedSelected,
        bandActive,
        seedBucket: seededBucket,
        canonicalTop,
      })
    ) return false
  }
  return true
}

export function validMorganaRoleCompositeSelection(ctx: ComposedTraceContext): boolean {
  const {
    scores, morganaRoleFeatureScores, components, componentRun, structured, chosen,
  } = ctx
  if (morganaRoleFeatureScores.length > 0) {
    const projection = (
      componentRun
        ? componentPayload(
            componentRun,
            components?.scorer === MORGANA_ROLE_SEEDED_SCORER_VERSION
              ? MORGANA_ROLE_UTILITY_SEEDED_COMPONENT
              : MORGANA_ROLE_UTILITY_COMPONENT,
          )
        : undefined
    ) as Record<string, unknown> | undefined
    const projectionRows = Array.isArray(projection?.candidates)
      ? projection.candidates as Record<string, unknown>[]
      : []
    const rows = new Map(
      projectionRows.map((row) => [row.candidateId as string, row]),
    )
    const selectedId = projection?.selectedCandidateId
    const mode = projection?.selectionMode
    const expectedScorer =
      mode === 'seeded-near-equal-vote-within-d2-band'
        ? MORGANA_ROLE_SEEDED_SCORER_VERSION
        : MORGANA_ROLE_SCORER_VERSION
    if (
      !projection
      || !validatePrivateMorganaRoleUtilityProjection(projection)
      || morganaRoleFeatureScores.length !== scores.length
      || rows.size !== scores.length
      || !scorerAdmitsDiagnosticOwner(components?.scorer, expectedScorer)
      || structured !== selectedId
      || chosen !== selectedId
      || morganaRoleFeatureScores.filter(
        (score) => score.viable === true,
      ).length !== 1
      || morganaRoleFeatureScores.some((score) => {
        const row = rows.get(score.candidateId as string)
        const feature = score.morganaRoleObjectiveFeatures as
          Record<string, unknown>
        if (!row) return true
        const selected = score.candidateId === selectedId
        return (
          score.viable !== selected
          || score.value !== (
            row.forcedAllowed === true
              ? row.counterfeitValue
              : -Number.MAX_SAFE_INTEGER
          )
          || feature.candidateId !== row.candidateId
          || feature.kind !== row.kind
          || feature.d2RoleValue !== row.d2RoleValue
          || feature.maxD2RoleValue !== projection.maxD2RoleValue
          || feature.d2BandFloor !== projection.d2BandFloor
          || feature.inD2ViableBand !== row.inD2ViableBand
          || feature.counterfeitValue !== row.counterfeitValue
          || feature.counterfeitRank !== row.counterfeitRank
          || feature.selectionMode !== mode
          || feature.selectedByPolicy !== selected
          || feature.seedBucket !== projection.seedBucket
          || !isDeepStrictEqual(feature.utility, row)
        )
      })
    ) return false
  }
  return true
}
