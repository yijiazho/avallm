# Design: durable game archive (local game logs)

**Status:** proposed, unbuilt. Written 2026-11-01.
Companions: [design-implementation.md](design-implementation.md) (architecture),
[design-snapshots.md](design-snapshots.md) (in-progress durability),
[design-postgame-review.md](design-postgame-review.md),
[design-cross-game-memory.md](design-cross-game-memory.md), [design-evaluation.md](design-evaluation.md)
(artifact format), [ROADMAP.md](ROADMAP.md).

## Why

The user-facing ask is simple: **every finished game should be readable locally after the fact**.
Today a game exists only as an in-memory `Session` and disappears when the process does. That is
already painful (a redeploy erases every finished game), and it blocks two follow-on features:
post-game reviews need somewhere to live, and cross-game memory needs a corpus to read.

Games are independent records. There is no rematch and no table lineage: every game is a fresh
draw. History therefore selects by agent identity and time, not by a shared table id (see
[design-cross-game-memory.md](design-cross-game-memory.md)).

This document designs that persistent layer. It deliberately reuses the existing
`GameArtifact`/`toArtifact` machinery rather than inventing a second game schema.

## What exists today

- **The authoritative record is already event-sourced.** `Game.log` is an append-only
  `GameEvent[]`; `viewFor(game, seat)` derives every view from it. A finished game is complete
  plain JSON, so "persist a game" is close to `JSON.stringify`.
- **An eval artifact format already exists.** `server/eval/core/artifact.ts` defines
  `GameArtifact` (`ARTIFACT_SCHEMA = 4`) with the full log, the pre-shuffle role multiset, per-seat
  agent descriptors, winner, degradation records, optional decision traces, and optional
  `probes`/`judge` analyses. `toArtifact(game, opts)` requires `phase === 'gameOver'`.
- **The server already writes one, but only if asked.** `saveArtifact` in `server/server.ts` runs
  once at `gameOver` when `AVALON_ARTIFACTS` is set, appending a JSONL line to a single file. It is
  opt-in because an artifact is a full reveal (roles, private `thinking`, `scratchpad`, secret
  cards) and retention is an operator choice. Write failures are warned and swallowed.
- **The on-demand transcript is not persisted.** `GET /api/game/:id/transcript` renders Markdown
  with `renderTranscript`; it is built for copying to a chat, not for storage.
- **The data-dir plumbing is half-generalized.** `AVALON_DATA_DIR` (or
  `RAILWAY_VOLUME_MOUNT_PATH`) is resolved once in `server/server.ts`, but only the agent store
  consumes it: `useDataDir()` in `server/agents/defs.ts` points `data/agents` at the base. There is
  no shared "data root" module.
- **Nothing survives a restart.** `sessions` and `lobbies` are plain in-memory maps. Boot scans
  only the agent library. `design-snapshots.md` scopes in-progress durability; this document is
  about finished games and can land first.

## Gaps

| Gap | Today | Needed |
|---|---|---|
| Per-game record | One optional JSONL corpus at `AVALON_ARTIFACTS` | One addressable record per game |
| Default | Off | On by default for finished games, with an explicit opt-out |
| Discovery | Must parse the whole corpus | List finished games by time, winner, agent, and model without loading full logs |
| History selection | No per-agent view of the corpus | Metadata index that answers "which games did this agent play?" |
| Lifecycle | Write-once | Update with post-game review and retention metadata |
| Durability | In-memory sessions | Reboot-safe files on the configured data volume |
| Retention | None | Bounded growth, deletion, and documented privacy posture |
| Reuse | `readArtifacts` rejects future schemas | Tolerant per-file reads that skip one bad file, never the corpus |

Two subtler gaps:

1. **`saveArtifact` is once per `Session`, not once per game.** `artifactWritten` is a session
   flag. That is correct today because a session holds exactly one game, but it is the wrong
   invariant for a store keyed by game id. Track the written game id instead, so a future session
   that hosts more than one game cannot silently skip a record.
2. **The full log is a full reveal.** `toArtifact` stores `game.log`, which includes
   `roleDealt`/`knowledge`/`thinking`/`scratchpad`/`questCard`. A durable archive built directly on
   it inherits that sensitivity. The design below makes fidelity an explicit choice instead of an
   accident.

## Design

### One record per game, one writer

Every finished game produces exactly one archive record, written by a single server-layer module.
Do not add a second writer in the eval path; the sim can keep using `--out <jsonl>` and the web
archive can be imported/exported to that format.

Proposed home: `server/archive/` (a server layer, not `server/engine` and not `server/agents`).
It may import the engine and `toArtifact`; the engine must never import it (ARCH014/ARCH019 stay
untouched).

```ts
// server/archive/record.ts
export const ARCHIVE_VERSION = 1

export type ArchiveFidelity = 'public' | 'full'

export interface ArchivedGame {
  archiveVersion: 1
  /** Reuses the established artifact schema; `artifact.id` is the engine game id. */
  artifact: GameArtifact
  config: {
    humanSeats: number
    fidelity: ArchiveFidelity
    historyMode: HistoryMode   // see design-cross-game-memory.md
    botTable: TableSeat[]      // the seat plan the game was started from
  }
  postgame?: PostgameRecord    // see design-postgame-review.md
}
```

`GameArtifact` already carries players, roles, winner, agents, and `createdAt`, so the wrapper must
not duplicate them. The wrapper exists for **runtime-only config and post-game state**, which the
eval format does not know about. In particular, `artifact.players[].agent` is the stable descriptor
history selection uses (`llm:<model>` or `def:<id>:llm:<model>`).

### Fidelity, not a second schema

Two settings, same schema:

- **`full`** stores the artifact exactly as `toArtifact` produces it, including private events and
  (optionally) decision traces. This is the eval/debug record and matches today's
  `AVALON_ARTIFACTS` payload.
- **`public`** stores the same artifact with model prose removed: `thinking` and `scratchpad`
  events are dropped, everything else is kept. Roles live in `artifact.players`; `roleDealt`,
  `knowledge`, individual `questCard`, and `voteCast` are post-game public at this point and are
  useful for reviews and history. This is enough for history digests, transcripts, and post-game
  reading without retaining private model prose or a seat's hidden reasoning text.

Default: `full` on a local/self-hosted instance, `public` when `AVALON_INVITE_CODE` is set (a
public deployment should opt in to retaining private reasoning). Operators can override with
`AVALON_ARCHIVE_FIDELITY=public|full`. This reconciles the existing opt-in rationale with the
user's request that logs be kept: the game record is kept by default, the private reasoning is the
part that stays a deliberate choice.

The post-game review is stored separately (`postgame`) and already contains model prose, so
`public` fidelity does not make the archive anonymous.

### Where it lives

Extend the existing data root rather than inventing a second one. Factor the resolution in
`server/server.ts` into `server/data-dir.ts` (`dataDir()`, `useDataDirBase(base)`) and have both
the agent store and the archive read it. Keep `useDataDir()` in `defs.ts` as a thin adapter for
compatibility.

```
<dataDir>/agents/<id>.json          # existing
<dataDir>/games/<gameId>.json       # new: one ArchivedGame per finished game
<dataDir>/games/<gameId>.tmp-<pid>  # atomic write scratch, renamed into place
```

One file per game has three advantages over the single JSONL corpus:

- deleting one game is `rm`, not a corpus rewrite;
- a corrupt file loses one game, not the whole archive;
- post-game analysis can rewrite one record atomically without touching unrelated games.

`gameId` is the engine game id (`game-web-<id>`), not the session id. They already differ today:
`startLobby` mints a session id (`newId()`), while `createGame` derives `game-${seed}`. Routing uses
the session id; records and archives use the game id. Name the distinction explicitly in the
archive API.

### Write path

1. On `gameOver`, in `pump`, write the base record **before** any paid post-game work, so a crash
   during analysis cannot lose the game.
2. `writeArchive(record)` uses the same atomic pattern as `saveCustomDef`: write
   `<file>.tmp-<pid>`, `fsync` optional, `rename` into place. Never append.
3. If the volume is not mounted (`AVALON_DATA_DIR` set but missing), warn once at boot, exactly as
   the agent store does, and degrade to "no archive" rather than failing the game.
4. A failed write is warned and swallowed. The game result is already in memory and on clients;
   bookkeeping must not take the game down.
5. Post-game review updates are full-record rewrites (small, one game).
6. If the process dies mid-write, the temp file is ignored on boot and the previous record (if
   any) is intact.

**Do not** write on every event. `design-snapshots.md` owns in-progress durability; this archive
is a finished-game record. If both land, the snapshot writer and the archive writer must not
compete for the same file. Recommended split: snapshots live in `<dataDir>/sessions/`, archives in
`<dataDir>/games/`, and `gameOver` is the hand-off point.

### Read path

- **Boot scan.** `loadArchive()` reads every `*.json` in `<dataDir>/games/`, validates
  `archiveVersion`, and builds an in-memory index of small metadata (game id, finished time,
  player count, roles, winner, post-game status, per-seat agent descriptor and model, file size).
  A bad file is logged as a problem and skipped; it never aborts the scan. The index is a cache,
  not a source of truth. At friends-scale (hundreds of games) scanning a directory at boot is
  cheap; add an index file only if measurement says otherwise.
- **Selection.** `listArchive({ agent?, model?, limit?, before? })` reads the index only. `agent`
  matches a seat's descriptor (`llm:...` or `def:...`), which is what cross-game memory needs.
  This is also what the "previous games" UI consumes.
- **Load one.** `readArchivedGame(id)` parses one file with a tolerant reader. A
  `archiveVersion` newer than the server's is refused for that file, not for the directory.

### HTTP surface

Keep it small and honest about fidelity:

| Route | Returns | Notes |
|---|---|---|
| `GET /api/games?agent=&model=&limit=` | metadata list | Finished games only; no private events |
| `GET /api/games/:id` | metadata plus rendered transcript | Roles and public record; post-game review; no private thinking |
| `GET /api/games/:id/raw` | full record | Gated when `AVALON_INVITE_CODE` is set |

After a restart there is no live session token to authenticate against, so the archive cannot
reuse seat tokens. Public metadata and the public record are safe because the game is over and the
UI already reveals roles. Private reasoning is the operator's data, not a public API; gate it.
This mirrors the existing transcript rule: a full reveal is a deliberate request, not a default.

### Retention and privacy

- Retention is a **volume** decision. Default `AVALON_ARCHIVE_KEEP_GAMES=500` (or a 30-day window,
  whichever is easier to reason about). GC on boot and after each write. A running game snapshots
  its history at start, so deleting an archived record never changes a game already in progress.
- `DELETE /api/games/:id` (invite-gated) removes one record. Deleting a record that is a history
  input for a running game is safe: the running game already snapshotted its history.
- `public` fidelity is the default on a gated deployment. Document that even `public` retains
  roles and human speech, which is enough to identify people by name.
- Do not ship archives inside the repo. `data/` is runtime state and `.gitignore` already ignores
  the whole directory, so `data/games/` inherits that protection.
- The POST body cap is unrelated today (`readBody` is unbounded); the archive has no upload route,
  so this design adds no new unbounded write path.

### Relationship to the existing artifact corpus

- `AVALON_ARTIFACTS` remains the **explicit eval export**: one JSONL corpus, full fidelity,
  append-only, consumed by `readArtifacts`, `probe`, `judge`, and the bench tools.
- The archive is the **product record**: one file per game, discoverable, updatable, retention-
  managed. It can contain the same `GameArtifact` object.
- If both are enabled, write both from one `saveArtifact` call site, and never let them disagree
  about `id`, `roles`, or `winner`.
- Import path: `node tools/archive-import.ts <corpus.jsonl>` reads an existing corpus and writes one
  archive file per artifact. Imported records need no extra table identity: their players, agents,
  and timestamps are already in the artifact, which is all history selection needs.
- Export path: `listArchive` → JSONL is trivial and keeps eval tooling fed from the new store.

## Phasing

1. **Foundation:** factor `server/data-dir.ts`, add `server/archive/record.ts` (types, atomic
   write/read, boot index), wire `saveArtifact` to it. No UI.
2. **Fidelity split:** public redaction, env override, retention GC, delete route.
3. **Read API + UI:** list and detail routes, a "Previous games" surface, transcript reuse.
4. **Per-agent index:** expose descriptor/model filtering, the input cross-game memory needs (see
   [design-cross-game-memory.md](design-cross-game-memory.md)).
5. **Import/export tooling** for the existing corpus.

## Testing

- Round-trip: `toArtifact` → `writeArchive` → `readArchivedGame` preserves id, roles, winner, log,
  and per-seat agents; `public` fidelity drops every non-public event and keeps the role reveal.
- Atomicity: a temp file left by a crashed write is ignored; the previous record still loads.
- Corrupt file: one bad JSON file is skipped and surfaced, the rest of the archive loads.
- Retention: GC removes the oldest records and never deletes the newest games first.
- No leak: `GET /api/games/:id` never contains private `thinking`/`scratchpad`; `/raw` does, and is
  gated.
- Idempotence: the same finished game is written exactly once, tracked by game id rather than by a
  session flag.
- Selection: `listArchive({ agent })` returns exactly the games in which that descriptor held a
  seat, newest first.
- Boot scan is read-only and does not create directories for an unmounted volume.

## Open questions

- Default retention: 500 games or 30 days? The volume is small; time-based is easier to explain to
  users, count-based is easier to bound.
- Should archived games be listable publicly by default, or only to the operator? The game is over,
  but the archive contains every game ever played on the deployment, including casts the visitor
  never sat at.
