import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  QUEST_FACTOR_LOG_LIKELIHOOD_CAP,
  QUEST_WEIGHTED_BELIEF_VERSION,
  createQuestWeightedBeliefModel,
  questCardEvidence,
  questFailCountDistribution,
  questWeightedBeliefModel,
  type QuestCardEvidence,
  type QuestCardLikelihoodFactor,
} from '../server/agents/belief/quest-card-factor.ts'
import { assessTeam, exactBelief } from '../server/agents/belief/exact.ts'
import type { HiddenWorld } from '../server/agents/belief/types.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import {
  applyDecision,
  createGame,
} from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { Role, Seat } from '../server/engine/types.ts'
import {
  PHASE5_QUEST_BANK_ID,
  runPhase5QuestBench,
  phase5QuestVariants,
} from '../server/eval/phase5-quest-bench.ts'
import { PHASE4_POLICY_BANK } from '../server/eval/phase4-policy-bank.ts'
import { runArchitectureBench } from '../server/eval/architecture-bench.ts'

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
  assert.deepEqual(degraded.degradation, ['quest-card-factor-failed'])
  assert.deepEqual(degraded.worlds, exact.worlds)
})

test('held-out quest ablation is paired, attributed, and stdio-safe', async () => {
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
    parseStdioDecisionReply(
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
