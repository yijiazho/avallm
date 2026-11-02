# REVIEW-002 — Post-game runner, persistence, and status

- **Status:** proposed
- **Depends on:** REVIEW-001, ARCH-001
- **Blocks:** REVIEW-003
- **Design:** [design-postgame-review.md](../design-postgame-review.md) §Scheduling and failure,
  §Cost and control
- **Size:** M

## Description

Run the review after a game finishes, without blocking the reveal and without ever taking the game
down. Each modeled seat gets one review call, bounded concurrency, one retry, and a per-seat status.
Every completed review is written to the game's archive record, keyed by the game id, so a restart
cannot lose it or attach it to a later game.

This ticket is the server-side runner. It does not add the HTTP review route or the reveal UI; it
exposes status on the existing game payload so REVIEW-003 can render it.

## Implementation plan

1. Extend `Session`:
   ```ts
   postgame?: PostgameRecord
   postgameRev: number          // increments on every status/content change
   ```
   `postgameRev` is a cheap change signal; the full record is fetched by REVIEW-003.
2. Add `server/postgame/run.ts`:
   ```ts
   export interface PostgameDeps {
     client?: OpenRouterClient      // fake client in tests
     archive?: { update(id: string, record: PostgameRecord): void }
   }
   export async function runPostgame(
     session: Session,
     game: Game,
     deps?: PostgameDeps,
   ): Promise<PostgameRecord>
   ```
   - Capture `game` by value at the call site. Never read `session.game` after the first line.
   - Build one `PostgameView` per seat from the frozen game.
   - Seat disposition:
     - raw-LLM agent with a resolved model: one `review` call;
     - composed/bounded-llm agent: `unavailable` in v1 (the planner context is a separate audited
       projection; note it in the record);
     - heuristic/random: `unavailable`;
     - human: `pending` (their note is optional and arrives via REVIEW-003).
   - Concurrency cap 2-3, configurable by env (`AVALON_POSTGAME_CONCURRENCY`, clamped 1-4).
   - Per call: `client.call(modelSlug, messages, { tag:
     reviewTag(agentId, game.id, seat), temperature, max_tokens, response_format })`. The tag is
     game-and-seat specific, for example `<agentId>/review/<gameId>/<seat>`, so two concurrent
     reviews of the same agent descriptor do not share a spend bucket. Dashboards still group
     reviews by the `<agentId>/review/` prefix. On parse failure, one retry with the prior reply
     and the error appended, matching the decision ladder. On second failure, mark `failed` with a
     short error and the raw snippet (full-reveal data, so no new leak beyond the reveal).
   - Record `cost` from a `getSpend()[reviewTag]` before/after delta, plus prompt/completion
     tokens. With a unique tag the delta cannot include another game's or seat's calls.
   - Update `session.postgame`, increment `postgameRev`, and call `broadcast(session)` after each
     seat and at the end.
   - Persist after each seat and at the end through `deps.archive.update(game.id, record)`; a write
     failure is warned and does not stop the remaining seats.
   - `completedAt` and `status`, computed from model seats only. Human notes are optional and
     never keep the record running:
     - `running` while any model seat is still pending/running;
     - `complete` when every model seat is `complete` or `unavailable` (including the case where
       there are no model seats at all);
     - `partial` when at least one model seat is `complete` and at least one is `failed`;
     - `failed` when every model seat is `failed`.
     A human seat stays `pending` until its note is written, then becomes `complete`; that
     transition updates `postgameRev` but not the terminal record status.
3. Hook the trigger in `server/server.ts` `pump`, at `gameOver`:
   - write the archive base record first (ARCH-001);
   - then `void runPostgame(session, game)`; do not await it in `pump`;
   - if `AVALON_POSTGAME=off`, set `postgame` to `undefined` and do not run;
   - if the game is heuristic-only, skip the calls and set all seats `unavailable` (still record the
     section so the UI can say why).
4. Add `postgameStatus` to `payloadFor`:
   ```ts
   postgame: {
     status: 'none' | 'running' | 'complete' | 'partial' | 'failed'
     completed: number
     total: number
     rev: number
   } | undefined
   ```
   Do not put model prose or the full record in every SSE payload.
5. Boot behavior: `loadArchive` may see a record with `postgame.status === 'running'`. Settle it
   with `completedAt` set to the archive load time and a `resume: false` note: any completed model
   seat makes it `partial`, otherwise `failed`. Do not spend money automatically. A re-run is an
   explicit CLI or route in a later ticket.
6. Add a CLI for re-running a review on one archived game:
   `node tools/postgame.ts <gameId> [--seat n] [--force]`. It uses the same runner with a fake or
   real client, reads the archived game, writes the record, and reports cost. This is also the
   test entry point for a full end-to-end run.

### Files

- `server/postgame/run.ts` (new)
- `server/postgame/types.ts` (status helpers)
- `server/server.ts` (`Session`, `payloadFor`, pump hook, startup postgame config)
- `tools/postgame.ts` (new)
- `test/postgame/run.test.ts` (new)
- `test/server/postgame-status.test.ts` (new)

## Acceptance criteria

- [ ] A finished game with at least one modeled seat produces a `postgame` record with one entry
      per seat and statuses from the union.
- [ ] The reveal and game payload remain available while reviews are running; the pump does not
      await them.
- [ ] Each modeled seat gets exactly one call; a parse failure gets exactly one retry; a second
      failure marks that seat `failed` and does not affect other seats.
- [ ] Heuristic/random seats are `unavailable`; composed/bounded-llm seats are `unavailable` in v1;
      human seats are `pending` and never block a terminal status.
- [ ] A game whose model seats all fail ends `failed`; a mixed fan-out ends `partial`; a human who
      declines to write a note leaves the record `complete`.
- [ ] `AVALON_POSTGAME=off` performs no calls and leaves `postgame` unset.
- [ ] Completed reviews are written to the archive record keyed by the finished game id.
- [ ] A restart while a review is running settles the record to `partial` (some completed) or
      `failed` (none completed); no automatic paid retry.
- [ ] `payloadFor` exposes only status counts and a revision, never model prose or the full record.
- [ ] Spend is tagged `<agentId>/review/<gameId>/<seat>` and visible in `/api/usage`; overlapping
      reviews of the same agent descriptor do not share a cost bucket.
- [ ] A write failure or a single model failure never throws out of the runner or the pump.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Record shape and statuses | `test/postgame/run.test.ts`: fixture game + fake client returning valid JSON |
| Non-blocking | same file: start run, assert `postgame.status === 'running'` and `pump`/payload available before resolution |
| One call and one retry | fake client that returns invalid then valid; assert two calls and `complete` |
| Failure isolation | fake client fails seat 2 twice; assert seat 2 `failed`, others `complete`, overall `partial` |
| All-failed fan-out | fake client fails every model seat twice; assert overall `failed` and a terminal `completedAt` |
| Human note is optional | fake client succeeds for every model seat, human seat stays `pending`; assert overall `complete` and no polling state |
| Unavailable seats | heuristic fixture: all `unavailable`, no calls, overall `complete` |
| Off switch | same file with `AVALON_POSTGAME=off`; assert zero calls |
| Archive persistence | fake archive sink; assert update called with the game id and final record |
| Restart settlement | write a `running` record with one completed seat, then with none; assert `partial` and `failed` respectively, and no call |
| Payload shape | `test/server/postgame-status.test.ts`: finish a fake game, assert status/rev fields (including `failed`) and no prose |
| Spend isolation | fake client records tags; run two overlapping reviews for the same descriptor in different games/seats; assert unique `<agentId>/review/<gameId>/<seat>` tags and per-tag cost deltas with no double count |

Run:

```
node --test test/postgame/run.test.ts test/server/postgame-status.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- The runner must not read `session.game` after starting: the game object is finished, but the
  session may later be reused by unrelated features. Key everything by game id.
- Do not run nine calls at once on a 9-seat table; the cap is there for provider rate limits.
- A review is paid work triggered by game end. Default it on only where the operator expects it;
  on a gated deployment default it off until REVIEW-003 exposes the setup toggle.
- Errors may contain model output. They are full-reveal material; keep them out of every public
  payload and show them only in the reveal/archive.
