// test-lane: eval
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MERLIN_CONCEALMENT_VALUE_VERSION,
  neutralPivotalProbability,
  valueOutcomeAwareMerlinVote,
  type MerlinConcealmentCandidateInput,
} from '../../server/eval/runs/merlin-concealment-value.ts'

const candidate = (
  vote: 'approve' | 'reject',
  over: Partial<MerlinConcealmentCandidateInput> = {},
): MerlinConcealmentCandidateInput => ({
  candidateId: `legal-candidates-v3:vote:${vote}`,
  vote,
  boardUtility: 1,
  currentCleanProbability: 1,
  rejectionsBeforeHammer: 4,
  correctedExposureProxyIndex: 0.5,
  ...over,
})

test('neutral pivotal prior is the exact strict-majority binomial mass', () => {
  assert.equal(neutralPivotalProbability(5), 6 / 16)
  assert.equal(neutralPivotalProbability(6), 10 / 32)
  assert.equal(neutralPivotalProbability(10), 126 / 512)
})

test('proposal delay breaks an equal clean-team vote toward approval', () => {
  const result = valueOutcomeAwareMerlinVote({
    playerCount: 5,
    concealmentExchangeRate: 0,
    candidates: [candidate('reject'), candidate('approve')],
  })
  assert.equal(result.version, MERLIN_CONCEALMENT_VALUE_VERSION)
  assert.equal(
    result.chosenCandidateId,
    'legal-candidates-v3:vote:approve',
  )
  const reject = result.candidates.find((row) => row.vote === 'reject')!
  assert.equal(reject.proposalDelayCost, 0.2)
  assert.ok(Math.abs(reject.expectedStrategicValue - 0.3) < 1e-12)
})

test('the proven-clean gate accepts float drift but refuses uncertainty', () => {
  const uncertain = valueOutcomeAwareMerlinVote({
    playerCount: 5,
    concealmentExchangeRate: 0,
    candidates: [
      candidate('approve', { currentCleanProbability: 0.9 }),
      candidate('reject', { currentCleanProbability: 0.9 }),
    ],
  })
  assert.equal(
    uncertain.candidates.find((row) => row.vote === 'reject')!
      .proposalDelayCost,
    0,
  )
  const drifted = valueOutcomeAwareMerlinVote({
    playerCount: 5,
    concealmentExchangeRate: 0,
    candidates: [
      candidate('approve', { currentCleanProbability: 1 - 5e-13 }),
      candidate('reject', { currentCleanProbability: 1 - 5e-13 }),
    ],
  })
  assert.equal(
    drifted.candidates.find((row) => row.vote === 'reject')!
      .proposalDelayCost,
    0.2,
  )
})
test('nonpivotal concealment can win when its explicit benefit exceeds cost', () => {
  const result = valueOutcomeAwareMerlinVote({
    playerCount: 5,
    concealmentExchangeRate: 1,
    candidates: [
      candidate('approve', {
        currentCleanProbability: 0,
        boardUtility: 1,
        correctedExposureProxyIndex: 0.8,
      }),
      candidate('reject', {
        currentCleanProbability: 0,
        boardUtility: 0.9,
        correctedExposureProxyIndex: 0.2,
      }),
    ],
  })
  assert.equal(
    result.chosenCandidateId,
    'legal-candidates-v3:vote:reject',
  )
  const approve = result.candidates.find((row) => row.vote === 'approve')!
  const reject = result.candidates.find((row) => row.vote === 'reject')!
  assert.ok(reject.expectedStrategicValue < approve.expectedStrategicValue)
  assert.ok(reject.expectedConcealmentValue > approve.expectedConcealmentValue)
  assert.ok(reject.totalValue > approve.totalValue)
})

test('strategic cost remains authoritative at a low exchange rate', () => {
  const result = valueOutcomeAwareMerlinVote({
    playerCount: 5,
    concealmentExchangeRate: 0.01,
    candidates: [
      candidate('approve', {
        currentCleanProbability: 0,
        boardUtility: 1,
        correctedExposureProxyIndex: 1,
      }),
      candidate('reject', {
        currentCleanProbability: 0,
        boardUtility: 0.5,
        correctedExposureProxyIndex: 0,
      }),
    ],
  })
  assert.equal(
    result.chosenCandidateId,
    'legal-candidates-v3:vote:approve',
  )
})

test('shared-state disagreements and malformed surfaces fail closed', () => {
  assert.throws(
    () => valueOutcomeAwareMerlinVote({
      playerCount: 5,
      concealmentExchangeRate: 0.1,
      candidates: [candidate('approve'), candidate('approve', {
        candidateId: 'other-approve',
      })],
    }),
    /requires approve and reject/,
  )
  assert.throws(
    () => valueOutcomeAwareMerlinVote({
      playerCount: 5,
      concealmentExchangeRate: 0.1,
      candidates: [candidate('approve'), candidate('reject', {
        currentCleanProbability: 0,
      })],
    }),
    /disagree on shared vote state/,
  )
})