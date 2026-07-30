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
} from '../components/native-score-components.ts'
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
  GOOD_PROPOSAL_FEATURE_VERSION,
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
  GOOD_VOTE_FEATURE_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  GOOD_VOTE_UTILITY_VERSION,
  goodVoteValue,
  ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SEEDED_SCORER_VERSION,
  ROLE_OBJECTIVE_UTILITY_CONSTANTS,
  stablePolicyBucket,
  type GoodProposalFeatures,
  type GoodVoteFeatures,
  type GoodVoteUtilityVersion,
} from '../policy/good-score-contract.ts'
import {
  boardSwingGoodProposalVoteScorer,
  goodProposalScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededRoleObjectiveScorer,
  type CandidateScorer,
} from '../policy/score.ts'
import { sequenceEqual } from '../components/canonical-shape.ts'
import { SEEDED_SELECTION_MARGIN } from '../components/probability-arithmetic.ts'
import { compareCandidateIds } from '../policy/candidates.ts'
import { calculateCompatibilityBase } from '../policy/compatibility-score.ts'
import type { DecisionKind } from '../../engine/types.ts'
import { canonicalTeam } from '../../engine/seatset.ts'

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
/**
 * NB-013. Same deterministic selection as the top-utility layer; the one
 * difference is that its vote value prices the board slot each branch risks, so
 * approving a possibly dirty team finally costs something.
 */
export const GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER = scoreLayerToken(
  'good-proposal-vote-board-swing-score',
  GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION,
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
  if (scorer === boardSwingGoodProposalVoteScorer) {
    return GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER
  }
  if (scorer === roleObjectiveScorer) return GOOD_ROLE_SCORE_LAYER
  if (scorer === seededRoleObjectiveScorer) {
    return SEEDED_GOOD_ROLE_SCORE_LAYER
  }
  return undefined
}

/** The total compatibility root owns every decision kind. */
export function goodScoreLayersApplyToDecision(
  _kind: DecisionKind,
): boolean {
  return true
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
        && sequenceEqual(
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

interface GoodVoteUtilityInputs {
  readonly currentTeam: readonly number[]
  readonly currentCleanProbability: number
  readonly currentEvilCountDistribution: readonly number[]
  readonly bestAlternativeCandidateId: string
  readonly bestAlternativeTeam: readonly number[]
  readonly bestAlternativeCleanProbability: number
  readonly bestAlternativeEvilCountDistribution: readonly number[]
  readonly futureQuestsRemain: boolean
  readonly stake: number
  readonly alternativeRealization: number
  readonly hammerPenalty: number
  readonly informationBonus: number
  readonly dirtyApprovalCost: number
  readonly approveUtility: number
  readonly rejectUtility: number
}

function voteUtility(
  context: VoteContext | DeterministicGoodBaseContext,
  utilityVersion: GoodVoteUtilityVersion,
): GoodVoteUtilityInputs {
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
      || !sequenceEqual(assessment.team, team)
      || assessment.beliefModelVersion !== projection.beliefModelVersion
      || assessment.beliefThroughSeq !== projection.beliefThroughSeq
      || assessment.probabilitySemantics
        !== projection.probabilitySemantics
    ) throw new Error('good vote assessment join mismatch')
  }
  const currentTeam = canonicalTeam(context.view.currentTeam)
  const currentMatches = [...expected].filter(([, team]) =>
    sequenceEqual(team, currentTeam))
  const alternatives = [...assessments.values()]
    .filter((entry) => entry.candidateId !== projection.currentCandidateId)
    .sort((left, right) =>
      right.cleanProbability - left.cleanProbability
      || compareCandidateIds(left.candidateId, right.candidateId))
  const best = alternatives[0]
  if (
    currentMatches.length !== 1
    || projection.currentCandidateId !== currentMatches[0][0]
    || !sequenceEqual(projection.currentTeam.team, currentTeam)
    || projection.currentTeam.cleanProbability
      !== context.analysis.currentTeam?.cleanProbability
  ) throw new Error('good vote situation join mismatch')
  if (
    !best
    || projection.bestAlternative.candidateId !== best.candidateId
    || !sequenceEqual(projection.bestAlternative.team, best.team)
    || projection.bestAlternative.cleanProbability !== best.cleanProbability
  ) throw new Error('good vote best-alternative join mismatch')

  const futureQuestsRemain =
    context.view.round < context.view.quests.length
    && !context.analysis.matchPoint.good
    && !context.analysis.matchPoint.evil
  const value = goodVoteValue({
    currentCleanProbability: projection.currentTeam.cleanProbability,
    bestAlternativeCleanProbability: best.cleanProbability,
    matchPointGood: context.analysis.matchPoint.good,
    matchPointEvil: context.analysis.matchPoint.evil,
    futureQuestsRemain,
    rejectionsBeforeHammer: context.analysis.rejectionsBeforeHammer,
  }, utilityVersion)
  return Object.freeze({
    currentTeam,
    currentCleanProbability: projection.currentTeam.cleanProbability,
    currentEvilCountDistribution:
      projection.currentTeam.evilCountDistribution,
    bestAlternativeCandidateId: projection.bestAlternative.candidateId,
    bestAlternativeTeam: projection.bestAlternative.team,
    bestAlternativeCleanProbability:
      projection.bestAlternative.cleanProbability,
    bestAlternativeEvilCountDistribution:
      projection.bestAlternative.evilCountDistribution,
    futureQuestsRemain,
    stake: value.stake,
    alternativeRealization: value.alternativeRealization,
    hammerPenalty: value.hammerPenalty,
    informationBonus: value.informationBonus,
    dirtyApprovalCost: value.dirtyApprovalCost,
    approveUtility: value.approveUtility,
    rejectUtility: value.rejectUtility,
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
    // Both utility versions read the same joined inputs, so either one proves
    // the projection joins. This checks the joins, not the value function.
    voteUtility(context, GOOD_VOTE_UTILITY_VERSION)
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
  return calculateCompatibilityBase({
    candidates: context.candidates,
    allowedCandidateIds: context.candidateBoundary.survivorCandidateIds,
    compatibilityCandidateId: context.compatibilityCandidateId,
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
        survivorCandidateIds:
          context.candidateBoundary.survivorCandidateIds,
      }),
    }
  },
}
const compatibilityRoot = Object.freeze(compatibilityRootDefinition)

type GoodMode = 'proposal-only' | 'top-utility' | 'seeded-band'

function goodDefinition(
  token: ScoreLayerToken,
  mode: GoodMode,
  utilityVersion: GoodVoteUtilityVersion = GOOD_VOTE_UTILITY_VERSION,
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
    applies: () => true,
    execute(context) {
      const inScope =
        context.view.alignment === 'good'
        && (
          context.request.kind === 'propose'
          || (supportsVote && context.request.kind === 'vote')
        )
      if (!inScope) {
        const reason = mode === 'proposal-only'
          ? 'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY'
          : 'GOOD_POLICY_OUT_OF_SCOPE_COMPATIBILITY'
        return {
          status: 'applied',
          surface: context.surface.create({
            scores: context.prior.scores.map((row) => ({
              candidateId: row.candidateId,
              value: row.value,
              viable: row.viable,
              reasonCodes: [...row.reasonCodes, reason],
            })),
            survivorCandidateIds: context.prior.survivorCandidateIds,
          }),
        }
      }
      const deterministicRows =
        calculateGoodPolicyRows(context, mode, utilityVersion)
          .map((row) => row.score)
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
      return {
        status: 'applied',
        surface: context.surface.create({
          scores: deterministicRows,
          survivorCandidateIds: context.prior.survivorCandidateIds,
        }),
      }
    },
  }
  return Object.freeze(definition)
}

export interface DeterministicGoodBaseRow {
  readonly score: ScoreLayerRowDraft
  readonly baseValue: number
  readonly features: GoodProposalFeatures | GoodVoteFeatures
}

export interface DeterministicGoodBase {
  readonly version: 'deterministic-good-base-v1'
  readonly rows: readonly DeterministicGoodBaseRow[]
}

export type DeterministicGoodBaseContext = Pick<
  ScoreLayerTransformContext,
  | 'request'
  | 'view'
  | 'analysis'
  | 'candidates'
  | 'candidateBoundary'
  | 'forced'
> & {
  readonly hypotheticalTeamCandidates?:
    ScoreLayerTransformContext['hypotheticalTeamCandidates']
}

/**
 * One typed owner for deterministic Phase 4 mechanics and their exact
 * historical feature inputs. C2 consumes this base before applying its own
 * role adjustment; compatibility projection may read features but cannot
 * change the score rows.
 */
export function calculateDeterministicGoodBase(
  context: DeterministicGoodBaseContext,
  // Required rather than defaulted: NB-013 made the value function part of the
  // policy identity, and a caller that silently inherited the symmetric one
  // would publish its numbers under whichever identity it was restating.
  utilityVersion: GoodVoteUtilityVersion,
): DeterministicGoodBase {
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
  if (context.request.kind === 'propose') {
    const assessments = new Map(
      context.analysis.policyCandidateAssessments.map((entry) => [
        entry.candidateId,
        entry,
      ]),
    )
    if (
      assessments.size !== context.analysis.policyCandidateAssessments.length
      || assessments.size !== context.candidates.length
    ) throw new Error('good base assessment mismatch')
    const base = context.candidates.map((candidate) => {
      if (candidate.decision.kind !== 'propose') {
        throw new Error('good base received mixed proposal candidates')
      }
      const assessment = assessments.get(candidate.id)
      if (
        !assessment
        || !sequenceEqual(
          canonicalTeam(candidate.decision.team),
          assessment.team,
        )
      ) throw new Error('good base assessment mismatch')
      const forcedAllowed = allowed.has(candidate.id)
      return {
        score: {
          candidateId: candidate.id,
          value: forcedAllowed
            ? assessment.cleanProbability
            : REMOVED_VALUE,
          viable: forcedAllowed,
          reasonCodes: [
            forcedAllowed
              ? 'FORCED_POLICY_ALLOWED'
              : 'FORCED_POLICY_REMOVED',
            'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
          ],
        },
        baseValue: assessment.cleanProbability,
        features: {
          version: GOOD_PROPOSAL_FEATURE_VERSION,
          semantics: assessment.probabilitySemantics,
          beliefModelVersion: assessment.beliefModelVersion,
          beliefThroughSeq: assessment.beliefThroughSeq,
          team: canonicalTeam(candidate.decision.team),
          cleanProbability: assessment.cleanProbability,
          evilCountDistribution: assessment.evilCountDistribution,
        } satisfies GoodProposalFeatures,
      }
    })
    const viable = base.filter((row) => row.score.viable)
    const max = Math.max(...viable.map((row) => row.score.value))
    const topIds = viable
      .filter((row) => row.score.value === max)
      .map((row) => row.score.candidateId)
      .sort(compareCandidateIds)
    return Object.freeze({
      version: 'deterministic-good-base-v1',
      rows: Object.freeze(base.map((row) => Object.freeze({
        ...row,
        score: Object.freeze({
          ...row.score,
          reasonCodes: Object.freeze([
            ...row.score.reasonCodes,
            ...(row.score.viable && row.score.value === max
              ? ['GOOD_PROPOSAL_MAX_TEAM_CLEAN']
              : []),
            ...(topIds.length > 1
              && row.score.candidateId === topIds[0]
              ? ['GOOD_PROPOSAL_CANONICAL_TIE_BREAK']
              : []),
          ]),
        }),
      }))),
    })
  }
  if (context.request.kind !== 'vote') {
    throw new Error('good role base requires proposal or vote')
  }
  const utility = voteUtility(context, utilityVersion)
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
    .sort(compareCandidateIds)[0]
  const inViableBand =
    Math.abs(utility.approveUtility - utility.rejectUtility)
      <= GOOD_VOTE_UTILITY_CONSTANTS.viableBand
  return Object.freeze({
    version: 'deterministic-good-base-v1',
    rows: Object.freeze(context.candidates.map((candidate) => {
    if (candidate.decision.kind !== 'vote') {
      throw new Error('good base received mixed vote candidates')
    }
    const forcedAllowed = allowed.has(candidate.id)
    const viable = forcedAllowed && candidate.id === topId
    const baseValue = values[candidate.decision.vote]
    return Object.freeze({
      score: Object.freeze({
        candidateId: candidate.id,
        value: forcedAllowed ? baseValue : REMOVED_VALUE,
        viable,
        reasonCodes: Object.freeze([
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
        ]),
      }),
      baseValue,
      features: Object.freeze({
        version: GOOD_VOTE_FEATURE_VERSION,
        utilityVersion,
        situationVersion: GOOD_VOTE_SITUATION_VERSION,
        semantics: context.analysis.goodVote!.probabilitySemantics,
        beliefModelVersion:
          context.analysis.goodVote!.beliefModelVersion,
        beliefThroughSeq: context.analysis.throughSeq,
        currentTeam: utility.currentTeam,
        currentCleanProbability: utility.currentCleanProbability,
        currentEvilCountDistribution:
          utility.currentEvilCountDistribution,
        bestAlternativeCandidateId:
          utility.bestAlternativeCandidateId,
        bestAlternativeTeam: utility.bestAlternativeTeam,
        bestAlternativeCleanProbability:
          utility.bestAlternativeCleanProbability,
        bestAlternativeEvilCountDistribution:
          utility.bestAlternativeEvilCountDistribution,
        boardScore: { ...context.analysis.score },
        proposalNumber: context.analysis.proposalNumber,
        rejectionsBeforeHammer:
          context.analysis.rejectionsBeforeHammer,
        futureQuestsRemain: utility.futureQuestsRemain,
        stake: utility.stake,
        alternativeRealization: utility.alternativeRealization,
        hammerPenalty: utility.hammerPenalty,
        informationBonus: utility.informationBonus,
        approveUtility: utility.approveUtility,
        rejectUtility: utility.rejectUtility,
        baseUtility: baseValue,
        selectionAdjustment: 0,
        selectionMode: 'top-utility',
        viableBand: GOOD_VOTE_UTILITY_CONSTANTS.viableBand,
        inViableBand,
      } satisfies GoodVoteFeatures),
    })
  })),
  })
}

/** Typed historical diagnostic projection backed by the good-family base. */
export function calculateGoodProposalCandidateScores(
  context: DeterministicGoodBaseContext,
) {
  // Proposal-only: this projection never reaches a vote, so the vote value
  // function cannot be causal and the symmetric one is the truthful label.
  return calculateDeterministicGoodBase(
    context,
    GOOD_VOTE_UTILITY_VERSION,
  ).rows.map((row) => ({
    version: GOOD_PROPOSAL_SCORER_VERSION,
    ...row.score,
    features: structuredClone(row.features),
  }))
}

type GoodPolicyCalculationContext = DeterministicGoodBaseContext & {
  readonly deterministicSeed: string
}

function calculateGoodPolicyRows(
  context: GoodPolicyCalculationContext,
  mode: GoodMode,
  utilityVersion: GoodVoteUtilityVersion,
): readonly DeterministicGoodBaseRow[] {
  const base = calculateDeterministicGoodBase(context, utilityVersion)
  if (
    context.request.kind !== 'vote'
    || mode !== 'seeded-band'
  ) return base.rows
  const allowed = new Set(
    context.candidateBoundary.survivorCandidateIds,
  )
  const allowedRows = base.rows.filter((row) =>
    allowed.has(row.score.candidateId))
  const features = base.rows[0]?.features
  if (!features || features.version !== GOOD_VOTE_FEATURE_VERSION) {
    throw new Error('seeded good vote requires vote features')
  }
  const bandActive =
    features.inViableBand && allowedRows.length > 1
  const maxBase = Math.max(
    ...allowedRows.map((row) => row.score.value),
  )
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
  return base.rows.map((row, index) => {
    const candidate = context.candidates[index]
    if (
      !candidate
      || candidate.id !== row.score.candidateId
      || candidate.decision.kind !== 'vote'
      || row.features.version !== GOOD_VOTE_FEATURE_VERSION
    ) throw new Error('seeded good vote base row join mismatch')
    const forcedAllowed = allowed.has(candidate.id)
    const selectedBySeed =
      bandActive && candidate.decision.vote === seededVote
    const selectionAdjustment = selectedBySeed
      ? maxBase - row.score.value + SEEDED_SELECTION_MARGIN
      : 0
    return Object.freeze({
      baseValue: row.baseValue,
      score: Object.freeze({
        ...row.score,
        value: forcedAllowed
          ? row.score.value + selectionAdjustment
          : REMOVED_VALUE,
        viable: forcedAllowed && (bandActive || row.score.viable),
        reasonCodes: Object.freeze(bandActive
          ? [
              ...row.score.reasonCodes.filter((reason) =>
                reason !== 'GOOD_VOTE_TOP_UTILITY'),
              'GOOD_VOTE_SEEDED_VIABLE_BAND',
            ]
          : [...row.score.reasonCodes]),
      }),
      features: Object.freeze({
        ...row.features,
        selectionMode: 'seeded-band' as const,
        selectionAdjustment,
        ...(seedBucket === undefined ? {} : { seedBucket }),
      }),
    })
  })
}

export function calculateGoodProposalVoteCandidateScores(
  context: GoodPolicyCalculationContext,
  scorer: CandidateScorer,
) {
  const mode: GoodMode =
    scorer.version === GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION
      ? 'seeded-band'
      : (
          scorer.version === GOOD_PROPOSAL_VOTE_SCORER_VERSION
          || scorer.version === GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION
        )
        ? 'top-utility'
        : scorer.version === GOOD_PROPOSAL_SCORER_VERSION
          ? 'proposal-only'
          : (() => {
              throw new Error(`unsupported good scorer ${scorer.version}`)
            })()
  const utilityVersion: GoodVoteUtilityVersion =
    scorer.version === GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORER_VERSION
      ? GOOD_VOTE_BOARD_SWING_UTILITY_VERSION
      : GOOD_VOTE_UTILITY_VERSION
  return calculateGoodPolicyRows(context, mode, utilityVersion).map((row) => ({
    version: scorer.version,
    ...row.score,
    features: structuredClone(row.features),
  }))
}

function deterministicGoodBaseRows(
  context: ScoreLayerTransformContext,
): readonly ScoreLayerRowDraft[] {
  // The compatibility root's diagnostic base. Its rows carry no vote-value
  // identity downstream, so the symmetric utility is the truthful label.
  return calculateDeterministicGoodBase(
    context,
    GOOD_VOTE_UTILITY_VERSION,
  ).rows.map((row) => row.score)
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
      const allowed = new Set(
        context.candidateBoundary.survivorCandidateIds,
      )
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
        .sort(compareCandidateIds)[0]
      const forcedSelection =
        context.candidateBoundary.selectedCandidateId
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
              ? maxCombined - row.combinedValue + SEEDED_SELECTION_MARGIN
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
  goodDefinition(
    GOOD_PROPOSAL_VOTE_BOARD_SWING_SCORE_LAYER,
    'top-utility',
    GOOD_VOTE_BOARD_SWING_UTILITY_VERSION,
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

export function goodScoreLayerDefinitions(): readonly ScoreLayerDefinition[] {
  return definitions
}

export function createGoodScoreLayerRegistry() {
  return createScoreLayerRegistry(goodScoreLayerDefinitions())
}
