# REVIEW-001 — Post-game projection, prompt, and parser

- **Status:** proposed
- **Depends on:** SHARED-002 (fixture games are enough for the rest)
- **Blocks:** REVIEW-002, REVIEW-003
- **Design:** [design-postgame-review.md](../design-postgame-review.md) §Record shape,
  §Full-reveal projection, §Not a LlmCallKind, §What the prompt sees
- **Size:** M

## Description

Build the offline half of the post-game review: a full-reveal projection that is usable only after
`gameOver`, a prompt that asks one seat to review its own decisions with hindsight, a tolerant JSON
parser, and the record types. No server wiring, no model calls in tests, no UI.

The negative constraint is as important as the feature: a review is not a `DecisionKind`, not a
`GameEvent`, and not a `PlayerView` extension. It lives beside the game record and uses its own
call table and parser.

## Implementation plan

1. Add `PostgameView` and `viewForPostgame(game, seat)` in `server/engine/view.ts`:
   - throw unless `game.phase === 'gameOver'`;
   - include seat, name, role, alignment, `privateInfo`, playerCount, rolesInPlay, players with
     roles/alignments, quests, proposals, the public transcript, the **entire** event log, and the
     outcome;
   - return a `DeepReadonly` shape, consistent with `PlayerView`;
   - do not add a flag to `viewFor` and do not make `PostgameView` assignable to `PlayerView`.
2. Add `server/postgame/types.ts`:
   - `PostgameRecord`, `PostgameSeat`, `PostgameReview` exactly as in the design, with capped
     arrays;
   - `PostgameStatus` and a `PostgameSeatStatus` union;
   - a `postgameRecord(seats)` constructor that starts every seat `pending`.
3. Use `sanitizeSpeech` from `server/shared/speech.ts` (provided by SHARED-002) for every
   player-authored string that enters the review prompt.
4. Add `server/postgame/params.ts`:
   ```ts
   export type PostgameCallKind = 'review'
   export const POSTGAME_CALL_PARAMS = {
     review: { temperature: 0.4, max_tokens: 1200, json: true },
   } as const
   ```
   Do not add `review` to `LlmCallKind` or `CALL_PARAMS`. The `/api/agents` decision-kind list must
   not grow.
5. Add `server/postgame/prompts.ts` (pure, imports only `PostgameView` and text helpers):
   - `buildPostgameMessages(kind, view, extra?)` returns `Msg[]`.
   - System prompt: role and alignment, the win condition/outcome, a compact review contract, the
     injection guard, and the house-style rules. Do not use em/en dashes or antithesis reframes.
   - User prompt sections: roster with roles, quest board, full proposal/vote record, this seat's
     decision ledger, a bounded selection of pivotal moments, and the ask.
   - Decision ledger is derived from `view.events` filtered to the reviewing seat: `thinking`,
     `scratchpad`, `utterance`, `proposal`, `proposalRevised`, `voteCast`, `questCard`,
     `assassination`, with `seq` preserved.
   - `renderLedger` has a char budget (~8k chars by default). Over-budget keeps the outcome, the
     seat's votes/cards/proposals, and the pivotal moments; drops the oldest chatter first.
   - All player-authored text passes `sanitizeSpeech`; the whole table-talk section is fenced and
     carries the guard.
   - Output contract:
     `{"summary": "...", "decisions": [{"seq": n, "kind": "...", "assessment": "...",
     "alternative": "..."}], "commentary": [{"seat": n, "note": "..."}], "lesson": "..."}`
     with caps of 4 decisions and 2 comments, and a word/char cap per field.
6. Add `server/postgame/parse.ts`:
   - `parsePostgameReply(content, view): { ok: true; review } | { ok: false; error }`.
   - Tolerant ladder: strict JSON, then the existing `{...}` extraction approach used by
     `decision-parser.ts` (reuse a helper if it is already exported; otherwise keep a small local
     extractor).
   - Reject a `seq` that does not exist, does not belong to the reviewing seat, or whose event
     kind does not match `kind`.
   - Clamp array lengths and field lengths; never throw on model output.
7. Add `server/postgame/render.ts` (pure): `renderPostgameMarkdown(record, nameOf)` for the
   transcript and UI, with the same caps as the record.
8. Add docs comments explaining why this module is outside `server/agents/` and why
   `viewForPostgame` is a separate chokepoint.

### Files

- `server/engine/view.ts` (`PostgameView`, `viewForPostgame`)
- `server/postgame/types.ts` (new)
- `server/postgame/params.ts` (new)
- `server/postgame/prompts.ts` (new)
- `server/postgame/parse.ts` (new)
- `server/postgame/render.ts` (new)
- `test/engine/postgame-view.test.ts` (new)
- `test/postgame/prompts.test.ts` (new)
- `test/postgame/parse.test.ts` (new)
- `test/postgame/render.test.ts` (new)

## Acceptance criteria

- [ ] `viewForPostgame` throws before `gameOver` and returns every role, every event, and the
      outcome after it.
- [ ] `PostgameView` is not assignable to `PlayerView`; no live decision path imports
      `viewForPostgame` (grep contract test).
- [ ] `PostgameView` is deeply read-only.
- [ ] `review` is not in `LlmCallKind` or `CALL_PARAMS`; `/api/agents` `kinds` is unchanged.
- [ ] The rendered prompt contains the reviewing seat's own decision trail and the full public
      record, and does not contain another seat's scratchpad as "your notes".
- [ ] The prompt and contract contain no em/en dashes and no antithesis reframes.
- [ ] The ledger respects its char budget; over-budget truncation keeps proposals, votes, cards,
      and pivotal moments.
- [ ] The parser accepts strict and fenced JSON, rejects unknown `seq`/kind mismatches, clamps
      caps, and returns an error instead of throwing.
- [ ] Every player-authored string in the rendered prompt goes through
      `sanitizeSpeech` from `server/shared/speech.ts`.
- [ ] Every new test file declares `// test-lane: fast` or `contract` as appropriate.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Projection guard and completeness | `test/engine/postgame-view.test.ts`: heuristic-driven fixture game; assert throw mid-game, roles/events/outcome after |
| No live import | `test/contract/postgame-boundary.test.ts` (or extend an existing architecture test): grep imports of `server/postgame` and `viewForPostgame` |
| Deep readonly | same engine test: `Object.isFrozen` on the top-level and nested arrays |
| Call table unchanged | `test/postgame/prompts.test.ts`: assert `CALL_PARAMS.review` is undefined and `Object.keys(OUTPUT_CONTRACTS)` does not include it |
| Prompt content and budget | same file: fixture view, assert own ledger, roles, cap marker, no other seat's private note |
| House style | same file: the rendered system+user text has no `—`/`–` and no banned reframe; mirrors `test/agents/prompts/talk-norms.test.ts` |
| Parser ladder | `test/postgame/parse.test.ts`: valid, fenced, truncated, wrong seq, wrong kind, too many items |
| Markdown render | `test/postgame/render.test.ts`: statuses, citations, caps |

Run:

```
node --test test/engine/postgame-view.test.ts test/postgame/*.test.ts
npm run typecheck
npm run test:lanes
npm run verify:contract
```

## Risks and notes

- Do not import `Game` into `server/agents/`. `PostgameView` exists so prompt code never needs the
  raw game.
- The full log can be large. The ledger budget is the guard; do not let the model see a raw JSONL
  dump.
- A review may cite an event the parser no longer finds if the log changes; archived games are
  immutable, so this is a fixture concern only.
- `PostgameView` must not be exported from a barrel that `PlayerView` consumers already import
  wholesale. Keep it explicit.
