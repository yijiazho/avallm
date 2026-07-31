// Migration phase 5A; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import { assessTeam } from '../server/agents/belief/team-assessment.ts'
import type {
  BeliefModel,
  WeightedWorld,
} from '../server/agents/belief/types.ts'
import {
  capLogLikelihood,
  normalizeLogWeights,
} from '../server/agents/belief/log-weights.ts'
import { advanceCognition } from '../server/agents/cognition/state.ts'
import {
  candidateIdForDecision,
  candidateTeams,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../server/agents/policy/forced.ts'
import {
  GOOD_PROPOSAL_SCORER_VERSION,
} from '../server/agents/policy/score.ts'
import {
  validateCandidateScores,
} from '../server/agents/policy/candidate-score-validation.ts'
import {
  calculateGoodProposalCandidateScores,
} from '../server/agents/role-score-layers/good.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { runGame } from '../server/sim/runner.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { toArtifact } from '../server/eval/artifact.ts'
import {
  beliefCalibrationReport,
  pairedCalibrationDelta,
  scoreCalibration,
  type BeliefPredictionRow,
} from '../server/eval/belief-calibration.ts'
import {
  datasetSplitFor,
  mechanicalDataset,
} from '../server/eval/mechanical-data.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'
import type { Seat } from '../server/engine/types.ts'
import type { AvalonAgent } from '../server/agents/types.ts'
import { runArchitectureBench } from '../server/eval/architecture-bench.ts'
import { PHASE4_POLICY_BANK } from '../server/eval/good-policy-bank.ts'
import { phase4PolicyVariants } from '../server/eval/good-policy-bench.ts'

async function heuristicArtifact(seed: string): Promise<GameArtifact> {
  const game = createGame({
    seed,
    playerCount: 5,
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      {
        decide: (request, view) =>
          Promise.resolve(heuristicDecide(request, view, seed)),
      },
    ]),
  )
  const result = await runGame({ game, agents })
  return toArtifact(game, {
    agents: game.players.map(() => 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
  })
}

test('non-uniform world weights drive every posterior projection', () => {
  const game = createGame({ seed: 'phase5a-weighted', playerCount: 5 })
  const view = viewFor(game, game.players.find(
    (player) => player.role === 'servant',
  )!.seat)
  const uniform = exactBelief(view)
  const raw: WeightedWorld[] = uniform.worlds.map(
    (weighted, index) => ({
      world: weighted.world,
      probability: index === 0 ? 9 : 1,
    }),
  )
  const snapshot = beliefFromWeightedWorlds(view, raw, {
    modelVersion: 'weighted-test-v1',
    quality: 'weighted',
    provenance: [{
      factorId: 'test-factor',
      factorVersion: 'v1',
      evidenceIds: ['event:1:test'],
      logLikelihoodCap: 2,
      minLogLikelihood: -1,
      maxLogLikelihood: 1,
    }],
  })
  assert.equal(snapshot.quality, 'weighted')
  assert.equal(snapshot.provenance[0].factorId, 'test-factor')
  assert.ok(Math.abs(
    snapshot.worlds.reduce(
      (sum, weighted) => sum + weighted.probability,
      0,
    ) - 1,
  ) < 1e-12)
  assert.equal(snapshot.topWorlds[0].world.key, uniform.worlds[0].world.key)
  const evilSeat = uniform.worlds[0].world.alignmentBySeat.findIndex(
    (alignment) => alignment === 'evil',
  )
  const expectedEvil = snapshot.worlds.reduce(
    (sum, weighted) =>
      sum + (
        weighted.world.alignmentBySeat[evilSeat] === 'evil'
          ? weighted.probability
          : 0
      ),
    0,
  )
  assert.ok(Math.abs(
    snapshot.playerMarginals[evilSeat].evilProbability - expectedEvil,
  ) < 1e-12)
  assert.ok(Math.abs(
    assessTeam(snapshot, [evilSeat]).evilCountDistribution[1]
      - expectedEvil,
  ) < 1e-12)
  const expectedEntropy = -snapshot.worlds.reduce(
    (sum, weighted) =>
      sum + weighted.probability * Math.log2(weighted.probability),
    0,
  )
  assert.ok(Math.abs(snapshot.entropy - expectedEntropy) < 1e-12)

  const request = {
    kind: 'propose' as const,
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const candidates = legalCandidates(request, view)
  const teams = candidateTeams(candidates, view)
  const analysis = analyzeSituation(view, {
    belief: snapshot,
    policyCandidateTeams: teams,
    policyCandidateAssessments: teams,
  })
  assert.ok(analysis.policyCandidateAssessments.every(
    (assessment) => assessment.probabilitySemantics === 'weighted-joint',
  ))
  const forced = applyForcedPolicy(request, view, analysis, candidates)
  const context = {
    deterministicSeed: 'phase5a-weighted',
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
    compatibilityCandidateId: candidateIdForDecision(
      heuristicDecide(request, view, 'phase5a-weighted'),
    ),
  }
  const scores = calculateGoodProposalCandidateScores(context)
  validateCandidateScores(context, scores, GOOD_PROPOSAL_SCORER_VERSION)
  assert.ok(scores.every(
    (score) => score.features?.semantics === 'weighted-joint',
  ))

  const model: BeliefModel = {
    version: 'weighted-test-v1',
    factorsVersion: 'test-factors-v1',
    infer: () => snapshot,
  }
  const cognition = advanceCognition(undefined, view, model)
  assert.equal(cognition.versions.belief, model.version)
  assert.deepEqual(advanceCognition(cognition, view, model), cognition)
})

test('log weights normalize stably and every contribution is capped', () => {
  const game = createGame({ seed: 'phase5a-log-sum-exp', playerCount: 5 })
  const view = viewFor(game, 0)
  const worlds = exactBelief(view).worlds.slice(0, 2)
    .map((weighted) => weighted.world)
  const weighted = normalizeLogWeights(worlds, [1_000, 999])
  assert.ok(Math.abs(
    weighted.reduce((sum, entry) => sum + entry.probability, 0) - 1,
  ) < 1e-12)
  assert.ok(weighted[0].probability > weighted[1].probability)
  assert.deepEqual(capLogLikelihood(3, 1.5), {
    value: 1.5,
    capped: true,
  })
  assert.deepEqual(capLogLikelihood(-1, 1.5), {
    value: -1,
    capped: false,
  })
})

test('mechanical rows are public-only, split by game, and exclude reserved data', async () => {
  const artifact = await heuristicArtifact('phase5a-public-rows')
  const original = mechanicalDataset([artifact])
  assert.ok(original.rows.some((row) => row.kind === 'proposal'))
  assert.ok(original.rows.some((row) => row.kind === 'vote'))
  assert.ok(original.rows.some((row) => row.kind === 'quest'))
  assert.equal(new Set(original.rows.map((row) => row.split)).size, 1)
  assert.equal(
    original.rows[0].split,
    datasetSplitFor(artifact),
  )
  const sameGameDifferentId = structuredClone(artifact)
  sameGameDifferentId.id = 'same-deal-copy'
  assert.equal(
    datasetSplitFor(sameGameDifferentId),
    datasetSplitFor(artifact),
  )

  const hiddenMutation = structuredClone(artifact)
  hiddenMutation.players.reverse()
  for (const event of hiddenMutation.log) {
    if (event.visibility !== 'public') {
      event.payload = { hidden: 'changed' }
    }
  }
  assert.deepEqual(
    mechanicalDataset([hiddenMutation]).rows,
    original.rows,
  )

  const evaluation = structuredClone(artifact)
  evaluation.id = 'reserved-evaluation'
  evaluation.architecture = {
    bank: 'held-out',
    caseId: 'case',
    targetRole: 'servant',
    targetSeat: 0,
    variant: 'candidate',
    components: {},
  }
  const human = structuredClone(artifact)
  human.id = 'reserved-human'
  human.tags = { datasetUse: 'human-study' }
  assert.deepEqual(mechanicalDataset([evaluation, human]), {
    schema: 1,
    extractorVersion: 'mechanical-public-rows-v1',
    rows: [],
    excluded: [
      { gameId: 'reserved-evaluation', reason: 'evaluation-deal' },
      { gameId: 'reserved-human', reason: 'human-study' },
    ],
  })

  assert.equal(artifact.strategyVersions?.schema, 1)
  assert.deepEqual(
    artifact.strategyVersions?.agentDescriptors,
    ['heuristic'],
  )
})

test('calibration reports Brier, log loss, curves, populations, and paired deltas', () => {
  const rows = (
    probabilities: readonly [number, number],
  ): BeliefPredictionRow[] => [
    {
      id: 'game-a:seat-1',
      gameId: 'game-a',
      populationId: 'bots-a',
      split: 'test',
      target: 'player-evil',
      probability: probabilities[0],
      observed: true,
    },
    {
      id: 'game-b:team-1',
      gameId: 'game-b',
      populationId: 'bots-b',
      split: 'test',
      target: 'team-clean',
      probability: probabilities[1],
      observed: false,
    },
  ]
  const baseline = rows([0.5, 0.5])
  const candidate = rows([0.8, 0.2])
  const score = scoreCalibration(baseline)
  assert.equal(score.brier, 0.25)
  assert.ok(Math.abs(score.logLoss - Math.log(2)) < 1e-12)
  // One bin holding both rows, one of them observed. The bin carries its Wilson
  // interval, which is the point of binning small: 1/2 is not evidence of a
  // half, and the interval says so.
  assert.equal(score.curve.length, 1)
  assert.equal(score.curve[0].observed.trials, 2)
  assert.equal(score.curve[0].observed.successes, 1)
  assert.equal(score.curve[0].observed.rate, 0.5)
  assert.deepEqual(score.curve[0].observed.interval95, {
    low: 0.09453120573423074,
    high: 0.9054687942657693,
  })
  assert.equal(score.curve[0].meanProbability, 0.5)
  const report = beliefCalibrationReport(candidate)
  assert.equal(report.overall.rows, 2)
  assert.equal(report.byTarget['player-evil'].rows, 1)
  assert.deepEqual(Object.keys(report.byPopulation), ['bots-a', 'bots-b'])
  const delta = pairedCalibrationDelta(baseline, candidate)
  assert.equal(delta.rows, 2)
  assert.ok(delta.brier < 0)
  assert.ok(delta.logLoss < 0)
  assert.throws(
    () => pairedCalibrationDelta(
      baseline,
      candidate.slice(0, 1),
    ),
    /identical held-out rows/,
  )
})

test('new artifacts identify agent, model, prompt, policy, belief, and factors', async () => {
  const [artifact] = await runArchitectureBench({
    variants: phase4PolicyVariants().slice(0, 1),
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    bankId: 'phase5a-version-manifest',
  })
  const versions = artifact.strategyVersions
  assert.ok(versions)
  assert.ok(versions!.agentDescriptors.length > 0)
  assert.deepEqual(versions!.models, [])
  assert.ok(versions!.prompts.length > 0)
  assert.deepEqual(versions!.policies, ['composed-policy-v1'])
  assert.deepEqual(versions!.beliefs, ['exact-constraints-v1'])
  assert.deepEqual(versions!.factors, ['off'])
})
