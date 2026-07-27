import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import {
  candidateTeams,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import { applyForcedPolicy } from '../server/agents/policy/forced.ts'
import { FORCED_POLICY_VERSION } from '../server/agents/policy/types.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import type {
  DecisionKind,
  DecisionRequest,
  GameEvent,
  PlayerView,
  Seat,
} from '../server/engine/types.ts'

const fixture = (id: string) =>
  readDecisionFixtures().find((candidate) => candidate.id === id)!

const withPhase = (
  view: PlayerView,
  kind: DecisionKind,
): PlayerView => ({
  ...view,
  phase:
    kind === 'assassinate' ? 'assassination'
      : kind === 'propose' ? 'proposal'
        : kind,
})

const asMinion = (
  view: PlayerView,
  partners: readonly number[],
): PlayerView => ({
  ...view,
  role: 'minion',
  rolesInPlay: view.rolesInPlay.map((role) =>
    role === 'oberon' ? 'minion' : role),
  privateInfo: { evilPartners: [...partners] },
})

function policyResult(
  req: DecisionRequest,
  view: PlayerView,
) {
  const candidates = legalCandidates(req, view)
  const cognition = reconstructCognition(view)
  const analysis = analyzeSituation(view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    policyCandidateTeams: candidateTeams(candidates, view),
  })
  return {
    candidates,
    analysis,
    forced: applyForcedPolicy(req, view, analysis, candidates),
  }
}

const withoutUtterances = (view: PlayerView): PlayerView => ({
  ...view,
  events: view.events.filter((event) => event.type !== 'utterance'),
})

function withDeclaredLeans(
  view: PlayerView,
  leans: readonly { seat: Seat; lean: 'approve' | 'reject' }[],
): PlayerView {
  const base = withoutUtterances(view)
  const start = Math.max(0, ...base.events.map((event) => event.seq)) + 1
  const events: GameEvent[] = leans.map(({ seat, lean }, index) => ({
    seq: start + index,
    type: 'utterance',
    payload: { seat, text: '', round: view.round, lean },
    visibility: 'public',
  }))
  return { ...base, events: [...base.events, ...events] }
}

test('good quest cards are forced to Success', () => {
  const base = fixture('oberon-two-fail-quest')
  const view: PlayerView = {
    ...base.view,
    role: 'servant',
    alignment: 'good',
    privateInfo: {},
  }
  const result = policyResult({ ...base.req, seat: view.seat }, view)
  assert.equal(result.forced.version, FORCED_POLICY_VERSION)
  assert.equal(result.forced.applied, true)
  assert.match(result.forced.selectedCandidateId!, /quest:success$/)
  assert.deepEqual(result.forced.reasonCodes, ['GOOD_QUEST_CARD_FORCED_SUCCESS'])
})

test('an uncoordinated evil Success is forced below the Fail requirement, except for Oberon', () => {
  const base = fixture('oberon-two-fail-quest')
  const offTeam = base.view.players
    .map((player) => player.seat)
    .filter((seat) =>
      seat !== base.view.seat && !base.view.currentTeam!.includes(seat))
  const coordinatedView = asMinion(base.view, offTeam.slice(0, 2))
  const coordinated = policyResult(base.req, coordinatedView)
  assert.match(coordinated.forced.selectedCandidateId!, /quest:success$/)
  assert.deepEqual(
    coordinated.forced.reasonCodes,
    ['EVIL_QUEST_CARD_CANNOT_SINK'],
  )

  const oberon = policyResult(base.req, base.view)
  assert.equal(oberon.forced.applied, false)
  assert.equal(oberon.forced.selectedCandidateId, undefined)
})

test('both known Fails are selected on a decisive two-Fail quest', () => {
  const base = fixture('oberon-two-fail-quest')
  const partner = base.view.currentTeam!.find((seat) => seat !== base.view.seat)!
  const offTeam = base.view.players
    .map((player) => player.seat)
    .find((seat) =>
      seat !== base.view.seat && !base.view.currentTeam!.includes(seat))!
  const view = asMinion(base.view, [partner, offTeam])
  const result = policyResult(base.req, view)
  assert.match(result.forced.selectedCandidateId!, /quest:fail$/)
  assert.ok(result.forced.reasonCodes.includes('GOOD_MATCH_POINT_FAIL_REQUIRED'))
})

test('decisive evil votes approve sinkable teams and reject unsinkable teams', () => {
  const base = fixture('mordred-late-vote')
  const goodMatchQuests = base.view.quests.map((quest, index) => {
    if (index >= 2) return quest
    return { ...quest, result: 'success' as const, failCount: 0 }
  })
  const unsinkableView: PlayerView = {
    ...withoutUtterances(base.view),
    quests: goodMatchQuests,
  }
  const reject = policyResult(base.req, unsinkableView)
  assert.match(reject.forced.selectedCandidateId!, /vote:reject$/)

  const sinkableView: PlayerView = {
    ...unsinkableView,
    currentTeam: [
      base.view.seat,
      ...unsinkableView.currentTeam!.filter((seat) => seat !== base.view.seat),
    ].slice(0, unsinkableView.currentTeam!.length),
  }
  const approve = policyResult(base.req, sinkableView)
  assert.match(approve.forced.selectedCandidateId!, /vote:approve$/)
  assert.ok(
    approve.analysis.forcedPlayReasonCodes.includes(
      'EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED',
    ),
  )
})

test('decisive vote rules stand down when declared leans make the vote immaterial', () => {
  const base = fixture('mordred-late-vote')
  const quests = base.view.quests.map((quest, index) =>
    index < 2
      ? { ...quest, result: 'success' as const, failCount: 0 }
      : quest)
  const otherSeats = base.view.players
    .map((player) => player.seat)
    .filter((seat) => seat !== base.view.seat)

  const sinkable = {
    ...base.view,
    quests,
    currentTeam: [
      base.view.seat,
      ...base.view.currentTeam!.filter((seat) => seat !== base.view.seat),
    ].slice(0, base.view.currentTeam!.length),
  }
  const doomed = policyResult(
    base.req,
    withDeclaredLeans(
      sinkable,
      otherSeats.slice(0, Math.floor(base.view.playerCount / 2) + 1)
        .map((seat) => ({ seat, lean: 'reject' as const })),
    ),
  )
  assert.equal(doomed.forced.applied, false)
  assert.ok(!doomed.analysis.forcedPlayReasonCodes.includes(
    'EVIL_DECISIVE_TEAM_APPROVAL_REQUIRED',
  ))

  const unsinkable = {
    ...base.view,
    quests,
  }
  const carried = policyResult(
    base.req,
    withDeclaredLeans(
      unsinkable,
      otherSeats.slice(0, Math.floor(base.view.playerCount / 2) + 1)
        .map((seat) => ({ seat, lean: 'approve' as const })),
    ),
  )
  assert.equal(carried.forced.applied, false)
  assert.ok(!carried.analysis.forcedPlayReasonCodes.includes(
    'EVIL_TEAM_CANNOT_SINK_GOOD_MATCH_POINT',
  ))
})

test('good match-point evil proposals retain every and only sinkable team', () => {
  const base = fixture('assassin-late-finalize')
  const view = withPhase(base.view, 'propose')
  const req: DecisionRequest = { ...base.req, kind: 'propose' }
  const result = policyResult(req, view)
  const allowed = new Set(result.forced.allowedCandidateIds)
  assert.equal(result.forced.selectedCandidateId, undefined)
  assert.ok(result.forced.reasonCodes.includes(
    'EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
  ))
  const need = view.quests[view.round - 1].failsRequired
  for (const [index, candidate] of result.candidates.entries()) {
    assert.equal(
      allowed.has(candidate.id),
      result.analysis.policyCandidateTeams[index].knownFailsAboard.length >= need,
      candidate.id,
    )
  }
})

test('good match-point evil finalize, including hammer, retains only sinkable final teams', () => {
  const base = fixture('assassin-late-finalize')
  for (const proposalNum of [base.view.proposalNum, 5]) {
    const view = { ...base.view, proposalNum }
    const req = { ...base.req, proposalNum }
    const result = policyResult(req, view)
    const allowed = new Set(result.forced.allowedCandidateIds)
    assert.ok(result.forced.reasonCodes.includes(
      'EVIL_GOOD_MATCH_POINT_SINKABLE_PROPOSAL_REQUIRED',
    ))
    for (const facts of result.analysis.policyCandidateTeams) {
      assert.equal(
        allowed.has(facts.candidateId),
        facts.knownFailsAboard.length >= result.analysis.failsRequired,
        `${proposalNum}:${facts.candidateId}`,
      )
    }
  }
})

test('forced team constraints join analysis by candidate ID and verify the team', () => {
  const base = fixture('assassin-late-finalize')
  const candidates = legalCandidates(base.req, base.view)
  const cognition = reconstructCognition(base.view)
  const analysis = analyzeSituation(base.view, {
    belief: cognition.belief,
    evidence: cognition.evidence,
    policyCandidateTeams: candidateTeams(candidates, base.view),
  })
  const reordered = {
    ...analysis,
    policyCandidateTeams: [...analysis.policyCandidateTeams].reverse(),
  }
  assert.deepEqual(
    applyForcedPolicy(base.req, base.view, reordered, candidates),
    applyForcedPolicy(base.req, base.view, analysis, candidates),
  )
  const mismatched = {
    ...analysis,
    policyCandidateTeams: analysis.policyCandidateTeams.map((facts, index) =>
      index === 0
        ? { ...facts, team: analysis.policyCandidateTeams[1].team }
        : facts),
  }
  assert.throws(
    () => applyForcedPolicy(base.req, base.view, mismatched, candidates),
    /analysis mismatch for policy candidate/,
  )
})
