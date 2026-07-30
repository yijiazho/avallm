// Test helpers for the pending/complete Quest union (server/engine/types.ts).
// Fixtures used to build a quest by spreading a pending one and tacking on
// `result`/`failCount`, which the union now rejects (a completed quest must
// also carry its team). These keep the fixtures to one line and honest.

import type { CompletedQuest, Quest, Seat } from '../../server/engine/types.ts'

// The fixed quest parameters these helpers read off a base quest — accepts a
// mutable engine Quest or a readonly one out of a PlayerView projection.
type QuestParams = { num: number; teamSize: number; failsRequired: number }

// Build the completed member of a Quest, preserving the base quest's fixed
// parameters. `team` defaults to the first `teamSize` seats when a test does
// not care which seats went.
export function resolveQuest(
  base: QuestParams,
  outcome: { result: 'success' | 'fail'; failCount: number; team?: readonly Seat[] },
): CompletedQuest {
  return {
    num: base.num,
    teamSize: base.teamSize,
    failsRequired: base.failsRequired,
    status: 'complete',
    team: outcome.team
      ? [...outcome.team]
      : Array.from({ length: base.teamSize }, (_, seat) => seat),
    result: outcome.result,
    failCount: outcome.failCount,
  }
}

// Build the pending member from a base quest, dropping any outcome fields a
// cloned quest may carry.
export function pendingQuest(base: QuestParams): Quest {
  return {
    num: base.num,
    teamSize: base.teamSize,
    failsRequired: base.failsRequired,
    status: 'pending',
  }
}

// Narrow a quest to its completed member inside an assertion, throwing (rather
// than silently reading undefined) if it is still pending.
export function asCompletedQuest(quest: Quest): CompletedQuest {
  if (quest.status !== 'complete') {
    throw new Error(`expected a completed quest, got status ${quest.status}`)
  }
  return quest
}
