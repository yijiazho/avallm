// test-lane: eval
// Migration phase 5B; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  QUEST_CARD_FACTOR_DEGRADATION,
  QUEST_CARD_FACTOR_DETAIL_MAX_LENGTH,
  QUEST_CARD_FACTOR_DETAIL_PREFIX,
  QUEST_CARD_FACTOR_VERSION,
  QUEST_CARD_MODEL_PARAMETERS,
  QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
  QUEST_WEIGHTED_BELIEF_VERSION,
  createQuestWeightedBeliefModel,
  questCardEvidence,
  questFailCountDistribution,
  questWeightedBeliefModel,
  type QuestCardEvidence,
  type QuestCardLikelihoodFactor,
} from '../../../server/agents/belief/quest-card-factor.ts'
import { exactBelief } from '../../../server/agents/belief/exact.ts'
import { assessTeam } from '../../../server/agents/belief/team-assessment.ts'
import type { HiddenWorld } from '../../../server/agents/belief/types.ts'
import { parseExternalDecisionReply } from '../../../server/agents/external-reply.ts'
import {
  applyDecision,
  createGame,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import type { Role } from '../../../server/engine/types.ts'
import {
  PHASE5_QUEST_BANK_ID,
  runPhase5QuestBench,
  phase5QuestVariants,
} from '../../../server/eval/runs/quest-factor-bench.ts'
import { PHASE4_POLICY_BANK } from '../../../server/eval/banks/good-policy-bank.ts'
import { runArchitectureBench } from '../../../server/eval/harness/architecture-bench.ts'

function world(roles: readonly Role[]): HiddenWorld {
  return {
    roleBySeat: roles,
    alignmentBySeat: roles.map((role) =>
      ['assassin', 'morgana', 'mordred', 'oberon', 'minion'].includes(role)
        ? 'evil'
        : 'good'),
    key: roles.join('|'),
  }
}

const evidence = (
  overrides: Partial<QuestCardEvidence> = {},
): QuestCardEvidence => ({
  evidenceId: 'event:10:quest-card',
  sourceSeq: 10,
  questNum: 2,
  team: [0, 1, 2],
  failCount: 0,
  failsRequired: 1,
  scoreBefore: { good: 1, evil: 0 },
  ...overrides,
})

function resolvedZeroFailView() {
  const game = createGame({
    seed: 'phase5b-zero-fail',
    playerCount: 5,
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  })
  const evil = game.players.find((player) => player.alignment === 'evil')!
  const good = game.players.find(
    (player) =>
      player.alignment === 'good' && player.role !== 'servant',
  )!
  const team = [evil.seat, good.seat].sort((left, right) => left - right)
  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  for (const player of game.players) {
    applyDecision(game, player.seat, { kind: 'vote', vote: 'approve' })
  }
  for (const seat of team) {
    applyDecision(game, seat, { kind: 'quest', card: 'success' })
  }
  const viewer = game.players.find((player) => player.role === 'servant')!
  return { game, view: viewFor(game, viewer.seat), team }
}

test('analytical quest behavior is contextual, symmetric, and non-zero', () => {
  const coordinated = world([
    'assassin', 'morgana', 'servant', 'percival', 'merlin',
  ])
  const uncoordinated = world([
    'assassin', 'oberon', 'servant', 'percival', 'merlin',
  ])
  const twoFail = evidence({
    questNum: 4,
    failCount: 2,
    failsRequired: 2,
    scoreBefore: { good: 2, evil: 1 },
  })
  assert.ok(
    questFailCountDistribution(coordinated, twoFail)[2]
      > questFailCountDistribution(uncoordinated, twoFail)[2],
  )

  const lone = world([
    'assassin', 'servant', 'servant', 'percival', 'merlin',
  ])
  const slow = questFailCountDistribution(
    lone,
    evidence({ questNum: 1, team: [0, 1] }),
  )
  const decisive = questFailCountDistribution(
    lone,
    evidence({
      questNum: 3,
      team: [0, 1],
      scoreBefore: { good: 2, evil: 0 },
    }),
  )
  assert.ok(slow[0] > decisive[0])
  assert.ok([...slow, ...decisive].every((probability) => probability > 0))
  assert.ok(Math.abs(slow.reduce((sum, value) => sum + value, 0) - 1) < 1e-12)

  const rotated = world([
    'servant', 'assassin', 'morgana', 'merlin', 'percival',
  ])
  assert.deepEqual(
    questFailCountDistribution(
      coordinated,
      evidence({ team: [0, 1, 2] }),
    ),
    questFailCountDistribution(
      rotated,
      evidence({ team: [0, 1, 2] }),
    ),
  )
})

test('quest weighting retains exact worlds and caps total history influence', () => {
  const { game, view, team } = resolvedZeroFailView()
  const uniform = exactBelief(view)
  const weighted = questWeightedBeliefModel.infer(view)
  assert.equal(weighted.modelVersion, QUEST_WEIGHTED_BELIEF_VERSION)
  assert.equal(weighted.quality, 'weighted')
  assert.equal(weighted.provenance.length, 1)
  assert.equal(questCardEvidence(view).length, 1)
  assert.ok(weighted.worlds.every((entry) => entry.probability > 0))
  assert.deepEqual(
    weighted.worlds.map((entry) => entry.world.key),
    uniform.worlds.map((entry) => entry.world.key),
  )
  const probabilities = weighted.worlds.map((entry) => entry.probability)
  assert.ok(
    Math.max(...probabilities) / Math.min(...probabilities)
      <= Math.exp(QUEST_FACTOR_LOG_LIKELIHOOD_CAP) + 1e-12,
  )
  assert.ok(
    assessTeam(weighted, team).cleanProbability
      > assessTeam(uniform, team).cleanProbability,
  )
  assert.ok(weighted.entropy < uniform.entropy)
  for (const player of game.players) {
    assert.deepEqual(
      questCardEvidence(viewFor(game, player.seat)),
      questCardEvidence(view),
    )
  }
})

test('absent evidence stays uniform and factor failure degrades safely', () => {
  const game = createGame({ seed: 'phase5b-fallback', playerCount: 5 })
  const view = viewFor(game, 0)
  const before = questWeightedBeliefModel.infer(view)
  assert.equal(before.quality, 'constraints-only')
  assert.equal(before.modelVersion, QUEST_WEIGHTED_BELIEF_VERSION)
  assert.equal(before.provenance.length, 0)

  const failing: QuestCardLikelihoodFactor = {
    id: 'quest-card',
    version: 'throwing-test-v1',
    logLikelihood() {
      throw new Error('factor failed')
    },
  }
  const resolved = resolvedZeroFailView().view
  const degraded = createQuestWeightedBeliefModel(failing).infer(resolved)
  const exact = exactBelief(resolved)
  assert.equal(degraded.quality, 'degraded')
  assert.equal(degraded.degradation[0], QUEST_CARD_FACTOR_DEGRADATION)
  assert.deepEqual(degraded.degradation, [
    'quest-card-factor-failed',
    'quest-card-factor-detail:Error: factor failed',
  ])
  assert.deepEqual(degraded.worlds, exact.worlds)
})

test('factor failure detail is bounded, single line, and house style', () => {
  const resolved = resolvedZeroFailView().view
  const detailFor = (thrown: unknown): string => {
    const failing: QuestCardLikelihoodFactor = {
      id: 'quest-card',
      version: 'throwing-test-v1',
      logLikelihood() {
        throw thrown
      },
    }
    const degradation =
      createQuestWeightedBeliefModel(failing).infer(resolved).degradation
    assert.equal(degradation.length, 2)
    assert.equal(degradation[0], QUEST_CARD_FACTOR_DEGRADATION)
    assert.ok(degradation[1].startsWith(QUEST_CARD_FACTOR_DETAIL_PREFIX))
    assert.ok(degradation[1].length <= QUEST_CARD_FACTOR_DETAIL_MAX_LENGTH)
    // Bounded diagnosis must never carry newlines, control characters, or the
    // dashes the house style bans, since snapshots reach rendering surfaces.
    assert.doesNotMatch(degradation[1], /[^\x20-\x7e]/)
    assert.doesNotMatch(degradation[1], /[\u2010-\u2015\u2212]/)
    return degradation[1]
  }

  // Distinct failures stay distinguishable rather than collapsing to one label.
  const typeError = detailFor(new TypeError('cards is not iterable'))
  assert.equal(
    typeError,
    'quest-card-factor-detail:TypeError: cards is not iterable',
  )
  assert.notEqual(typeError, detailFor(new Error('cards is not iterable')))

  const long = detailFor(new Error('x'.repeat(4000)))
  assert.equal(long.length, QUEST_CARD_FACTOR_DETAIL_MAX_LENGTH)
  assert.ok(long.endsWith('...'))

  assert.equal(
    detailFor(new Error('line one\nline two\ttabbed')),
    'quest-card-factor-detail:Error: line one line two tabbed',
  )
  assert.equal(
    detailFor('plain string'),
    'quest-card-factor-detail:non-error thrown: string',
  )
  assert.equal(detailFor(new Error('')), 'quest-card-factor-detail:Error:')
})

test('quest-card hyperparameters are pinned to the factor version', () => {
  // These values ARE the model. An edit changes every seat's beliefs, so it is
  // a new model and must move QUEST_CARD_FACTOR_VERSION. Update both together.
  assert.equal(QUEST_CARD_FACTOR_VERSION, 'analytical-quest-card-v1')
  assert.deepEqual(QUEST_CARD_MODEL_PARAMETERS, {
    oberonAboard: { decisiveBoard: 0.95, openBoard: 0.85 },
    twoFailsRequired: {
      uncoordinated: 0.08,
      coordinatedDecisiveBoard: 0.9,
      coordinatedOpenBoard: 0.72,
    },
    loneEvilAboard: {
      decisiveBoard: 0.88,
      firstQuest: 0.35,
      laterQuest: 0.65,
    },
    multipleEvilAboard: {
      decisiveBoard: 0.62,
      firstQuest: 0.25,
      laterQuest: 0.5,
    },
    coordinatedSingleFailBoost: 1.5,
    uniformMixtureWeight: 0.05,
  })
  assert.ok(Object.isFrozen(QUEST_CARD_MODEL_PARAMETERS))
  for (const value of Object.values(QUEST_CARD_MODEL_PARAMETERS)) {
    if (typeof value === 'object') assert.ok(Object.isFrozen(value))
  }
})

test('held-out quest ablation is paired, attributed, and external-ingress-safe', async () => {
  const report = await runPhase5QuestBench({
    cases: PHASE4_POLICY_BANK.slice(0, 1),
  })
  assert.deepEqual(
    report.architecture.variants.map((variant) => variant.id),
    [
      'uniform-policy',
      'quest-weighted-policy',
      'uniform-calibration',
      'quest-weighted-calibration',
    ],
  )
  assert.ok(report.calibration.uniform.overall.rows > 0)
  assert.equal(
    report.calibration.uniform.overall.rows,
    report.calibration.weighted.overall.rows,
  )
  assert.equal(
    report.calibration.delta.rows,
    report.calibration.uniform.overall.rows,
  )
  assert.ok(Number.isFinite(report.calibration.delta.brier))
  assert.ok(Number.isFinite(report.calibration.delta.logLoss))

  const [artifact] = await runArchitectureBench({
    variants: phase5QuestVariants().filter(
      (variant) => variant.id === 'quest-weighted-policy',
    ),
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    bankId: 'phase5b-stdio',
  })
  const trace = artifact.decisionTraces?.find(
    (candidate) => candidate.quality === 'weighted',
  )
  assert.ok(trace)
  assert.equal(trace!.componentVersions?.factors, 'quest-card-only-v1')
  assert.equal(trace!.beliefProvenance?.[0].factorId, 'quest-card')
  assert.doesNotThrow(() =>
    parseExternalDecisionReply(
      trace!.request,
      { decision: trace!.action, trace },
      'phase5b-weighted-trace',
    ))

  const edgeCase = PHASE4_POLICY_BANK.find(
    (candidate) => candidate.id === '6p-percival-1',
  )!
  const [normalized] = await runArchitectureBench({
    variants: phase5QuestVariants().filter(
      (variant) => variant.id === 'quest-weighted-policy',
    ),
    cases: [edgeCase],
    bankId: 'phase5b-normalized-projection',
  })
  assert.ok(normalized.decisionTraces?.every(
    (candidate) =>
      !candidate.degradation.includes('scorer-invalid-output')
      && (candidate.beliefTeamAssessments ?? []).every(
        (assessment) =>
          assessment.evilCountDistribution.every(
            (probability) => probability >= 0 && probability <= 1,
          )
          && Math.abs(
            assessment.evilCountDistribution.reduce(
              (sum, probability) => sum + probability,
              0,
            ) - 1,
          ) <= 1e-12,
      ),
  ))
})

test('quest calibration preserves opponent-population identity', async () => {
  const report = await runPhase5QuestBench({
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    opponentKind: 'random',
  })
  assert.deepEqual(
    Object.keys(report.calibration.uniform.byPopulation),
    [`${PHASE5_QUEST_BANK_ID}:random-opponents`],
  )
  assert.equal(
    report.calibration.uniform.overall.rows,
    report.calibration.weighted.overall.rows,
  )
})

test('quest likelihood runtime has no raw Game dependency', () => {
  const source = fs.readFileSync(
    'server/agents/belief/quest-card-factor.ts',
    'utf8',
  )
  assert.doesNotMatch(source, /from ['"].*engine\/game/)
  assert.doesNotMatch(source, /\bGame\b/)
})
