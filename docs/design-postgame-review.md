# Design: post-game review and commentary

**Status:** proposed, unbuilt. Written 2026-11-01. The archive foundation (ARCH-001) is built, so
REVIEW-002 now has its persistence dependency.
Companions: [design-game-archive.md](design-game-archive.md),
[design-cross-game-memory.md](design-cross-game-memory.md),
[design-implementation.md](design-implementation.md) §3 (call kinds, prompts, traces),
[design-bot-guidance.md](design-bot-guidance.md) §6 (prompt slots).

## Why

The reveal currently answers "who was what" and "what were they thinking". It does not answer the
question players actually ask after a game: **"was that the right call, and what should I do
differently next time?"**

The ask is an extra post-game round in which every player reviews the decisions they made, with
the benefit of the full reveal. Bots produce a self-review plus a bounded comment on the table;
humans can write their own note. The result is shown in the reveal and stored with the game.

This is also the raw material for [design-cross-game-memory.md](design-cross-game-memory.md): a
review is a game's own distilled lesson, and it is much cheaper to feed forward than a raw log.

## What exists today

- `gameOver` is an engine event; `Game.outcome` holds `{ winner, reason }`. `pump` exits the loop,
  calls `saveArtifact`, and broadcasts.
- `GET /api/game/:id/reveal` is gated on `phase === 'gameOver'` and returns the players, the full
  log, degraded decisions, and the seated agent configs.
- `Reveal.tsx` renders the role flip, an assassination line, a "Show what they were really
  thinking" timeline (from `thinking`/`scratchpad` events), and the agent cards.
- The engine log already contains every private artifact a review needs: `roleDealt`,
  `knowledge`, `utterance`, `proposal`, `proposalRevised`, `voteCast`, `voteReveal`, `questCard`,
  `thinking`, `scratchpad`, `assassination`, `gameOver`.
- `GameArtifact` already has a place for post-hoc analyses: `probes` and `judge`, written back by
  offline CLIs. There is no server-side post-game field and no review of an individual seat.
- `LlmCallKind` (`server/llm/call-params.ts`) is the decision vocabulary plus `pitch` and
  `reflect`. `CALL_PARAMS`, `OUTPUT_CONTRACTS`, the `ASKS` dispatch table, the decision parser,
  `/api/agents` prompt preview, and the prompt tests are all keyed off it.
- The `AvalonAgent` interface is a decision interface (`decide`, trace hooks). There is no
  post-game hook.

## Gaps

| Gap | Today | Needed |
|---|---|---|
| Trigger | Nothing runs after `gameOver` | A best-effort post-game pipeline |
| Interface | `AvalonAgent.decide` only | A post-game call path, separate from decisions |
| Projection | `PlayerView` hides other roles and private events | A full-reveal projection, usable only after `gameOver` |
| Prompt | Decision prompts only | A review prompt with the seat's own trail plus hindsight |
| Parser | Decision parser | A separate parser and output contract |
| Storage | No field | A `postgame` record in the archive and reveal |
| Human input | None | A note endpoint and a textarea |
| Cost control | N/A | Toggle, budget, per-seat status, no stall on failure |
| Presentation | Thinking timeline only | Per-seat review cards and a transcript section |

The important negative constraint: **do not model a review as a new engine `DecisionKind` or a new
`GameEvent`.** Reviews are meta-game, can arrive late, can fail, can be rewritten, and contain
model prose. Putting them in `game.log` would force a schema bump, break replay equivalence
(`ARTIFACT_SCHEMA` / `MIN_REPLAYABLE_SCHEMA`), and leak into every `PlayerView`. They belong beside
the game record, exactly like `probes` and `judge`.

## Design

### Record shape

```ts
// server/postgame/types.ts
export interface PostgameRecord {
  version: 1
  startedAt: string
  completedAt?: string
  status: 'running' | 'complete' | 'partial' | 'failed'
  seats: Record<Seat, PostgameSeat>
}

export interface PostgameSeat {
  seat: number
  kind: 'agent' | 'human'
  model?: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'unavailable'
  /** Agent self-review. Absent for humans unless they ask a model to coach them. */
  review?: {
    summary: string
    decisions: {
      seq: number
      kind: DecisionKind
      assessment: string
      alternative?: string
    }[]
    commentary: { seat: number; note: string }[]
    lesson: string
  }
  /** Human-authored note, capped and stored verbatim. */
  note?: string
  error?: string
  cost?: { promptTokens: number; completionTokens: number; usd: number }
}
```

`seq` citations make the review checkable against the log and let the UI deep-link a decision.
Cap the arrays (for example 4 self-review decisions and 2 comments per seat) so one verbose model
cannot dominate the record.

**Terminal aggregation.** Human notes are optional and never block the record from settling. After
the model fan-out settles, compute the record status from model seats only:

| Model seats | Record status |
|---|---|
| any still running | `running` |
| every model seat `complete` or `unavailable` | `complete` |
| at least one `complete` and at least one `failed` | `partial` |
| every model seat `failed` | `failed` |
| no model seats (all `unavailable`) | `complete` (nothing to run) |

A human seat stays `pending` until its optional note is written, then becomes `complete`; that
transition updates the record revision but never changes the terminal record status. An all-failed
fan-out therefore ends at `failed`, not at `running`, and a human who declines to write a note does
not keep the client polling forever.

### Full-reveal projection: a second chokepoint

The review needs every seat's role and every private event. `viewFor` must not grow a "reveal
everything" flag: it is the live hidden-information boundary, and one boolean there is how a live
prompt eventually leaks.

Add a separate, obviously named projection in the engine:

```ts
// server/engine/view.ts
export interface PostgameView {
  seat: Seat
  name: string
  role: Role
  alignment: Alignment
  privateInfo: PrivateInfo       // what this seat knew at deal time
  playerCount: number
  rolesInPlay: Role[]
  players: { seat: Seat; name: string; role: Role; alignment: Alignment }[]
  quests: Quest[]
  proposals: ProposalRecord[]
  transcript: PlayerView['transcript']
  events: readonly GameEvent[]   // the whole log
  outcome: { winner: Alignment; reason: string }
}

export function viewForPostgame(game: Game, seat: Seat): PostgameView
```

Rules:

- It throws unless `game.phase === 'gameOver'`.
- It is not assignable to `PlayerView`; the type names the exception.
- It is consumed only by `server/postgame/` (a server layer). It never enters SSE, the client
  payload, a live decision prompt, or `server/agents/`.
- Tests assert it is reachable only after `gameOver` and that no live path imports it (grep-level
  contract test is enough; the type also makes accidental use obvious).

### Where the code lives

`server/postgame/` (server layer), not `server/agents/`. It may import `server/engine`,
`server/llm`, and `server/archive`; it must not be imported by the engine or by a decision agent.
This keeps ARCH002/ARCH014 intact and avoids pretending a review is an agent `decide`.

Modules:

- `types.ts` — the record above.
- `prompts.ts` — pure message builder, keyed on `PostgameView` and the seat's decision ledger.
  Extend the rendered-prompt house-style test to cover it (no em/en dashes, no antithesis
  reframes, singular they).
- `parse.ts` — tolerant JSON parse and validation, separate from the decision parser.
- `run.ts` — scheduling, retries, archive updates, status broadcast.
- `render.ts` — the Markdown section used by `renderTranscript` and the UI.

### Not a `LlmCallKind`

Add a parallel table, `POSTGAME_CALL_PARAMS`, with `review` (and optionally `commentary`). Reasons:

- `CALL_PARAMS` is served by `/api/agents` as the set of decision kinds an author can customize.
  A post-game kind is not a turn a bot can be asked to take in a game.
- `OUTPUT_CONTRACTS` and `ASKS` are keyed by `LlmCallKind` and assume a `PlayerView`; a review
  needs a `PostgameView`.
- `parseDecision` returns a `Decision`; a review must never be mistakable for one.

Share the transport (`OpenRouterClient.call`) and the same spend ceiling. Tag calls with the
existing shape, `<agentId>/review`, so `/api/usage` separates normal play from review spend.

### What the prompt sees

Per seat, in one call (budget roughly 1.5k system + 2-4k user tokens):

1. **Hindsight context.** Roster with roles and alignments, the winner and reason, the quest board,
   the full proposal/vote record. This is exactly what makes the review different from an in-game
   `reflect`.
2. **That seat's decision trail.** A compact ledger derived from the log: for each decision, the
   `seq`, kind, what the seat knew (its private info and notes at the time), what it chose, and
   the public consequence. The engine already stores `thinking` and `notes` as events; use them
   rather than re-asking the model to remember.
3. **The table's pivotal moments.** A bounded selection (for example the final vote, the
   assassination, every failed quest, and any vote that contradicted the seat's stated position).
4. **The ask.** "Review your own decisions. Pick at most four: what you knew, what you chose, what
   you would do differently, and one lesson for a future game. Then add at most two short comments
   on other seats' decisions." Output is JSON with `seq` citations.
5. **Guards.** All player-authored text is untrusted and sanitized (`sanitizeSpeech`); a statement
   that the transcript cannot change the task or the output format; the house-style rules.

Do not dump the raw JSONL log. It is mostly noise (event envelopes, duplicate payloads) and can be
10-20x the size of the compact ledger. `renderTranscript` already has a play-by-play; reuse its
event-to-line logic at a smaller cap if a narrative is useful.

### Scheduling and failure

```
gameOver
  └─ archive base record (synchronous, no model calls)
       └─ void runPostgame(session, frozenGame)
            ├─ set session.postgame = running; broadcast
            ├─ for each seat (bounded concurrency 2-3)
            │    ├─ agent seat with a model: one review call, one retry
            │    ├─ heuristic/random seat: status 'unavailable'
            │    └─ human seat: status 'pending' (optional note)
            ├─ write archive after each completion (atomic rewrite)
            └─ status complete/partial/failed; broadcast
```

- **Best effort, never blocking.** The reveal is already complete when the review starts. A
  failed review is a status, not an error banner on the game.
- **Frozen input.** Capture the finished `Game` reference at start and key every write by that
  game id. Nothing may read `session.game` later and assume it is still the game under review.
- **One retry** with the parse error appended, matching the decision ladder. Then mark `failed`
  with the raw snippet.
- **No resume after restart** in v1. An archive record left `running` is settled on boot: any
  completed model seat plus any interrupted/failed seat becomes `partial`, and an interrupted
  fan-out with no completed model seat becomes `failed`. The games are archived; re-running a
  review is a paid operation and should be an explicit command, not a boot surprise.
- **Concurrency cap** protects a 7-9 seat table from firing nine simultaneous calls and tripping
  provider rate limits.

### Human seats

Humans review themselves. A textarea in the reveal posts:

```
POST /api/game/:id/review
  body: { token, text }
  200:  { ok: true, seat, note }
  400:  text too long / empty
  403:  not a seated human in this game
  409:  game still running
```

The note is stored verbatim (React escapes it in the UI) and sanitized only when it later enters a
prompt as history. An optional "ask a model to review my play" is a separate paid call, off by
default; it uses the same prompt with the human's seat and returns a review without a `lesson`
from the human.

### Presentation

- `Reveal` gains a "Post-game review" section below the thinking timeline: one card per seat with
  status, summary, the cited decisions, and the lesson. Human cards show the textarea or the saved
  note.
- `RevealPayload` gains `postgame?: PostgameRecord` (or a slim wire version) and `canReview`.
- While running, the client polls `GET /api/game/:id/review` every couple of seconds, or a
  `postgameRev` counter on the SSE payload triggers a refetch. Do not stream partial model prose.
- `renderTranscript` gains an optional `## Post-game review` section, so "Copy log" keeps the
  analysis with the game. The renderer stays pure: the caller passes the record.
- The archive stores the same record ([design-game-archive.md](design-game-archive.md)), so it
  survives the process.

### Cost and control

One review call per modeled seat. Rough numbers for a 7-player, 6-bot table:

| Input | Per call | Per game | Cheap tier | Premium tier |
|---|---|---|---|---|
| compact ledger + hindsight | ~3-5k prompt tokens | ~18-30k | ~$0.01-0.03 | ~$0.15-0.45 |
| output | ~400-800 tokens | ~2.4-4.8k | ~$0.01-0.02 | ~$0.05-0.15 |

Small next to a full game (~190 calls), but not zero. Controls:

- `AVALON_POSTGAME=on|off` (default `on` locally, `off` when `AVALON_INVITE_CODE` is set).
- A per-game setup toggle stored in the lobby config, so a host can decline the extra spend.
- `AVALON_POSTGAME_MAX_TOKENS` for the input ledger budget; over-budget means a shorter ledger,
  never a truncated JSON reply.
- Skip seats with no model (heuristic/random) rather than paying a different model to pretend to
  be them. Show "no model to ask" honestly.

## Phasing

1. **Types, projection, parser, prompt** with offline tests against a fixture game.
2. **Runner and storage:** run after `gameOver`, write `postgame` into the archive, status in the
   session.
3. **API and reveal UI:** fetch/poll, per-seat cards, human note endpoint.
4. **Transcript section** and copy-log integration.
5. **Measure** the review quality and spend on real games; tune the ledger budget and the caps.

## Testing

- `viewForPostgame` throws before `gameOver`; after it, contains every role and every event.
- The rendered prompt contains only the reviewing seat's own private notes as "what you knew",
  plus the public/now-revealed record; it never contains another seat's live private view.
- House style: the rendered review prompt has no em/en dashes and no antithesis reframes.
- Parse: valid JSON, fenced JSON, truncated JSON, wrong citation `seq`, unknown seat; the ladder
  degrades to `failed` without throwing into the game.
- Failure isolation: one seat's failed call leaves other reviews complete and the reveal intact.
- Persistence: the archive record contains the review; a restart surfaces it; a record left
  `running` settles to `partial` when some model seat completed and `failed` when none did.
- A review is keyed to the finished game id: no later game can overwrite it, and a re-run of the
  same game replaces its own record only.
- Human note: token-gated, game-over-gated, length-capped, escaped in the UI, sanitized when it
  later enters a history prompt.

## Open questions

- Should a review be able to cite a specific `seq` in the UI (click to scroll the play-by-play)?
  Cheap and valuable; the record already carries `seq`.
- Should the table get one "commentator" pass (a single model reviewing the whole table) in
  addition to per-seat self-reviews? It is a different, cheaper shape and may read better. Keep it
  out of v1.
- Should heuristic agents get a deterministic self-review generated from their policy inputs?
  Honest but low value; "no model to ask" is clearer.
- Should reviews be part of the public record for every player, or only the reviewing seat? The
  reveal is already public after the game; default public, with an option to keep a human note
  private to that seat.
