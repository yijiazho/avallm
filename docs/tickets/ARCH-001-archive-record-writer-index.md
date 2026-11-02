# ARCH-001 — Archive record, writer, and boot index

- **Status:** implemented 2026-11-02 (PR #2)
- **Depends on:** SHARED-001 (done)
- **Blocks:** ARCH-002, ARCH-003, ARCH-004, REVIEW-002, MEM-001
- **Design:** [design-game-archive.md](../design-game-archive.md) §One record per game,
  §Where it lives, §Write path, §Read path
- **Size:** M

## Description

Give every finished game one durable, addressable record on the configured data volume. The record
wraps the existing `GameArtifact` (same schema, same `toArtifact` call) and adds only the runtime
config and post-game fields the eval format does not know about. Writes happen at `gameOver`,
before any paid post-game work. Boot scans the directory and builds an in-memory metadata index; a
bad file is skipped, never fatal.

This ticket does not add public redaction, retention, or any HTTP route. It writes full-fidelity
records, so the existing `AVALON_ARTIFACTS` privacy rationale still applies until ARCH-002 lands.

## Implementation plan

1. Add `server/archive/types.ts`:
   ```ts
   export const ARCHIVE_VERSION = 1
   export type ArchiveFidelity = 'public' | 'full'

   export interface ArchivedGame {
     archiveVersion: 1
     artifact: GameArtifact
     config: {
       humanSeats: number
       fidelity: ArchiveFidelity
       historyMode: 'off' | 'digest' | 'full'
       botTable: TableSeat[]
     }
     postgame?: never   // reserved for REVIEW-002
   }

   export interface ArchiveMeta {
     id: string
     createdAt: string
     playerCount: number
     roles: Role[]
     winner: Alignment
     winReason: string
     postgame: 'none' | 'pending' | 'running' | 'complete' | 'partial'
     agents: { seat: number; descriptor: string; model?: string }[]
   }
   ```
2. Add `server/archive/store.ts`:
   - `useArchiveDir(dir: string | undefined)` (called once at startup; tests call it directly).
   - `archiveDir(): string` defaults to `<dataDir>/games`.
   - `archiveFile(gameId): string` = `<archiveDir>/<gameId>.json`.
   - `toArchivedGame(game, opts)` calls `toArtifact(game, { agents, degraded, steps,
     decisionTraces })` and wraps it. `agents` comes from the same `seatAgentLabel` used by the
     existing writer so the artifact and the transcript cannot disagree.
   - `writeArchivedGame(record)`: `writeJsonAtomic` from SHARED-001. Refuse if
     `record.artifact.phase` exists? `GameArtifact` has no phase; rely on `toArchivedGame`'s
     `gameOver` assertion via `toArtifact`.
   - `readArchivedGame(id)`: tolerant read, validates `archiveVersion`, returns `undefined` on a
     missing file and throws a named error on a corrupt one (the caller decides whether to skip).
   - `loadArchive(): { metas, problems }`: read every `*.json`, skip `*.tmp-*`, build `ArchiveMeta`
     from each record, and return problems for files that fail. Never throw for one bad file.
   - `archiveMeta(record): ArchiveMeta`.
   - An in-memory index (`Map<id, ArchiveMeta>`) with `getArchiveMeta(id)`, `listArchiveMeta()`
     populated by `loadArchive` and updated by `writeArchivedGame`.
3. Wire startup in `server/server.ts`:
   - After `useDataDirBase`, call `useArchiveDir(gamesDir())` and `loadArchive()`.
   - Log the count and problems once. Do not create the directory when the base is missing; let the
     first write create it.
4. Replace the direct artifact write in `saveArtifact` with two independent sinks:
   - the existing `AVALON_ARTIFACTS` JSONL append when configured (unchanged);
   - the archive write when `AVALON_GAME_ARCHIVE !== 'off'` (default on).
   A failure in either sink is warned and swallowed; one sink failing must not skip the other.
5. Replace `Session.artifactWritten: boolean` with `Session.archivedGameId?: string` and keep a
   separate `Session.artifactAppended: boolean` for the JSONL sink. A repeated pump iteration must
   not write twice.
6. Add the session's runtime config at `startLobby`: `lobbyConfig: { humanSeats, botTable }` (or
   carry the `Lobby` config forward). `historyMode` defaults to `'off'` until MEM-001.
7. Environment:
   - `AVALON_GAME_ARCHIVE=off` disables the archive; anything else (including unset) enables it.
   - `AVALON_ARCHIVE_DIR` is intentionally not added; the archive follows the shared data root.

### Files

- `server/archive/types.ts` (new)
- `server/archive/store.ts` (new)
- `server/server.ts` (startup, `saveArtifact`, `Session`, `startLobby`)
- `test/archive/store.test.ts` (new)
- `test/server/archive-write.test.ts` (new, HTTP-level)

## Acceptance criteria

- [x] A finished game produces exactly one `<archiveDir>/<gameId>.json` containing an
      `ArchivedGame` whose `artifact.id` is the engine game id and whose `artifact.log` is the full
      finished log.
- [x] `archiveVersion === 1`; a record with a newer version is refused for that file only.
- [x] The record preserves `roles` (pre-shuffle), `winner`, `winReason`, per-seat agent
      descriptors, and the runtime `humanSeats` and `botTable`.
- [x] Writing the same game twice is a no-op (tracked by game id, not by a session boolean).
- [x] `AVALON_GAME_ARCHIVE=off` performs no archive write and leaves the game playable.
- [x] A write failure logs a warning, does not throw out of `pump`, and does not prevent the game
      from finishing or the reveal from loading.
- [x] A malformed archive file is reported in `loadArchive().problems`, is skipped, and the rest
      of the archive loads.
- [x] Boot scan is read-only: it does not create `<archiveDir>` when the directory is absent.
- [x] The in-memory index exposes id, createdAt, playerCount, roles, winner, post-game status, and
      per-seat agent descriptor/model without parsing full logs on every list.
- [x] `AVALON_ARTIFACTS`, when set, still appends its JSONL line; both sinks receive the same game
      id, roles, and winner.

## Implementation notes (2026-11-02)

- SHARED-001 landed in the same change; the archive follows `<dataDir>/games` through
  `gamesDir()` and never adds a separate `AVALON_ARCHIVE_DIR`.
- `server/archive/types.ts` holds the record/meta types. `server/archive/store.ts` holds the
  writer, tolerant reader, boot scan, and metadata index.
- `toArchivedGame(game, opts)` still calls `toArtifact` exactly once. The accepted config includes
  optional `fidelity` and `historyMode`; ARCH-001 supplies `full` and `off` respectively.
- Idempotence is enforced twice: the session remembers `archivedGameId`, and the store refuses to
  rewrite an id already in its index or already present as a file. Base records are therefore
  write-once; REVIEW-002 should add an explicit update path for post-game state rather than weaken
  this guard.
- `writeArchivedGame` uses `writeJsonAtomic`; a corrupt existing file therefore stops that write
  (the caller warns) rather than being silently clobbered.
- `readArchivedGame` exposes named `ArchiveCorruptError` and `ArchiveVersionError` failures so the
  boot scan can report one file without aborting the directory.
- `archiveMeta` reports `postgame: 'none'`; `ArchivedGame.postgame` remains typed `never` until
  REVIEW-002.
- The read/index exports (`readArchivedGame`, `getArchiveMeta`, `listArchiveMeta`) are deliberately
  consumption-free until ARCH-003. ARCH018 has a temporary exemption that the staleness check will
  report once the read API consumes them.
- Tests: `test/archive/store.test.ts` and `test/server/archive-write.test.ts`, both lane `fast`.
  The HTTP test finishes a real 5-seat game through the SSE decision path and covers the
  archive-off case, a dual sink, and a swallowed write failure.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| One full record, correct id/roles/log | `test/archive/store.test.ts`: fixture game → `toArchivedGame` → write → read |
| Idempotence by game id | same file: call `writeArchivedGame` twice, assert one mtime/content write and no duplicate |
| Env off | `test/server/archive-write.test.ts`: start server with archive off, finish a 5-seat autopilot game, assert no file |
| Write failure is swallowed | `test/archive/store.test.ts`: point the archive dir at a path that cannot be created (a file), assert `writeArchivedGame` throws and the caller's `saveArtifact` wrapper swallows it |
| Corrupt file skipped | write one valid and one `{` file, call `loadArchive`, assert one meta and one problem |
| Boot scan read-only | point at a nonexistent dir, call `loadArchive`, assert it still does not exist |
| Index metadata | assert `ArchiveMeta` fields without reading `artifact.log` |
| Dual sink | `test/server/archive-write.test.ts` with both env vars set; parse the JSONL line and the JSON file and compare ids/winner |

The HTTP tests must isolate the archive directory before `server/server.ts` is imported. Use a
unique directory under `test/.tmp` (or the OS temp dir) and call `useArchiveDir` from the test
bootstrap, or set `AVALON_DATA_DIR` in a child process. Do not write into the repository's `data/`.

Run:

```
node --test test/archive/store.test.ts test/server/archive-write.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- `toArtifact` calls `new Date().toISOString()` for `createdAt`. That clock read stays in the
  server/eval layer; do not move it into the engine.
- The archive stores the full `game.log`, including private events. That is deliberate for this
  ticket; ARCH-002 introduces the public fidelity mode and the default switch on gated deploys.
- `decisionTraces` can be large. Keep passing them for now so the archive matches the artifact; if
  size becomes a problem, add a `--without-traces` option in ARCH-004 rather than changing the
  default silently.
- Do not add an HTTP route here. ARCH-003 owns reads.
