// The runtime half of the house-style loop: talk-norms.test.ts proves we never
// SHOW the model a banned construction, this measures how often it produces one
// anyway. Both halves import the same patterns from eval/norms.ts.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SPEECH_NORMS, speechNorms, mergeSpeechNorms, newSpeechNormReport } from '../server/eval/norms.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'
import type { GameEvent, Role, Seat } from '../server/engine/types.ts'

const ROLES: Role[] = ['merlin', 'percival', 'servant', 'morgana', 'assassin']
const AGENTS = ['llm:kimi', 'llm:glm', 'llm:qwen', 'llm:seed', 'heuristic']

function artifact(events: Omit<GameEvent, 'seq' | 'visibility'>[]): GameArtifact {
  return {
    schema: 3, id: 'g', seed: 's', createdAt: '2026-07-26T00:00:00.000Z',
    playerCount: 5, roles: [...ROLES],
    talk: { maxRounds: 1, maxRoundsAfterChange: 0 },
    players: ROLES.map((role, seat) => ({
      seat: seat as Seat, name: `P${seat}`, role,
      alignment: role === 'morgana' || role === 'assassin' ? 'evil' : 'good',
      agent: AGENTS[seat],
    })),
    winner: 'good', winReason: 'threeQuests', steps: 0, degraded: [],
    log: events.map((e, seq) => ({ seq, visibility: 'public', ...e })) as GameEvent[],
  }
}
const say = (seat: Seat, text: string) =>
  ({ type: 'utterance' as const, payload: { seat, text, round: 1 } })

test('a clean table reports no violations', () => {
  const r = speechNorms(artifact([
    say(0, 'I am fine with this team. Lets get a result on the board.'),
    say(1, 'Agreed. No reason to stall on the first proposal.'),
  ]))
  assert.equal(r.turns, 2)
  assert.equal(r.violations, 0)
})

test('dashes and the banned slogan are both caught, and attributed per agent', () => {
  const r = speechNorms(artifact([
    say(0, 'I backed that mess—my bad—and now I want a clean team.'),   // kimi, dash
    say(0, "That's not conviction, that's cover."),                     // kimi, slogan
    say(1, 'You kept yourself on the team. That is the whole problem.'), // glm, clean
    say(3, "That's not a vote, that's an alibi."),                      // seed, slogan
  ]))
  assert.equal(r.turns, 4)
  assert.equal(r.violations, 3)
  assert.equal(r.byRule['em-or-en-dash'], 1)
  assert.equal(r.byRule['not-x-that-y'], 2)
  // Per agent, because compliance is model-dependent and that is the actionable cut.
  assert.deepEqual(r.byAgent['not-x-that-y'], { 'llm:kimi': 1, 'llm:seed': 1 })
  assert.deepEqual(r.byAgent['em-or-en-dash'], { 'llm:kimi': 1 })
})

test('one turn breaking two norms counts once as a violation, twice by rule', () => {
  const r = speechNorms(artifact([
    say(0, "That's not analysis—that's noise, that's chasing shiny objects."),
  ]))
  assert.equal(r.turns, 1)
  assert.equal(r.violations, 1, 'a turn is one violation however many rules it breaks')
  assert.equal(r.byRule['em-or-en-dash'], 1)
  assert.equal(r.byRule['not-x-that-y'], 1)
})

test('pitches and revision reasons count as speech', () => {
  // They are read by the whole table and rendered into everyone's next prompt
  // exactly like an utterance, so a dash in a pitch does the same work.
  const r = speechNorms(artifact([
    { type: 'proposal', payload: { round: 1, proposalNum: 1, leader: 2, team: [0, 1], pitch: 'Building on Q1—lets go.' } },
    { type: 'proposalRevised', payload: { round: 1, proposalNum: 1, leader: 2, from: [0, 1], to: [0, 2], reason: "That's not hiding, that's listening." } },
  ]))
  assert.equal(r.turns, 2)
  assert.equal(r.violations, 2)
  assert.deepEqual(r.byAgent['em-or-en-dash'], { 'llm:qwen': 1 })
})

test('passing (empty speech) is not a turn', () => {
  // Bots pass constantly; counting passes as clean turns would deflate the rate.
  const r = speechNorms(artifact([say(0, ''), say(1, '   '), say(2, 'a real turn')]))
  assert.equal(r.turns, 1)
})

test('reports merge across a batch', () => {
  const one = speechNorms(artifact([say(0, "That's not a team, that's a surrender.")]))
  const two = speechNorms(artifact([say(0, 'clean'), say(1, 'also—not clean')]))
  const total = mergeSpeechNorms(mergeSpeechNorms(newSpeechNormReport(), one), two)
  assert.equal(total.turns, 3)
  assert.equal(total.violations, 2)
  assert.equal(total.byRule['not-x-that-y'], 1)
  assert.equal(total.byRule['em-or-en-dash'], 1)
  assert.deepEqual(total.byAgent['em-or-en-dash'], { 'llm:glm': 1 })
})

test('plain contrast is not flagged as the slogan', () => {
  // "my issue is with you, not Flash" is ordinary English. Only the copula
  // ANTITHESIS reframe is the tell, and over-matching would flag half of speech.
  const r = speechNorms(artifact([
    say(0, 'My issue is with you, not Flash.'),
    say(1, 'I want a result, not another stall.'),
  ]))
  assert.equal(r.violations, 0)
})

test('the patterns are shared, not copied', () => {
  // If these ever diverge from talk-norms.test.ts the two halves stop being
  // comparable, which is the whole reason they live in one module.
  assert.ok(SPEECH_NORMS['em-or-en-dash'].pattern.test('a—b'))
  assert.ok(!SPEECH_NORMS['em-or-en-dash'].pattern.test('a-b'), 'a plain hyphen is not a dash')
})
