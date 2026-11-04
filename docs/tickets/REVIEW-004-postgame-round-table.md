# REVIEW-004 — Post-game round table

- **Status:** implemented 2026-11-02, revised 2026-11-03 (PR #6)
- **Depends on:** REVIEW-003
- **Blocks:** none
- **Design:** [design-postgame-review.md](../design-postgame-review.md) §Post-game round table,
  §Scheduling and failure, §Presentation
- **Size:** M

## Description

Give the post-game review a separate table-talk phase before the reviews. Model seats speak once
each, in seat order, about the decisions they think were problematic. Seated humans also get a
turn: they can speak after hearing the model turns, skip, or let the timeout pass. The talk runs
first so every seat hears the table's outside view before it writes its own review.

The reviews then run independently from the same completed talk. No review sees another review, so
one seat's conclusion cannot anchor the next. The talk is the conversation; the review is the
private analysis. This costs one talk call and one review call per modeled seat. A human talk turn
is free and waits for the human (or `AVALON_POSTGAME_HUMAN_TALK_TIMEOUT_MS`, default five minutes).

## Implementation plan

1. Add `PostgameTurn` (`seat`, `statement`, cited `decisions`, `commentary`) and
   `PostgameRecord.tableTalk`. Add `phase: 'talk' | 'review'`, `PostgameSeat.talkError`, and
   `PostgameSeat.talkCost`. Keep `PostgameReview.statement` and `PostgameRecord.turnOrder` as
   legacy-only fields so older archives still render.
2. Add a `tableTalk` post-game call kind in `POSTGAME_CALL_PARAMS` and a `tableTalk` prompt:
   - each seat speaks once, in seat order, before the reviews;
   - output is a `statement`, at most four cited problematic decisions, and at most two comments;
   - the first speaker gets `You speak first.`; later speakers see the earlier talk and can answer
     a claim that named them;
   - every quoted field is sanitized and fenced; detailed evidence is carried for the three most
     recent turns.
3. Add `parsePostgameTalkReply`: require a statement, validate every citation like the review
   parser, clamp caps, and never throw.
4. Change the review prompt to consume the **whole completed table talk** as outside context. The
   review no longer asks for a spoken statement and no longer sees another review.
5. Add human talk participation:
   - `POST /api/game/:id/talk` accepts `{ token, text }` or `{ token, skip: true }` while
     `postgame.phase === 'talk'`; only a seated human may write, empty/over-cap text is 400, and a
     game that is still running or already reviewing is 409.
   - The turn is a `PostgameTurn` with empty citations/comments, stored in `tableTalk`; a skip is
     recorded in `skippedTalk` and removes any previous human turn.
   - After the model talk, the runner waits until every seated human has a turn or skipped, up to
     `AVALON_POSTGAME_HUMAN_TALK_TIMEOUT_MS` (default five minutes). Only then does it set
     `phase: 'review'` and run the analysis.
6. Run the model talk sequentially, then run the reviews with bounded concurrency
   (`AVALON_POSTGAME_CONCURRENCY`, clamped 1-4, default 3). Tag spend `<agentId>/talk/<gameId>/<seat>`
   and `<agentId>/review/<gameId>/<seat>`. A failed talk turn is skipped; the review still runs. A
   failed review is a status on that seat.
7. Render the `tableTalk` array as a `### Table talk` block in the transcript and a compact block
   in `Reveal`, with a legacy fallback to `turnOrder` plus `review.statement`/`summary`. While the
   phase is `talk`, a seated human gets a textarea, Speak/Update, and Skip; after the phase, the
   editor closes.
8. Add deterministic gallery talk turns, a human talk editor fixture, and reviews to the
   complete/running/failed fixtures, and refresh the review screenshots.

### Files

- `server/postgame/types.ts` (`PostgameTurn`, `tableTalk`, `phase`, talk error/cost, caps)
- `server/postgame/params.ts` (`tableTalk` call params)
- `server/postgame/prompts.ts` (talk prompt, review context, shared renderer)
- `server/postgame/parse.ts` (`parsePostgameTalkReply`)
- `server/postgame/run.ts` (talk phase, human wait, independent review phase, two spend tags)
- `server/postgame/render.ts` (`Table talk` section with legacy fallback)
- `server/server.ts` (human talk route)
- `client/src/types.ts`, `client/src/components/Reveal.tsx`, `client/src/styles.css`
- `client/src/App.tsx` (talk submit/skip and refetch)
- `client/src/gallery.tsx`
- `test/postgame/{prompts,parse,render,run}.test.ts`
- `test/server/{review-http,transcript}.test.ts`
- `test/client/app-lifecycle.test.ts`

## Acceptance criteria

- [x] The table talk runs before any review, sequentially in seat order, with at most one talk
      request in flight.
- [x] A later talk prompt contains the earlier seats' statements and citations; the first speaker
      gets `You speak first.`
- [x] The table talk requires a statement and parses/caps cited decisions and comments without a
      lesson or summary. Talk citations may belong to any seat at the table; review citations stay
      limited to the reviewing seat.
- [x] Every review runs after the talk and receives the completed talk as context, but no review
      sees another review.
- [x] The record stores `tableTalk`, `phase`, `talkError`, and separate `talkCost`/`cost`; older
      records without them still render.
- [x] A failed talk turn is skipped and does not block the remaining talk or the reviews; terminal
      status still comes from the reviews.
- [x] A seated human can submit a trimmed, capped table-talk statement or skip; the turn is stored
      in `tableTalk` and appears in the transcript and review context. Spectators, bots, running
      games, and a closed talk phase are rejected.
- [x] The reviews wait for every seated human to speak or skip, up to the configured timeout; the
      human's turn is part of the outside context every review sees.
- [x] The transcript renders `### Table talk` from `tableTalk`; the reveal renders the same turns
      above the detailed cards with the current phase and the human talk editor, and auto-opens the
      section for a seated human when the talk phase starts.
- [x] No quoted turn can close the prompt fence or reach the model as an instruction.
- [x] The gallery fixtures carry separate talk and review data, and the refreshed screenshots show
      the table-talk block.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Talk before review and order | `test/postgame/run.test.ts`: two model seats, assert talk tags first in seat order, then review tags |
| Prior context | same file: the second talk prompt contains the first statement; every review prompt contains the whole talk |
| Talk parse | `test/postgame/parse.test.ts`: statement required, own and foreign citations accepted, non-decisions rejected, caps clamped, no lesson needed |
| Review independence | `test/postgame/run.test.ts`: review prompts contain the talk, not another review's summary |
| Phase/storage | same file: `phase === 'talk'` while gated, `phase === 'review'` after; `tableTalk`, `talkCost`, `cost` |
| Failure isolation | existing partial/all-failed cases plus a talk failure case |
| Human talk route | `test/server/review-http.test.ts`: trimmed statement, skip, empty/over-cap 400, spectator 403, running/review 409, archive/transcript inclusion |
| Human blocks analysis | `test/postgame/run.test.ts`: reviews wait for a human turn and the review prompt contains it; HTTP test waits for the phase transition |
| Timeout path | `test/postgame/run.test.ts` uses a short `humanTalkTimeoutMs` to proceed without a turn |
| Rendering | `test/postgame/render.test.ts` and `test/server/transcript.test.ts`: table talk order, legacy fallback |
| UI | `npm --prefix client run build` and the refreshed talk/review gallery fixtures |

Run:

```
node --test test/postgame/run.test.ts test/postgame/prompts.test.ts \
  test/postgame/parse.test.ts test/postgame/render.test.ts \
  test/server/transcript.test.ts test/client/app-lifecycle.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- Two calls per modeled seat doubles review spend and adds one sequential wave before the reviews.
  The talk is sequential by design; the reviews are independent and can run in parallel.
- The talk is model-authored and untrusted. Every quoted field is sanitized, fenced, and guarded;
  a quoted turn cannot close the fence.
- A talk failure is a `talkError`, not a review failure. Later speakers see only completed turns.
- A seated human can delay the reviews for up to the timeout. The UI offers Skip, and the timeout is
  the fallback for a human who leaves. The timeout is an operator knob, not a per-game setting.
- No table-level synthesis ("who was right") is added. The reviews use the talk; a synthesis would
  be another paid call and a separate ticket.
- Older archived records have no `tableTalk`/`phase`; the renderer and UI fall back to the legacy
  `turnOrder` and `review.statement`/`summary`.

## Implementation notes

- `server/postgame/types.ts` adds `PostgameTurn`, `PostgameRecord.tableTalk` (present, possibly
  empty, on new records), `PostgamePhase`, `PostgameSeat.talkError`, and `PostgameSeat.talkCost`.
  `postgameRecord` starts in `phase: 'talk'` with an empty talk. Legacy `review.statement` and
  `turnOrder` remain optional.
- `server/postgame/prompts.ts` builds two prompts. `tableTalk` asks for a statement plus cited
  problematic decisions and comments; `review` asks for the structured summary/decisions/comments/
  lesson and receives the completed talk as outside context. Both share the game context and the
  sanitized/fenced talk renderer. Every quoted field passes `sanitizeSpeech`; detailed evidence is
  limited to the most recent three turns.
- `server/postgame/parse.ts` factors the citation parser into `parseEvidence` and adds
  `parsePostgameTalkReply`. The talk uses an `any` ownership policy so it can cite another seat's
  decision, which is the point of the cross-seat criticism; reviews keep the `self` policy. A
  missing statement fails the talk; a missing review statement is still accepted for legacy
  replies.
- `server/postgame/run.ts` runs the talk sequentially, records `talkCost` and `talkError`, then
  waits for every seated human (`waitForHumanTalk`) until they have a `tableTalk` turn or are in
  `skippedTalk`, up to `deps.humanTalkTimeoutMs` / `AVALON_POSTGAME_HUMAN_TALK_TIMEOUT_MS`
  (default five minutes). Only then does it set `phase: 'review'` and run the reviews with the
  bounded worker pool. Talk spend uses `<agentId>/talk/...`; review spend uses
  `<agentId>/review/...`. A failed talk turn is skipped; a failed review is a seat status.
- `server/server.ts` adds `POST /api/game/:id/talk`. It requires `gameOver`, a seated human, and
  `postgame.phase === 'talk'`; it trims and caps the statement, stores a `PostgameTurn`, or records
  an explicit skip in `skippedTalk`. It rewrites the archive and broadcasts like the note route.
- `Reveal.tsx` adds the human talk editor while the phase is `talk`: Speak/Update and Skip. The
  editor sends the route and then refetches. The review `<details>` auto-opens for a seated human
  when the talk phase starts, because their turn blocks the reviews; it remains user-closable. The
  complete/running/failed fixtures carry a human talk turn; the new talk fixture captures the open
  editor.
- `server/postgame/render.ts` prefers `record.tableTalk`, then falls back to the legacy
  `turnOrder` + review statement/summary. The human turn is just another table-talk turn.
- `test/postgame/run.test.ts` proves talk-first order, review independence, two spend buckets,
  phase transitions, and the human wait. `test/server/review-http.test.ts` covers the talk route,
  skip, gating, archive/transcript inclusion, and the phase transition. The prompt, parse, render,
  transcript, and client tests cover the remaining shapes.
