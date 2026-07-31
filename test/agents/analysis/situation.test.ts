// test-lane: fast
import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDecision, createGame } from '../../../server/engine/game.ts'
import { DEFAULT_ROLES } from '../../../server/engine/rules.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { analyzeSituation } from '../../../server/agents/analysis/situation.ts'
import { reconstructCognition } from '../../../server/agents/cognition/state.ts'
import { readDecisionFixtures } from '../../../server/eval/decision-fixtures.ts'
import type { PlayerView, Role } from '../../../server/engine/types.ts'

const fixtures = readDecisionFixtures()
const fixture = (id: string) => fixtures.find((candidate) => candidate.id === id)!

test('score, match point, proposal runway, and hammer proximity are hand-worked', () => {
  const late = analyzeSituation(fixture('minion-late-discussion').view)
  assert.deepEqual(late.score, { good: 2, evil: 2 })
  assert.deepEqual(late.matchPoint, { good: true, evil: true })
  assert.equal(late.proposalNumber, 4)
  assert.equal(late.proposalsRemaining, 1)
  assert.equal(late.rejectionsBeforeHammer, 1)
  assert.deepEqual(late.hammer, { proximity: 'next', automaticApproval: false })

  const hammer = analyzeSituation(fixture('oberon-two-fail-quest').view)
  assert.equal(hammer.proposalNumber, 5)
  assert.equal(hammer.proposalsRemaining, 0)
  assert.deepEqual(hammer.hammer, { proximity: 'hammer', automaticApproval: true })
  assert.ok(hammer.factCodes.includes('HAMMER_AUTOMATIC'))
  assert.ok(hammer.forcedPlayReasonCodes.includes('HAMMER_TEAM_AUTOMATIC'))
})

test('current and caller-supplied teams share exact assessment semantics', () => {
  const view = fixture('servant-vote-after-evidence').view
  const candidate = [view.seat, (view.seat + 1) % view.playerCount]
  const analysis = analyzeSituation(view, { candidateTeams: [candidate] })
  assert.deepEqual(analysis.currentTeam?.team, [...view.currentTeam!].sort((a, b) => a - b))
  assert.deepEqual(analysis.candidateTeams[0].team, [...candidate].sort((a, b) => a - b))
  assert.equal(
    analysis.currentTeam!.evilCountDistribution.reduce((sum, share) => sum + share, 0),
    1,
  )
  assert.equal(
    analysis.candidateTeams[0].evilCountDistribution.reduce((sum, share) => sum + share, 0),
    1,
  )
})

test('known Fails aboard uses only legal evil knowledge and preserves Oberon invisibility', () => {
  const oberonView = fixture('oberon-two-fail-quest').view
  const oberon = analyzeSituation(oberonView)
  assert.deepEqual(oberon.currentTeam?.knownFailsAboard, [oberonView.seat])

  const game = createGame({ seed: 'oberon-partner-hidden', playerCount: 7 })
  const visibleEvil = game.players.find((player) =>
    player.alignment === 'evil' && player.role !== 'oberon')!
  const oberonSeat = game.players.find((player) => player.role === 'oberon')!.seat
  const view = {
    ...viewFor(game, visibleEvil.seat),
    currentTeam: [visibleEvil.seat, oberonSeat],
  }
  assert.deepEqual(analyzeSituation(view).currentTeam?.knownFailsAboard, [visibleEvil.seat])
})

test('hard deductions distinguish private, closure, quest, and multi-constraint provenance', () => {
  const merlin = fixture('merlin-opening-proposal').view
  const privateAnalysis = analyzeSituation(merlin, {
    evidence: reconstructCognition(merlin).evidence,
  })
  assert.equal(
    privateAnalysis.deductions.find((deduction) => deduction.seat === merlin.seat)
      ?.provenance.kind,
    'private-deal',
  )
  assert.ok(privateAnalysis.deductions.some((deduction) =>
    deduction.provenance.kind === 'role-cardinality-closure'))

  const directGame = createGame({
    seed: 'analysis-single-quest',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const percivalSeat = directGame.players.find((player) => player.role === 'percival')!.seat
  const morganaSeat = directGame.players.find((player) => player.role === 'morgana')!.seat
  applyDecision(directGame, directGame.leaderSeat, {
    kind: 'propose',
    team: [percivalSeat, morganaSeat],
  })
  for (const player of directGame.players) {
    applyDecision(directGame, player.seat, { kind: 'vote', vote: 'approve' })
  }
  applyDecision(directGame, percivalSeat, { kind: 'quest', card: 'success' })
  applyDecision(directGame, morganaSeat, { kind: 'quest', card: 'fail' })
  const directView = viewFor(directGame, percivalSeat)
  const direct = analyzeSituation(directView, {
    evidence: reconstructCognition(directView).evidence,
  })
  const directDeduction = direct.deductions.find(
    (candidate) => candidate.seat === morganaSeat,
  )!
  assert.equal(directDeduction.provenance.kind, 'joint-constraints')
  if (directDeduction.provenance.kind === 'joint-constraints') {
    assert.deepEqual(directDeduction.provenance.questNums, [1])
    assert.ok(directDeduction.provenance.components.includes('private-knowledge'))
  }

  const questOnlyGame = createGame({
    seed: 'analysis-quest-only',
    playerCount: 5,
    roles: DEFAULT_ROLES[5],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const evilTeam = questOnlyGame.players
    .filter((player) => player.alignment === 'evil')
    .map((player) => player.seat)
  const servantSeat = questOnlyGame.players.find(
    (player) => player.role === 'servant',
  )!.seat
  applyDecision(questOnlyGame, questOnlyGame.leaderSeat, {
    kind: 'propose',
    team: evilTeam,
  })
  for (const player of questOnlyGame.players) {
    applyDecision(questOnlyGame, player.seat, { kind: 'vote', vote: 'approve' })
  }
  for (const seat of evilTeam) {
    applyDecision(questOnlyGame, seat, { kind: 'quest', card: 'fail' })
  }
  const questOnlyView = viewFor(questOnlyGame, servantSeat)
  const questOnly = analyzeSituation(questOnlyView, {
    evidence: reconstructCognition(questOnlyView).evidence,
  })
  for (const seat of evilTeam) {
    const proven = questOnly.deductions.find(
      (deduction) => deduction.seat === seat,
    )!
    assert.equal(proven.provenance.kind, 'quest-record')
  }

  const roles: Role[] = ['servant', 'servant', 'servant', 'minion', 'minion']
  const game = createGame({ seed: 'analysis-joint', playerCount: 5, roles })
  const viewer = game.players.find((player) => player.role === 'servant')!.seat
  const [evilA, evilB] = game.players
    .filter((player) => player.alignment === 'evil')
    .map((player) => player.seat)
  const [goodC, settledGood] = game.players
    .filter((player) => player.alignment === 'good' && player.seat !== viewer)
    .map((player) => player.seat)
  const base = viewFor(game, viewer)
  const view: PlayerView = {
    ...base,
    quests: base.quests.map((quest) => {
      if (quest.num === 1) return { ...quest, status: 'complete' as const, team: [evilA, evilB], result: 'fail' as const, failCount: 1 }
      if (quest.num === 2) return { ...quest, status: 'complete' as const, team: [evilA, goodC, viewer], result: 'fail' as const, failCount: 1 }
      if (quest.num === 3) return { ...quest, status: 'complete' as const, team: [evilB, goodC], result: 'fail' as const, failCount: 1 }
      return quest
    }),
  }
  const joint = analyzeSituation(view)
  const deduction = joint.deductions.find((candidate) => candidate.seat === settledGood)!
  assert.equal(deduction.alignment, 'good')
  assert.equal(deduction.provenance.kind, 'joint-constraints')
  if (deduction.provenance.kind === 'joint-constraints') {
    assert.ok(deduction.provenance.questNums.length > 1)
  }
  assert.ok(joint.factCodes.includes('ALIGNMENT_PROVEN_JOINT'))
})

test('analysis reason codes are deterministic and stable', () => {
  const view = fixture('assassin-late-finalize').view
  const first = analyzeSituation(view)
  const second = analyzeSituation(view)
  assert.deepEqual(first.factCodes, second.factCodes)
  assert.deepEqual(first.forcedPlayReasonCodes, second.forcedPlayReasonCodes)
  assert.ok(first.forcedPlayReasonCodes.includes('GOOD_MATCH_POINT_FAIL_REQUIRED'))
})

test('off-team good viewers do not receive a forced quest-card reason', () => {
  const game = createGame({
    seed: 'analysis-off-team-good',
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  const team = [game.leaderSeat, (game.leaderSeat + 1) % game.config.playerCount]
  applyDecision(game, game.leaderSeat, { kind: 'propose', team })
  for (const player of game.players) {
    applyDecision(game, player.seat, { kind: 'vote', vote: 'approve' })
  }

  const offTeamGood = game.players.find(
    (player) => player.alignment === 'good' && !team.includes(player.seat),
  )!
  const analysis = analyzeSituation(viewFor(game, offTeamGood.seat))
  assert.equal(analysis.currentTeam?.team.includes(offTeamGood.seat), false)
  assert.ok(
    !analysis.forcedPlayReasonCodes.includes('GOOD_QUEST_CARD_FORCED_SUCCESS'),
  )
})
