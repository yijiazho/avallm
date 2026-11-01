# ARCH-003 — Archive read API and previous-games UI

- **Status:** proposed
- **Depends on:** ARCH-001, ARCH-002
- **Blocks:** none
- **Design:** [design-game-archive.md](../design-game-archive.md) §Read path, §HTTP surface
- **Size:** M

## Description

Make the archive discoverable. Operators and players can list finished games without loading full
logs, and open one as the same Markdown transcript the "Copy log" button produces today. Private
model prose remains unavailable over HTTP; the full record is an invite-gated operator route.

The archive is read-only in this ticket. Rematch does not exist; a game is a standalone record.

## Implementation plan

1. Add `server/archive/api.ts` with pure builders so the HTTP handlers stay thin:
   - `listArchivePayload({ agent?, model?, limit?, before? })` filters the in-memory
     `ArchiveMeta` index, sorts newest first by `createdAt`, and applies a limit with a `nextBefore`
     cursor. It never opens a record file.
   - `archiveTranscript(record): string` builds `TranscriptInput` from the archived artifact:
     id, seed, playerCount, phase `'gameOver'`, quests, seats (role and alignment are a full reveal
     because the game is over), `log`, `degraded`, `traceDegraded`, winner/winReason,
     `revealed: true`, `capturedAt: artifact.createdAt`, `includeRaw` from the query.
   - `publicArchivePayload(record)` returns `{ meta, transcript, postgame? }` and must not include
     `artifact.log` or `artifact.players` raw. The transcript string is the public representation.
2. Add routes in `server/server.ts` (before the static fallback):
   ```
   GET /api/games?agent=&model=&limit=&before=
     200 { games: ArchiveMeta[], nextBefore?: string }

   GET /api/games/:id?raw=0
     200 { meta, transcript, postgame? }        // text/markdown inside JSON
     404 { error }

   GET /api/games/:id/raw?invite=
     200 ArchivedGame                            // gated when AVALON_INVITE_CODE is set
     403 { error, gated: true }                  // missing/wrong code
     404
   ```
   - `limit` defaults to 20, clamps to 100.
   - `agent` matches a seat descriptor exactly; `model` matches the resolved model field.
   - `raw` is ignored on the public detail route; only the explicit `/raw` route returns the full
     record.
3. Client:
   - Add `#/games` and `#/games/:id` routes to `parseHash` in `client/src/App.tsx`.
   - Add `client/src/components/Archive.tsx` with a list and a detail panel. The transcript is
     rendered as preformatted text plus a copy button, matching the existing "Copy log" output.
   - Link "Previous games" from the landing footer and from the reveal ("Past games").
   - Add `ArchiveMeta`, `ArchiveListPayload`, `ArchiveDetailPayload` to `client/src/types.ts`.
   - Keep the page read-only. No decisions, no stream, no reveal pacing.
4. Document the routes in the server header comment and in the design doc if the shape changes.

### Files

- `server/archive/api.ts` (new)
- `server/server.ts` (routes)
- `client/src/App.tsx` (routes, screen state)
- `client/src/components/Archive.tsx` (new)
- `client/src/types.ts`
- `test/server/archive-read.test.ts` (new)
- `test/server/transcript.test.ts` (extend with an archived-artifact round-trip if useful)

## Acceptance criteria

- [ ] `GET /api/games` returns metadata only, newest first, with working `agent`, `model`, `limit`,
      and `before` filters; it does not read record files.
- [ ] `GET /api/games/:id` returns the rendered transcript and metadata for a finished game; the
      transcript matches `renderTranscript` for the same artifact.
- [ ] A public record's transcript contains no `thinking`/`scratchpad` lines when the record has
      public fidelity; a full record includes them.
- [ ] `GET /api/games/:id/raw` returns the full `ArchivedGame` when ungated, and 403 when
      `AVALON_INVITE_CODE` is set without a valid invite.
- [ ] Unknown ids return 404 on every archive route.
- [ ] List and detail work after a process restart: they read the boot index/files, not live
      sessions.
- [ ] The client shows a previous-games list, opens a game, and copies the transcript; no live-game
      state or SSE stream is started.
- [ ] No route leaks `decisionTraces` or `telemetry`.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| List metadata and filters | `test/server/archive-read.test.ts`: seed a temp archive with three records of different agents/times; assert order and filters |
| List does not read files | same file: replace record files with unreadable content after `loadArchive`; list still succeeds from the index |
| Detail transcript parity | same file: compare route output to `renderTranscript` on the artifact |
| Public vs full lines | same file: one public and one full fixture; assert thinking presence |
| Raw gate | same file: ungated 200, gated 403/200 with invite |
| Restart | same file: construct a second archive store over the same dir and query |
| Client route/UI | `npm --prefix client run build`; manual open `#/games`, click a game, copy |
| No trace/telemetry leak | same file: assert JSON keys absent from public payload |

Run:

```
node --test test/server/archive-read.test.ts test/server/transcript.test.ts
npm run typecheck
npm --prefix client run build
npm run test:lanes
```

## Risks and notes

- The transcript is Markdown, not HTML. Render it as text; do not `dangerouslySetInnerHTML` model
  prose.
- The detail route returns a potentially large string. Keep the limit/summary in the list route so
  the index stays cheap.
- After a restart there are no seat tokens, so archive routes cannot reuse the participant check.
  The public record is safe because the game is over; the raw route is the operator's data.
- If the archive is disabled (`AVALON_GAME_ARCHIVE=off`), routes should still work for whatever
  files exist (an operator may have imported a corpus), or return an empty list and 404. Choose
  "serve what exists" and document it.
