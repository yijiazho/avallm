// test-lane: fast
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateAudits,
  auditArtifact,
} from '../../.codex/skills/avalon-playtest-debugging/scripts/audit-artifact.mjs'

test('playtest auditor distinguishes execution evidence and finds plan reversals', () => {
  const artifact = {
    id: 'game-test',
    seed: 'seed-test',
    createdAt: '2026-08-01T00:00:00.000Z',
    winner: 'good',
    players: [
      { seat: 0, name: 'Martin', role: 'merlin', alignment: 'good', agent: 'moonshotai/kimi-k2.5' },
      { seat: 1, name: 'Raw', role: 'servant', alignment: 'good', agent: 'llm:kimi' },
      { seat: 2, name: 'Percival', role: 'percival', alignment: 'good', agent: 'heuristic' },
      { seat: 3, name: 'Morgana', role: 'morgana', alignment: 'evil', agent: 'heuristic' },
      { seat: 4, name: 'Assassin', role: 'assassin', alignment: 'evil', agent: 'heuristic' },
    ],
    log: [
      { type: 'thinking', payload: { seat: 1 } },
      ...[[3, 4], [0, 1], [3, 4]].map((team, index) => ({
        type: 'voteReveal',
        payload: {
          round: index + 1,
          proposalNum: 1,
          team,
          votes: [{ seat: 0, vote: team[0] === 0 ? 'approve' : 'reject' }],
        },
      })),
    ],
    decisionTraces: [
      {
        viewerSeat: 0,
        beliefThroughSeq: 10,
        request: { kind: 'discuss', round: 1, proposalNum: 1 },
        action: { kind: 'discuss', say: 'I support it' },
        privatePlanOutcome: { selected: { plan: { strategicIntent: { objective: 'SUPPORT_TEAM' } } } },
      },
      {
        viewerSeat: 0,
        beliefThroughSeq: 11,
        request: { kind: 'vote', round: 1, proposalNum: 1 },
        action: { kind: 'vote', vote: 'reject' },
      },
    ],
  }

  const audit = auditArtifact(artifact)
  assert.equal(audit.seats[0]!.inferredExecution, 'probabilistic-llm')
  assert.equal(audit.seats[1]!.inferredExecution, 'raw-llm')
  assert.deepEqual(
    audit.findings.map((finding) => finding.signature).sort(),
    [
      'IDENTITY_DESCRIPTOR_LOSS',
      'MERLIN_PERFECT_TRUTH_VOTING',
      'PLAN_VOTE_CONTRADICTION',
    ],
  )
  assert.deepEqual(aggregateAudits([audit]).map((row) => row.occurrences), [1, 1, 1])
})

test('playtest auditor accepts an explicitly classified stance reversal', () => {
  const artifact = {
    id: 'game-classified',
    seed: 'seed-classified',
    createdAt: '2026-08-01T00:00:00.000Z',
    winner: 'evil',
    players: [{
      seat: 0, name: 'Hybrid', role: 'percival', alignment: 'good',
      agent: 'def:probabilistic-llm:llm:kimi',
    }],
    log: [],
    decisionTraces: [
      {
        viewerSeat: 0,
        beliefThroughSeq: 10,
        request: { kind: 'discuss', round: 1, proposalNum: 1 },
        privatePlanOutcome: {
          selected: { plan: { strategicIntent: { objective: 'SUPPORT_TEAM' } } },
        },
      },
      {
        viewerSeat: 0,
        beliefThroughSeq: 11,
        request: { kind: 'vote', round: 1, proposalNum: 1 },
        action: { kind: 'vote', vote: 'reject' },
        privatePlanOutcome: { coherence: { conflictCodes: [
          'VOTE_REVERSES_CURRENT_PROPOSAL_INTENT',
        ] } },
      },
    ],
  }

  assert.deepEqual(auditArtifact(artifact).findings, [])
})

test('playtest auditor keeps API-free composed traces out of the hybrid lane', () => {
  const artifact = {
    id: 'game-structured-only',
    seed: 'seed-structured-only',
    createdAt: '2026-08-01T00:00:00.000Z',
    winner: 'evil',
    players: [{
      seat: 0, name: 'Structured Merlin', role: 'merlin', alignment: 'good',
      agent: 'composed:full-role',
    }],
    log: [
      ...[1, 2, 3].map((round) => ({
        type: 'voteReveal',
        payload: {
          round, proposalNum: 1, team: [],
          votes: [{ seat: 0, vote: 'approve' }],
        },
      })),
    ],
    decisionTraces: [{
      viewerSeat: 0,
      request: { kind: 'vote', round: 1, proposalNum: 1 },
      action: { kind: 'vote', vote: 'approve' },
    }],
  }

  const audit = auditArtifact(artifact)
  const seat = audit.seats[0]
  assert.ok(seat)
  assert.equal(seat.descriptorKind, 'probabilistic')
  assert.equal(seat.inferredExecution, 'probabilistic')
  assert.deepEqual(audit.findings, [])
})
