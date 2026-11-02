// Post-game calls get a parallel table on purpose. A review is not a turn a bot
// can be asked to take during a game: CALL_PARAMS and OUTPUT_CONTRACTS are
// keyed by LlmCallKind and assume a PlayerView, and /api/agents serves their
// keys as the decision kinds an author can customize. Adding `review` there
// would advertise a decision kind that does not exist and put a PostgameView
// through a decision-shaped dispatch.
//
// The transport is still shared: the runner calls OpenRouterClient.call with
// these params and the same global spend ceiling.

export type PostgameCallKind = 'review'

export const POSTGAME_CALL_PARAMS = {
  review: { temperature: 0.4, max_tokens: 1200, json: true },
} as const
