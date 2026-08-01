// test-lane: fast

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PUBLIC_BEHAVIOR_READING_VERSION,
  type PublicObserverSeatAssessment,
} from '../../../server/agents/analysis/observer-types.ts'
import { publicSeatSalience } from '../../../server/agents/analysis/public-seat-salience.ts'

const assessment: PublicObserverSeatAssessment = {
  seat: 0,
  goodProbability: 0.5,
  evilProbability: 0.5,
  roleMarginals: [],
  behavior: {
    version: PUBLIC_BEHAVIOR_READING_VERSION,
    semantics: 'bounded-deterministic-indices-not-probabilities',
    proposalLeadershipCount: 0,
    proposalSelectionIndex: 0.25,
    approvalIndex: 0.75,
    failedQuestExposureIndex: 0.75,
  },
}

const completedProposal = {
  round: 1,
  proposalNum: 1,
  leader: 0,
  team: [0, 1],
  outcome: 'voted' as const,
  votes: [0, 1, 2, 3, 4].map((seat) => ({
    seat,
    vote: 'approve' as const,
  })),
  approved: true,
}

test('public seat salience ignores the approval sentinel before a full vote', () => {
  assert.ok(
    Math.abs(
      publicSeatSalience(assessment, { playerCount: 5, proposals: [] })
      - 5 / 12,
    ) < Number.EPSILON,
  )
  assert.ok(
    Math.abs(publicSeatSalience(assessment, {
      playerCount: 5,
      proposals: [{
        ...completedProposal,
        votes: completedProposal.votes.slice(1),
      }],
    }) - 5 / 12) < Number.EPSILON,
  )
})

test('public seat salience admits approval extremity after a full vote', () => {
  assert.equal(
    publicSeatSalience(assessment, {
      playerCount: 5,
      proposals: [completedProposal],
    }),
    0.5,
  )
})
