import { test } from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { assertWallClockBelow } from './helpers/performance-gate.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import type {
  BeliefSnapshot,
  HiddenWorld,
} from '../server/agents/belief/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../server/agents/policy/forced.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  GOOD_VOTE_UTILITY_CONSTANTS,
  createGoodProposalVoteScorer,
  goodProposalScorer,
  goodProposalVoteScorer,
  structuredChoice,
  validateCandidateScores,
  type CandidateScore,
  type CandidateScoringContext,
  type GoodVoteFeatures,
  type GoodVoteSelectionMode,
} from '../server/agents/policy/score.ts'
import {
  calculateGoodProposalVoteCandidateScores,
} from '../server/agents/score-layers/good.ts'
import type { ForcedPolicyResult } from '../server/agents/policy/types.ts'
import { parseExternalDecisionReply } from '../server/agents/external-reply.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'

const proposalFixture = () =>
  readDecisionFixtures().find(
    (candidate) => candidate.id === 'merlin-opening-proposal',
  )!

const scoreWith = (
  scorer: Parameters<
    typeof calculateGoodProposalVoteCandidateScores
  >[1],
  context: CandidateScoringContext,
) => calculateGoodProposalVoteCandidateScores(context, scorer)

function syntheticBelief(
  pairs: readonly {
    evil: readonly [Seat, Seat]
    probability: number
  }[],
): BeliefSnapshot {
  const worlds = pairs.map(({ evil: [left, right], probability }, index) => {
    const alignmentBySeat = Array.from(
      { length: 5 },
      (_, seat) => seat === left || seat === right ? 'evil' : 'good',
    ) as HiddenWorld['alignmentBySeat']
    const roleBySeat: readonly Role[] = [
      'assassin',
      'morgana',
      'servant',
      'percival',
      'merlin',
    ]
    return {
      world: {
        roleBySeat,
        alignmentBySeat,
        key: `vote-synthetic-${index}-${left}-${right}`,
      },
      probability,
    }
  })
  const playerMarginals = Array.from({ length: 5 }, (_, seat) => {
    const evilProbability = worlds.reduce(
      (sum, weighted) =>
        sum + (
          weighted.world.alignmentBySeat[seat] === 'evil'
            ? weighted.probability
            : 0
        ),
      0,
    )
    return {
      seat,
      goodProbability: 1 - evilProbability,
      evilProbability,
    }
  })
  return {
    throughSeq: -1,
    modelVersion: 'exact-constraints-v1',
    quality: 'constraints-only',
    worlds,
    playerMarginals,
    roleMarginals: [],
    entropy: 1,
    topWorlds: worlds,
  }
}

function goodVoteView(
  currentTeam: readonly Seat[],
  options: {
    proposalNum?: number
    decisive?: 'good' | 'evil' | 'both'
  } = {},
): PlayerView {
  const source = proposalFixture().view
  const decisive = options.decisive
  return {
    ...structuredClone(source),
    name: 'Analyst',
    role: 'servant',
    alignment: 'good',
    privateInfo: { kind: 'none' },
    phase: 'vote',
    round: decisive ? 3 : 1,
    proposalNum: options.proposalNum ?? 1,
    currentTeam: [...currentTeam],
    players: source.players.map((player) => ({ ...player })),
    events: [],
    transcript: [],
    proposals: [],
    quests: source.quests.map((quest, index) => ({
      ...quest,
      result: decisive === 'both'
        ? (index < 2 ? (index === 0 ? 'success' : 'fail') : null)
        : decisive === 'good'
          ? (index < 2 ? 'success' : null)
          : decisive === 'evil'
            ? (index < 2 ? 'fail' : null)
            : null,
    })),
  }
}

function voteContext(
  view: PlayerView,
  belief: BeliefSnapshot,
  forcedOverride?: ForcedPolicyResult,
): CandidateScoringContext {
  const request: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const candidates = legalCandidates(request, view)
  const hypotheticalTeamCandidates = hypotheticalProposalCandidates(view)
  const hypotheticalTeams = candidateTeams(hypotheticalTeamCandidates, view)
  const analysis = analyzeSituation(view, {
    belief,
    policyCandidateAssessments: hypotheticalTeams,
    goodVote: true,
  })
  const forced = forcedOverride
    ?? applyForcedPolicy(request, view, analysis, candidates)
  return {
    deterministicSeed: 'good-vote-test-seed',
    request,
    view,
    analysis,
    candidates,
    hypotheticalTeamCandidates,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      selectedCandidateId: forced.selectedCandidateId,
      reasonCodes: forced.reasonCodes,
    },
  }
}

const features = (scores: readonly CandidateScore[]): GoodVoteFeatures =>
  scores[0].features as GoodVoteFeatures

test('good vote analysis owns exact current-team and best-different-team summaries', () => {
  const belief = syntheticBelief([
    { evil: [0, 2], probability: 0.5 },
    { evil: [1, 3], probability: 0.5 },
  ])
  const context = voteContext(goodVoteView([0, 1]), belief)
  const projection = context.analysis.goodVote!

  assert.deepEqual(projection.currentTeam.team, [0, 1])
  assert.equal(projection.currentTeam.cleanProbability, 0)
  assert.notEqual(
    projection.bestAlternative.candidateId,
    projection.currentCandidateId,
  )
  assert.equal(projection.bestAlternative.cleanProbability, 0.5)
  assert.equal(
    context.analysis.policyCandidateAssessments.length,
    context.hypotheticalTeamCandidates!.length,
  )
})

test('current-team and best-alternative joint posteriors causally change vote utility', () => {
  const correlated = syntheticBelief([
    { evil: [0, 2], probability: 0.5 },
    { evil: [1, 3], probability: 0.5 },
  ])
  const spread = syntheticBelief([
    { evil: [0, 2], probability: 1 / 6 },
    { evil: [0, 3], probability: 1 / 6 },
    { evil: [0, 4], probability: 1 / 6 },
    { evil: [1, 2], probability: 1 / 6 },
    { evil: [1, 3], probability: 1 / 6 },
    { evil: [1, 4], probability: 1 / 6 },
  ])
  const first = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 1]), correlated),
  ))
  const second = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 1]), spread),
  ))
  assert.equal(first.currentCleanProbability, 0)
  assert.equal(second.currentCleanProbability, 0)
  assert.equal(first.bestAlternativeCleanProbability, 0.5)
  assert.ok(Math.abs(
    second.bestAlternativeCleanProbability - 1 / 3,
  ) < 1e-12)
  assert.ok(first.rejectUtility > second.rejectUtility)

  const safeCurrent = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 2]), spread),
  ))
  assert.ok(safeCurrent.currentCleanProbability > second.currentCleanProbability)
  assert.ok(safeCurrent.approveUtility > second.approveUtility)
})

test('board stakes, future information, runway, and hammer risk are explicit', () => {
  const belief = syntheticBelief([
    { evil: [0, 1], probability: 0.6 },
    { evil: [2, 3], probability: 0.4 },
  ])
  const early = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 1]), belief),
  ))
  const nearHammer = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 1], { proposalNum: 4 }), belief),
  ))
  const decisive = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(goodVoteView([0, 1], { decisive: 'good' }), belief),
  ))

  assert.equal(early.informationBonus, 0.018)
  assert.equal(early.alternativeRealization, 1)
  assert.equal(early.hammerPenalty, 0)
  assert.equal(structuredChoice(
    scoreWith(
      goodProposalVoteScorer,
      voteContext(goodVoteView([0, 1]), belief),
    ),
  ).candidateId.endsWith(':reject'), true)

  assert.equal(nearHammer.rejectionsBeforeHammer, 1)
  assert.equal(nearHammer.alternativeRealization, 0.79)
  assert.equal(nearHammer.hammerPenalty, 0.255)
  assert.equal(structuredChoice(
    scoreWith(
      goodProposalVoteScorer,
      voteContext(goodVoteView([0, 1], { proposalNum: 4 }), belief),
    ),
  ).candidateId.endsWith(':approve'), true)

  assert.equal(decisive.futureQuestsRemain, false)
  assert.equal(decisive.informationBonus, 0)
  assert.equal(decisive.stake, 1.5)
})

test('forced selection dominates vote utility and disables variation', () => {
  const belief = syntheticBelief([
    { evil: [0, 2], probability: 0.5 },
    { evil: [1, 3], probability: 0.5 },
  ])
  const base = voteContext(goodVoteView([0, 1]), belief)
  const approveId = base.candidates.find(
    (candidate) =>
      candidate.decision.kind === 'vote'
      && candidate.decision.vote === 'approve',
  )!.id
  const forced: ForcedPolicyResult = {
    version: 'forced-policy-v1',
    applied: true,
    reasonCodes: ['HAMMER_TEAM_AUTOMATIC'],
    allowedCandidateIds: [approveId],
    selectedCandidateId: approveId,
  }
  const context = voteContext(goodVoteView([0, 1]), belief, forced)
  const scorer = createGoodProposalVoteScorer({
    selectionMode: 'seeded-band',
  })
  const scores = scoreWith(scorer, context)
  validateCandidateScores(context, scores, scorer.version)
  assert.equal(structuredChoice(scores).candidateId, approveId)
  assert.ok(scores.every(
    (score) =>
      (score.features as GoodVoteFeatures).seedBucket === undefined,
  ))
})

test('seeded variation is replayable and changes only an in-band selection', () => {
  const belief = syntheticBelief([
    { evil: [0, 1], probability: 0.5 },
    { evil: [2, 3], probability: 0.5 },
  ])
  const context = voteContext(goodVoteView([0, 1]), belief)
  const choices = new Map<string, readonly CandidateScore[]>()
  for (let index = 0; index < 100 && choices.size < 2; index++) {
    const scorer = createGoodProposalVoteScorer({
      selectionMode: 'seeded-band',
    })
    const seededContext = {
      ...context,
      deterministicSeed: `band-seed-${index}`,
    }
    const scores = scoreWith(scorer, seededContext)
    validateCandidateScores(seededContext, scores, scorer.version)
    choices.set(structuredChoice(scores).candidateId, scores)
  }
  assert.equal(choices.size, 2)
  const [first, second] = [...choices.values()]
  assert.equal(features(first).selectionMode, 'seeded-band')
  assert.equal(features(first).inViableBand, true)
  assert.equal(features(first).approveUtility, features(second).approveUtility)
  assert.equal(features(first).rejectUtility, features(second).rejectUtility)
  assert.equal(
    features(first).bestAlternativeCleanProbability,
    features(second).bestAlternativeCleanProbability,
  )

  const replayScorer = createGoodProposalVoteScorer({
    selectionMode: 'seeded-band',
  })
  const replayContext = {
    ...context,
    deterministicSeed: 'stable-replay',
  }
  assert.deepEqual(
    scoreWith(replayScorer, replayContext),
    scoreWith(replayScorer, replayContext),
  )

  const outside = voteContext(
    goodVoteView([0, 1]),
    syntheticBelief([
      { evil: [0, 2], probability: 0.5 },
      { evil: [1, 3], probability: 0.5 },
    ]),
  )
  const outsideChoices = new Set<string>()
  let outsideBase: readonly [number, number] | undefined
  for (let index = 0; index < 20; index++) {
    const scorer = createGoodProposalVoteScorer({
      selectionMode: 'seeded-band',
    })
    const scores = scoreWith(scorer, {
      ...outside,
      deterministicSeed: `outside-${index}`,
    })
    const voteFeatures = features(scores)
    outsideChoices.add(structuredChoice(scores).candidateId)
    outsideBase ??= [
      voteFeatures.approveUtility,
      voteFeatures.rejectUtility,
    ]
    assert.deepEqual(
      [voteFeatures.approveUtility, voteFeatures.rejectUtility],
      outsideBase,
    )
    assert.equal(voteFeatures.inViableBand, false)
    assert.equal(voteFeatures.seedBucket, undefined)
    assert.equal(scores.filter((score) => score.viable).length, 1)
  }
  assert.equal(outsideChoices.size, 1)
})

test('seeded scorer snapshots its mode and rejects bucket or adjustment tampering', () => {
  const context = voteContext(
    goodVoteView([0, 1]),
    syntheticBelief([
      { evil: [0, 1], probability: 0.5 },
      { evil: [2, 3], probability: 0.5 },
    ]),
  )
  const options: { selectionMode: GoodVoteSelectionMode } = {
    selectionMode: 'seeded-band',
  }
  const scorer = createGoodProposalVoteScorer(options)
  options.selectionMode = 'top-utility'
  const scores = scoreWith(scorer, context)
  validateCandidateScores(context, scores, scorer.version)
  assert.equal(scorer.version, GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION)
  assert.ok(scores.every(
    (score) =>
      (score.features as GoodVoteFeatures).selectionMode === 'seeded-band',
  ))

  const bucketTamper = structuredClone(scores)
  for (const score of bucketTamper) {
    const voteFeatures = score.features as GoodVoteFeatures
    voteFeatures.seedBucket = voteFeatures.seedBucket === 0 ? 1 : 0
  }
  assert.throws(
    () => validateCandidateScores(context, bucketTamper, scorer.version),
    /invalid good vote selection semantics/,
  )

  const adjustmentTamper = structuredClone(scores)
  const unselected = adjustmentTamper.find(
    (score) =>
      (score.features as GoodVoteFeatures).selectionAdjustment === 0,
  )!
  const unselectedFeatures = unselected.features as GoodVoteFeatures
  unselectedFeatures.selectionAdjustment = -0.25
  unselected.value = unselectedFeatures.baseUtility - 0.25
  assert.throws(
    () => validateCandidateScores(context, adjustmentTamper, scorer.version),
    /invalid good vote selection semantics/,
  )
})

test('names and seat rotation do not affect relative vote utility', () => {
  const belief = syntheticBelief([
    { evil: [0, 2], probability: 0.5 },
    { evil: [1, 3], probability: 0.5 },
  ])
  const view = goodVoteView([0, 1])
  const original = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(view, belief),
  ))
  const renamed = features(scoreWith(goodProposalVoteScorer, voteContext({
    ...view,
    name: 'Renamed self',
    players: view.players.map((player) => ({
      ...player,
      name: `Player ${100 - player.seat}`,
    })),
  }, belief)))
  assert.deepEqual(renamed, original)

  const rotate = (seat: Seat): Seat => (seat + 1) % 5
  const rotatedView: PlayerView = {
    ...view,
    seat: rotate(view.seat),
    leaderSeat: rotate(view.leaderSeat),
    currentTeam: view.currentTeam!.map(rotate).sort((a, b) => a - b),
    players: view.players
      .map((player) => ({ ...player, seat: rotate(player.seat) }))
      .sort((left, right) => left.seat - right.seat),
  }
  const rotatedWorlds = belief.worlds.map((weighted) => {
    const alignmentBySeat = Array(5) as Array<'good' | 'evil'>
    const roleBySeat = Array(5) as Role[]
    for (let seat = 0; seat < 5; seat++) {
      alignmentBySeat[rotate(seat)] =
        weighted.world.alignmentBySeat[seat]
      roleBySeat[rotate(seat)] = weighted.world.roleBySeat[seat]
    }
    return {
      world: {
        alignmentBySeat,
        roleBySeat,
        key: `${weighted.world.key}-rotated`,
      },
      probability: weighted.probability,
    }
  })
  const rotatedBelief: BeliefSnapshot = {
    ...belief,
    worlds: rotatedWorlds,
    topWorlds: rotatedWorlds,
    playerMarginals: belief.playerMarginals
      .map((marginal) => ({ ...marginal, seat: rotate(marginal.seat) }))
      .sort((left, right) => left.seat - right.seat),
  }
  const rotated = features(scoreWith(
    goodProposalVoteScorer,
    voteContext(rotatedView, rotatedBelief),
  ))
  assert.equal(rotated.currentCleanProbability, original.currentCleanProbability)
  assert.equal(
    rotated.bestAlternativeCleanProbability,
    original.bestAlternativeCleanProbability,
  )
  assert.equal(rotated.approveUtility, original.approveUtility)
  assert.equal(rotated.rejectUtility, original.rejectUtility)
})

test('combined scorer is opt-in and preserves compatibility and Phase 4A ablations', async () => {
  const vote = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const compatibility = await createComposedAgent({
    seed: vote.source.seed,
  }).decide(vote.req, vote.view)
  const phase4a = await createComposedAgent({
    seed: vote.source.seed,
    scorer: goodProposalScorer,
  }).decide(vote.req, vote.view)
  const phase4b = await createComposedAgent({
    seed: vote.source.seed,
    scorer: goodProposalVoteScorer,
  }).decide(vote.req, vote.view)

  assert.equal(
    compatibility.trace!.componentVersions!.scorer,
    CANDIDATE_SCORER_VERSION,
  )
  assert.equal(
    phase4a.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_SCORER_VERSION,
  )
  assert.deepEqual(phase4a.decision, compatibility.decision)
  assert.equal(
    phase4b.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  )
  assert.deepEqual(parseExternalDecisionReply(vote.req, phase4b), phase4b)
  assert.ok(
    phase4b.trace!.candidateScores!.every(
      (score) =>
        (score.features as GoodVoteFeatures).semantics
        === 'uniform-feasible-joint',
    ),
  )

  const proposal = proposalFixture()
  const phase4aProposal = await createComposedAgent({
    seed: proposal.source.seed,
    scorer: goodProposalScorer,
  }).decide(proposal.req, proposal.view)
  const phase4bProposal = await createComposedAgent({
    seed: proposal.source.seed,
    scorer: goodProposalVoteScorer,
  }).decide(proposal.req, proposal.view)
  assert.deepEqual(phase4bProposal.decision, phase4aProposal.decision)
  assert.deepEqual(
    phase4bProposal.trace!.candidateScores!.map((score) => ({
      ...score,
      version: GOOD_PROPOSAL_SCORER_VERSION,
    })),
    phase4aProposal.trace!.candidateScores,
  )
})

test('tampered vote features and joins degrade to compatibility', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: {
      ...goodProposalVoteScorer,
      score(context) {
        return scoreWith(goodProposalVoteScorer, context)
          .map((score, index) =>
          index === 0
            ? {
                ...score,
                features: {
                  ...(score.features as GoodVoteFeatures),
                  bestAlternativeCleanProbability: 0.123,
                },
              }
            : score)
      },
    },
  }).decide(source.req, source.view)
  assert.ok(output.trace!.degradation.includes('scorer-invalid-output'))
  assert.equal(
    output.trace!.componentVersions!.scorer,
    CANDIDATE_SCORER_VERSION,
  )
  assert.deepEqual(output.decision, source.baselineDecision)

  const belief = syntheticBelief([
    { evil: [0, 2], probability: 0.5 },
    { evil: [1, 3], probability: 0.5 },
  ])
  const context = voteContext(goodVoteView([0, 1]), belief)
  assert.throws(
    () => scoreWith(goodProposalVoteScorer, {
      ...context,
      analysis: {
        ...context.analysis,
        policyCandidateAssessments:
          context.analysis.policyCandidateAssessments.slice(1),
      },
    }),
    /every legal team/,
  )
  assert.throws(
    () => scoreWith(goodProposalVoteScorer, {
      ...context,
      analysis: {
        ...context.analysis,
        goodVote: {
          ...context.analysis.goodVote!,
          bestAlternative: {
            ...context.analysis.goodVote!.bestAlternative,
            candidateId: 'legal-candidates-v1:propose:0,4',
          },
        },
      },
    }),
    /best-alternative join mismatch/,
  )
})

test('seeded and deterministic traces remain distinguishable and external-ingress-safe', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const scorer = createGoodProposalVoteScorer({
    selectionMode: 'seeded-band',
  })
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer,
  }).decide(source.req, source.view)
  assert.equal(
    output.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
  )
  assert.deepEqual(parseExternalDecisionReply(source.req, output), output)
  const malformed = structuredClone(output)
  ;(malformed.trace!.candidateScores![0].features as GoodVoteFeatures)
    .selectionMode = 'top-utility'
  assert.deepEqual(
    parseExternalDecisionReply(source.req, malformed),
    { decision: malformed.decision },
  )
  const formulaTamper = structuredClone(output)
  ;(
    formulaTamper.trace!.candidateScores![0].features as GoodVoteFeatures
  ).hammerPenalty += 0.01
  assert.deepEqual(
    parseExternalDecisionReply(source.req, formulaTamper),
    { decision: formulaTamper.decision },
  )
  const joinTamper = structuredClone(output)
  ;(
    joinTamper.trace!.candidateScores![0].features as GoodVoteFeatures
  ).bestAlternativeCandidateId = 'legal-candidates-v1:propose:0,1'
  assert.deepEqual(
    parseExternalDecisionReply(source.req, joinTamper),
    { decision: joinTamper.decision },
  )
})

test('10-player vote projection remains bounded and JSON-safe', async () => {
  let game = createGame({
    seed: 'good-vote-10p-0',
    playerCount: 10,
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  })
  for (let attempt = 1; game.players[game.leaderSeat].role !== 'servant'; attempt++) {
    assert.ok(attempt < 100)
    game = createGame({
      seed: `good-vote-10p-${attempt}`,
      playerCount: 10,
      talk: {
        maxRounds: 0,
        maxRoundsAfterChange: 0,
        leaderInDiscussion: 'none',
      },
    })
  }
  const teamSize = game.quests[3].teamSize
  const view: PlayerView = {
    ...viewFor(game, game.leaderSeat),
    phase: 'vote',
    round: 4,
    proposalNum: 1,
    currentTeam: game.players.slice(0, teamSize).map((player) => player.seat),
  }
  const request: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: 4,
    proposalNum: 1,
  }
  const started = performance.now()
  const output = await createComposedAgent({
    seed: game.seed,
    scorer: goodProposalVoteScorer,
  }).decide(request, view)
  const elapsedMs = performance.now() - started
  assert.equal(
    (output.trace!.candidateScores![0].features as GoodVoteFeatures)
      .bestAlternativeTeam.length,
    teamSize,
  )
  assertWallClockBelow(
    elapsedMs,
    2_000,
    `10p vote scoring took ${elapsedMs.toFixed(1)}ms`,
  )
  assert.doesNotThrow(() => JSON.stringify(output))
  assert.equal(
    GOOD_VOTE_UTILITY_CONSTANTS.viableBand,
    0.04,
  )
})
