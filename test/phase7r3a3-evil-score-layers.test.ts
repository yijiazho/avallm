import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  observePublicRecord,
} from '../server/agents/analysis/observer.ts'
import {
  combineSituationAnalysisRequirements,
} from '../server/agents/analysis/situation-plan.ts'
import { projectJointIdentity } from '../server/agents/belief/identity.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  PRIVATE_IDENTITY_INPUT,
  PRIVATE_PUBLIC_OBSERVER_INPUT,
} from '../server/agents/components/legacy-role-adapters.ts'
import { projectPublicRecord } from '../server/agents/communication/public-record.ts'
import {
  canonicalDecisionFrame,
  prepareNativeScoreLayers,
  withDecisionAnalysis,
  withLegalCandidates,
  withNativeResolvedComponents,
  withNativeScoreLayers,
  withUniversalForcedPolicy,
} from '../server/agents/policy/decision-frame.ts'
import {
  evilRoleObjectiveScorer,
  goodProposalVoteScorer,
  roleObjectiveScorer,
  seededEvilRoleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededRoleObjectiveScorer,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  EVIL_ROLE_SCORE_LAYER,
  SEEDED_EVIL_ROLE_SCORE_LAYER,
  evilScoreLayerTerminalFor,
} from '../server/agents/score-layers/evil.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  GOOD_ROLE_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/good.ts'
import {
  createConfiguredScoreLayerRegistry,
} from '../server/agents/score-layers/configured.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import {
  replayDecisionScenario,
  type DecisionScenario,
  type LegalReplayStep,
} from './support/decision-scenario.ts'
import {
  readPhase7R3AScoreOracle,
  type Phase7R3AOracleScenario,
} from './support/phase7r3a-score-oracle.ts'

const oracle = readPhase7R3AScoreOracle()

const malformed = (source: CandidateScorer): CandidateScorer =>
  Object.freeze({ ...source, score: () => [] })

function options(configuration: string, seed: string) {
  switch (configuration) {
    case 'd2-deterministic':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: evilRoleObjectiveScorer,
      }
    case 'd2-seeded':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: seededEvilRoleObjectiveScorer,
      }
    case 'd2-malformed-fallback':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: malformed(seededEvilRoleObjectiveScorer),
      }
    default: throw new Error(`not a D2 scenario: ${configuration}`)
  }
}

function mechanical(decision: Decision): Decision {
  const result = structuredClone(decision)
  delete result.thinking
  delete result.notes
  if (result.kind === 'discuss') result.say = ''
  if (result.kind === 'propose') delete result.pitch
  if (result.kind === 'finalize' && !result.stick) delete result.reason
  return result
}

async function runOracleScenario(scenario: Phase7R3AOracleScenario) {
  return normalizeAgentOutput(await createComposedAgent(
    options(scenario.input.configuration, scenario.input.seed),
  ).decide(
    scenario.input.req as DecisionRequest,
    scenario.input.view as PlayerView,
  ))
}

function deterministicProposalScenario(): DecisionScenario<'propose'> {
  const game = createGame({
    seed: 'a3-replay-3',
    playerCount: 7,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  assert.equal(game.players[game.leaderSeat].alignment, 'evil')
  return replayDecisionScenario(game, [], {
    kind: 'propose',
    seat: game.leaderSeat,
    round: 1,
    proposalNum: 1,
  })
}

function seededVoteScenario(): DecisionScenario<'vote'> {
  const game = createGame({
    seed: 'a3-vote-0',
    playerCount: 10,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const mordred = game.players.find((player) => player.role === 'mordred')
  assert.ok(mordred)
  const steps: readonly LegalReplayStep[] = [{
    request: {
      kind: 'propose',
      seat: game.leaderSeat,
      round: 1,
      proposalNum: 1,
    },
    decision: { kind: 'propose', team: [0, 1, 2] },
  }]
  return replayDecisionScenario(game, steps, {
    kind: 'vote',
    seat: mordred.seat,
    round: 1,
    proposalNum: 1,
  })
}

async function nativeFrame(
  scenario: DecisionScenario<'propose' | 'vote'>,
  scorer: typeof evilRoleObjectiveScorer
    | typeof seededEvilRoleObjectiveScorer,
) {
  const agent = createComposedAgent({
    seed: scenario.source.seed,
    roleObjectiveRouter: true,
    scorer,
  })
  const brain = agent.resolvedBrain()
  const canonical = canonicalDecisionFrame(scenario.request, scenario.view)
  const legal = withLegalCandidates(canonical)
  const lease = prepareNativeScoreLayers(legal, brain)
  const cognition = reconstructCognition(scenario.view)
  const analyzed = withDecisionAnalysis(
    legal,
    cognition,
    combineSituationAnalysisRequirements(lease.requirements),
  )
  const forced = withUniversalForcedPolicy(analyzed)
  const identity = projectJointIdentity(cognition.belief, {
    roleQueries: [],
    hiddenTeam: true,
  })
  const observer = observePublicRecord(projectPublicRecord(scenario.view))
  const components = await withNativeResolvedComponents(
    forced,
    brain,
    lease,
    undefined,
    () => ({
      providers: [
        { input: PRIVATE_IDENTITY_INPUT, provide: () => identity },
        { input: PRIVATE_PUBLIC_OBSERVER_INPUT, provide: () => observer },
      ],
    }),
  )
  return withNativeScoreLayers(components, lease, {
    deterministicSeed: scenario.source.seed,
    compatibilityCandidateId: legal.legalCandidates[0].id,
  })
}

test('A3 exact singletons resolve matching ordered D2 chains', () => {
  const registry = createConfiguredScoreLayerRegistry()
  assert.equal(
    evilScoreLayerTerminalFor(evilRoleObjectiveScorer),
    EVIL_ROLE_SCORE_LAYER,
  )
  assert.equal(
    evilScoreLayerTerminalFor(seededEvilRoleObjectiveScorer),
    SEEDED_EVIL_ROLE_SCORE_LAYER,
  )
  assert.equal(
    evilScoreLayerTerminalFor({ ...evilRoleObjectiveScorer }),
    undefined,
  )
  assert.equal(
    evilScoreLayerTerminalFor(malformed(evilRoleObjectiveScorer)),
    undefined,
  )
  assert.deepEqual(
    registry.resolve({ terminal: EVIL_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      GOOD_ROLE_SCORE_LAYER,
      EVIL_ROLE_SCORE_LAYER,
    ],
  )
  assert.deepEqual(
    registry.resolve({ terminal: SEEDED_EVIL_ROLE_SCORE_LAYER }).order,
    [
      COMPATIBILITY_SCORE_LAYER,
      SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      SEEDED_GOOD_ROLE_SCORE_LAYER,
      SEEDED_EVIL_ROLE_SCORE_LAYER,
    ],
  )
})

test('legal replay drives deterministic proposal and seeded vote native layers', async () => {
  const cases = [
    [deterministicProposalScenario(), evilRoleObjectiveScorer],
    [seededVoteScenario(), seededEvilRoleObjectiveScorer],
  ] as const
  for (const [scenario, scorer] of cases) {
    assert.equal(scenario.request.seat, scenario.view.seat)
    assert.equal(scenario.request.round, scenario.view.round)
    assert.equal(scenario.request.proposalNum, scenario.view.proposalNum)
    assert.equal(
      scenario.source.throughSeq,
      scenario.view.events.at(-1)?.seq ?? -1,
    )
    const frame = await nativeFrame(scenario, scorer)
    assert.deepEqual(
      frame.scoreLayerRun.journal.map((entry) => entry.status),
      ['generated', 'inapplicable', 'inapplicable', 'applied'],
    )
    const terminal = frame.scoreLayerRun.journal.at(-1)!
    assert.equal(terminal.status, 'applied')
    if (terminal.status !== 'applied') {
      throw new Error('D2 terminal did not apply')
    }
    assert.deepEqual(terminal.componentReads, [{
      id: EVIL_ROLE_UTILITY_COMPONENT.id,
      version: EVIL_ROLE_UTILITY_COMPONENT.version,
    }])
    assert.deepEqual(terminal.attributedComponents, [
      {
        id: EVIL_ROLE_OBJECTIVE_COMPONENT.id,
        version: EVIL_ROLE_OBJECTIVE_COMPONENT.version,
      },
      {
        id: EVIL_ROLE_UTILITY_COMPONENT.id,
        version: EVIL_ROLE_UTILITY_COMPONENT.version,
      },
    ])
    for (const token of [
      EVIL_ROLE_OBJECTIVE_COMPONENT,
      EVIL_ROLE_UTILITY_COMPONENT,
    ]) {
      const use = frame.componentRun.policyUse.find(
        (entry) => entry.component.id === token.id,
      )
      assert.deepEqual(use, {
        component: { id: token.id, version: token.version },
        used: true,
        stages: ['candidate-score'],
      })
    }
    const allowed = new Set(frame.effectiveForced.allowedCandidateIds)
    assert.ok(allowed.has(frame.structuredCandidateId))
    assert.ok(frame.scores.every((row) =>
      allowed.has(row.candidateId)
        || (!row.viable && row.value === -Number.MAX_SAFE_INTEGER)))
  }
})

test('A0 D2 oracle remains exact for roles, seed modes, and forced policy', async () => {
  for (const id of [
    'd2:assassin-proposal-forced-filter',
    'd2:mordred-vote-seeded',
    'd2:minion-vote-deterministic',
    'd2:oberon-vote-forced-selection',
  ]) {
    const scenario = oracle.scenarios.find((candidate) => candidate.id === id)
    assert.ok(scenario)
    const result = await runOracleScenario(scenario)
    assert.deepEqual(
      mechanical(result.decision),
      scenario.expected.mechanicalDecision,
      id,
    )
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.trace!.candidateScores)),
      scenario.expected.candidateScores,
      id,
    )
    assert.deepEqual(
      result.trace!.forcedPolicyResult,
      scenario.expected.forcedPolicyResult,
      id,
    )
    assert.equal(
      result.trace!.structuredCandidateId,
      scenario.expected.structuredCandidateId,
      id,
    )
  }
})

test('D2 delegates by role and custom scorers remain wholly legacy', async () => {
  const delegation = [
    ['c2:merlin-proposal-deterministic', evilRoleObjectiveScorer,
      roleObjectiveScorer.version],
    ['c2:percival-vote-seeded', seededEvilRoleObjectiveScorer,
      seededRoleObjectiveScorer.version],
    ['phase4:good-vote-deterministic', evilRoleObjectiveScorer,
      goodProposalVoteScorer.version],
    ['phase4:good-vote-seeded', seededEvilRoleObjectiveScorer,
      seededGoodProposalVoteScorer.version],
  ] as const
  for (const [id, scorer, expectedVersion] of delegation) {
    const scenario = oracle.scenarios.find((candidate) => candidate.id === id)
    assert.ok(scenario)
    assert.equal(
      id.includes('merlin')
        ? scenario.input.view.role === 'merlin'
        : id.includes('percival')
          ? scenario.input.view.role === 'percival'
          : scenario.input.view.role === 'servant',
      true,
      id,
    )
    const output = normalizeAgentOutput(await createComposedAgent({
      seed: scenario.input.seed,
      roleObjectiveRouter: true,
      scorer,
    }).decide(
      scenario.input.req as DecisionRequest,
      scenario.input.view as PlayerView,
    ))
    assert.equal(output.trace!.componentVersions!.scorer, expectedVersion, id)
  }

  const clone = Object.freeze({ ...evilRoleObjectiveScorer })
  assert.equal(
    createComposedAgent({
      seed: 'a3-custom-legacy',
      roleObjectiveRouter: true,
      scorer: clone,
    }).resolvedBrain().scoreLayerChain,
    null,
  )
})

test('malformed D2 is frozen legacy fallback and deterministic replay is stable', async () => {
  const fallback = oracle.scenarios.find(
    (scenario) => scenario.id === 'd2:malformed-falls-to-phase4',
  )
  assert.ok(fallback)
  const degraded = await runOracleScenario(fallback)
  assert.deepEqual(
    mechanical(degraded.decision),
    fallback.expected.mechanicalDecision,
  )
  assert.deepEqual(degraded.trace!.degradation, fallback.expected.degradation)
  assert.equal(
    degraded.trace!.componentVersions!.scorer,
    fallback.expected.appliedVersions.scorer,
  )
  assert.equal(
    createComposedAgent(
      options(fallback.input.configuration, fallback.input.seed),
    ).resolvedBrain().scoreLayerChain,
    null,
  )

  const scenario = seededVoteScenario()
  const first = await nativeFrame(scenario, seededEvilRoleObjectiveScorer)
  const second = await nativeFrame(scenario, seededEvilRoleObjectiveScorer)
  assert.deepEqual(first.scores, second.scores)
  assert.equal(first.structuredCandidateId, second.structuredCandidateId)
  const viable = first.scores.filter((row) => row.viable)
  assert.ok(viable.length >= 1)
  assert.ok(viable.length <= 2)
})
