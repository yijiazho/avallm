import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  analyzeSituation,
  boardSituation,
} from '../server/agents/analysis/situation.ts'
import type {
  SituationAnalysis,
} from '../server/agents/analysis/types.ts'
import {
  EVIL_QUEST_CARD_POLICY_VERSION,
  EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  EVIL_QUEST_ROBUST_POLICY_VERSION,
  MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
  buildPrivateEvilQuestCardPolicy,
  validatePrivateEvilQuestCardPolicyHostJoin,
  type EvilQuestCardPolicyMode,
} from '../server/agents/policy/evil-quest-card.ts'
import {
  parseStdioDecisionReply,
  validateComposedTraceHostJoin,
} from '../server/agents/stdio.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import {
  CANDIDATE_SCORER_VERSION,
} from '../server/agents/policy/score.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import { runGame } from '../server/sim/runner.ts'
import { toArtifact } from '../server/eval/artifact.ts'
import { createHeuristicAgent } from '../server/agents/heuristic.ts'

const source = readDecisionFixtures()
  .find((fixture) => fixture.id === 'oberon-two-fail-quest')!

function coordinatedView(
  seat: Seat,
  visibleEvil: readonly Seat[],
  role: Role = 'assassin',
): PlayerView {
  const names = source.view.players.map((player) => ({
    ...player,
    name: `Seat ${player.seat}`,
  }))
  return {
    ...structuredClone(source.view),
    seat,
    name: names.find((player) => player.seat === seat)!.name,
    role,
    alignment: 'evil',
    privateInfo: {
      evilPartners: visibleEvil.filter((partner) => partner !== seat),
    },
    players: names,
  }
}

function request(view: PlayerView): DecisionRequest {
  return {
    kind: 'quest',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
}

function snapshot(
  view: PlayerView,
  mode: EvilQuestCardPolicyMode,
) {
  const req = request(view)
  const analysis = boardSituation(view) as SituationAnalysis
  return buildPrivateEvilQuestCardPolicy({
    req,
    view,
    analysis,
    mode,
  })
}

test('exact quota is independently reconstructed by every mutually visible evil', () => {
  const visible = [1, 4, 5]
  const bySeat = visible.map((seat) =>
    snapshot(coordinatedView(seat, visible), 'visible-exact-quota'))
  for (const policy of bySeat) {
    assert.equal(policy.version, EVIL_QUEST_CARD_POLICY_VERSION)
    assert.equal(
      policy.policyVersion,
      EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
    )
    assert.equal(policy.failsRequired, 2)
    assert.equal(policy.decisiveBoard, true)
    assert.equal(
      policy.coordinationAssumption,
      'homogeneous-common-policy-required',
    )
    assert.equal(policy.mixedTableSafe, false)
    assert.equal(policy.promotionEvidenceEligible, false)
    assert.deepEqual(policy.visibleEvilSeats, visible)
    assert.deepEqual(policy.visibleEvilAboard, visible)
    assert.deepEqual(policy.designation, bySeat[0].designation)
  }
  assert.equal(bySeat[0].designation.length, 2)
  assert.equal(
    bySeat.filter((policy) => policy.selectedCard === 'fail').length,
    2,
  )
  for (const policy of bySeat) {
    assert.equal(
      policy.selectedCard,
      policy.designation.includes(policy.request.seat)
        ? 'fail'
        : 'success',
    )
  }
})

test('independent real engine views reconstruct the homogeneous exact convention', () => {
  const game = createGame({
    playerCount: 10,
    roles: [
      'merlin', 'percival', 'servant', 'servant', 'servant',
      'servant', 'morgana', 'assassin', 'mordred', 'oberon',
    ],
    names: Array.from({ length: 10 }, (_, seat) => `P${seat}`),
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  }, 'phase7d3-independent-engine-views')
  const visibleEvil = game.players
    .filter((player) =>
      player.alignment === 'evil' && player.role !== 'oberon')
    .map((player) => player.seat)
    .sort((a, b) => a - b)
  const good = game.players
    .filter((player) => player.alignment === 'good')
    .map((player) => player.seat)
  const currentTeam = [...visibleEvil, ...good]
    .slice(0, game.config.playerCount === 10 ? 5 : 4)
    .sort((a, b) => a - b)
  const policies = visibleEvil.map((seat) => {
    const view = viewFor(game, seat)
    view.phase = 'quest'
    view.round = 4
    view.proposalNum = 3
    view.leaderSeat = good[0]
    view.currentTeam = currentTeam
    view.quests[0] = {
      ...view.quests[0],
      team: [visibleEvil[0], good[0]],
      result: 'success',
      failCount: 0,
    }
    view.quests[1] = {
      ...view.quests[1],
      team: [visibleEvil[1], good[0], good[1]],
      result: 'success',
      failCount: 0,
    }
    view.quests[2] = {
      ...view.quests[2],
      team: [visibleEvil[2], good[0], good[1], good[2]],
      result: 'fail',
      failCount: 1,
    }
    const policy = snapshot(view, 'visible-exact-quota')
    assert.deepEqual(
      [seat, ...(view.privateInfo.evilPartners ?? [])]
        .sort((a, b) => a - b),
      visibleEvil,
    )
    return policy
  })
  for (const policy of policies) {
    assert.deepEqual(policy.sourceContext, policies[0].sourceContext)
    assert.equal(policy.sourceFingerprint, policies[0].sourceFingerprint)
    assert.deepEqual(policy.visibleEvilSeats, visibleEvil)
    assert.deepEqual(policy.designation, policies[0].designation)
    assert.ok(
      Buffer.byteLength(JSON.stringify(policy), 'utf8')
        <= MAX_EVIL_QUEST_CARD_POLICY_JSON_BYTES,
    )
  }
  assert.equal(
    policies.filter((policy) => policy.selectedCard === 'fail').length,
    2,
  )
})

test('exact and robust decisive modes differ only in excess visible Fails', () => {
  const visible = [1, 4, 5]
  const exact = visible.map((seat) =>
    snapshot(coordinatedView(seat, visible), 'visible-exact-quota'))
  const robust = visible.map((seat) =>
    snapshot(coordinatedView(seat, visible), 'robust-heterogeneous'))
  assert.equal(
    exact.filter((policy) => policy.selectedCard === 'fail').length,
    2,
  )
  assert.equal(
    robust.filter((policy) => policy.selectedCard === 'fail').length,
    3,
  )
  for (const policy of robust) {
    assert.equal(policy.policyVersion, EVIL_QUEST_ROBUST_POLICY_VERSION)
    assert.equal(policy.reason, 'ROBUST_DECISIVE_FAIL')
    assert.equal(policy.coordinationAssumption, 'none')
    assert.equal(policy.mixedTableSafe, true)
    assert.equal(policy.promotionEvidenceEligible, true)
    assert.equal(policy.designation, undefined)
    assert.equal(policy.orderedVisibleEvilAboard, undefined)
  }
})

test('one-Fail exact quota holds at good, evil, and simultaneous match point', () => {
  const visible = [1, 4, 5]
  const boards = [
    ['success', 'success', 'fail', undefined],
    ['success', 'fail', 'fail', undefined],
    ['success', 'success', 'fail', 'fail'],
  ] as const
  for (const results of boards) {
    const policies = visible.map((seat) => {
      const view = coordinatedView(seat, visible)
      view.round = 5
      view.currentTeam = [1, 4, 5, 6]
      results.forEach((result, index) => {
        view.quests[index] = {
          ...view.quests[index],
          ...(result
            ? {
                result,
                failCount: result === 'fail' ? 1 : 0,
                team: view.quests[index].team
                  ?? view.currentTeam!.slice(
                    0,
                    view.quests[index].teamSize,
                  ),
              }
            : { result: undefined, failCount: undefined }),
        }
      })
      return snapshot(view, 'visible-exact-quota')
    })
    assert.ok(policies.every((policy) => policy.decisiveBoard))
    assert.equal(policies[0].failsRequired, 1)
    assert.equal(policies[0].designation!.length, 1)
    assert.equal(
      policies.filter((policy) => policy.selectedCard === 'fail').length,
      1,
    )
  }
})

test('insufficient visible quota holds and Oberon remains uncoordinated', () => {
  const insufficient = snapshot(
    coordinatedView(1, [1]),
    'visible-exact-quota',
  )
  assert.equal(insufficient.selectedCard, 'success')
  assert.deepEqual(insufficient.designation, [])
  assert.equal(
    insufficient.reason,
    'INSUFFICIENT_VISIBLE_QUOTA_SUCCESS',
  )

  const oberon = snapshot(
    coordinatedView(6, [1, 4, 5], 'oberon'),
    'visible-exact-quota',
  )
  assert.equal(oberon.applicable, false)
  assert.equal(oberon.selectedCard, undefined)
  assert.deepEqual(oberon.visibleEvilSeats, [])
  assert.deepEqual(oberon.designation, [])
  assert.equal(oberon.reason, 'OBERON_UNCOORDINATED')
})

test('all visible evil role labels share one convention without names', () => {
  const roles: readonly Role[] = [
    'assassin',
    'morgana',
    'mordred',
    'minion',
  ]
  const visible = [1, 4, 5]
  const outputs = roles.map((role, index) => {
    const view = coordinatedView(visible[index % visible.length], visible, role)
    view.name = `Renamed ${index}`
    view.players = view.players.map((player) => ({
      ...player,
      name: `Hostile name ${index}-${player.seat}`,
    }))
    return snapshot(view, 'visible-exact-quota')
  })
  for (const output of outputs) {
    assert.deepEqual(output.designation, outputs[0].designation)
    assert.deepEqual(output.sourceContext, outputs[0].sourceContext)
    assert.equal(output.sourceFingerprint, outputs[0].sourceFingerprint)
  }
})

test('robust nondecisive play is seat-local and makes no quota guarantee', () => {
  const visible = [4, 5]
  let pair: ReturnType<typeof snapshot>[] | undefined
  for (let proposalNum = 1; proposalNum <= 5 && !pair; proposalNum++) {
    for (let leaderSeat = 0; leaderSeat < 7 && !pair; leaderSeat++) {
      const policies = visible.map((seat) => {
        const view = coordinatedView(seat, visible)
        view.proposalNum = proposalNum
        view.leaderSeat = leaderSeat
        view.quests[0] = {
          ...view.quests[0],
          result: 'success',
          failCount: 0,
        }
        view.quests[1] = {
          ...view.quests[1],
          result: 'fail',
          failCount: 1,
        }
        view.quests[2] = {
          ...view.quests[2],
          result: undefined,
          failCount: undefined,
        }
        return snapshot(view, 'robust-heterogeneous')
      })
      if (policies[0].selectedCard !== policies[1].selectedCard) pair = policies
    }
  }
  assert.ok(pair, 'seat-local buckets should admit complementary choices')
  for (const policy of pair!) {
    assert.equal(policy.decisiveBoard, false)
    assert.equal(policy.coordinationAssumption, 'none')
    assert.equal(policy.orderedVisibleEvilAboard, undefined)
    assert.equal(policy.designation, undefined)
    assert.equal(typeof policy.slowPlayBucket, 'number')
    assert.equal(typeof policy.localSlowPlayFail, 'boolean')
    assert.ok(
      policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_FAIL'
      || policy.reason === 'ROBUST_LOCAL_SLOW_PLAY_HOLD',
    )
  }
})

test('composed exact policy is seed-invariant and forced policy stays final', async () => {
  const visible = [4, 5]
  const view = coordinatedView(4, visible)
  const req = request(view)
  const first = await createComposedAgent({
    seed: 'hidden-seed-a',
    evilQuestCardPolicy: 'visible-exact-quota',
  }).decide(req, view)
  const second = await createComposedAgent({
    seed: 'hidden-seed-b',
    evilQuestCardPolicy: 'visible-exact-quota',
  }).decide(req, view)
  assert.deepEqual(
    first.trace!.privateEvilQuestCardPolicy,
    second.trace!.privateEvilQuestCardPolicy,
  )
  assert.deepEqual(first.decision, second.decision)
  assert.equal(
    first.trace!.componentVersions!.evilQuestCardPolicy,
    EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  )
  assert.equal(
    first.trace!.componentVersions!.configuredEvilQuestCardPolicy,
    EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
  )
  assert.equal(
    first.trace!.chosenCandidateId,
    first.trace!.structuredCandidateId,
  )
  const robustA = await createComposedAgent({
    seed: 'unrelated-robust-a',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  const robustB = await createComposedAgent({
    seed: 'unrelated-robust-b',
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  assert.deepEqual(
    robustA.trace!.privateEvilQuestCardPolicy,
    robustB.trace!.privateEvilQuestCardPolicy,
  )
  assert.deepEqual(robustA.decision, robustB.decision)

  const goodView: PlayerView = {
    ...structuredClone(view),
    alignment: 'good',
    role: 'servant',
    privateInfo: {},
  }
  const good = await createComposedAgent({
    seed: 'irrelevant',
    evilQuestCardPolicy: 'visible-exact-quota',
  }).decide(request(goodView), goodView)
  assert.deepEqual(good.decision, { kind: 'quest', card: 'success' })
  assert.deepEqual(
    good.trace!.forcedPolicyResult!.reasonCodes,
    ['GOOD_QUEST_CARD_FORCED_SUCCESS'],
  )
})

test('D3 traces are host-reconstructed and mutation resistant', async () => {
  const view = coordinatedView(4, [4, 5])
  const req = request(view)
  const output = await createComposedAgent({
    seed: 'host-only-seed',
    evilQuestCardPolicy: 'visible-exact-quota',
  }).decide(req, view)
  const trace = output.trace!
  const policy = trace.privateEvilQuestCardPolicy!
  const analysis = analyzeSituation(view)
  assert.ok(validatePrivateEvilQuestCardPolicyHostJoin(policy, {
    req,
    view,
    analysis,
    mode: 'visible-exact-quota',
  }))
  assert.ok(validateComposedTraceHostJoin({
    trace,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'host-only-seed',
  }))
  assert.deepEqual(
    parseStdioDecisionReply(
      req,
      { decision: output.decision, trace },
      'D3 fixture',
      view,
    ),
    output,
  )

  for (const mutate of [
    (copy: typeof trace) => {
      copy.privateEvilQuestCardPolicy!.designation = [0] as never
    },
    (copy: typeof trace) => {
      copy.privateEvilQuestCardPolicy!.selectedCard =
        copy.privateEvilQuestCardPolicy!.selectedCard === 'fail'
          ? 'success'
          : 'fail'
    },
    (copy: typeof trace) => {
      copy.privateEvilQuestCardPolicy!.policyVersion =
        EVIL_QUEST_ROBUST_POLICY_VERSION
    },
    (copy: typeof trace) => {
      delete copy.privateEvilQuestCardPolicy
    },
  ]) {
    const forged = structuredClone(trace)
    mutate(forged)
    assert.equal(validateComposedTraceHostJoin({
      trace: forged,
      req,
      view,
      authoritativeAction: output.decision,
      selectedDecision: output.decision,
      deterministicSeed: 'host-only-seed',
    }), false)
  }
})

test('D3 private policy does not enter prompts, voice rendering, or client state', () => {
  for (const path of [
    '../server/agents/prompts.ts',
    '../server/agents/communication/composed-renderer.ts',
    '../client/src/App.tsx',
  ]) {
    const sourceText = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(
      sourceText,
      /privateEvilQuestCardPolicy|evilQuestCardPolicy|visibleEvilAboard|designation/,
    )
  }
})

test('free architecture bank attributes robust D3 and rejects artifact mutations', async () => {
  const variant: ArchitectureVariant = {
    id: 'phase7d3-robust-heterogeneous',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'off',
      policy: 'composed-policy-v1',
      scorer: CANDIDATE_SCORER_VERSION,
      planner: 'planner-off',
      voice: 'voice-off',
      evilQuestCardPolicy: EVIL_QUEST_ROBUST_POLICY_VERSION,
      populationAssumption: 'heterogeneous-independent',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      evilQuestCardPolicy: 'robust-heterogeneous',
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const artifacts = await runArchitectureBench({
    variants: [variant],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7d3-robust-heterogeneous',
  })
  assert.equal(artifacts.length, ARCHITECTURE_BANK.length)
  const report = architectureReport(artifacts).variants[0]
  assert.equal(report.safety.traceAttributionViolations, 0)
  assert.equal(report.safety.hiddenInformationViolations, 0)
  for (const artifact of artifacts) {
    assert.deepEqual(
      artifact.strategyVersions!.evilQuestCardPolicies,
      [EVIL_QUEST_ROBUST_POLICY_VERSION],
    )
    for (const trace of artifact.decisionTraces!) {
      assert.equal(
        trace.componentVersions!.configuredEvilQuestCardPolicy,
        EVIL_QUEST_ROBUST_POLICY_VERSION,
      )
      const applicable =
        trace.request.kind === 'quest'
        && !['merlin', 'percival', 'servant', 'oberon']
          .includes(artifact.architecture!.targetRole)
      assert.equal(
        trace.componentVersions!.evilQuestCardPolicy,
        applicable ? EVIL_QUEST_ROBUST_POLICY_VERSION : undefined,
      )
      assert.equal(
        trace.privateEvilQuestCardPolicy !== undefined,
        applicable,
      )
    }
  }

  const evilArtifact = artifacts.find((artifact) =>
    artifact.decisionTraces!.some(
      (trace) => trace.privateEvilQuestCardPolicy,
    ))!
  const replayCase = ARCHITECTURE_BANK.find(
    (candidate) =>
      candidate.id === evilArtifact.architecture!.caseId,
  )!
  const [replayed] = await runArchitectureBench({
    variants: [variant],
    cases: [replayCase],
    bankId: 'phase7d3-robust-heterogeneous-replay',
  })
  assert.deepEqual(replayed.log, evilArtifact.log)
  for (const mutate of [
    (copy: typeof evilArtifact) => {
      copy.decisionTraces!.find(
        (trace) => trace.privateEvilQuestCardPolicy,
      )!.privateEvilQuestCardPolicy!.slowPlayBucket = 0.999
    },
    (copy: typeof evilArtifact) => {
      delete copy.decisionTraces!.find(
        (trace) => trace.privateEvilQuestCardPolicy,
      )!.privateEvilQuestCardPolicy
    },
    (copy: typeof evilArtifact) => {
      const policy = copy.decisionTraces!.find(
        (trace) => trace.privateEvilQuestCardPolicy,
      )!.privateEvilQuestCardPolicy!
      policy.designation = [policy.request.seat]
      policy.orderedVisibleEvilAboard = [policy.request.seat]
    },
    (copy: typeof evilArtifact) => {
      copy.strategyVersions!.evilQuestCardPolicies = []
    },
  ]) {
    const forged = structuredClone(evilArtifact)
    mutate(forged)
    assert.ok(
      architectureReport([forged]).variants[0]
        .safety.traceAttributionViolations > 0,
    )
  }
})

test('target-only architecture runs cannot claim homogeneous exact evidence', async () => {
  const exactVariant: ArchitectureVariant = {
    id: 'invalid-target-only-exact',
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'off',
      policy: 'composed-policy-v1',
      scorer: CANDIDATE_SCORER_VERSION,
      planner: 'planner-off',
      voice: 'voice-off',
      evilQuestCardPolicy: EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
      populationAssumption: 'homogeneous-all-evil-verified',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      evilQuestCardPolicy: 'visible-exact-quota',
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  await assert.rejects(
    runArchitectureBench({
      variants: [exactVariant],
      cases: [ARCHITECTURE_BANK[4]],
      bankId: 'invalid-target-only-exact',
    }),
    /cannot verify the homogeneous all-evil population/,
  )
})

test('stored target-only exact artifacts remain unverified despite a claimed label', async () => {
  const bankCase = ARCHITECTURE_BANK.find(
    (candidate) => candidate.targetRole === 'mordred',
  )!
  const game = createGame({
    playerCount: bankCase.playerCount,
    roles: [...bankCase.roles],
    names: Array.from(
      { length: bankCase.playerCount },
      (_, seat) => `P${seat}`,
    ),
    talk: { ...bankCase.talk },
  }, bankCase.seed)
  const traces: NonNullable<
    ReturnType<typeof toArtifact>['decisionTraces']
  > = []
  const agents = new Map(
    game.players.map((player) => [
      player.seat,
      player.seat === bankCase.expectedTargetSeat
        ? createComposedAgent({
            seed: bankCase.seed,
            evilQuestCardPolicy: 'visible-exact-quota',
          })
        : createHeuristicAgent({
            seed: bankCase.seed,
            seat: player.seat,
          }),
    ]),
  )
  const result = await runGame({
    game,
    agents,
    onDecisionTrace: (trace) => traces.push(structuredClone(trace)),
  })
  const exactComponents = {
    mode: 'compatibility',
    brain: 'brain-spec-v1',
    belief: 'exact-constraints-v1',
    factors: 'off',
    languageEvidence: 'off',
    observerModel: 'off',
    policy: 'composed-policy-v1',
    scorer: CANDIDATE_SCORER_VERSION,
    planner: 'planner-off',
    voice: 'voice-off',
    evilQuestCardPolicy: EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION,
    populationAssumption: 'homogeneous-all-evil-verified',
  }
  const artifact = toArtifact(result.game, {
    agents: result.game.players.map((player) =>
      player.seat === bankCase.expectedTargetSeat
        ? 'composed:target-only-exact'
        : 'heuristic'),
    degraded: result.degraded,
    steps: result.steps,
    decisionTraces: traces,
    architecture: {
      bank: 'phase7d3-target-only-exact',
      caseId: bankCase.id,
      targetRole: bankCase.targetRole,
      targetSeat: bankCase.expectedTargetSeat,
      variant: 'claimed-homogeneous-exact',
      components: exactComponents,
    },
  })
  assert.deepEqual(
    artifact.strategyVersions!.evilQuestCardPolicies,
    [EVIL_QUEST_EXACT_QUOTA_POLICY_VERSION],
  )
  assert.ok(traces.some(
    (trace) => trace.privateEvilQuestCardPolicy,
  ))
  assert.ok(
    architectureReport([artifact]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
})
