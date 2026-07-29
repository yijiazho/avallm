import type { Game } from '../../server/engine/types.ts'
import {
  replayDecisionScenario,
  type DecisionFor,
  type DecisionScenario,
  type LegalReplayStep,
} from '../support/decision-scenario.ts'

const vote: DecisionFor<'vote'> = {
  kind: 'vote',
  vote: 'approve',
}
void vote

const legalVote: LegalReplayStep = {
  request: {
    kind: 'vote',
    seat: 2,
    round: 1,
    proposalNum: 1,
  },
  decision: { kind: 'vote', vote: 'reject' },
}
void legalVote

// @ts-expect-error A vote coordinate cannot be paired with a quest decision.
const mismatched: LegalReplayStep = {
  request: {
    kind: 'vote',
    seat: 2,
    round: 1,
    proposalNum: 1,
  },
  decision: { kind: 'quest', card: 'success' },
}
void mismatched

declare const game: Game
if (false) {
  const scenario: DecisionScenario<'propose'> = replayDecisionScenario(
    game,
    [],
    {
      kind: 'propose',
      seat: 0,
      round: 1,
      proposalNum: 1,
    },
  )
  const exactKind: 'propose' = scenario.request.kind
  void exactKind
  // @ts-expect-error The detached result deliberately exposes no raw Game.
  scenario.game
}
