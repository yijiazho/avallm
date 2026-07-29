import {
  GOOD_PROPOSAL_ANALYSIS,
  GOOD_VOTE_ANALYSIS,
} from '../analysis/situation-plan.ts'
import {
  GOOD_VOTE_SITUATION_VERSION,
} from '../analysis/types.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
  type PrivateRoleUtilityProjection,
} from '../analysis/role-utility.ts'
import {
  GOOD_ROLE_UTILITY_COMPONENT,
} from '../components/legacy-role-adapters.ts'
import {
  createScoreLayerRegistry,
} from '../policy/score-layer/registry.ts'
import {
  scoreLayerToken,
  type ScoreLayerAnalysisAdmissionContext,
  type ScoreLayerAnalysisRef,
  type ScoreLayerApplicabilityContext,
  type ScoreLayerDefinition,
  type ScoreLayerExecutionContext,
  type ScoreLayerRootDefinition,
  type ScoreLayerRowDraft,
  type ScoreLayerToken,
  type ScoreLayerTransformContext,
  type ScoreLayerTransformDefinition,
} from '../policy/score-layer/types.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  stablePolicyBucket,
} from '../policy/good-score-contract.ts'
import {
  goodProposalScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededRoleObjectiveScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import type { DecisionKind } from '../../engine/types.ts'

export const COMPATIBILITY_SCORE_LAYER = scoreLayerToken(
  'compatibility-score',
  CANDIDATE_SCORER_VERSION,
)
export const GOOD_PROPOSAL_SCORE_LAYER = scoreLayerToken(
  'good-proposal-score',
  GOOD_PROPOSAL_SCORER_VERSION,
)
export const GOOD_PROPOSAL_VOTE_SCORE_LAYER = scoreLayerToken(
  'good-proposal-vote-score',
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
)
export const SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER = scoreLayerToken(
  'seeded-good-proposal-vote-score',
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
)
export const GOOD_ROLE_SCORE_LAYER = scoreLayerToken(
  'good-role-score',
  ROLE_OBJECTIVE_SCORER_VERSION,
)
export const SEEDED_GOOD_ROLE_SCORE_LAYER = scoreLayerToken(
  'seeded-good-role-score',
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
)

/** Exact built-in identity mapping; custom same-version writers stay legacy. */
export function goodScoreLayerTerminalFor(
  scorer: CandidateScorer | undefined,
): ScoreLayerToken | undefined {
  if (scorer === undefined) return COMPATIBILITY_SCORE_LAYER
  if (scorer === goodProposalScorer) return GOOD_PROPOSAL_SCORE_LAYER
  if (scorer === goodProposalVoteScorer) {
    return GOOD_PROPOSAL_VOTE_SCORE_LAYER
  }
  if (scorer === seededGoodProposalVoteScorer) {
    return SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER
  }
  if (scorer === roleObjectiveScorer) return GOOD_ROLE_SCORE_LAYER
  if (scorer === seededRoleObjectiveScorer) {
    return SEEDED_GOOD_ROLE_SCORE_LAYER
  }
  return undefined
}

/** A2 owns proposal and vote scoring only; later families own other decisions. */
export function goodScoreLayersApplyToDecision(
  kind: DecisionKind,
): kind is 'propose' | 'vote' {
  return kind === 'propose' || kind === 'vote'
}

const REMOVED_VALUE = -Number.MAX_SAFE_INTEGER

function requirementFor(
  context: {
    readonly request: { readonly kind: string }
    readonly view: { readonly alignment: string }
  },
  supportsVote: boolean,
): readonly ScoreLayerAnalysisRef[] {
  if (context.view.alignment !== 'good') return Object.freeze([])
  if (context.request.kind === 'propose') {
    return Object.freeze([GOOD_PROPOSAL_ANALYSIS])
  }
  if (supportsVote && context.request.kind === 'vote') {
    return Object.freeze([GOOD_VOTE_ANALYSIS])
  }
  return Object.freeze([])
}

const sameNumbers = (
  left: readonly number[],
  right: readonly number[],
): boolean => left.length === right.length
  && left.every((value, index) => value === right[index])

const canonicalTeam = (team: readonly number[]): readonly number[] =>
  [...team].sort((left, right) => left - right)

function admitsProposal(
  context: ScoreLayerAnalysisAdmissionContext,
): boolean {
  if (
    context.request.kind !== 'propose'
    || context.view.alignment !== 'good'
    || context.requirements.length !== 1
    || context.requirements[0].id !== GOOD_PROPOSAL_ANALYSIS.id
    || context.requirements[0].version !== GOOD_PROPOSAL_ANALYSIS.version
    || context.analysis.policyCandidateAssessments.length
      !== context.candidates.length
  ) return false
  const byId = new Map(
    context.analysis.policyCandidateAssessments.map((entry) => [
      entry.candidateId,
      entry,
    ]),
  )
  return byId.size === context.candidates.length
    && context.candidates.every((candidate) => {
      if (candidate.decision.kind !== 'propose') return false
      const assessment = byId.get(candidate.id)
      return !!assessment
        && sameNumbers(
          assessment.team,
          canonicalTeam(candidate.decision.team),
        )
        && assessment.beliefThroughSeq === context.analysis.throughSeq
        && assessment.cleanProbability
          === assessment.evilCountDistribution[0]
    })
}

type VoteContext = Pick<
  ScoreLayerApplicabilityContext,
  'request' | 'view' | 'analysis' | 'hypotheticalTeamCandidates'
>

function voteUtility(context: VoteContext) {
  const projection = context.analysis.goodVote
  const surface = context.hypotheticalTeamCandidates
  if (
    context.request.kind !== 'vote'
    || context.view.alignment !== 'good'
    || !projection
    || projection.version !== GOOD_VOTE_SITUATION_VERSION
    || projection.beliefThroughSeq !== context.analysis.throughSeq
    || !surface?.length
    || !context.view.currentTeam?.length
  ) throw new Error('good vote layer requires a complete projection')

  const expected = new Map<string, readonly number[]>()
  for (const candidate of surface) {
    if (candidate.decision.kind !== 'propose' || expected.has(candidate.id)) {
      throw new Error('good vote layer received an invalid team surface')
    }
    expected.set(candidate.id, canonicalTeam(candidate.decision.team))
  }
  const assessments = new Map(
    context.analysis.policyCandidateAssessments.map((assessment) => [
      assessment.candidateId,
      assessment,
    ]),
  )
  if (
    assessments.size !== context.analysis.policyCandidateAssessments.length
    || assessments.size !== expected.size
  ) throw new Error('good vote layer requires every legal team')
  for (const [candidateId, team] of expected) {
    const assessment = assessments.get(candidateId)
    if (
      !assessment
      || !sameNumbers(assessment.team, team)
      || assessment.beliefModelVersion !== projection.beliefModelVersion
      || assessment.beliefThroughSeq !== projection.beliefThroughSeq
      || assessment.probabilitySemantics
        !== projection.probabilitySemantics
    ) throw new Error('good vote assessment join mismatch')
  }
  const currentTeam = canonicalTeam(context.view.currentTeam)
  const currentMatches = [...expected].filter(([, team]) =>
    sameNumbers(team, currentTeam))
  const alternatives = [...assessments.values()]
    .filter((entry) => entry.candidateId !== projection.currentCandidateId)
    .sort((left, right) =>
      right.cleanProbability - left.cleanProbability
      || left.candidateId.localeCompare(right.candidateId))
  const best = alternatives[0]
  if (
    currentMatches.length !== 1
    || projection.currentCandidateId !== currentMatches[0][0]
    || !sameNumbers(projection.currentTeam.team, currentTeam)
    || !best
    || projection.bestAlternative.candidateId !== best.candidateId
    || !sameNumbers(projection.bestAlternative.team, best.team)
    || projection.bestAlternative.cleanProbability !== best.cleanProbability
    || projection.currentTeam.cleanProbability
      !== context.analysis.currentTeam?.cleanProbability
  ) throw new Error('good vote situation join mismatch')

  const constants = GOOD_VOTE_UTILITY_CONSTANTS
  const futureQuestsRemain =
    context.view.round < context.view.quests.length
    && !context.analysis.matchPoint.good
    && !context.analysis.matchPoint.evil
  const stake = 1
    + (context.analysis.matchPoint.good ? constants.matchPointStakeBonus : 0)
    + (context.analysis.matchPoint.evil ? constants.matchPointStakeBonus : 0)
  const alternativeRealization =
    constants.alternativeRealizationBase
    + constants.alternativeRealizationPerRejection
      * context.analysis.rejectionsBeforeHammer
  const hammerPenalty =
    constants.hammerPenaltyScale
      * (1 - context.analysis.rejectionsBeforeHammer / 4)
    + (
      context.analysis.rejectionsBeforeHammer === 1
        ? constants.nextHammerPenalty
        : 0
    )
  const informationBonus = futureQuestsRemain
    ? constants.informationBonusScale
      * (1 - projection.currentTeam.cleanProbability)
    : 0
  return Object.freeze({
    informationBonus,
    approveUtility:
      stake * projection.currentTeam.cleanProbability + informationBonus,
    rejectUtility:
      stake * best.cleanProbability * alternativeRealization - hammerPenalty,
  })
}

function admitsVote(
  context: ScoreLayerAnalysisAdmissionContext,
): boolean {
  if (
    context.requirements.length !== 1
    || context.requirements[0].id !== GOOD_VOTE_ANALYSIS.id
    || context.requirements[0].version !== GOOD_VOTE_ANALYSIS.version
  ) return false
  try {
    voteUtility(context)
    return true
  } catch {
    return false
  }
}

function admitsGood(
  context: ScoreLayerAnalysisAdmissionContext,
  supportsVote: boolean,
): boolean {
  if (context.requirements.length === 0) return true
  if (context.request.kind === 'propose') return admitsProposal(context)
  return supportsVote && admitsVote(context)
}

function compatibilityRows(
  context: ScoreLayerExecutionContext,
): readonly ScoreLayerRowDraft[] {
  const allowed = new Set(context.forced.allowedCandidateIds)
  return context.candidates.map((candidate, index) => {
    const viable = allowed.has(candidate.id)
    const compatibility =
      candidate.id === context.compatibilityCandidateId
    return {
      candidateId: candidate.id,
      value: viable
        ? (compatibility ? 1_000_000 : -index)
        : REMOVED_VALUE,
      viable,
      reasonCodes: [
        viable ? 'FORCED_POLICY_ALLOWED' : 'FORCED_POLICY_REMOVED',
        ...(compatibility ? ['COMPATIBILITY_CHOICE'] : []),
      ],
    }
  })
}

const compatibilityRootDefinition: ScoreLayerRootDefinition = {
  kind: 'root',
  token: COMPATIBILITY_SCORE_LAYER,
  requiredComponents: Object.freeze([]),
  analysisRequirements: () => Object.freeze([]),
  admitAnalysis: ({ requirements }) => requirements.length === 0,
  execute(context) {
    return {
      status: 'generated',
      surface: context.surface.create({
        scores: compatibilityRows(context),
        survivorCandidateIds: context.forced.allowedCandidateIds,
      }),
    }
  },
}
const compatibilityRoot = Object.freeze(compatibilityRootDefinition)

type GoodMode = 'proposal-only' | 'top-utility' | 'seeded-band'

function goodDefinition(
  token: ScoreLayerToken,
  mode: GoodMode,
): ScoreLayerTransformDefinition {
  const supportsVote = mode !== 'proposal-only'
  const definition: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token,
    predecessor: COMPATIBILITY_SCORE_LAYER,
    requiredComponents: Object.freeze([]),
    degradationCode: `${token.id}-failed`,
    analysisRequirements: (context) =>
      requirementFor(context, supportsVote),
    admitAnalysis: (context) => admitsGood(context, supportsVote),
    applies: (context) =>
      context.view.alignment === 'good'
      && (
        context.request.kind === 'propose'
        || (supportsVote && context.request.kind === 'vote')
      ),
    execute(context) {
      const deterministicRows = deterministicGoodBaseRows(context)
      if (context.request.kind === 'propose') {
        return {
          status: 'applied',
          surface: context.surface.create({
            scores: deterministicRows,
            survivorCandidateIds: context.prior.survivorCandidateIds,
          }),
        }
      }
      if (!supportsVote || context.request.kind !== 'vote') {
        throw new Error('good score layer executed outside applicability')
      }
      if (mode !== 'seeded-band') {
        return {
          status: 'applied',
          surface: context.surface.create({
            scores: deterministicRows,
            survivorCandidateIds: context.prior.survivorCandidateIds,
          }),
        }
      }
      const allowed = new Set(context.forced.allowedCandidateIds)
      const allowedRows = deterministicRows.filter((row) =>
        allowed.has(row.candidateId))
      const utility = voteUtility(context)
      const inBand =
        Math.abs(utility.approveUtility - utility.rejectUtility)
          <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
      const bandActive = inBand && allowedRows.length > 1
      const maxBase = Math.max(...allowedRows.map((row) => row.value))
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
      const seededVote = seedBucket === 0 ? 'approve' : 'reject'
      return {
        status: 'applied',
        surface: context.surface.create({
          scores: context.candidates.map((candidate, index) => {
            if (candidate.decision.kind !== 'vote') {
              throw new Error('mixed vote candidate')
            }
            const base = deterministicRows[index]
            if (!base || base.candidateId !== candidate.id) {
              throw new Error('good vote base row join mismatch')
            }
            const forcedAllowed = allowed.has(candidate.id)
            const selectedBySeed =
              bandActive && candidate.decision.vote === seededVote
            const selectionAdjustment = selectedBySeed
              ? maxBase - base.value + 1e-9
              : 0
            return {
              ...base,
              value: forcedAllowed
                ? base.value + selectionAdjustment
                : REMOVED_VALUE,
              viable: forcedAllowed && (bandActive || base.viable),
              reasonCodes: bandActive
                ? [
                    ...base.reasonCodes.filter((reason) =>
                      reason !== 'GOOD_VOTE_TOP_UTILITY'),
                    'GOOD_VOTE_SEEDED_VIABLE_BAND',
                  ]
                : base.reasonCodes,
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  }
  return Object.freeze(definition)
}

function deterministicGoodBaseRows(
  context: ScoreLayerTransformContext,
): readonly ScoreLayerRowDraft[] {
  const allowed = new Set(context.forced.allowedCandidateIds)
  if (context.request.kind === 'propose') {
    const assessments = new Map(
      context.analysis.policyCandidateAssessments.map((entry) => [
        entry.candidateId,
        entry,
      ]),
    )
    const base = context.candidates.map((candidate) => {
      if (candidate.decision.kind !== 'propose') {
        throw new Error('good base received mixed proposal candidates')
      }
      const assessment = assessments.get(candidate.id)
      if (!assessment) throw new Error('good base assessment missing')
      const forcedAllowed = allowed.has(candidate.id)
      return {
        candidateId: candidate.id,
        value: forcedAllowed ? assessment.cleanProbability : REMOVED_VALUE,
        viable: forcedAllowed,
        reasonCodes: [
          forcedAllowed
            ? 'FORCED_POLICY_ALLOWED'
            : 'FORCED_POLICY_REMOVED',
          'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
        ],
      }
    })
    const viable = base.filter((row) => row.viable)
    const max = Math.max(...viable.map((row) => row.value))
    const topIds = viable
      .filter((row) => row.value === max)
      .map((row) => row.candidateId)
      .sort()
    return base.map((row) => ({
      ...row,
      reasonCodes: [
        ...row.reasonCodes,
        ...(row.viable && row.value === max
          ? ['GOOD_PROPOSAL_MAX_TEAM_CLEAN']
          : []),
        ...(topIds.length > 1 && row.candidateId === topIds[0]
          ? ['GOOD_PROPOSAL_CANONICAL_TIE_BREAK']
          : []),
      ],
    }))
  }
  if (context.request.kind !== 'vote') {
    throw new Error('good role base requires proposal or vote')
  }
  const utility = voteUtility(context)
  const values = {
    approve: utility.approveUtility,
    reject: utility.rejectUtility,
  } as const
  const allowedCandidates = context.candidates.filter((candidate) =>
    allowed.has(candidate.id))
  if (
    context.candidates.length !== 2
    || !allowedCandidates.length
  ) throw new Error('good vote base requires complete vote surface')
  const max = Math.max(...allowedCandidates.map((candidate) => {
    if (candidate.decision.kind !== 'vote') {
      throw new Error('good base received mixed vote candidates')
    }
    return values[candidate.decision.vote]
  }))
  const topId = allowedCandidates.filter((candidate) =>
    candidate.decision.kind === 'vote'
    && values[candidate.decision.vote] === max)
    .map((candidate) => candidate.id)
    .sort()[0]
  return context.candidates.map((candidate) => {
    if (candidate.decision.kind !== 'vote') {
      throw new Error('good base received mixed vote candidates')
    }
    const forcedAllowed = allowed.has(candidate.id)
    const viable = forcedAllowed && candidate.id === topId
    return {
      candidateId: candidate.id,
      value: forcedAllowed
        ? values[candidate.decision.vote]
        : REMOVED_VALUE,
      viable,
      reasonCodes: [
        forcedAllowed ? 'FORCED_POLICY_ALLOWED' : 'FORCED_POLICY_REMOVED',
        'GOOD_VOTE_CURRENT_TEAM_JOINT_CLEAN',
        'GOOD_VOTE_BEST_ALTERNATIVE_JOINT_CLEAN',
        'GOOD_VOTE_BOARD_STAKES',
        'GOOD_VOTE_PROPOSAL_RUNWAY',
        'GOOD_VOTE_HAMMER_RISK',
        ...(utility.informationBonus > 0
          ? ['GOOD_VOTE_INFORMATION_FUTURE_QUEST']
          : []),
        ...(viable ? ['GOOD_VOTE_TOP_UTILITY'] : []),
      ],
    }
  })
}

function roleDefinition(
  token: ScoreLayerToken,
  predecessor: ScoreLayerToken,
  seeded: boolean,
): ScoreLayerTransformDefinition {
  const definition: ScoreLayerTransformDefinition = {
    kind: 'transform',
    token,
    predecessor,
    requiredComponents: Object.freeze([GOOD_ROLE_UTILITY_COMPONENT]),
    degradationCode: `${token.id}-failed`,
    analysisRequirements: (context) => requirementFor(context, true),
    admitAnalysis: (context) => admitsGood(context, true),
    applies: (context) =>
      (context.request.kind === 'propose' || context.request.kind === 'vote')
      && (context.view.role === 'merlin' || context.view.role === 'percival'),
    execute(context: ScoreLayerTransformContext) {
      const projection: PrivateRoleUtilityProjection =
        context.components.require(GOOD_ROLE_UTILITY_COMPONENT)
      if (
        projection.version !== ROLE_UTILITY_PROJECTION_VERSION
        || projection.role !== context.view.role
        || projection.request.kind !== context.request.kind
        || projection.request.seat !== context.request.seat
        || projection.request.round !== context.request.round
        || projection.request.proposalNum !== context.request.proposalNum
        || projection.source.beliefThroughSeq !== context.analysis.throughSeq
      ) throw new Error('good role layer component join mismatch')
      const utilityById = new Map(
        projection.assessments.map((entry) => [entry.candidateId, entry]),
      )
      const deterministicBase = deterministicGoodBaseRows(context)
      const priorById = new Map(
        deterministicBase.map((row) => [row.candidateId, row]),
      )
      if (
        utilityById.size !== context.candidates.length
        || priorById.size !== context.candidates.length
      ) throw new Error('good role layer requires complete surfaces')
      const allowed = new Set(context.forced.allowedCandidateIds)
      const survivors = context.candidates.filter((candidate) =>
        allowed.has(candidate.id))
      const survivorMean = survivors.reduce((sum, candidate) => {
        const utility = utilityById.get(candidate.id)
        if (!utility) throw new Error('good role utility join mismatch')
        return sum + utility.roleValue
      }, 0) / survivors.length
      const rows = context.candidates.map((candidate) => {
        const utility = utilityById.get(candidate.id)
        const base = priorById.get(candidate.id)
        if (
          !utility
          || !base
          || utility.kind !== context.request.kind
          || utility.role !== context.view.role
        ) throw new Error('good role row join mismatch')
        const roleAdjustment =
          ROLE_OBJECTIVE_UTILITY_CONSTANTS.centeredAdjustmentScale
          * (utility.roleValue - survivorMean)
        return {
          candidate,
          base,
          combinedValue: base.value + roleAdjustment,
        }
      })
      const allowedRows = rows.filter(({ candidate }) =>
        allowed.has(candidate.id))
      const maxCombined = Math.max(
        ...allowedRows.map((row) => row.combinedValue),
      )
      const canonicalTopId = allowedRows
        .filter((row) => row.combinedValue === maxCombined)
        .map((row) => row.candidate.id)
        .sort()[0]
      const forcedSelection = context.forced.selectedCandidateId
      const voteRows = context.request.kind === 'vote' ? allowedRows : []
      const inBand = voteRows.length === 2
        && Math.abs(
          voteRows[0].combinedValue - voteRows[1].combinedValue,
        ) <= ROLE_OBJECTIVE_UTILITY_CONSTANTS.viableBand
      const bandActive = !forcedSelection && seeded && inBand
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
      const seededVote = seedBucket === 0 ? 'approve' : 'reject'
      return {
        status: 'applied',
        surface: context.surface.create({
          scores: rows.map((row) => {
            const forcedAllowed = allowed.has(row.candidate.id)
            const selectedBySeed =
              bandActive
              && row.candidate.decision.kind === 'vote'
              && row.candidate.decision.vote === seededVote
            const selectionAdjustment = selectedBySeed
              ? maxCombined - row.combinedValue + 1e-9
              : 0
            const viable = forcedAllowed && (
              forcedSelection
                ? row.candidate.id === forcedSelection
                : bandActive || row.candidate.id === canonicalTopId
            )
            return {
              candidateId: row.candidate.id,
              value: forcedAllowed
                ? row.combinedValue + selectionAdjustment
                : REMOVED_VALUE,
              viable,
              reasonCodes: [
                forcedAllowed
                  ? 'FORCED_POLICY_ALLOWED'
                  : 'FORCED_POLICY_REMOVED',
                ...row.base.reasonCodes.filter((reason) =>
                  reason !== 'GOOD_VOTE_TOP_UTILITY'
                  && reason !== 'GOOD_VOTE_SEEDED_VIABLE_BAND'
                  && reason !== 'GOOD_PROPOSAL_MAX_TEAM_CLEAN'
                  && reason !== 'GOOD_PROPOSAL_CANONICAL_TIE_BREAK'),
                'PRIVATE_ROLE_OBJECTIVE_COMPOSITE',
                ...(viable ? ['PRIVATE_ROLE_OBJECTIVE_SELECTED_SET'] : []),
                ...(bandActive
                  ? ['PRIVATE_ROLE_OBJECTIVE_SEEDED_BAND']
                  : []),
              ],
            }
          }),
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  }
  return Object.freeze(definition)
}

const definitions: readonly ScoreLayerDefinition[] = Object.freeze([
  compatibilityRoot,
  goodDefinition(GOOD_PROPOSAL_SCORE_LAYER, 'proposal-only'),
  goodDefinition(GOOD_PROPOSAL_VOTE_SCORE_LAYER, 'top-utility'),
  goodDefinition(
    SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
    'seeded-band',
  ),
  roleDefinition(
    GOOD_ROLE_SCORE_LAYER,
    GOOD_PROPOSAL_VOTE_SCORE_LAYER,
    false,
  ),
  roleDefinition(
    SEEDED_GOOD_ROLE_SCORE_LAYER,
    SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
    true,
  ),
])

export function createGoodScoreLayerRegistry() {
  return createScoreLayerRegistry(definitions)
}
