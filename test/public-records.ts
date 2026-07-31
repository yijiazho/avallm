// Hand-built PublicRecord boards shared by the tests that read public state.
//
// These live together rather than beside one suite because two suites assert
// on the SAME board from different angles: public-self-read measures it, and
// servant-objective weights that measurement. A copy per file lets one drift
// while both stay green, which is the failure this file exists to prevent.

import type { PublicRecord } from '../server/agents/record/public-record.ts'
import {
  DEFAULT_ROLES,
  QUESTS_PER_GAME,
  TEAM_SIZES,
  failsRequired,
} from '../server/engine/rules.ts'

const seats = (count: number) =>
  Array.from({ length: count }, (_, seat) => ({ seat, name: `P${seat}` }))

// Derived from the engine rather than transcribed, so a board built here for
// ten players carries ten-player team sizes and the quest-four two-fail rule
// instead of five-player numbers wearing a different playerCount.
const unplayedQuests = (playerCount: number) =>
  Array.from({ length: QUESTS_PER_GAME }, (_, index) => ({
    num: index + 1,
    teamSize: TEAM_SIZES[playerCount][index],
    failsRequired: failsRequired(playerCount, index + 1),
  }))

/**
 * A settled five-player board whose first quest FAILED with seats 0 and 1 on
 * it. The failure is what gives the public read any width at all: a quest that
 * succeeds constrains nothing, since evil may always play success.
 */
export function failedQuestRecord(): PublicRecord {
  return {
    playerCount: 5,
    rolesInPlay: [...DEFAULT_ROLES[5]].sort(),
    players: seats(5),
    phase: 'proposal',
    round: 2,
    proposalNum: 1,
    leaderSeat: 2,
    quests: [
      {
        num: 1,
        teamSize: 2,
        failsRequired: 1,
        team: [0, 1],
        result: 'fail',
        failCount: 1,
      },
      ...unplayedQuests(5).slice(1),
    ],
    proposals: [{
      round: 1,
      proposalNum: 1,
      leader: 0,
      team: [0, 1],
      outcome: 'voted',
      votes: [
        { seat: 0, vote: 'approve' },
        { seat: 1, vote: 'approve' },
        { seat: 2, vote: 'approve' },
        { seat: 3, vote: 'reject' },
        { seat: 4, vote: 'reject' },
      ],
      approved: true,
    }],
  }
}

/** An opening board of any legal size: nothing resolved, no seat distinguished. */
export function openingRecord(playerCount: number): PublicRecord {
  return {
    playerCount,
    rolesInPlay: [...DEFAULT_ROLES[playerCount]].sort(),
    players: seats(playerCount),
    phase: 'proposal',
    round: 1,
    proposalNum: 1,
    leaderSeat: 0,
    quests: unplayedQuests(playerCount),
    proposals: [],
  }
}
