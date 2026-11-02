# REVIEW-003 — Review API, reveal UI, and human notes

- **Status:** implemented 2026-11-02 (PR #4)
- **Depends on:** REVIEW-002
- **Blocks:** none
- **Design:** [design-postgame-review.md](../design-postgame-review.md) §Human seats, §Presentation
- **Size:** M

## Description

Expose the post-game record, let a seated human add their own review note, and render the section in
the reveal and in the copyable transcript. The review is fetched separately from the game stream
because it is large and arrives after the reveal; the SSE payload only carries a revision counter
from REVIEW-002.

## Implementation plan

1. Add routes in `server/server.ts`:
   ```
   GET /api/game/:id/review
     200 { postgame?: PostgameRecord, canReview: boolean, rev: number }
     403 mid-game (review is post-game only)
     404 unknown game

   POST /api/game/:id/review
     body { token, text }
     200 { ok: true, seat, note }
     400 empty / too long
     403 not a seated human / spectator
     409 game still running
     404 unknown game
   ```
   - `GET` is public once `phase === 'gameOver'`, mirroring `/reveal`; mid-game it is 403.
   - `POST` uses `seatOf`; only a numeric seat (human) may write. Spectators and bots cannot.
   - Trim, require non-empty, cap at 2000 characters (define `REVIEW_NOTE_CAP` beside the record
     type). Store verbatim; the UI escapes it, and history rendering sanitizes it.
   - On success: set `postgame.seats[seat].note`, keep `kind: 'human'`, set the seat status
     `complete`, increment `session.postgameRev`, rewrite the archive record if the archive is
     enabled, and broadcast.
   - If `postgame` is undefined because reviews were disabled, still allow a human note? Yes: create
     a minimal record with human seats, so the note is not lost. Document the choice.
2. Extend `RevealPayload` (`/api/game/:id/reveal`) with:
   - `postgame?: PostgameRecord` (or omit and let the client use the review route; pick one and
     keep it consistent);
   - `canReview: boolean`;
   - `reviewNoteCap: number`.
   Prefer omitting the full record from `/reveal` and using `GET /review`, so one large object does
   not make every reveal fetch heavier. The reveal response only needs `canReview` and
   `reviewNoteCap`.
3. Extend the transcript route: when `s.postgame` exists and the caller gets a full reveal, append
   `renderPostgameMarkdown(postgame, nameOf)` under `## Post-game review`. A scoped transcript must
   not include reviews (they may contain another seat's private reasoning about the game).
4. Client:
   - `client/src/types.ts`: `PostgameRecord`, `PostgameSeat`, `ReviewPayload`.
   - `Reveal.tsx`: add a "Post-game review" section below the thinking timeline. One card per seat:
     status chip, summary, cited decisions (`seq`, kind, assessment, alternative), comments, lesson,
     and cost when present. Human card shows a textarea and save button when `canReview`.
   - `App.tsx`: fetch `/review` on `gameOver`; if `postgame.status === 'running'`, poll every 1.5-3s
     or refetch when `payload.postgame.rev` changes. Stop polling on unmount and on any terminal
     status: `complete`, `partial`, or `failed`. A human seat left `pending` because the optional
     note was not written does not count as running. Apply the POST response optimistically and
     refetch on failure.
   - Show "reviews are optional and cost a model call" near the section when the game had reviews
     disabled (`postgame` absent) and the human can still write a note.
   - Keep the section collapsed by default so the role flip and thinking timeline stay the primary
     reveal.
5. Update the copy-log label behavior: copying after a review includes the new section.
6. Add a gallery fixture for a completed review and a running review (see
   `client/src/gallery.tsx`), so the layout is captured without a live deal.

### Files

- `server/server.ts` (two routes, reveal/transcript payload additions)
- `server/postgame/types.ts` (`REVIEW_NOTE_CAP`, note helper)
- `server/transcript.ts` (optional post-game section or caller-appended)
- `client/src/App.tsx`
- `client/src/components/Reveal.tsx`
- `client/src/types.ts`
- `client/src/gallery.tsx`
- `test/server/review-http.test.ts` (new)
- `test/server/transcript.test.ts` (extend)

## Acceptance criteria

- [x] `GET /api/game/:id/review` is 403 before `gameOver`, returns `postgame` and `canReview` after,
      and 404 for an unknown game.
- [x] `canReview` is true only for a seated human; spectators and bot seats are false.
- [x] `POST /api/game/:id/review` stores a trimmed note for a seated human, rejects empty/over-cap
      text with 400, rejects spectators/bots with 403, and rejects a running game with 409.
- [x] A human note survives a page refresh and, when the archive is enabled, a restart.
- [x] The reveal shows per-seat status and completed reviews; a running review does not block the
      role flip or the thinking timeline.
- [x] The client stops polling when unmounted and when the status is terminal
      (`complete`, `partial`, or `failed`).
- [x] An all-failed review renders its per-seat failures and does not leave the section spinning.
- [x] The full transcript includes a `## Post-game review` section; a scoped mid-game transcript
      does not.
- [x] No review text is inserted as HTML. The UI escapes it; long fields wrap.
- [x] The gallery has deterministic fixtures for `running`, `complete`, and `failed` states.

## Implementation notes

- `GET` and `POST /api/game/:id/review` live in `server/server.ts`. `GET` is gated on `gameOver`
  exactly like `/reveal`; `POST` rejects a running game with 409 before auth, then uses `seatOf` so
  only a numeric seat (human) can write. `REVIEW_NOTE_CAP` is imported from
  `server/postgame/types.ts`.
- The reveal response omits the full record on purpose. It carries `canReview` (derived from the
  optional `?token=`) and `reviewNoteCap`; the client fetches `GET /review` separately. The client
  now sends its token on `/reveal` so `canReview` is correct.
- Reviews disabled: `POST` creates a minimal record containing the human seats, with status
  `complete`. The note is kept, no model seats are invented, and the UI explains that generated
  reviews were not run. This choice is documented in the design doc.
- A note POST can race the post-game runner's first archive write, because the decide route
  broadcasts `gameOver` before `pump` reaches `saveArtifact`. The POST route calls `saveArtifact`
  before updating the archive, so the note is never lost in that window.
- `Reveal.tsx` renders a collapsed `<details>` section below the thinking timeline. It renders one
  card per seat with status, summary, cited decisions, comments, lesson, cost, and errors; the
  human's card has the note editor. All prose is a React text node, and `.pg-*` styles use
  `overflow-wrap: anywhere` plus `white-space: pre-wrap` for long fields.
- `App.tsx` fetches `/review` on `gameOver`, refetches when `payload.postgame.rev` changes, and
  polls every 2s only while `postgame.status === 'running'`. The timer is cleared on unmount, game
  change, and every terminal status; a failed fetch retries at the same cadence.
- The transcript section is appended by the pure renderer only when `revealed` is true, so a scoped
  mid-game transcript cannot carry another seat's review even if a caller passes one by mistake.
- Gallery fixtures: `reveal-review-complete`, `reveal-review-running`, and `reveal-review-failed`
  in `client/src/gallery.tsx`, listed in `tools/screens-expected.mjs`. They open the section via a
  gallery-only `reviewOpen` prop so the cards are the specimen; the app default stays collapsed.
- Tests: `test/server/review-http.test.ts`, `test/server/transcript.test.ts`,
  `test/server/postgame-status.test.ts`, `test/postgame/run.test.ts`.
- REVIEW-004 supersedes the parallel review fan-out described above: the per-seat calls now run
  sequentially in seat order, and each later prompt carries the earlier spoken turns. The API, note
  path, and reveal section are unchanged; the client already polls while the status is `running`.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| GET gating and shape | `test/server/review-http.test.ts`: finish an autopilot game, assert 403 mid-game, 200 after with `canReview` |
| Human note auth/caps | same file: human token 200; spectator/bot 403; empty/2001 chars 400; running 409 |
| Persistence | same file: write note, read again; archive record contains it when enabled |
| Transcript section | `test/server/transcript.test.ts`: full reveal includes the section; scoped one omits it |
| UI polling/cleanup | `test/client/app-lifecycle.test.ts` pins the running-only timer and the abort/clear cleanup; `npm --prefix client run build` and the gallery fixtures cover layout |
| No HTML injection | `test/client/app-lifecycle.test.ts` rejects `dangerouslySetInnerHTML` and asserts note/review prose is a text child; the complete gallery fixture carries a literal `<script>` note |
| Gallery fixtures | `npm --prefix client run build && node tools/screenshots.mjs --check`; `docs/screens/components/reveal-review-{complete,running,failed}.jpg` |

Run:

```
node --test test/server/review-http.test.ts test/server/transcript.test.ts
npm run typecheck
npm --prefix client run build
npm run test:lanes
```

## Risks and notes

- The review record can be large (per-seat prose). Do not put it in every SSE payload; the revision
  counter plus a fetch is the contract.
- Human notes are user-authored. Escape on render and sanitize when they enter a history prompt.
  Do not sanitize the stored note so the human's own words survive; sanitize at the model boundary.
- If the archive is off, the review and note live in memory only. The UI should say so? At minimum,
  the server should not pretend the record is durable.
- Do not add a "regenerate review" button in this ticket. Re-running is the CLI from REVIEW-002 and
  is a paid action.
