import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildScorerSituationSurface,
} from '../server/agents/analysis/scorer-situation-surface.ts'
import {
  combineSituationAnalysisRequirements,
  type SituationAnalysisPlan,
} from '../server/agents/analysis/situation-plan.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  canonicalDecisionFrame,
  prepareNativeScoreLayers,
  withDecisionAnalysis,
  withLegalCandidates,
} from '../server/agents/policy/decision-frame.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  seededEvilRoleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededMorganaRoleScorer,
  seededRoleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import { createGame } from '../server/engine/game.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import { evilPartnersOf } from '../server/engine/rules.ts'
import { viewFor } from '../server/engine/view.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

const jsonBytes = (value: unknown): Buffer =>
  Buffer.from(JSON.stringify(value), 'utf8')

function runtimeSurface(
  req: DecisionRequest,
  view: PlayerView,
  plan: SituationAnalysisPlan,
) {
  const candidateFrame = withLegalCandidates(canonicalDecisionFrame(req, view))
  const cognition = reconstructCognition(view)
  const analyzed = withDecisionAnalysis(candidateFrame, cognition, plan)
  return {
    candidateFrame,
    cognition,
    analyzed,
  }
}

test('shared scorer situation surface owns the three bounded analysis plans', () => {
  const fixtures = readDecisionFixtures()
  const proposal = fixtures.find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const vote = fixtures.find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!

  const candidateOnly = buildScorerSituationSurface({
    view: proposal.view,
    belief: exactBelief(proposal.view),
    legalCandidates: legalCandidates(proposal.req, proposal.view),
    plan: 'candidate-teams',
  })
  assert.equal(candidateOnly.hypotheticalTeamCandidates, null)
  assert.ok(candidateOnly.analysis.policyCandidateTeams.length > 0)
  assert.deepEqual(candidateOnly.analysis.policyCandidateAssessments, [])
  assert.equal(candidateOnly.analysis.goodVote, undefined)

  const goodProposal = buildScorerSituationSurface({
    view: proposal.view,
    belief: exactBelief(proposal.view),
    legalCandidates: legalCandidates(proposal.req, proposal.view),
    plan: 'good-proposal',
  })
  assert.equal(goodProposal.hypotheticalTeamCandidates, null)
  assert.deepEqual(
    goodProposal.analysis.policyCandidateAssessments.map(
      (assessment) => assessment.candidateId,
    ),
    goodProposal.analysis.policyCandidateTeams.map(
      (candidate) => candidate.candidateId,
    ),
  )
  assert.equal(goodProposal.analysis.goodVote, undefined)

  const goodVote = buildScorerSituationSurface({
    view: vote.view,
    belief: exactBelief(vote.view),
    legalCandidates: legalCandidates(vote.req, vote.view),
    plan: 'good-vote',
  })
  assert.ok(goodVote.hypotheticalTeamCandidates)
  assert.deepEqual(goodVote.analysis.policyCandidateTeams, [])
  assert.deepEqual(
    goodVote.analysis.policyCandidateAssessments.map(
      (assessment) => assessment.candidateId,
    ),
    goodVote.hypotheticalTeamCandidates.map((candidate) => candidate.id),
  )
  assert.ok(goodVote.analysis.goodVote)

  for (const entry of [candidateOnly, goodProposal, goodVote]) {
    assert.equal(Object.isFrozen(entry), true)
    assert.deepEqual(
      jsonBytes(entry),
      jsonBytes(structuredClone(entry)),
    )
  }
})

test('runtime uses byte-identical shared surfaces for every frozen decision', async () => {
  const kinds = new Set<string>()
  for (const fixture of readDecisionFixtures()) {
    const agent = createComposedAgent({ seed: fixture.source.seed })
    const candidateFrame = withLegalCandidates(
      canonicalDecisionFrame(fixture.req, fixture.view),
    )
    const lease = prepareNativeScoreLayers(
      candidateFrame,
      agent.resolvedBrain(),
    )
    const plan = combineSituationAnalysisRequirements(lease.requirements)
    const cognition = reconstructCognition(fixture.view)
    const runtime = withDecisionAnalysis(candidateFrame, cognition, plan)
    const shared = buildScorerSituationSurface({
      view: fixture.view,
      belief: cognition.belief,
      evidence: cognition.evidence,
      legalCandidates: legalCandidates(fixture.req, fixture.view),
      plan,
    })
    assert.deepEqual(
      jsonBytes(runtime.analysis),
      jsonBytes(shared.analysis),
      fixture.id,
    )
    assert.deepEqual(
      jsonBytes(runtime.hypotheticalTeamCandidates),
      jsonBytes(shared.hypotheticalTeamCandidates),
      fixture.id,
    )

    const output = await agent.decide(fixture.req, fixture.view)
    assert.equal(
      candidateIdForDecision(output.decision),
      candidateIdForDecision(fixture.baselineDecision),
      fixture.id,
    )
    kinds.add(fixture.req.kind)
  }
  assert.deepEqual(
    [...kinds].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
})

test('good, C2, D2, Morgana, and D3 replay from the shared surface', async () => {
  const fixtures = readDecisionFixtures()
  const merlin = fixtures.find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const servant = fixtures.find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const mordred = fixtures.find(
    (entry) => entry.id === 'mordred-late-vote',
  )!
  const morganaGame = createGame({
    id: 'r3b1a-morgana',
    seed: 'r3b1a-morgana',
    playerCount: 5,
  })
  const morganaSeat = morganaGame.players.find(
    (player) => player.role === 'morgana',
  )!.seat
  const morganaView: PlayerView = {
    ...viewFor(morganaGame, morganaSeat),
    phase: 'vote',
    currentTeam: morganaGame.players
      .slice(0, morganaGame.quests[0].teamSize)
      .map((player) => player.seat),
  }
  const morganaReq: DecisionRequest = {
    kind: 'vote',
    seat: morganaSeat,
    round: morganaView.round,
    proposalNum: morganaView.proposalNum,
  }
  const d3Game = createGame({
    id: 'r3b1a-d3',
    seed: 'r3b1a-d3',
    playerCount: 7,
  })
  const d3Seat = d3Game.players.find(
    (player) =>
      player.alignment === 'evil'
      && player.role !== 'oberon',
  )!.seat
  const d3ViewBase = viewFor(d3Game, d3Seat)
  const visibleEvil = [
    d3Seat,
    ...evilPartnersOf(d3ViewBase.privateInfo),
  ]
  const d3View: PlayerView = {
    ...d3ViewBase,
    phase: 'quest',
    currentTeam: [
      ...new Set([
        ...visibleEvil,
        ...d3Game.players.map((player) => player.seat),
      ]),
    ].slice(0, d3Game.quests[0].teamSize),
  }
  const d3Req: DecisionRequest = {
    kind: 'quest',
    seat: d3Seat,
    round: d3View.round,
    proposalNum: d3View.proposalNum,
  }

  const cases = [
    {
      id: 'good-proposal',
      req: merlin.req,
      view: merlin.view,
      seed: merlin.source.seed,
      options: { scorer: seededGoodProposalVoteScorer },
    },
    {
      id: 'good-vote',
      req: servant.req,
      view: servant.view,
      seed: servant.source.seed,
      options: { scorer: seededGoodProposalVoteScorer },
    },
    {
      id: 'c2',
      req: merlin.req,
      view: merlin.view,
      seed: merlin.source.seed,
      options: { scorer: seededRoleObjectiveScorer },
    },
    {
      id: 'd2',
      req: mordred.req,
      view: mordred.view,
      seed: mordred.source.seed,
      options: {
        scorer: seededEvilRoleObjectiveScorer,
        roleObjectiveRouter: true,
      },
    },
    {
      id: 'morgana',
      req: morganaReq,
      view: morganaView,
      seed: morganaGame.seed,
      options: {
        scorer: seededMorganaRoleScorer,
        roleObjectiveRouter: true,
      },
    },
    {
      id: 'd3-robust',
      req: d3Req,
      view: d3View,
      seed: d3Game.seed,
      options: { evilQuestCardPolicy: 'robust-heterogeneous' as const },
    },
  ] as const

  for (const entry of cases) {
    const agent = createComposedAgent({
      seed: entry.seed,
      ...entry.options,
    })
    const candidateFrame = withLegalCandidates(
      canonicalDecisionFrame(entry.req, entry.view),
    )
    const plan = combineSituationAnalysisRequirements(
      prepareNativeScoreLayers(
        candidateFrame,
        agent.resolvedBrain(),
      ).requirements,
    )
    const {
      cognition,
      analyzed,
    } = runtimeSurface(entry.req, entry.view, plan)
    const shared = buildScorerSituationSurface({
      view: entry.view,
      belief: cognition.belief,
      evidence: cognition.evidence,
      legalCandidates: legalCandidates(entry.req, entry.view),
      plan,
    })
    assert.deepEqual(jsonBytes(analyzed.analysis), jsonBytes(shared.analysis))
    assert.deepEqual(
      jsonBytes(analyzed.hypotheticalTeamCandidates),
      jsonBytes(shared.hypotheticalTeamCandidates),
    )

    const output = await agent.decide(entry.req, entry.view)
    assert.deepEqual(
      output.trace!.beliefTeamAssessments ?? [],
      analyzed.analysis.policyCandidateAssessments,
      `${entry.id} runtime trace surface`,
    )
  }
})
