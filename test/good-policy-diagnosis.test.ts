// test-lane: eval
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  diagnoseGoodPolicy,
  renderGoodPolicyDiagnosis,
} from '../server/eval/good-policy-diagnosis.ts'
import type { GameArtifact } from '../server/eval/artifact.ts'

/**
 * The reader consumes a narrow public projection of a bench artifact, so these
 * fixtures supply exactly that projection rather than a whole replayable game.
 */
function artifact(input: {
  variant: string
  winner: 'good' | 'evil'
  winReason: string
  /** One entry per revealed vote: was the team dirty, did the target approve. */
  votes: readonly { dirty: boolean; approve: boolean }[]
  questFails?: number
  questSuccesses?: number
  proposalNums?: readonly number[]
}): GameArtifact {
  const players = [
    { seat: 0, name: 'P0', role: 'merlin', alignment: 'good' },
    { seat: 1, name: 'P1', role: 'servant', alignment: 'good' },
    { seat: 2, name: 'P2', role: 'assassin', alignment: 'evil' },
  ]
  const log: unknown[] = []
  for (const proposalNum of input.proposalNums ?? [1]) {
    log.push({ type: 'proposal', payload: { proposalNum, leader: 0, team: [0, 1] } })
  }
  for (const vote of input.votes) {
    log.push({
      type: 'voteReveal',
      payload: {
        // Seat 2 is the only evil seat, so its presence makes the team dirty.
        team: vote.dirty ? [0, 2] : [0, 1],
        votes: [{ seat: 0, vote: vote.approve ? 'approve' : 'reject' }],
      },
    })
  }
  for (let index = 0; index < (input.questFails ?? 0); index++) {
    log.push({ type: 'questResult', payload: { result: 'fail' } })
  }
  for (let index = 0; index < (input.questSuccesses ?? 0); index++) {
    log.push({ type: 'questResult', payload: { result: 'success' } })
  }
  return {
    architecture: {
      bank: 'test-bank',
      variant: input.variant,
      targetRole: 'merlin',
      targetSeat: 0,
    },
    players,
    winner: input.winner,
    winReason: input.winReason,
    log,
  } as unknown as GameArtifact
}

test('the two vote error directions are separated, not averaged', () => {
  // Both variants make exactly one wrong vote out of two, so the symmetric
  // vote-truth accuracy that architecture-report.ts computes is identical.
  // Only the direction differs, and only the direction predicts the outcome.
  const diagnosis = diagnoseGoodPolicy([
    artifact({
      variant: 'rejects-clean',
      winner: 'good',
      winReason: 'assassinMissed',
      votes: [
        { dirty: false, approve: false },
        { dirty: true, approve: false },
      ],
    }),
    artifact({
      variant: 'approves-dirty',
      winner: 'evil',
      winReason: 'threeFails',
      votes: [
        { dirty: false, approve: true },
        { dirty: true, approve: true },
      ],
    }),
  ])
  const cheap = diagnosis.cells.find((cell) => cell.variant === 'rejects-clean')!
  const costly = diagnosis.cells.find(
    (cell) => cell.variant === 'approves-dirty',
  )!
  assert.equal(cheap.targetVotes, 2)
  assert.equal(costly.targetVotes, 2)
  assert.deepEqual(
    [cheap.rejectedCleanTeams, cheap.approvedDirtyTeams],
    [1, 0],
  )
  assert.deepEqual(
    [costly.rejectedCleanTeams, costly.approvedDirtyTeams],
    [0, 1],
  )
  assert.equal(cheap.targetApprovals, 0)
  assert.equal(costly.targetApprovals, 2)
})

test('outcome channels and rejection pressure are counted per variant', () => {
  const diagnosis = diagnoseGoodPolicy([
    artifact({
      variant: 'candidate',
      winner: 'evil',
      winReason: 'merlinAssassinated',
      votes: [{ dirty: false, approve: true }],
      proposalNums: [1, 2, 5],
      questFails: 1,
      questSuccesses: 2,
    }),
    artifact({
      variant: 'candidate',
      winner: 'evil',
      winReason: 'threeFails',
      votes: [{ dirty: true, approve: true }],
      proposalNums: [1],
      questFails: 3,
    }),
  ])
  assert.equal(diagnosis.cells.length, 1)
  const cell = diagnosis.cells[0]
  assert.equal(cell.games, 2)
  // The target is Merlin, so a good win is a target win. Both games are losses.
  assert.equal(cell.targetWins, 0)
  assert.deepEqual(cell.outcomes, {
    'evil:merlinAssassinated': 1,
    'evil:threeFails': 1,
  })
  assert.equal(cell.proposals, 4)
  assert.equal(cell.hammerProposals, 1)
  assert.equal(cell.questsRun, 6)
  assert.equal(cell.questsFailed, 4)
})

test('cells never merge across banks, so populations stay separate', () => {
  const heuristic = artifact({
    variant: 'candidate',
    winner: 'good',
    winReason: 'assassinMissed',
    votes: [{ dirty: true, approve: false }],
  })
  const random = artifact({
    variant: 'candidate',
    winner: 'evil',
    winReason: 'threeFails',
    votes: [{ dirty: true, approve: true }],
  })
  ;(random.architecture as { bank: string }).bank = 'test-bank-random'
  const diagnosis = diagnoseGoodPolicy([heuristic, random])
  assert.deepEqual(
    diagnosis.cells.map((cell) => [cell.bank, cell.targetWins]),
    [['test-bank', 1], ['test-bank-random', 0]],
  )
  const rendered = renderGoodPolicyDiagnosis(diagnosis)
  assert.match(rendered, /bank test-bank\b/)
  assert.match(rendered, /bank test-bank-random\b/)
})

test('a target seat absent from the cast is refused, not scored as a loss', () => {
  const stray = artifact({
    variant: 'candidate',
    winner: 'good',
    winReason: 'assassinMissed',
    votes: [],
  })
  ;(stray.architecture as { targetSeat: number }).targetSeat = 9
  assert.throws(
    () => diagnoseGoodPolicy([stray]),
    /no player at target seat 9/,
  )
})

test('a non-bench artifact is refused rather than silently grouped', () => {
  const stray = artifact({
    variant: 'candidate',
    winner: 'good',
    winReason: 'assassinMissed',
    votes: [],
  })
  delete (stray as { architecture?: unknown }).architecture
  assert.throws(
    () => diagnoseGoodPolicy([stray]),
    /not an architecture bench result/,
  )
})
