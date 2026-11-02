# REVIEW-004 — Post-game round table

- **Status:** implemented 2026-11-02 (PR #5)
- **Depends on:** REVIEW-003
- **Blocks:** none
- **Design:** [design-postgame-review.md](../design-postgame-review.md) §Post-game round table,
  §Scheduling and failure, §Presentation
- **Size:** M

## Description

Turn the post-game review from independent per-seat essays into a sequential round table. Each
model seat speaks once, in seat order, and sees the earlier turns before writing its own. A seat can
answer a specific claim about its play instead of reviewing in isolation. The call count is
unchanged; the wall-clock cost becomes the sum of the turns rather than the slowest one.

The round table is the analysis: the structured review still carries the citations, comments, and
lesson, and the spoken statement is what the rest of the table gets to answer. No extra synthesis
call is added in this ticket.

## Implementation plan

1. Extend `PostgameReview` with an optional `statement` (the spoken turn), capped by
   `POSTGAME_STATEMENT_MAX_CHARS`. Extend `PostgameRecord` with an optional `turnOrder: Seat[]` so
   the UI and transcript can render the actual speaking order; older records remain readable.
2. Extend the review prompt:
   - the model is told it is in a round table and speaks once;
   - the output contract adds `"statement": "..."`;
   - the user prompt carries an `EARLIER POST-GAME TURNS` section with each earlier seat's
     statement, sanitized and fenced with the injection guard; detailed citations, comments, and
     lessons are included only for the three most recent turns;
   - the first speaker gets `You speak first.`; later speakers are told to answer an earlier claim
     when it named their decision.
3. Parse the optional statement, clamp it, and fall back to `summary` when absent. A missing
   statement is not a parse failure.
4. Change `runPostgame` from a bounded parallel fan-out to a sequential loop in seat order. Keep
   the per-turn retry, failure isolation, cost delta, archive writes, revision bumps, and broadcast
   after each turn. A failed turn is skipped; later turns see only completed turns.
5. Remove `AVALON_POSTGAME_CONCURRENCY`; one review request is in flight at a time.
6. Render the turns in `turnOrder` as a `### Table talk` block in the transcript, and a compact
   "Table talk" block in `Reveal` above the detailed cards. Fall back to `summary` for records or
   replies without a statement.
7. Add deterministic gallery turns to the complete/running/failed fixtures and regenerate the
   screenshot gallery.

### Files

- `server/postgame/types.ts` (`statement`, `turnOrder`, statement cap)
- `server/postgame/prompts.ts` (round-table contract and prior-turn rendering)
- `server/postgame/parse.ts` (optional statement)
- `server/postgame/run.ts` (sequential loop, prior turns)
- `server/postgame/render.ts` (`Table talk` section)
- `client/src/types.ts`, `client/src/components/Reveal.tsx`, `client/src/styles.css`
- `client/src/gallery.tsx`
- `test/postgame/{prompts,parse,render,run}.test.ts`
- `test/server/transcript.test.ts`

## Acceptance criteria

- [x] Model seats are reviewed sequentially in seat order, with one call per seat and at most one
      review request in flight.
- [x] A later seat's prompt contains the earlier seats' statements and citations; the first speaker
      gets `You speak first.`
- [x] `statement` is parsed and capped; a missing statement still parses and falls back to
      `summary`.
- [x] `turnOrder` is stored for new records; older records without it still render.
- [x] A failed turn is skipped and does not block the remaining turns; terminal status is unchanged.
- [x] The transcript renders `### Table talk` in `turnOrder`; the reveal renders the same turns
      above the detailed cards.
- [x] No quoted turn can close the prompt fence or reach the model as an instruction.
- [x] The gallery fixtures carry statements and turn order, and the refreshed screenshots show the
      table-talk block.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Sequential order and prior context | `test/postgame/run.test.ts`: two model seats, assert call order `[0, 1]` and the second prompt contains the first statement |
| First speaker | same file: the first prompt contains `You speak first.` and the second does not |
| Statement parse/cap/fallback | `test/postgame/parse.test.ts`: statement kept, capped, and optional |
| Prior-turn rendering | `test/postgame/prompts.test.ts`: earlier statement, citations, comments, fence safety |
| Turn order rendering | `test/postgame/render.test.ts`: `turnOrder` overrides seat order; transcript test includes `### Table talk` |
| Failure isolation | existing `run.test.ts` partial/all-failed cases |
| UI layout | `npm --prefix client run build` and the refreshed gallery fixtures |

Run:

```
node --test test/postgame/run.test.ts test/postgame/prompts.test.ts \
  test/postgame/parse.test.ts test/postgame/render.test.ts \
  test/server/transcript.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- Sequential turns make the review section fill in over the sum of the call latencies. The reveal
  and role flip are unaffected; the section already polls while `running`.
- The same model call count as the parallel version, so spend is unchanged. Wall-clock time and
  provider rate-limit pressure are the trade.
- The prior-turn section is model-authored and untrusted. It is sanitized, fenced, and carries the
  injection guard. A statement cannot close the fence because the renderer replaces the fence
  markers in quoted text.
- A table-level synthesis ("who was right") is deliberately out of scope. It is one more paid call
  and should be a separate ticket if the measured reviews need it.
- Older archived records have no `statement` or `turnOrder`; the renderer and UI fall back and keep
  working.

## Implementation notes

- `server/postgame/types.ts` adds `POSTGAME_STATEMENT_MAX_CHARS` (500), optional
  `PostgameReview.statement`, and optional `PostgameRecord.turnOrder`. `postgameRecord` fills
  `turnOrder` from the model seats in seat order.
- `server/postgame/prompts.ts` builds the `EARLIER POST-GAME TURNS` block from
  `PostgameExtra.priorTurns`, sanitizes every quoted string, clamps the evidence, and replaces the
  fence markers inside quoted statements. Every earlier statement is quoted; detailed citations,
  comments, and lessons are limited to the three most recent turns. The system contract also asks
  for the spoken statement.
- `server/postgame/run.ts` awaits each `reviewSeat` in seat order, appends each successful review to
  `priorTurns`, and passes that array to the next prompt. `AVALON_POSTGAME_CONCURRENCY` and the
  bounded worker pool were removed.
- `server/postgame/render.ts` renders `### Table talk` in `record.turnOrder`, then the existing
  detailed seat sections. `Reveal.tsx` renders the same turns in a compact block above the cards.
- `test/postgame/run.test.ts` proves the sequential order and prior-turn context; the prompt, parse,
  render, and transcript tests cover the new field and block.
