import test from 'node:test'
import assert from 'node:assert/strict'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type { DecisionRequest, PlayerView } from '../server/engine/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  evilRoleObjectiveScorer,
  morganaRoleScorer,
  seededMorganaRoleScorer,
} from '../server/agents/policy/score.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
  MORGANA_ROLE_SEEDED_SCORER_VERSION,
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  MAX_MORGANA_ROLE_UTILITY_ASSESSMENTS,
  MAX_MORGANA_ROLE_UTILITY_JSON_BYTES,
  buildMorganaRoleUtilityProjection,
  validatePrivateMorganaRoleUtilityProjection,
} from '../server/agents/analysis/morgana-role-utility.ts'
import { validateComposedTraceHostJoin } from '../server/agents/stdio.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import {
  authoritativeDecisionSnapshots,
} from '../server/eval/trace-replay.ts'
import { JOINT_IDENTITY_MODEL_VERSION } from '../server/agents/belief/identity.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../server/agents/analysis/observer-types.ts'
import { ROLE_OBJECTIVE_ROUTER_VERSION } from '../server/agents/analysis/evil-objective-types.ts'
import { EVIL_ROLE_UTILITY_PROJECTION_VERSION } from '../server/agents/analysis/evil-role-utility.ts'
import { ROLE_UTILITY_PROJECTION_VERSION } from '../server/agents/analysis/role-utility.ts'
import { MORGANA_COUNTERFEIT_OBJECTIVE_VERSION } from '../server/agents/analysis/morgana-counterfeit-types.ts'
import {
  MORGANA_ROLE_SCORER_DEGRADATION,
  MORGANA_ROLE_UTILITY_DEGRADATION,
} from '../server/agents/analysis/morgana-role-utility.ts'
import {
  parseStdioDecisionReply,
} from '../server/agents/stdio.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
} from '../server/agents/policy/score.ts'
import {
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  EVIL_ROLE_UTILITY_CONSTANTS,
  validatePrivateEvilRoleUtilityProjection,
} from '../server/agents/analysis/evil-role-utility.ts'
import {
  validatePrivateMorganaCounterfeitObjective,
} from '../server/agents/analysis/morgana-counterfeit.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import { canonicalWorldKey } from '../server/agents/belief/worlds.ts'
import type { Role } from '../server/engine/types.ts'
import {
  EVIL_QUEST_ROBUST_POLICY_VERSION,
} from '../server/agents/policy/evil-quest-card.ts'

function morganaProposal(
  playerCount = 9,
): {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest
} {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const game = createGame({
      seed: `phase7e1b-propose-${playerCount}-${attempt}`,
      playerCount,
    })
    const morgana = game.players.find((player) => player.role === 'morgana')!
    if (morgana.seat !== game.leaderSeat) continue
    const view = viewFor(game, morgana.seat)
    const req: DecisionRequest = {
      kind: 'propose',
      seat: morgana.seat,
      round: game.round,
      proposalNum: game.proposalNum,
    }
    return { game, view, req }
  }
  throw new Error('could not find Morgana proposal fixture')
}

function canonicalTeams(
  playerCount: number,
  size: number,
): readonly number[][] {
  const out: number[][] = []
  const selected: number[] = []
  const visit = (start: number): void => {
    if (selected.length === size) {
      out.push(selected.slice())
      return
    }
    for (
      let seat = start;
      seat <= playerCount - (size - selected.length);
      seat++
    ) {
      selected.push(seat)
      visit(seat + 1)
      selected.pop()
    }
  }
  visit(0)
  return out
}

function asVote(
  view: PlayerView,
  team: readonly number[],
): {
  view: PlayerView
  req: DecisionRequest
} {
  const voteView = structuredClone(view)
  voteView.phase = 'vote'
  voteView.currentTeam = [...team]
  return {
    view: voteView,
    req: {
      kind: 'vote',
      seat: voteView.seat,
      round: voteView.round,
      proposalNum: voteView.proposalNum,
    },
  }
}

test('opt-in Morgana policy resolves above D2 with exact private attribution', async () => {
  const { game, view, req } = morganaProposal()
  const result = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(req, view)
  const trace = result.trace!
  assert.equal(trace.componentVersions!.scorer, MORGANA_ROLE_SCORER_VERSION)
  assert.equal(
    trace.componentVersions!.morganaRoleUtility,
    MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  )
  assert.equal(
    trace.componentVersions!.configuredMorganaRoleUtility,
    MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
  )
  assert.ok(
    validatePrivateMorganaRoleUtilityProjection(
      trace.privateMorganaRoleUtility,
    ),
  )
  assert.equal(
    trace.privateMorganaRoleUtility!.selectedCandidateId,
    trace.structuredCandidateId,
  )
  assert.equal(
    trace.candidateScores!.filter((score) => score.viable).length,
    1,
  )
  assert.ok(validateComposedTraceHostJoin({
    trace,
    req,
    view,
    authoritativeAction: result.decision,
    selectedDecision: result.decision,
    deterministicSeed: game.seed,
  }))
})

test('Morgana proposals are seed invariant and ineligible roles truthfully resolve to D2', async () => {
  const { game, view, req } = morganaProposal()
  const first = await createComposedAgent({
    seed: 'morgana-seed-a',
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(req, view)
  const second = await createComposedAgent({
    seed: 'morgana-seed-b',
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(req, view)
  assert.deepEqual(first.decision, second.decision)
  assert.equal(
    first.trace!.componentVersions!.scorer,
    MORGANA_ROLE_SEEDED_SCORER_VERSION,
  )
  assert.equal(
    first.trace!.privateMorganaRoleUtility!.seedBucket,
    undefined,
  )

  const other = game.players.find(
    (player) => player.alignment === 'evil' && player.role !== 'morgana',
  )!
  const otherView = viewFor(game, other.seat)
  otherView.phase = 'vote'
  otherView.currentTeam = [0, 1, 2].slice(
    0,
    otherView.quests[otherView.round - 1].teamSize,
  )
  const otherReq: DecisionRequest = {
    kind: 'vote',
    seat: other.seat,
    round: otherView.round,
    proposalNum: otherView.proposalNum,
  }
  const ineligible = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(otherReq, otherView)
  assert.equal(
    ineligible.trace!.componentVersions!.scorer,
    evilRoleObjectiveScorer.version,
  )
  assert.equal(
    ineligible.trace!.componentVersions!.configuredScorer,
    MORGANA_ROLE_SCORER_VERSION,
  )
  assert.equal(
    ineligible.trace!.componentVersions!.morganaRoleUtility,
    undefined,
  )
  assert.equal(ineligible.trace!.privateMorganaRoleUtility, undefined)
})

test('counterfeit value causally changes an actual proposal only inside the D2 band', async () => {
  let found:
    | {
        d2: Awaited<ReturnType<ReturnType<typeof createComposedAgent>['decide']>>
        morgana: Awaited<ReturnType<ReturnType<typeof createComposedAgent>['decide']>>
      }
    | undefined
  for (let playerCount = 5; playerCount <= 10 && !found; playerCount++) {
    for (let attempt = 0; attempt < 120 && !found; attempt++) {
      const game = createGame({
        seed: `phase7e1b-causal-${playerCount}-${attempt}`,
        playerCount,
      })
      const seat = game.players.find((player) => player.role === 'morgana')!
      if (seat.seat !== game.leaderSeat) continue
      const view = viewFor(game, seat.seat)
      const req: DecisionRequest = {
        kind: 'propose',
        seat: seat.seat,
        round: game.round,
        proposalNum: game.proposalNum,
      }
      const d2 = await createComposedAgent({
        seed: game.seed,
        roleObjectiveRouter: true,
        scorer: evilRoleObjectiveScorer,
      }).decide(req, view)
      const morgana = await createComposedAgent({
        seed: game.seed,
        roleObjectiveRouter: true,
        scorer: morganaRoleScorer,
      }).decide(req, view)
      const projection = morgana.trace!.privateMorganaRoleUtility!
      const selected = projection.candidates.find(
        (candidate) =>
          candidate.candidateId === projection.selectedCandidateId,
      )!
      const d2Selected = projection.candidates.find(
        (candidate) =>
          candidate.candidateId === d2.trace!.structuredCandidateId,
      )!
      if (
        d2.trace!.structuredCandidateId
          !== morgana.trace!.structuredCandidateId
        && selected.counterfeitValue > d2Selected.counterfeitValue
      ) found = { d2, morgana }
    }
  }
  assert.ok(found, 'expected an authentic in-band Morgana causal fixture')
  const projection = found.morgana.trace!.privateMorganaRoleUtility!
  const selected = projection.candidates.find(
    (candidate) => candidate.candidateId === projection.selectedCandidateId,
  )!
  const d2Selected = projection.candidates.find(
    (candidate) =>
      candidate.candidateId === found!.d2.trace!.structuredCandidateId,
  )!
  assert.equal(selected.inD2ViableBand, true)
  assert.equal(d2Selected.inD2ViableBand, true)
  assert.ok(selected.counterfeitValue > d2Selected.counterfeitValue)
  assert.ok(
    projection.candidates
      .filter((candidate) => !candidate.inD2ViableBand)
      .every((candidate) =>
        !found!.morgana.trace!.candidateScores!.find(
          (score) => score.candidateId === candidate.candidateId,
        )!.viable),
  )
})

test('seeded variation is vote-only, replayable, and confined to a hand-worked near-equal D2 band', async () => {
  const proposal = morganaProposal(5)
  const team = canonicalTeams(
    proposal.view.playerCount,
    proposal.view.quests[proposal.view.round - 1].teamSize,
  )[0]
  const vote = asVote(proposal.view, team)
  const authentic = await createComposedAgent({
    seed: proposal.game.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(vote.req, vote.view)
  const trace = authentic.trace!
  const counterfeit = structuredClone(
    trace.privateMorganaCounterfeitObjective!,
  )
  const threshold = counterfeit.request.failsRequired
  for (const assessment of counterfeit.assessments) {
    const support = assessment.candidate.direction === 'support'
    assessment.merlinVisibleEvilCountDistribution.fill(0)
    assessment.publicEvilCountDistribution.fill(0)
    assessment.merlinVisibleEvilCountDistribution[
      support ? 0 : threshold
    ] = 1
    assessment.publicEvilCountDistribution[support ? 0 : threshold] = 1
    assessment.merlinVisibleFailureCapabilityProbability =
      support ? 0 : 1
    assessment.publicFailureCapabilityProbability = support ? 0 : 1
    assessment.expectedMerlinConsistencyIndex = 1
    assessment.publicConsistencyBaselineIndex = 1
    assessment.privateKnowledgeTellIndex = 0
    assessment.publicAmbiguityIndex = 0
    assessment.counterfeitSignalIndex = 0
    assessment.counterfeitValue =
      assessment.counterfeitOpportunityReadProxyIndex
  }
  assert.ok(validatePrivateMorganaCounterfeitObjective(counterfeit))

  const d2 = structuredClone(trace.privateEvilRoleUtility!)
  const bases: number[] = []
  for (const assessment of d2.assessments) {
    assessment.participantCoverProxyIndex = 0.5
    if (assessment.direction === 'support') {
      assessment.teamFailureCapabilityProbability = 0.5
      assessment.failureCapacityValue = 0.5
    } else {
      assessment.bestAlternativeFailureCapabilityProbability =
        0.5 / assessment.alternativeRealization
      assessment.failureCapacityValue = 0.5
    }
    assessment.failureCapacityContribution =
      EVIL_ROLE_UTILITY_CONSTANTS.failureCapacityWeight
        * assessment.failureCapacityValue
    bases.push(
      assessment.failureCapacityContribution
        + assessment.futureOpportunityContribution
        + EVIL_ROLE_UTILITY_CONSTANTS.publicCoverWeight * 0.25,
    )
  }
  const target = Math.max(...bases)
  for (const [index, assessment] of d2.assessments.entries()) {
    const publicAction = (target - bases[index])
      / (EVIL_ROLE_UTILITY_CONSTANTS.publicCoverWeight * 0.5)
    assert.ok(publicAction >= 0 && publicAction <= 1)
    assessment.publicTeamFailureCapabilityProbability =
      assessment.direction === 'support'
        ? 1 - publicAction
        : publicAction
    assessment.publicActionPlausibilityValue = publicAction
    assessment.publicCoverValue = 0.5 * publicAction + 0.25
    assessment.publicCoverContribution =
      EVIL_ROLE_UTILITY_CONSTANTS.publicCoverWeight
        * assessment.publicCoverValue
    assessment.roleValue =
      assessment.failureCapacityContribution
        + assessment.publicCoverContribution
        + assessment.futureOpportunityContribution
  }
  assert.ok(validatePrivateEvilRoleUtilityProjection(d2))
  assert.ok(Math.abs(
    d2.assessments[0].roleValue - d2.assessments[1].roleValue,
  ) <= 1e-12)

  const candidates = legalCandidates(vote.req, vote.view)
  const build = (seed: string) => buildMorganaRoleUtilityProjection({
    req: vote.req,
    view: vote.view,
    candidates,
    forced: trace.forcedPolicyResult!,
    counterfeitObjective: counterfeit,
    evilRoleUtility: d2,
    selectionMode: 'seeded-near-equal-vote-within-d2-band',
    deterministicSeed: seed,
  })
  const buckets = new Map<number, ReturnType<typeof build>>()
  for (let index = 0; index < 32; index++) {
    const projection = build(`phase7e1b-hand-vote-${index}`)
    buckets.set(projection.seedBucket!, projection)
  }
  assert.deepEqual([...buckets.keys()].sort(), [0, 1])
  for (const [bucket, projection] of buckets) {
    assert.ok(validatePrivateMorganaRoleUtilityProjection(projection))
    assert.equal(
      (projection.selectedDecision as Extract<
        typeof projection.selectedDecision,
        { kind: 'vote' }
      >).vote,
      bucket === 0 ? 'approve' : 'reject',
    )
    assert.deepEqual(
      projection,
      build(
        [...Array(32).keys()]
          .map((index) => `phase7e1b-hand-vote-${index}`)
          .find((seed) => build(seed).seedBucket === bucket)!,
      ),
    )
  }
})

test('an actual good-match-point forced vote remains authoritative over Morgana policy', async () => {
  const proposal = morganaProposal(5)
  const view = structuredClone(proposal.view)
  view.phase = 'vote'
  view.round = 4
  view.proposalNum = 1
  const seats = view.players.map((player) => player.seat)
  const teamFor = (index: number, required?: number) => {
    const size = view.quests[index].teamSize
    return required === undefined
      ? seats.slice(0, size)
      : [
          required,
          ...seats.filter((seat) => seat !== required),
        ].slice(0, size).sort((left, right) => left - right)
  }
  view.quests[0] = {
    ...view.quests[0],
    team: teamFor(0),
    result: 'success',
    failCount: 0,
  }
  view.quests[1] = {
    ...view.quests[1],
    team: teamFor(1),
    result: 'success',
    failCount: 0,
  }
  view.quests[2] = {
    ...view.quests[2],
    team: teamFor(2, view.seat),
    result: 'fail',
    failCount: 1,
  }
  view.currentTeam = teamFor(3, view.seat)
  const req: DecisionRequest = {
    kind: 'vote',
    seat: view.seat,
    round: 4,
    proposalNum: 1,
  }
  const result = await createComposedAgent({
    seed: proposal.game.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(req, view)
  assert.deepEqual(result.decision, { kind: 'vote', vote: 'approve' })
  assert.equal(
    result.trace!.forcedPolicyResult!.selectedCandidateId,
    'legal-candidates-v1:vote:approve',
  )
  assert.equal(
    result.trace!.privateMorganaRoleUtility!.selectedCandidateId,
    result.trace!.forcedPolicyResult!.selectedCandidateId,
  )
  assert.deepEqual(
    result.trace!.candidateScores!.filter((score) => score.viable)
      .map((score) => score.candidateId),
    [result.trace!.forcedPolicyResult!.selectedCandidateId],
  )
})

test('Morgana scorer failure falls to D2 with separate attribution', async () => {
  const { game, view, req } = morganaProposal(5)
  const malformed = {
    ...morganaRoleScorer,
    score() {
      return []
    },
  }
  const result = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: malformed,
  }).decide(req, view)
  assert.equal(
    result.trace!.componentVersions!.scorer,
    EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  )
  assert.equal(
    result.trace!.componentVersions!.configuredScorer,
    MORGANA_ROLE_SCORER_VERSION,
  )
  assert.ok(result.trace!.degradation.includes('scorer-invalid-output'))
  assert.ok(
    result.trace!.degradation.includes(MORGANA_ROLE_SCORER_DEGRADATION),
  )
  assert.equal(
    result.trace!.degradation.includes(
      'evil-role-objective-scorer-failed',
    ),
    false,
  )
})

test('an E1A-only malformed belief degrades narrowly to D2', async () => {
  const input = morganaProposal(9)
  const malformedBelief = {
    version: 'phase7e1b-forged-partner-swap-v1',
    factorsVersion: 'off',
    infer(view: PlayerView) {
      const snapshot = structuredClone(exactBelief(view))
      const partner = view.privateInfo.evilPartners![0]
      const world = structuredClone(snapshot.worlds[0].world)
      const goodSeat = world.alignmentBySeat.findIndex(
        (alignment) => alignment === 'good',
      )
      const partnerRole = world.roleBySeat[partner]
      const goodRole = world.roleBySeat[goodSeat]
      ;(world.roleBySeat as Role[])[partner] = goodRole
      ;(world.roleBySeat as Role[])[goodSeat] = partnerRole
      ;(world.alignmentBySeat as ('good' | 'evil')[])[partner] = 'good'
      ;(world.alignmentBySeat as ('good' | 'evil')[])[goodSeat] = 'evil'
      world.key = canonicalWorldKey(world.roleBySeat)
      ;(snapshot.worlds as {
        world: typeof world
        probability: number
      }[])[0].world = world
      snapshot.modelVersion = this.version
      return snapshot
    },
  }
  const result = await createComposedAgent({
    seed: input.game.seed,
    beliefModel: malformedBelief,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(input.req, input.view)
  assert.equal(
    result.trace!.componentVersions!.scorer,
    EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  )
  assert.equal(
    result.trace!.componentVersions!.configuredScorer,
    MORGANA_ROLE_SCORER_VERSION,
  )
  assert.ok(result.trace!.privateEvilRoleUtility)
  assert.equal(result.trace!.privateMorganaRoleUtility, undefined)
  assert.ok(result.trace!.degradation.includes(
    'morgana-objective-assessment-failed',
  ))
  assert.ok(result.trace!.degradation.includes(
    MORGANA_ROLE_UTILITY_DEGRADATION,
  ))
  assert.equal(
    result.trace!.degradation.includes(
      'evil-role-utility-projection-failed',
    ),
    false,
  )
})

test('weighted runtime stays causal and host admission preserves nonpromotion', async () => {
  const input = morganaProposal(9)
  const partner = input.view.privateInfo.evilPartners![0]
  const weightedModel = {
    version: 'phase7e1b-weighted-mordred-v1',
    factorsVersion: 'phase7e1b-test-factor-v1',
    infer(view: PlayerView) {
      const source = exactBelief(view)
      return beliefFromWeightedWorlds(
        view,
        source.worlds.map((weighted) => ({
          world: weighted.world,
          probability:
            weighted.world.roleBySeat[partner] === 'mordred' ? 99 : 1,
        })),
        {
          modelVersion: this.version,
          quality: 'weighted',
        },
      )
    },
  }
  const result = await createComposedAgent({
    seed: input.game.seed,
    beliefModel: weightedModel,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(input.req, input.view)
  assert.equal(result.trace!.quality, 'weighted')
  assert.ok(result.trace!.privateMorganaRoleUtility)
  assert.equal(
    result.trace!.componentVersions!.scorer,
    MORGANA_ROLE_SCORER_VERSION,
  )
  assert.throws(() => parseStdioDecisionReply(
    input.req,
    result,
    'phase7e1b weighted external admission',
    input.view,
  ))
  assert.equal(validateComposedTraceHostJoin({
    trace: result.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: result.decision,
    selectedDecision: result.decision,
    deterministicSeed: input.game.seed,
  }), true)
})

test('E1B leaves the independent robust D3 quest-card path unchanged', async () => {
  const input = morganaProposal(5)
  const view = structuredClone(input.view)
  view.phase = 'quest'
  view.currentTeam = [
    view.seat,
    ...view.players
      .map((player) => player.seat)
      .filter((seat) => seat !== view.seat),
  ].slice(0, view.quests[view.round - 1].teamSize).sort(
    (left, right) => left - right,
  )
  const req: DecisionRequest = {
    kind: 'quest',
    seat: view.seat,
    round: view.round,
    proposalNum: view.proposalNum,
  }
  const baseline = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  const layered = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
    evilQuestCardPolicy: 'robust-heterogeneous',
  }).decide(req, view)
  assert.deepEqual(layered.decision, baseline.decision)
  assert.deepEqual(
    layered.trace!.privateEvilQuestCardPolicy,
    baseline.trace!.privateEvilQuestCardPolicy,
  )
  assert.equal(
    layered.trace!.componentVersions!.evilQuestCardPolicy,
    EVIL_QUEST_ROBUST_POLICY_VERSION,
  )
  assert.equal(layered.trace!.privateMorganaRoleUtility, undefined)
})

test('Morgana policy values and reasons stay out of rendered planner, voice, communication, and PlayerView', async () => {
  const input = morganaProposal(5)
  let renderedPlanner = ''
  let renderedVoice = ''
  const result = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
    planner: {
      version: 'phase7e1b-fake-planner',
      async choose(plannerInput) {
        renderedPlanner = plannerInput.renderedContext
        return { candidateId: plannerInput.structuredCandidateId }
      },
    },
    voice: {
      version: 'phase7e1b-fake-voice',
      async speak(voiceInput) {
        renderedVoice = voiceInput.renderedPlan
        return { text: 'A public cover line.' }
      },
    },
  }).decide(input.req, input.view)
  const privatePattern =
    /morganaRole|counterfeitValue|counterfeitRank|MORGANA_COUNTERFEIT/
  assert.doesNotMatch(renderedPlanner, privatePattern)
  assert.doesNotMatch(renderedVoice, privatePattern)
  assert.doesNotMatch(
    JSON.stringify(result.trace!.communicationIntent),
    privatePattern,
  )
  assert.doesNotMatch(JSON.stringify(input.view), privatePattern)
})

test('standalone Morgana projection rejects nested team, band, rank, seed, and selection forgeries', async () => {
  const { game, view, req } = morganaProposal()
  const result = await createComposedAgent({
    seed: game.seed,
    roleObjectiveRouter: true,
    scorer: seededMorganaRoleScorer,
  }).decide(req, view)
  const projection = result.trace!.privateMorganaRoleUtility!
  const mutate = (fn: (copy: any) => void): void => {
    const copy = structuredClone(projection)
    fn(copy)
    assert.equal(validatePrivateMorganaRoleUtilityProjection(copy), false)
  }
  mutate((copy) => {
    copy.candidates[0].d2RoleValue += 0.01
  })
  mutate((copy) => {
    copy.candidates[0].counterfeitRank += 1
  })
  mutate((copy) => {
    copy.selectedCandidateId = copy.candidates.at(-1).candidateId
    copy.selectedDecision = copy.candidates.at(-1).decision
  })
  mutate((copy) => {
    copy.seedBucket = 0
  })
  mutate((copy) => {
    copy.counterfeitObjective.assessments[0].candidate.team =
      copy.counterfeitObjective.assessments[1].candidate.team
  })
})

test('stdio and exact host replay reject nested, score, deletion, action, and simultaneous vote-team forgeries', async () => {
  const proposal = morganaProposal(5)
  const teams = canonicalTeams(
    proposal.view.playerCount,
    proposal.view.quests[proposal.view.round - 1].teamSize,
  )
  const input = asVote(proposal.view, teams[0])
  const output = await createComposedAgent({
    seed: proposal.game.seed,
    roleObjectiveRouter: true,
    scorer: morganaRoleScorer,
  }).decide(input.req, input.view)
  assert.ok(parseStdioDecisionReply(
    input.req,
    output,
    'phase7e1b',
    input.view,
  ).trace)
  assert.ok(validateComposedTraceHostJoin({
    trace: output.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: proposal.game.seed,
  }))
  const mutations = [
    (trace: NonNullable<typeof output.trace>) => {
      trace.privateMorganaRoleUtility!.candidates[0]
        .counterfeitValue += 0.01
    },
    (trace: NonNullable<typeof output.trace>) => {
      trace.privateMorganaRoleUtility!.evilRoleUtility.assessments[0]
        .roleValue += 0.01
    },
    (trace: NonNullable<typeof output.trace>) => {
      trace.privateMorganaRoleUtility!.counterfeitObjective
        .assessments[0].counterfeitValue += 0.01
    },
    (trace: NonNullable<typeof output.trace>) => {
      trace.candidateScores![0].morganaRoleObjectiveFeatures!
        .counterfeitValue += 0.01
    },
    (trace: NonNullable<typeof output.trace>) => {
      delete trace.privateMorganaRoleUtility
      delete trace.componentVersions!.morganaRoleUtility
      trace.componentVersions!.scorer =
        EVIL_ROLE_OBJECTIVE_SCORER_VERSION
      trace.componentVersions!.configuredScorer =
        MORGANA_ROLE_SCORER_VERSION
      trace.degradation.push(MORGANA_ROLE_UTILITY_DEGRADATION)
    },
    (trace: NonNullable<typeof output.trace>) => {
      const other = trace.candidateScores!.find(
        (score) => score.candidateId !== trace.structuredCandidateId,
      )!
      trace.structuredCandidateId = other.candidateId
      trace.chosenCandidateId = other.candidateId
    },
    (trace: NonNullable<typeof output.trace>) => {
      const replacement = teams.find(
        (team) => JSON.stringify(team) !== JSON.stringify(
          input.view.currentTeam,
        ),
      )!
      const applyTeam = (
        objective: NonNullable<
          typeof trace.privateMorganaCounterfeitObjective
        >,
        d2: NonNullable<typeof trace.privateEvilRoleUtility>,
      ) => {
        objective.request.currentTeam = replacement
        for (const assessment of objective.assessments) {
          assessment.candidate.team = replacement
        }
        for (const assessment of d2.assessments) {
          assessment.team = replacement
        }
      }
      const projection = trace.privateMorganaRoleUtility!
      projection.request.currentTeam = replacement
      applyTeam(
        projection.counterfeitObjective,
        projection.evilRoleUtility,
      )
      applyTeam(
        trace.privateMorganaCounterfeitObjective!,
        trace.privateEvilRoleUtility!,
      )
    },
  ]
  for (const mutate of mutations) {
    const forged = structuredClone(output)
    mutate(forged.trace!)
    assert.throws(() => parseStdioDecisionReply(
      input.req,
      forged,
      'phase7e1b forged',
      input.view,
    ))
    assert.equal(validateComposedTraceHostJoin({
      trace: forged.trace!,
      req: input.req,
      view: input.view,
      authoritativeAction: output.decision,
      selectedDecision: output.decision,
      deterministicSeed: proposal.game.seed,
    }), false)
  }
})

test('exact reconstructable E1B rejects coherent D2 projection degradation across admission paths', async () => {
  const input = morganaProposal()
  const d2 = await createComposedAgent({
    seed: input.game.seed,
    roleObjectiveRouter: true,
    morganaCounterfeitObjectives: true,
    scorer: evilRoleObjectiveScorer,
  }).decide(input.req, input.view)
  const forged = structuredClone(d2)
  forged.trace!.componentVersions!.configuredScorer =
    MORGANA_ROLE_SCORER_VERSION
  forged.trace!.componentVersions!.configuredMorganaRoleUtility =
    MORGANA_ROLE_UTILITY_PROJECTION_VERSION
  forged.trace!.degradation.push(MORGANA_ROLE_UTILITY_DEGRADATION)
  assert.equal(
    forged.trace!.componentVersions!.scorer,
    EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  )
  assert.ok(forged.trace!.privateMorganaCounterfeitObjective)
  assert.ok(forged.trace!.privateEvilRoleUtility)
  assert.throws(() => parseStdioDecisionReply(
    input.req,
    forged,
    'phase7e1b coherent degraded D2',
    input.view,
  ))
  assert.equal(validateComposedTraceHostJoin({
    trace: forged.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: forged.decision,
    selectedDecision: forged.decision,
    deterministicSeed: input.game.seed,
  }), false)
})

test('5-10 player E1B surfaces include the 252-candidate maximum within 1 MiB', async () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const input = morganaProposal(playerCount)
    if (playerCount === 10) {
      input.view.round = 4
      input.view.proposalNum = 1
      input.req.round = 4
      input.req.proposalNum = 1
      const seats = input.view.players.map((player) => player.seat)
      const team = (index: number, required?: number) => {
        const size = input.view.quests[index].teamSize
        return required === undefined
          ? seats.slice(0, size)
          : [
              required,
              ...seats.filter((seat) => seat !== required),
            ].slice(0, size).sort((left, right) => left - right)
      }
      input.view.quests[0] = {
        ...input.view.quests[0],
        team: team(0),
        result: 'success',
        failCount: 0,
      }
      input.view.quests[1] = {
        ...input.view.quests[1],
        team: team(1),
        result: 'success',
        failCount: 0,
      }
      input.view.quests[2] = {
        ...input.view.quests[2],
        team: team(2, input.view.seat),
        result: 'fail',
        failCount: 1,
      }
    }
    const output = await createComposedAgent({
      seed: input.game.seed,
      roleObjectiveRouter: true,
      scorer: morganaRoleScorer,
    }).decide(input.req, input.view)
    const projection = output.trace!.privateMorganaRoleUtility!
    assert.ok(
      validatePrivateMorganaRoleUtilityProjection(projection),
      `invalid E1B projection at ${playerCount}p; degradation=${
        output.trace!.degradation.join(',')
      }; bytes=${
        projection
          ? Buffer.byteLength(JSON.stringify(projection), 'utf8')
          : 'absent'
      }`,
    )
    assert.ok(
      projection.candidates.length
        <= MAX_MORGANA_ROLE_UTILITY_ASSESSMENTS,
    )
    assert.ok(
      Buffer.byteLength(JSON.stringify(projection), 'utf8')
        <= MAX_MORGANA_ROLE_UTILITY_JSON_BYTES,
    )
    if (playerCount === 10) {
      assert.equal(projection.candidates.length, 252)
    }
  }
})

test('free architecture bank admits E1B attribution and rejects trace or manifest deletion', async () => {
  const variant: ArchitectureVariant = {
    id: 'phase7e1b-morgana-policy',
    paid: false,
    components: {
      mode: 'structured-only',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
      identityModel: JOINT_IDENTITY_MODEL_VERSION,
      roleObjectiveRouter: ROLE_OBJECTIVE_ROUTER_VERSION,
      roleUtility: ROLE_UTILITY_PROJECTION_VERSION,
      evilRoleUtility: EVIL_ROLE_UTILITY_PROJECTION_VERSION,
      morganaCounterfeitObjective:
        MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
      morganaRoleUtility: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
      policy: 'composed-policy-v1',
      scorer: MORGANA_ROLE_SEEDED_SCORER_VERSION,
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      roleObjectiveRouter: true,
      scorer: seededMorganaRoleScorer,
      publicObserver: true,
      privateIdentity: {
        roleQueries: [],
        hiddenTeam: true,
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const artifacts = await runArchitectureBench({
    variants: [variant],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7e1b-morgana-policy',
  })
  const report = architectureReport(artifacts).variants[0]
  assert.equal(report.safety.traceAttributionViolations, 0)
  assert.equal(report.safety.hiddenInformationViolations, 0)
  const morganaArtifact = artifacts.find(
    (artifact) => artifact.architecture!.targetRole === 'morgana',
  )!
  assert.deepEqual(
    morganaArtifact.strategyVersions!.morganaRoleUtilities,
    [MORGANA_ROLE_UTILITY_PROJECTION_VERSION],
  )
  const forgedTrace = structuredClone([morganaArtifact])
  const applicable = forgedTrace[0].decisionTraces!.find(
    (trace) => trace.privateMorganaRoleUtility,
  )!
  delete applicable.privateMorganaRoleUtility
  assert.ok(
    architectureReport(forgedTrace).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedManifest = structuredClone([morganaArtifact])
  delete forgedManifest[0].strategyVersions!.morganaRoleUtilities
  const descriptorOwned = architectureReport(forgedManifest).variants[0]
  assert.equal(descriptorOwned.safety.traceAttributionViolations, 0)
  assert.equal(descriptorOwned.safety.promotionEvidenceEligible, true)

  const storedForgery = structuredClone([morganaArtifact])
  const storedArtifact = storedForgery[0]
  const snapshots = authoritativeDecisionSnapshots(
    storedArtifact,
    storedArtifact.architecture!.targetSeat,
  )
  let replaced = false
  for (let index = 0; index < storedArtifact.decisionTraces!.length; index++) {
    const originalTrace = storedArtifact.decisionTraces![index]
    if (
      originalTrace.request.kind !== 'propose'
      && originalTrace.request.kind !== 'vote'
    ) continue
    const snapshot = snapshots.get(originalTrace.decisionId)
    if (!snapshot) continue
    const d2 = await createComposedAgent({
      seed: storedArtifact.seed,
      roleObjectiveRouter: true,
      morganaCounterfeitObjectives: true,
      scorer: evilRoleObjectiveScorer,
    }).decide(snapshot.req, snapshot.view)
    if (JSON.stringify(d2.decision) !== JSON.stringify(snapshot.original)) {
      continue
    }
    d2.trace!.componentVersions!.configuredScorer =
      MORGANA_ROLE_SCORER_VERSION
    d2.trace!.componentVersions!.configuredMorganaRoleUtility =
      MORGANA_ROLE_UTILITY_PROJECTION_VERSION
    d2.trace!.degradation.push(MORGANA_ROLE_UTILITY_DEGRADATION)
    storedArtifact.decisionTraces![index] = d2.trace!
    replaced = true
    break
  }
  assert.equal(replaced, true, 'expected a replay-coherent stored D2 action')
  assert.ok(
    architectureReport(storedForgery).variants[0]
      .safety.traceAttributionViolations > 0,
  )
})
