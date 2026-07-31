// test-lane: contract
// Migration phase 7E1A; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildMorganaCounterfeitObjective,
  buildPublicCounterfeitMerlinRead,
  validatePrivateMorganaCounterfeitHostJoin,
  validatePrivateMorganaCounterfeitObjective,
  validatePublicCounterfeitMerlinRead,
  validatePublicCounterfeitMerlinReadHostJoin,
} from '../../../server/agents/analysis/morgana-counterfeit.ts'
import {
  MAX_MORGANA_COUNTERFEIT_ASSESSMENTS,
  MORGANA_COUNTERFEIT_DEGRADATION,
  MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  type MorganaCounterfeitAssessment,
} from '../../../server/agents/analysis/morgana-counterfeit-types.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
  visibleEventCursor,
} from '../../../server/agents/belief/exact.ts'
import { canonicalWorldKey } from '../../../server/agents/belief/worlds.ts'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import { componentPayload } from '../../../server/agents/components/kernel.ts'
import {
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
} from '../../../server/agents/components/native-score-components.ts'
import { projectPublicRecord } from '../../../server/agents/record/public-record.ts'
import type { PublicRecord } from '../../../server/agents/record/public-record.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../../../server/agents/candidate/candidates.ts'
import { CANDIDATE_SCORER_VERSION } from '../../../server/agents/policy/score.ts'
import {
  parseExternalDecisionReply,
} from '../../../server/agents/external-reply.ts'
import {
  admitDecisionTrace,
} from '../../../server/agents/admission/composed-trace.ts'
import {
  revalidatedArchitectureIdentity,
} from '../../../server/agents/components/resolved-brain.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../../../server/engine/types.ts'
import { createGame } from '../../../server/engine/game.ts'
import { DEFAULT_ROLES, validateRoles } from '../../../server/engine/rules.ts'
import { evilPartnersOf } from '../../../server/engine/knowledge.ts'
import { viewFor } from '../../../server/engine/view.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../../../server/eval/harness/architecture-bench.ts'
import { ARCHITECTURE_BANK } from '../../../server/eval/banks/architecture-bank.ts'
import { architectureReport } from '../../../server/eval/architecture-report.ts'
import type { DecisionTrace } from '../../../server/agents/trace.ts'
import { DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES } from '../../../server/agents/canonical/canonical-json.ts'

const morganaCounterfeitObjective = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
)
const morganaCounterfeitPublicRead = (trace: DecisionTrace) => componentPayload(
  trace.components!,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
)
const componentEntry = (trace: DecisionTrace, id: string) =>
  trace.components!.entries.find((entry) => entry.component.id === id)
const removeComponent = (trace: DecisionTrace, id: string) => {
  const index = trace.components!.entries.findIndex(
    (entry) => entry.component.id === id,
  )
  assert.notEqual(index, -1)
  trace.components!.entries.splice(index, 1)
}

function publicRecord(): PublicRecord {
  return {
    playerCount: 5,
    rolesInPlay: [...DEFAULT_ROLES[5]].sort(),
    players: Array.from(
      { length: 5 },
      (_, seat) => ({ seat, name: `P${seat}` }),
    ),
    phase: 'proposal',
    round: 2,
    proposalNum: 1,
    leaderSeat: 1,
    quests: [
      {
        num: 1,
        teamSize: 2,
        failsRequired: 1,
        team: [0, 1],
        result: 'success',
        failCount: 0,
      },
      { num: 2, teamSize: 3, failsRequired: 1 },
      { num: 3, teamSize: 2, failsRequired: 1 },
      { num: 4, teamSize: 3, failsRequired: 1 },
      { num: 5, teamSize: 3, failsRequired: 1 },
    ],
    proposals: [{
      round: 1,
      proposalNum: 2,
      leader: 0,
      team: [0, 1],
      outcome: 'voted',
      votes: [
        { seat: 4, vote: 'approve' },
        { seat: 2, vote: 'approve' },
        { seat: 0, vote: 'approve' },
        { seat: 3, vote: 'reject' },
        { seat: 1, vote: 'reject' },
      ],
      approved: true,
    }],
  }
}

function morganaProposal(
  playerCount = 9,
  round = 1,
): {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest
} {
  for (let attempt = 0; attempt < 500; attempt++) {
    const game = createGame({
      seed: `phase7e1a-${playerCount}-${round}-${attempt}`,
      playerCount,
    })
    const morgana = game.players.find((player) => player.role === 'morgana')!
    if (morgana.seat !== game.leaderSeat) continue
    const view = viewFor(game, morgana.seat)
    view.round = round
    view.proposalNum = 1
    view.phase = 'proposal'
    const req: DecisionRequest = {
      kind: 'propose',
      seat: morgana.seat,
      round,
      proposalNum: 1,
    }
    return { game, view, req }
  }
  throw new Error('test could not find a Morgana opening leader')
}

function forgedBeliefModel(
  version: string,
  infer: (view: PlayerView) => ReturnType<typeof exactBelief>,
) {
  return {
    version,
    factorsVersion: 'off',
    infer(view: PlayerView) {
      const snapshot = infer(view)
      snapshot.modelVersion = version
      return snapshot
    },
  }
}

async function assertAtomicMorganaFailure(input: {
  game: ReturnType<typeof createGame>
  view: PlayerView
  req: DecisionRequest
  beliefModel: ReturnType<typeof forgedBeliefModel>
}): Promise<void> {
  const baseline = await createComposedAgent({
    seed: input.game.seed,
    beliefModel: input.beliefModel,
  }).decide(input.req, input.view)
  const attempted = await createComposedAgent({
    seed: input.game.seed,
    beliefModel: input.beliefModel,
    morganaCounterfeitObjectives: true,
  }).decide(input.req, input.view)
  assert.deepEqual(attempted.decision, baseline.decision)
  assert.deepEqual(
    attempted.trace!.candidateScores,
    baseline.trace!.candidateScores,
  )
  assert.ok(morganaCounterfeitPublicRead(attempted.trace!))
  assert.equal(
    morganaCounterfeitObjective(attempted.trace!),
    undefined,
  )
  const objectiveEntry = componentEntry(
    attempted.trace!,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  )
  assert.equal(objectiveEntry?.status, 'degraded')
  assert.equal(
    objectiveEntry?.status === 'degraded'
      ? objectiveEntry.degradationCode
      : undefined,
    MORGANA_COUNTERFEIT_DEGRADATION,
  )
}

function recomputeCounterfeitEquation(
  assessment: MorganaCounterfeitAssessment,
  threshold = 1,
): void {
  const q = assessment.merlinVisibleEvilCountDistribution
    .slice(threshold)
    .reduce((sum, probability) => sum + probability, 0)
  const p = assessment.publicEvilCountDistribution
    .slice(threshold)
    .reduce((sum, probability) => sum + probability, 0)
  const support = assessment.candidate.direction === 'support'
  const a = support ? 1 - q : q
  const b = support ? 1 - p : p
  const tell = Math.max(0, a - b)
  const ambiguity = 1 - Math.abs(2 * p - 1)
  const signal = a * (0.5 * ambiguity + 0.5 * tell)
  const read = assessment.counterfeitOpportunityReadProxyIndex
  assessment.merlinVisibleFailureCapabilityProbability = q
  assessment.publicFailureCapabilityProbability = p
  assessment.expectedMerlinConsistencyIndex = a
  assessment.publicConsistencyBaselineIndex = b
  assessment.privateKnowledgeTellIndex = tell
  assessment.publicAmbiguityIndex = ambiguity
  assessment.counterfeitSignalIndex = signal
  assessment.counterfeitValue = read * a + (1 - read) * signal
}

test('public counterfeit read keeps exact Merlin marginals separate from hand-worked truth counts', () => {
  const record = publicRecord()
  const read = buildPublicCounterfeitMerlinRead(record)
  assert.ok(validatePublicCounterfeitMerlinRead(read))
  assert.ok(validatePublicCounterfeitMerlinReadHostJoin(read, record))
  assert.equal(read.version, MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION)
  for (const row of read.seats) {
    assert.equal(row.merlinProbability, 1 / 5)
    assert.equal(row.relativeMerlinEligibilityIndex, 1)
    assert.equal(
      row.merlinWorldNumerator / row.feasibleWorldDenominator,
      row.merlinProbability,
    )
  }
  const proposer = read.seats[0]
  assert.deepEqual(proposer.proposalTruthTracking, {
    numerator: 1,
    denominator: 1,
    index: 1,
  })
  assert.deepEqual(proposer.voteTruthTracking, {
    numerator: 1,
    denominator: 1,
    index: 1,
  })
  assert.deepEqual(proposer.totalTruthTracking, {
    numerator: 2,
    denominator: 2,
    index: 1,
  })
  assert.equal(proposer.smoothedTruthTrackingIndex, 3 / 4)
  assert.equal(proposer.counterfeitReadProxyIndex, 3 / 4)

  const rejectingSuccess = read.seats[1]
  assert.equal(rejectingSuccess.proposalTruthTracking.index, null)
  assert.deepEqual(rejectingSuccess.voteTruthTracking, {
    numerator: 0,
    denominator: 1,
    index: 0,
  })
  assert.equal(rejectingSuccess.smoothedTruthTrackingIndex, 1 / 3)

  const empty = buildPublicCounterfeitMerlinRead({
    ...record,
    quests: record.quests.map((quest) => ({
      num: quest.num,
      teamSize: quest.teamSize,
      failsRequired: quest.failsRequired,
    })),
    proposals: [],
  })
  for (const row of empty.seats) {
    assert.equal(row.proposalTruthTracking.index, null)
    assert.equal(row.voteTruthTracking.index, null)
    assert.equal(row.totalTruthTracking.index, null)
    assert.equal(row.smoothedTruthTrackingIndex, 1 / 2)
  }
})

test('public read is cross-seat and private-canary invariant', () => {
  const { game, view, req } = morganaProposal(9)
  const publicReads = game.players.map((player) =>
    buildPublicCounterfeitMerlinRead(
      projectPublicRecord(viewFor(game, player.seat)),
    ))
  for (const read of publicReads.slice(1)) {
    assert.deepEqual(read, publicReads[0])
  }
  const renamed = structuredClone(publicRecord())
  renamed.players = renamed.players
    .map((player) => ({ ...player, name: `PRIVATE-CANARY-${player.seat}` }))
    .reverse()
  renamed.proposals = renamed.proposals.map((proposal) => ({
    ...proposal,
    team: [...proposal.team].reverse(),
    votes: [...(proposal.votes ?? [])].reverse(),
  }))
  assert.deepEqual(
    buildPublicCounterfeitMerlinRead(renamed),
    buildPublicCounterfeitMerlinRead(publicRecord()),
  )

  const renamedPrivateView = structuredClone(view)
  renamedPrivateView.players = renamedPrivateView.players
    .map((player) => ({
      ...player,
      name: `PRIVATE-OBJECTIVE-CANARY-${player.seat}`,
    }))
    .reverse()
  const objective = (candidateView: PlayerView) => {
    const belief = exactBelief(candidateView)
    const publicRead = buildPublicCounterfeitMerlinRead(
      projectPublicRecord(candidateView),
    )
    return buildMorganaCounterfeitObjective({
      req,
      view: candidateView,
      belief,
      publicRead,
      candidates: legalCandidates(req, candidateView),
    })
  }
  assert.deepEqual(objective(renamedPrivateView), objective(view))
})

test('Morgana objective integrates per-world Mordred blindness and validates every equation', () => {
  const { view, req } = morganaProposal(9)
  const belief = exactBelief(view)
  const publicRead = buildPublicCounterfeitMerlinRead(
    projectPublicRecord(view),
  )
  const candidates = legalCandidates(req, view)
  const objective = buildMorganaCounterfeitObjective({
    req,
    view,
    belief,
    publicRead,
    candidates,
  })
  assert.ok(validatePrivateMorganaCounterfeitObjective(objective))
  assert.ok(validatePrivateMorganaCounterfeitHostJoin(objective, {
    req,
    view,
    belief,
    publicRead,
    candidates,
  }))
  const partner = evilPartnersOf(view.privateInfo)[0]!
  const assessment = objective.assessments.find(
    (candidate) =>
      candidate.candidate.team.includes(partner)
      && candidate.candidate.team.filter(
        (seat) =>
          seat === view.seat
          || evilPartnersOf(view.privateInfo).includes(seat),
      ).length === 1,
  )!
  const direct = Array<number>(assessment.candidate.team.length + 1).fill(0)
  for (const weighted of belief.worlds) {
    const visibleToWorldMerlin = assessment.candidate.team.filter(
      (seat) =>
        weighted.world.alignmentBySeat[seat] === 'evil'
        && weighted.world.roleBySeat[seat] !== 'mordred',
    ).length
    direct[visibleToWorldMerlin] += weighted.probability
  }
  assert.ok(
    assessment.merlinVisibleEvilCountDistribution.every(
      (probability, index) =>
        Math.abs(probability - direct[index]) <= 1e-12,
    ),
  )
  assert.ok(
    Math.abs(
      assessment.merlinVisibleFailureCapabilityProbability
      - direct.slice(objective.request.failsRequired)
        .reduce((sum, probability) => sum + probability, 0),
    ) <= 1e-12,
  )
  assert.ok(
    belief.worlds.some(
      (weighted) => weighted.world.roleBySeat[partner] === 'mordred',
    ),
  )
  assert.ok(
    belief.worlds.some(
      (weighted) => weighted.world.roleBySeat[partner] !== 'mordred',
    ),
  )
})

test('changed joint Mordred weights alter causal features without changing mechanics', async () => {
  const { game, view, req } = morganaProposal(9)
  const partner = evilPartnersOf(view.privateInfo)[0]!
  const weightedModel = {
    version: 'phase7e1a-correlated-mordred-test-v1',
    factorsVersion: 'phase7e1a-test-factor-v1',
    infer(input: PlayerView) {
      const source = exactBelief(input)
      return beliefFromWeightedWorlds(
        input,
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
  const exactOutput = await createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  }).decide(req, view)
  const weightedOutput = await createComposedAgent({
    seed: game.seed,
    beliefModel: weightedModel,
    morganaCounterfeitObjectives: true,
  }).decide(req, view)
  assert.deepEqual(weightedOutput.decision, exactOutput.decision)
  assert.deepEqual(
    weightedOutput.trace!.factCodes,
    exactOutput.trace!.factCodes,
  )
  const candidateId = morganaCounterfeitObjective(exactOutput.trace!)!
    .assessments.find(
      (assessment) =>
        assessment.candidate.team.includes(partner)
        && !assessment.candidate.team.includes(view.seat),
    )!.candidate.candidateId
  const exactAssessment =
    morganaCounterfeitObjective(exactOutput.trace!)!.assessments.find(
      (assessment) => assessment.candidate.candidateId === candidateId,
    )!
  const weightedAssessment =
    morganaCounterfeitObjective(weightedOutput.trace!)!.assessments.find(
      (assessment) => assessment.candidate.candidateId === candidateId,
    )!
  assert.notEqual(
    weightedAssessment.merlinVisibleFailureCapabilityProbability,
    exactAssessment.merlinVisibleFailureCapabilityProbability,
  )
  assert.notEqual(
    weightedAssessment.counterfeitValue,
    exactAssessment.counterfeitValue,
  )
  assert.ok(validatePrivateMorganaCounterfeitObjective(
    morganaCounterfeitObjective(weightedOutput.trace!),
  ))
  assert.deepEqual(
    parseExternalDecisionReply(
      req,
      {
        decision: weightedOutput.decision,
        trace: weightedOutput.trace,
      },
      'phase7e1a-weighted-external-admission',
      view,
    ).decision,
    weightedOutput.decision,
  )
})

test('composed Morgana analysis atomically rejects worlds outside the filtered view', async () => {
  const partnerCase = morganaProposal(9)
  const swappedPartner = forgedBeliefModel(
    'phase7e1a-forged-partner-swap-v1',
    (view) => {
      const snapshot = structuredClone(exactBelief(view))
      const partner = evilPartnersOf(view.privateInfo)[0]!
      const world = structuredClone(snapshot.worlds[0].world)
      const goodSeat = world.alignmentBySeat.findIndex(
        (alignment) => alignment === 'good',
      )
      assert.ok(goodSeat >= 0)
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
      return snapshot
    },
  )
  await assertAtomicMorganaFailure({
    ...partnerCase,
    beliefModel: swappedPartner,
  })

  const questCase = morganaProposal(10, 2)
  const uncertainSeats = questCase.view.players
    .map((player) => player.seat)
    .filter(
      (seat) =>
        seat !== questCase.view.seat
        && !evilPartnersOf(questCase.view.privateInfo).includes(seat),
    )
  questCase.view.quests[0] = {
    ...questCase.view.quests[0],
    status: 'complete',
    team: uncertainSeats.slice(0, questCase.view.quests[0].teamSize),
    result: 'fail',
    failCount: 1,
  }
  const ignoresQuestFail = forgedBeliefModel(
    'phase7e1a-forged-quest-evidence-v1',
    (view) => {
      const withoutOutcome = structuredClone(view)
      withoutOutcome.quests[0] = {
        num: withoutOutcome.quests[0].num,
        teamSize: withoutOutcome.quests[0].teamSize,
        failsRequired: withoutOutcome.quests[0].failsRequired,
        status: 'pending',
      }
      const snapshot = structuredClone(exactBelief(withoutOutcome))
      snapshot.throughSeq = visibleEventCursor(view)
      return snapshot
    },
  )
  await assertAtomicMorganaFailure({
    ...questCase,
    beliefModel: ignoresQuestFail,
  })

  const zeroSupport = forgedBeliefModel(
    'phase7e1a-forged-zero-support-v1',
    (view) => {
      const snapshot = structuredClone(exactBelief(view))
      const removed = snapshot.worlds[0].probability
      ;(snapshot.worlds as { probability: number }[])[0].probability = 0
      ;(snapshot.worlds as { probability: number }[])[1].probability +=
        removed
      snapshot.quality = 'weighted'
      return snapshot
    },
  )
  await assertAtomicMorganaFailure({
    ...partnerCase,
    beliefModel: zeroSupport,
  })
})

test('stale belief cursors are rejected by cognition and directly by Morgana analysis', async () => {
  const selected = morganaProposal(5)
  const stale = forgedBeliefModel(
    'phase7e1a-forged-stale-cursor-v1',
    (view) => {
      const snapshot = structuredClone(exactBelief(view))
      snapshot.throughSeq += 1
      return snapshot
    },
  )
  await assert.rejects(
    createComposedAgent({
      seed: selected.game.seed,
      beliefModel: stale,
      morganaCounterfeitObjectives: true,
    }).decide(selected.req, selected.view),
    /returned cursor .* expected/,
  )
  const staleSnapshot = structuredClone(exactBelief(selected.view))
  staleSnapshot.throughSeq += 1
  assert.throws(() => buildMorganaCounterfeitObjective({
    req: selected.req,
    view: selected.view,
    belief: staleSnapshot,
    publicRead: buildPublicCounterfeitMerlinRead(
      projectPublicRecord(selected.view),
    ),
    candidates: legalCandidates(selected.req, selected.view),
  }), /Morgana-bound joint worlds/)
})

test('two-Fail quest q sums count at least two instead of any visible evil', () => {
  const { view, req } = morganaProposal(9, 4)
  assert.equal(view.quests[3].failsRequired, 2)
  const belief = exactBelief(view)
  const objective = buildMorganaCounterfeitObjective({
    req,
    view,
    belief,
    publicRead: buildPublicCounterfeitMerlinRead(
      projectPublicRecord(view),
    ),
    candidates: legalCandidates(req, view),
  })
  const assessment = objective.assessments.find((candidate) => {
    const distribution = candidate.merlinVisibleEvilCountDistribution
    const anyVisible = distribution.slice(1)
      .reduce((sum, probability) => sum + probability, 0)
    const twoVisible = distribution.slice(2)
      .reduce((sum, probability) => sum + probability, 0)
    return distribution[1] > 0 && Math.abs(anyVisible - twoVisible) > 1e-12
  })!
  assert.ok(assessment)
  const distribution = assessment.merlinVisibleEvilCountDistribution
  const expected = distribution.slice(2)
    .reduce((sum, probability) => sum + probability, 0)
  const incorrectAnyEvil = distribution.slice(1)
    .reduce((sum, probability) => sum + probability, 0)
  assert.ok(
    Math.abs(
      assessment.merlinVisibleFailureCapabilityProbability - expected,
    ) <= 1e-12,
  )
  assert.ok(
    Math.abs(
      assessment.merlinVisibleFailureCapabilityProbability
      - incorrectAnyEvil,
    ) > 1e-12,
  )
})

test('opt-in is default-off, Morgana-only, kind-scoped, and mechanically inert', async () => {
  const { game, view, req } = morganaProposal(5)
  const off = await createComposedAgent({
    seed: game.seed,
  }).decide(req, view)
  const on = await createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  }).decide(req, view)
  assert.deepEqual(on.decision, off.decision)
  assert.deepEqual(on.trace!.candidateScores, off.trace!.candidateScores)
  assert.deepEqual(
    on.trace!.forcedPolicyResult,
    off.trace!.forcedPolicyResult,
  )
  assert.equal(
    morganaCounterfeitPublicRead(on.trace!)?.version,
    MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  )
  assert.equal(
    morganaCounterfeitObjective(on.trace!)?.version,
    MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
  )
  assert.ok(morganaCounterfeitPublicRead(on.trace!))
  assert.ok(morganaCounterfeitObjective(on.trace!))
  assert.equal(morganaCounterfeitPublicRead(off.trace!), undefined)

  const voteView = structuredClone(view)
  voteView.phase = 'vote'
  voteView.currentTeam = [0, 1].sort((left, right) => left - right)
  const voteReq: DecisionRequest = {
    kind: 'vote',
    seat: voteView.seat,
    round: voteView.round,
    proposalNum: voteView.proposalNum,
  }
  const vote = await createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  }).decide(voteReq, voteView)
  const voteObjective = morganaCounterfeitObjective(vote.trace!)!
  assert.ok(validatePrivateMorganaCounterfeitObjective(voteObjective))
  assert.deepEqual(
    voteObjective.assessments.map(
      (assessment) => assessment.candidate.direction,
    ),
    ['support', 'oppose'],
  )

  const servant = game.players.find((player) => player.role === 'servant')!
  const servantView = viewFor(game, servant.seat)
  servantView.phase = 'vote'
  servantView.currentTeam = [0, 1]
  const servantReq: DecisionRequest = {
    kind: 'vote',
    seat: servant.seat,
    round: servantView.round,
    proposalNum: servantView.proposalNum,
  }
  const ineligible = await createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  }).decide(servantReq, servantView)
  assert.ok(ineligible.trace!.componentPlan!.configured.some(
    (component) =>
      component.id === MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  ))
  assert.equal(morganaCounterfeitObjective(ineligible.trace!), undefined)
  assert.ok(morganaCounterfeitPublicRead(ineligible.trace!))
  assert.equal(
    ineligible.trace!.degradation.includes(
      'morgana-objective-assessment-failed',
    ),
    false,
  )
})

test('strict detached validators and external ingress host joins reject hostile mutation and deletion', async () => {
  const { game, view, req } = morganaProposal(5)
  const agent = createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  })
  const output = await agent.decide(req, view)
  const trace = output.trace!
  const expectedArchitectureIdentity =
    revalidatedArchitectureIdentity(agent.resolvedBrain().description)
  assert.doesNotThrow(() => parseExternalDecisionReply(
    req,
    { decision: output.decision, trace },
    'phase7e1a',
    view,
  ))

  const arithmetic = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  arithmetic.assessments[0].counterfeitValue =
    1 - arithmetic.assessments[0].counterfeitValue
  assert.equal(validatePrivateMorganaCounterfeitObjective(arithmetic), false)

  const forgedDirection = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  forgedDirection.assessments[0].candidate.direction = 'oppose'
  recomputeCounterfeitEquation(forgedDirection.assessments[0])
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(forgedDirection),
    false,
  )

  const forgedTeam = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  const teamAssessment = forgedTeam.assessments[0]
  const replacement = view.players
    .map((player) => player.seat)
    .find((seat) => !teamAssessment.candidate.team.includes(seat))!
  teamAssessment.candidate.team = [
    ...teamAssessment.candidate.team.slice(1),
    replacement,
  ].sort((left, right) => left - right)
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(forgedTeam),
    false,
  )

  const wrongTeamSize = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  const sizedAssessment = wrongTeamSize.assessments[0]
  const extraSeat = view.players
    .map((player) => player.seat)
    .find((seat) => !sizedAssessment.candidate.team.includes(seat))!
  sizedAssessment.candidate.team = [
    ...sizedAssessment.candidate.team,
    extraSeat,
  ].sort((left, right) => left - right)
  sizedAssessment.candidate.candidateId = candidateIdForDecision({
    kind: 'propose',
    team: sizedAssessment.candidate.team,
  })
  sizedAssessment.merlinVisibleEvilCountDistribution = [
    ...sizedAssessment.merlinVisibleEvilCountDistribution,
    0,
  ]
  sizedAssessment.publicEvilCountDistribution = [
    ...sizedAssessment.publicEvilCountDistribution,
    0,
  ]
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(wrongTeamSize),
    false,
  )

  const voteView = structuredClone(view)
  voteView.phase = 'vote'
  voteView.currentTeam = morganaCounterfeitObjective(trace)!
    .assessments[0].candidate.team
  const voteReq: DecisionRequest = {
    kind: 'vote',
    seat: voteView.seat,
    round: voteView.round,
    proposalNum: voteView.proposalNum,
  }
  const voteOutput = await createComposedAgent({
    seed: game.seed,
    morganaCounterfeitObjectives: true,
  }).decide(voteReq, voteView)
  const forgedVote = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  assert.equal(forgedVote.assessments[0].candidate.direction, 'support')
  assert.equal(
    forgedVote.assessments[0].candidate.candidateId,
    candidateIdForDecision({ kind: 'vote', vote: 'approve' }),
  )
  forgedVote.assessments[0].candidate.direction = 'oppose'
  recomputeCounterfeitEquation(forgedVote.assessments[0])
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(forgedVote),
    false,
  )

  const alternateVoteTeam = view.players
    .map((player) => player.seat)
    .filter(
      (seat) =>
        !morganaCounterfeitObjective(voteOutput.trace!)!
          .request.currentTeam!.includes(seat),
    )
    .concat(
      morganaCounterfeitObjective(voteOutput.trace!)!
        .request.currentTeam!.slice(0, 1),
    )
    .slice(0, voteView.quests[voteView.round - 1].teamSize)
    .sort((left, right) => left - right)
  assert.equal(
    alternateVoteTeam.length,
    voteView.quests[voteView.round - 1].teamSize,
  )
  assert.notDeepEqual(
    alternateVoteTeam,
    morganaCounterfeitObjective(voteOutput.trace!)!
      .request.currentTeam,
  )
  const forgedVoteTeam = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  forgedVoteTeam.assessments[0].candidate.team = alternateVoteTeam
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(forgedVoteTeam),
    false,
  )

  const forgedRequestTeam = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  forgedRequestTeam.request.currentTeam = alternateVoteTeam
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(forgedRequestTeam),
    false,
  )
  const permutedRequestTeam = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  permutedRequestTeam.request.currentTeam = [
    ...permutedRequestTeam.request.currentTeam!,
  ].reverse()
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(permutedRequestTeam),
    false,
  )
  const deletedRequestTeam = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  delete deletedRequestTeam.request.currentTeam
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(deletedRequestTeam),
    false,
  )
  const extraProposeTeam = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  extraProposeTeam.request.currentTeam =
    extraProposeTeam.assessments[0].candidate.team
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(extraProposeTeam),
    false,
  )

  const missingVoteCandidate = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  missingVoteCandidate.assessments.splice(1, 1)
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(missingVoteCandidate),
    false,
  )
  const emptyVoteCandidates = structuredClone(
    morganaCounterfeitObjective(voteOutput.trace!)!,
  )
  emptyVoteCandidates.assessments.splice(
    0,
    emptyVoteCandidates.assessments.length,
  )
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(emptyVoteCandidates),
    false,
  )
  const missingProposalCandidate = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  missingProposalCandidate.assessments.splice(0, 1)
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(
      missingProposalCandidate,
    ),
    false,
  )
  const emptyProposalCandidates = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  emptyProposalCandidates.assessments.splice(
    0,
    emptyProposalCandidates.assessments.length,
  )
  assert.equal(
    validatePrivateMorganaCounterfeitObjective(emptyProposalCandidates),
    false,
  )

  const sourceMutation = structuredClone(trace)
  morganaCounterfeitObjective(sourceMutation)!.source.beliefThroughSeq += 1
  const sourceAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: sourceMutation,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: game.seed,
    expectedArchitectureIdentity,
  })
  assert.equal(sourceAdmission.kind, 'rejected')
  if (sourceAdmission.kind === 'rejected') {
    assert.equal(
      sourceAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  const candidateMutation = structuredClone(trace)
  morganaCounterfeitObjective(candidateMutation)!
    .assessments[0].candidate.candidateId += ':forged'
  const candidateAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: candidateMutation,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: game.seed,
    expectedArchitectureIdentity,
  })
  assert.equal(candidateAdmission.kind, 'rejected')
  if (candidateAdmission.kind === 'rejected') {
    assert.equal(
      candidateAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  const sparse = structuredClone(
    morganaCounterfeitObjective(trace)!,
  )
  delete (sparse.assessments as unknown[])[0]
  assert.equal(validatePrivateMorganaCounterfeitObjective(sparse), false)

  const accessor = structuredClone(
    morganaCounterfeitPublicRead(trace)!,
  ) as unknown as Record<string, unknown>
  Object.defineProperty(accessor, 'version', {
    enumerable: true,
    get: () => MORGANA_COUNTERFEIT_PUBLIC_READ_VERSION,
  })
  assert.equal(validatePublicCounterfeitMerlinRead(accessor), false)

  for (const component of [
    MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  ] as const) {
    const forged = structuredClone(trace)
    removeComponent(forged, component.id)
    const admission = admitDecisionTrace({
      kind: 'finalized-artifact',
      trace: forged,
      req,
      view,
      authoritativeAction: output.decision,
      selectedDecision: output.decision,
      deterministicSeed: game.seed,
      expectedArchitectureIdentity,
    })
    assert.equal(admission.kind, 'rejected')
    if (admission.kind === 'rejected') {
      assert.equal(
        admission.reason,
        'trusted-identity-host-join-failed',
      )
    }
  }
  const fakeDegradation = structuredClone(trace)
  removeComponent(
    fakeDegradation,
    MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT.id,
  )
  removeComponent(
    fakeDegradation,
    MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id,
  )
  fakeDegradation.degradation.push('morgana-objective-assessment-failed')
  const fakeDegradationAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: fakeDegradation,
    req,
    view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: game.seed,
    expectedArchitectureIdentity,
  })
  assert.equal(fakeDegradationAdmission.kind, 'rejected')
  if (fakeDegradationAdmission.kind === 'rejected') {
    assert.equal(
      fakeDegradationAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
})

test('Morgana dependency is legal-cast enforced and 5-10p payloads stay bounded', async () => {
  assert.throws(() => validateRoles(5, [
    'merlin',
    'servant',
    'servant',
    'morgana',
    'assassin',
  ]))
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const round = playerCount === 10 ? 4 : 1
    const { game, view, req } = morganaProposal(playerCount, round)
    const output = await createComposedAgent({
      seed: game.seed,
      morganaCounterfeitObjectives: true,
    }).decide(req, view)
    const objective = morganaCounterfeitObjective(output.trace!)!
    assert.ok(validatePrivateMorganaCounterfeitObjective(objective))
    assert.ok(
      objective.assessments.length
        <= MAX_MORGANA_COUNTERFEIT_ASSESSMENTS,
    )
    assert.ok(
      Buffer.byteLength(JSON.stringify(objective), 'utf8')
        <= DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
    )
    if (playerCount === 10) {
      assert.equal(objective.assessments.length, 252)
    }
  }
})

test('private counterfeit substrate does not enter prompts, voice, client, or public view', () => {
  for (const path of [
    '../../../server/agents/prompts.ts',
    '../../../server/agents/communication/composed-renderer.ts',
    '../../../client/src/App.tsx',
    '../../../server/engine/view.ts',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(
      source,
      /publicMorganaCounterfeitRead|privateMorganaCounterfeitObjective|counterfeitValue/,
    )
  }
})

test('free architecture bank admits exact host-reconstructable Morgana traces and rejects stored mutations', async () => {
  const baseline: ArchitectureVariant = {
    id: 'phase7e1a-baseline',
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      beliefVisibility: 'none',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      decisionComponents: 'decision-component-run-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      policy: 'composed-policy-v1',
      scorer: CANDIDATE_SCORER_VERSION,
      planner: 'planner-off',
      prompt: 'composed-typed-context-v4',
      renderer: 'composed-policy-renderer-v4',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const variant: ArchitectureVariant = {
    id: 'phase7e1a-morgana-counterfeit',
    paid: false,
    components: {
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      beliefVisibility: 'none',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'exact-public-observer-v1',
      decisionComponents: 'decision-component-run-v1',
      analysis: 'situation-analysis-v1',
      candidates: 'legal-candidates-v1',
      forcedPolicy: 'forced-policy-v1',
      policy: 'composed-policy-v1',
      scorer: CANDIDATE_SCORER_VERSION,
      planner: 'planner-off',
      prompt: 'composed-typed-context-v4',
      renderer: 'composed-policy-renderer-v4',
      communication: 'plan-voice-v2',
      voice: 'voice-off',
      morganaCounterfeitObjective: MORGANA_COUNTERFEIT_OBJECTIVE_VERSION,
    },
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      publicObserver: true,
      morganaCounterfeitObjectives: true,
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
  const morganaCase = ARCHITECTURE_BANK.find(
    (entry) => entry.targetRole === 'morgana',
  )!
  const artifacts = await runArchitectureBench({
    variants: [baseline, variant],
    cases: ARCHITECTURE_BANK,
    bankId: 'phase7e1a-morgana-counterfeit',
  })
  const report = architectureReport(artifacts).variants.find(
    (entry) => entry.id === variant.id,
  )!
  assert.equal(report.safety.traceAttributionViolations, 0)
  assert.equal(report.safety.hiddenInformationViolations, 0)
  const baselineArtifact = artifacts.find(
    (artifact) =>
      artifact.architecture!.variant === baseline.id
      && artifact.architecture!.caseId === morganaCase.id,
  )!
  const candidateArtifact = artifacts.find(
    (artifact) =>
      artifact.architecture!.variant === variant.id
      && artifact.architecture!.caseId === morganaCase.id,
  )!
  const canonicalLog = (artifact: typeof candidateArtifact) =>
    JSON.stringify(artifact.log).replaceAll(artifact.id, 'GAME')
  for (const bankCase of ARCHITECTURE_BANK) {
    const pairedBaseline = artifacts.find(
      (artifact) =>
        artifact.architecture!.variant === baseline.id
        && artifact.architecture!.caseId === bankCase.id,
    )!
    const pairedCandidate = artifacts.find(
      (artifact) =>
        artifact.architecture!.variant === variant.id
        && artifact.architecture!.caseId === bankCase.id,
    )!
    assert.equal(
      canonicalLog(pairedCandidate),
      canonicalLog(pairedBaseline),
    )
  }
  assert.deepEqual(
    candidateArtifact.strategyVersions!.morganaCounterfeitObjectives,
    [MORGANA_COUNTERFEIT_OBJECTIVE_VERSION],
  )
  assert.equal(
    baselineArtifact.strategyVersions!.morganaCounterfeitObjectives,
    undefined,
  )

  const forged = structuredClone([candidateArtifact])
  const applicable = forged[0].decisionTraces!.find(
    (trace) => morganaCounterfeitObjective(trace),
  )!
  removeComponent(applicable, MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT.id)
  assert.ok(
    architectureReport(forged).variants[0]
      .safety.traceAttributionViolations > 0,
  )
})
