import { test } from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { assertWallClockBelow } from './helpers/performance-gate.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { assessTeams } from '../server/agents/belief/team-assessment.ts'
import type { BeliefSnapshot, HiddenWorld } from '../server/agents/belief/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../server/agents/policy/forced.ts'
import {
  CANDIDATE_SCORER_VERSION,
  GOOD_PROPOSAL_SCORER_VERSION,
  goodProposalScorer,
  selectTopViableScore,
  validateCandidateScores,
  type CandidateScoringContext,
} from '../server/agents/policy/score.ts'
import {
  calculateGoodProposalCandidateScores as scoreGoodProposalCandidates,
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

function syntheticBelief(
  evilPairs: readonly (readonly [Seat, Seat])[],
): BeliefSnapshot {
  const probability = 1 / evilPairs.length
  const worlds = evilPairs.map(([left, right], index) => {
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
        key: `synthetic-${index}-${left}-${right}`,
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
    entropy: Math.log2(worlds.length),
    topWorlds: worlds,
  }
}

function genericGoodProposalView(): PlayerView {
  const source = proposalFixture()
  return {
    ...structuredClone(source.view),
    name: 'Analyst',
    role: 'servant',
    alignment: 'good',
    privateInfo: { kind: 'none' },
    players: source.view.players.map((player) => ({ ...player })),
    events: [],
    transcript: [],
    proposals: [],
  }
}

function scoringContext(
  view: PlayerView,
  belief: BeliefSnapshot,
  forcedOverride?: ForcedPolicyResult,
): CandidateScoringContext {
  const request: DecisionRequest = {
    kind: 'propose',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const candidates = legalCandidates(request, view)
  const teams = candidateTeams(candidates, view)
  const analysis = analyzeSituation(view, {
    belief,
    policyCandidateTeams: teams,
    policyCandidateAssessments: teams,
  })
  const forced = forcedOverride
    ?? applyForcedPolicy(request, view, analysis, candidates)
  return {
    deterministicSeed: 'good-proposal-test-seed',
    request,
    view,
    analysis,
    candidates,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      selectedCandidateId: forced.selectedCandidateId,
      reasonCodes: forced.reasonCodes,
    },
  }
}

const scoreForTeam = (
  context: CandidateScoringContext,
  team: readonly Seat[],
) => {
  const id = candidateIdForDecision({ kind: 'propose', team: [...team] })
  return scoreGoodProposalCandidates(context).find(
    (score) => score.candidateId === id,
  )!
}

test('good proposal scorer uses joint correlation rather than marginal products', () => {
  const view = genericGoodProposalView()
  const belief = syntheticBelief([[0, 1], [2, 3]])
  const context = scoringContext(view, belief)
  const together = scoreForTeam(context, [0, 1])
  const split = scoreForTeam(context, [0, 2])

  assert.equal(
    context.analysis.policyCandidateAssessments.length,
    context.candidates.length,
  )
  assert.equal(together.features!.cleanProbability, 0.5)
  assert.equal(split.features!.cleanProbability, 0)
  assert.equal(together.features!.evilCountDistribution[2], 0.5)
  assert.equal(split.features!.evilCountDistribution[1], 1)

  const goodMarginalProduct = (team: readonly Seat[]): number =>
    team.reduce(
      (product, seat) =>
        product * belief.playerMarginals[seat].goodProbability,
      1,
    )
  assert.equal(goodMarginalProduct([0, 1]), 0.25)
  assert.equal(goodMarginalProduct([0, 2]), 0.25)
})

test('changing only the joint posterior causally flips team values', () => {
  const view = genericGoodProposalView()
  const correlated = scoringContext(
    view,
    syntheticBelief([[0, 1], [2, 3]]),
  )
  const crossed = scoringContext(
    view,
    syntheticBelief([[0, 2], [1, 3]]),
  )
  assert.deepEqual(
    correlated.analysis.unresolved,
    crossed.analysis.unresolved,
  )
  assert.equal(scoreForTeam(correlated, [0, 1]).value, 0.5)
  assert.equal(scoreForTeam(crossed, [0, 1]).value, 0)
  assert.equal(scoreForTeam(correlated, [0, 2]).value, 0)
  assert.equal(scoreForTeam(crossed, [0, 2]).value, 0.5)
})

test('batch assessment preserves non-uniform world probability and skips empty work', () => {
  const belief = syntheticBelief([[0, 1], [2, 3]])
  const weighted: BeliefSnapshot = {
    ...belief,
    worlds: [
      { ...belief.worlds[0], probability: 0.8 },
      { ...belief.worlds[1], probability: 0.2 },
    ],
  }
  const [assessment] = assessTeams(weighted, [[0, 1]])
  assert.equal(assessment.cleanProbability, 0.2)
  assert.deepEqual(assessment.evilCountDistribution, [0.2, 0, 0.8])

  const poison = {
    get worlds(): never {
      throw new Error('empty assessment touched posterior worlds')
    },
  } as unknown as BeliefSnapshot
  assert.deepEqual(assessTeams(poison, []), [])
})

test('best joint value and canonical tie-breaking are deterministic', () => {
  const context = scoringContext(
    genericGoodProposalView(),
    syntheticBelief([[0, 1], [2, 3]]),
  )
  const first = scoreGoodProposalCandidates(context)
  const second = scoreGoodProposalCandidates(context)
  assert.deepEqual(first, second)
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first)
  assert.equal(
    selectTopViableScore(first).candidateId,
    selectTopViableScore([...first].reverse()).candidateId,
  )
  const chosen = selectTopViableScore(first)
  assert.ok(chosen.reasonCodes.includes('GOOD_PROPOSAL_MAX_TEAM_CLEAN'))
  assert.ok(chosen.reasonCodes.includes('GOOD_PROPOSAL_CANONICAL_TIE_BREAK'))
  validateCandidateScores(context, first, GOOD_PROPOSAL_SCORER_VERSION)
})

test('forced policy remains authoritative over higher posterior value', () => {
  const base = scoringContext(
    genericGoodProposalView(),
    syntheticBelief([[0, 1], [2, 3]]),
  )
  const forcedId = candidateIdForDecision({
    kind: 'propose',
    team: [0, 2],
  })
  const forced: ForcedPolicyResult = {
    version: 'forced-policy-v1',
    applied: true,
    reasonCodes: ['HAMMER_TEAM_AUTOMATIC'],
    allowedCandidateIds: [forcedId],
    selectedCandidateId: forcedId,
  }
  const context = {
    ...base,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      selectedCandidateId: forced.selectedCandidateId,
      reasonCodes: forced.reasonCodes,
    },
  }
  const scores = scoreGoodProposalCandidates(context)
  validateCandidateScores(context, scores, GOOD_PROPOSAL_SCORER_VERSION)
  assert.equal(scoreForTeam(context, [0, 1]).value, -Number.MAX_SAFE_INTEGER)
  assert.equal(scoreForTeam(context, [0, 1]).viable, false)
  assert.equal(selectTopViableScore(scores).candidateId, forcedId)
})

test('candidate assessments require a complete ID and team join', () => {
  const context = scoringContext(
    genericGoodProposalView(),
    syntheticBelief([[0, 1], [2, 3]]),
  )
  assert.throws(
    () => scoreGoodProposalCandidates({
      ...context,
      analysis: {
        ...context.analysis,
        policyCandidateAssessments:
          context.analysis.policyCandidateAssessments.slice(1),
      },
    }),
    /good base assessment mismatch/,
  )
  assert.throws(
    () => scoreGoodProposalCandidates({
      ...context,
      analysis: {
        ...context.analysis,
        policyCandidateAssessments:
          context.analysis.policyCandidateAssessments.map(
            (assessment, index) => index === 0
              ? { ...assessment, team: [3, 4] }
              : assessment,
          ),
      },
    }),
    /assessment mismatch/,
  )
})

test('tampered posterior features degrade to compatibility at the scorer boundary', async () => {
  const source = proposalFixture()
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: GOOD_PROPOSAL_SCORER_VERSION,
      analysisRequirement: 'joint-proposal-team-assessments',
      score(context) {
        return scoreGoodProposalCandidates(context).map((score, index) =>
          index === 0
            ? {
                ...score,
                features: {
                  ...score.features!,
                  cleanProbability: 0.123,
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
})

test('good scorer attribution requires score values and complete features to match analysis', () => {
  const context = scoringContext(
    genericGoodProposalView(),
    syntheticBelief([[0, 1], [2, 3]]),
  )
  const scores = scoreGoodProposalCandidates(context)
  assert.throws(
    () => validateCandidateScores(
      context,
      scores.map((score, index) =>
        index === 0 ? { ...score, value: score.value + 0.01 } : score),
      GOOD_PROPOSAL_SCORER_VERSION,
    ),
    /invalid candidate score/,
  )
  assert.throws(
    () => validateCandidateScores(
      context,
      scores.map((score, index) =>
        index === 0 ? { ...score, features: undefined } : score),
      GOOD_PROPOSAL_SCORER_VERSION,
    ),
    /invalid candidate score/,
  )
})

test('scorer input mutation cannot reopen a forced-policy removal', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'assassin-late-finalize',
  )!
  const view = { ...source.view, phase: 'proposal' as const }
  const request = { ...source.req, kind: 'propose' as const }
  let removedId = ''
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: {
      version: 'mutating-scorer-v1',
      score(context) {
        removedId = context.candidates.find(
          (candidate) =>
            !context.forced.allowedCandidateIds.includes(candidate.id),
        )!.id
        ;(context.forced.allowedCandidateIds as string[]).push(removedId)
        return context.candidates.map((candidate) => ({
          version: 'mutating-scorer-v1',
          candidateId: candidate.id,
          value: candidate.id === removedId ? 1 : 0,
          viable: candidate.id === removedId,
          reasonCodes: [],
        }))
      },
    },
  }).decide(request, view)
  assert.ok(output.trace!.degradation.includes('scorer-invalid-output'))
  assert.ok(!output.trace!.forcedPolicyResult!.allowedCandidateIds.includes(
    removedId,
  ))
  assert.notEqual(output.trace!.chosenCandidateId, removedId)
})

test('validated scores are detached from scorer-retained mutable output', async () => {
  const source = proposalFixture()
  const output = await createComposedAgent({
    seed: source.source.seed,
    scorer: {
      ...goodProposalScorer,
      score(context) {
        const scores = scoreGoodProposalCandidates(context).map((score) => ({
          ...score,
          features: score.features
            ? { ...score.features }
            : undefined,
        }))
        queueMicrotask(() => {
          scores[0].value = 0.123456789
          scores[0].features!.cleanProbability = 0.123456789
        })
        return scores
      },
    },
  }).decide(source.req, source.view)
  const traced = output.trace!.candidateScores![0]
  assert.equal(traced.value, traced.features!.cleanProbability)
  assert.notEqual(traced.value, 0.123456789)
})

test('opt-in composed proposal is posterior-driven and compatibility stays default', async () => {
  const source = proposalFixture()
  const compatibility = await createComposedAgent({ seed: source.source.seed })
    .decide(source.req, source.view)
  const first = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)
  const replay = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)

  assert.equal(
    compatibility.trace!.componentVersions!.scorer,
    CANDIDATE_SCORER_VERSION,
  )
  assert.deepEqual(compatibility.decision, source.baselineDecision)
  assert.equal(
    first.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_SCORER_VERSION,
  )
  assert.deepEqual(first.decision, { kind: 'propose', team: [0, 1] })
  assert.ok(
    legalCandidates(source.req, source.view).some(
      (candidate) => candidate.id === first.trace!.chosenCandidateId,
    ),
  )
  assert.deepEqual(first, replay)
  assert.equal(
    first.trace!.candidateScores!.length,
    legalCandidates(source.req, source.view).length,
  )
  assert.ok(
    first.trace!.candidateScores!.every(
      (score) =>
        score.features?.semantics === 'uniform-feasible-joint'
        && Number.isFinite(score.value),
    ),
  )
  assert.deepEqual(parseExternalDecisionReply(source.req, first), first)
  const malformed = structuredClone(first)
  malformed.trace!.candidateScores = malformed.trace!.candidateScores!.map(
    (score, index) => index === 0
      ? {
          ...score,
          features: {
            ...score.features!,
            evilCountDistribution: [0.5, 0.5],
          },
        }
      : score,
  )
  assert.deepEqual(
    parseExternalDecisionReply(source.req, malformed),
    { decision: malformed.decision },
  )
  const mismatchedValue = structuredClone(first)
  mismatchedValue.trace!.candidateScores![0].value = 0.987654321
  assert.deepEqual(
    parseExternalDecisionReply(source.req, mismatchedValue),
    { decision: mismatchedValue.decision },
  )
  const mismatchedTeam = structuredClone(first)
  const featureScore = mismatchedTeam.trace!.candidateScores![0]
  featureScore.features!.team = [2, 4]
  assert.deepEqual(
    parseExternalDecisionReply(source.req, mismatchedTeam),
    { decision: mismatchedTeam.decision },
  )

  const voteSource = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const transplanted = await createComposedAgent({
    seed: voteSource.source.seed,
    scorer: goodProposalScorer,
  }).decide(voteSource.req, voteSource.view)
  transplanted.trace!.candidateScores = first.trace!.candidateScores!.map(
    (score) => ({
      ...structuredClone(score),
      features: {
        ...structuredClone(score.features!),
        beliefModelVersion: transplanted.trace!.beliefModelVersion,
        beliefThroughSeq: transplanted.trace!.beliefThroughSeq,
      },
    }),
  )
  transplanted.trace!.chosenCandidateId = first.trace!.chosenCandidateId
  transplanted.trace!.forcedPolicyResult = structuredClone(
    first.trace!.forcedPolicyResult!,
  )
  transplanted.trace!.relevantTeam = structuredClone(
    first.trace!.relevantTeam!,
  )
  assert.deepEqual(
    parseExternalDecisionReply(voteSource.req, transplanted),
    { decision: transplanted.decision },
  )
})

test('opt-in proposal scorer delegates every out-of-scope decision to compatibility', async () => {
  const source = readDecisionFixtures().find(
    (candidate) => candidate.id === 'servant-vote-after-evidence',
  )!
  const compatibility = await createComposedAgent({ seed: source.source.seed })
    .decide(source.req, source.view)
  const delegated = await createComposedAgent({
    seed: source.source.seed,
    scorer: goodProposalScorer,
  }).decide(source.req, source.view)
  assert.deepEqual(delegated.decision, compatibility.decision)
  assert.equal(
    delegated.trace!.componentVersions!.scorer,
    GOOD_PROPOSAL_SCORER_VERSION,
  )
  assert.ok(
    delegated.trace!.candidateScores!.every(
      (score) =>
        score.features === undefined
        && score.reasonCodes.includes(
          'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
        ),
    ),
  )
})

test('names do not affect scores and seat rotation preserves joint values', () => {
  const view = genericGoodProposalView()
  const belief = syntheticBelief([[0, 1], [2, 3]])
  const original = scoringContext(view, belief)
  const renamed = scoringContext({
    ...view,
    name: 'Different',
    players: view.players.map((player) => ({
      ...player,
      name: `Renamed ${player.seat}`,
    })),
  }, belief)
  assert.deepEqual(
    scoreGoodProposalCandidates(original),
    scoreGoodProposalCandidates(renamed),
  )

  const rotate = (seat: Seat): Seat => (seat + 1) % 5
  const rotatedView: PlayerView = {
    ...view,
    seat: rotate(view.seat),
    leaderSeat: rotate(view.leaderSeat),
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
  const rotated = scoringContext(rotatedView, rotatedBelief)
  const rotatedScores = new Map(
    scoreGoodProposalCandidates(rotated).map(
      (score) => [score.candidateId, score],
    ),
  )
  for (const score of scoreGoodProposalCandidates(original)) {
    const team = score.features!.team.map(rotate).sort((a, b) => a - b)
    const id = candidateIdForDecision({ kind: 'propose', team })
    assert.equal(rotatedScores.get(id)!.value, score.value)
  }
})

test('10-player quest-four surface remains bounded and JSON-safe', async () => {
  let game = createGame({
    seed: 'good-proposal-10p-0',
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
      seed: `good-proposal-10p-${attempt}`,
      playerCount: 10,
      talk: {
        maxRounds: 0,
        maxRoundsAfterChange: 0,
        leaderInDiscussion: 'none',
      },
    })
  }
  const view: PlayerView = {
    ...viewFor(game, game.leaderSeat),
    phase: 'proposal',
    round: 4,
    proposalNum: 1,
    currentTeam: undefined,
  }
  const request: DecisionRequest = {
    kind: 'propose',
    seat: view.seat,
    round: 4,
    proposalNum: 1,
  }
  const started = performance.now()
  const output = await createComposedAgent({
    seed: game.seed,
    scorer: goodProposalScorer,
  }).decide(request, view)
  const elapsedMs = performance.now() - started
  assert.equal(output.trace!.candidateScores!.length, 252)
  assertWallClockBelow(
    elapsedMs,
    2_000,
    `252-team scoring took ${elapsedMs.toFixed(1)}ms`,
  )
  assert.doesNotThrow(() => JSON.stringify(output))
})
