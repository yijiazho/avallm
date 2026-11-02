# ARCH-002 — Archive fidelity, retention, and deletion

- **Status:** proposed
- **Depends on:** ARCH-001 (done)
- **Blocks:** ARCH-003, MEM-001
- **Design:** [design-game-archive.md](../design-game-archive.md) §Fidelity, §Retention and privacy
- **Size:** M

## Description

ARCH-001 writes a full archive record by default, including private model prose. This ticket adds
the product/privacy split and the lifecycle controls that make a durable archive safe to leave on:

- a `public` fidelity that removes `thinking` and `scratchpad` text while keeping the game record;
- an environment default that chooses `public` on a gated deployment and `full` locally;
- a retention policy that bounds growth;
- an invite-gated delete route.

The archive is never the only copy of a running game. Retention and deletion must not affect a
game in progress; its history is snapshotted at start (MEM-001).

## Implementation plan

1. Add `redactArchiveForPublic(artifact: GameArtifact): GameArtifact`:
   - clone the artifact;
   - `log = log.filter(ev => ev.type !== 'thinking' && ev.type !== 'scratchpad')`;
   - drop `decisionTraces` (private cognition) and `telemetry` (provider/cost detail);
   - keep `players` (roles), `roles`, `winner`, `winReason`, `degraded`, `traceDegraded`,
     `strategyVersions`, `probes`, `judge`;
   - do not rewrite `seq` numbers. Gaps are fine: a public record is a reading record, not a
     replayable engine log. Document this in the type comment.
2. Add fidelity resolution in `server/archive/store.ts`:
   ```ts
   resolveArchiveFidelity(env): ArchiveFidelity
   ```
   - `AVALON_ARCHIVE_FIDELITY=public|full` wins;
   - otherwise `public` when `AVALON_INVITE_CODE` is non-empty, `full` otherwise;
   - an invalid value warns once and falls back to the default, rather than failing boot.
   - `toArchivedGame` accepts `fidelity` and applies the redaction before wrapping.
3. Add retention:
   - `AVALON_ARCHIVE_KEEP_GAMES` (default 500, minimum 1; invalid falls back with a warning).
   - `gcArchive(keep: number): { removed: string[]; kept: number }` uses the in-memory index
     ordered by `artifact.createdAt`, removes the oldest files with `fs.rmSync(..., { force: true })`,
     and updates the index.
   - Run once after `loadArchive()` on boot and after each successful write. Keep it synchronous
     and simple at friends-scale; if it shows up in profiling, debounce it.
   - Never remove a record whose game id is the session currently finishing. There is at most one
     and it is the newest, so a newest-first guard is enough.
4. Add `DELETE /api/games/:id`:
   - body `{ invite }` (same gate semantics as other disk-writing routes);
   - when `AVALON_INVITE_CODE` is set, reject a missing/wrong code with 403 `{ gated: true }`;
   - 404 when the record does not exist;
   - remove the file and its index entry, return `{ ok: true, id }`;
   - concurrent deletes are idempotent (second call 404).
5. Surface fidelity in `ArchiveMeta` and in the boot log so an operator can see which mode is
   active without reading a file.
6. Update the design doc and README env list if the final env names differ.

### Files

- `server/archive/store.ts` (redaction, fidelity, GC, delete)
- `server/archive/types.ts` (`fidelity` in meta)
- `server/server.ts` (startup GC, delete route)
- `test/archive/fidelity.test.ts` (new)
- `test/archive/retention.test.ts` (new)
- `test/server/archive-delete.test.ts` (new)

## Acceptance criteria

- [ ] `public` records contain no `thinking` or `scratchpad` events, no `decisionTraces`, and no
      `telemetry`; they still contain roles, players, quests, votes, cards, winner, and the public
      transcript material.
- [ ] `full` records are byte-equivalent to the ARCH-001 output for the same game and options.
- [ ] Default fidelity is `full` with no invite code and `public` when `AVALON_INVITE_CODE` is set;
      `AVALON_ARCHIVE_FIDELITY` overrides both; an invalid value warns and falls back.
- [ ] A redacted record is marked `fidelity: 'public'` in the wrapper and in `ArchiveMeta`.
- [ ] `AVALON_ARCHIVE_KEEP_GAMES=N` keeps the N newest records and removes older files and index
      entries; the newest record is never removed.
- [ ] Retention runs on boot and after a write, and a GC failure is warned, not fatal.
- [ ] `DELETE /api/games/:id` removes the file and index entry; it is 404 for an unknown id and is
      idempotent.
- [ ] On a gated deployment, delete without a valid invite code is 403 and leaves the file.
- [ ] Deleting an archived game never affects a running game; the running game still has its
      in-memory history snapshot (verified after MEM-001 lands).

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Public redaction | `test/archive/fidelity.test.ts`: fixture artifact with thinking/scratchpad/traces → redact → assert absent, roles/quotes present |
| Full fidelity unchanged | same file: compare full record to `toArtifact` output |
| Env default and override | same file: explicit env objects, no ambient reads; invalid value warning path |
| Meta fidelity | `test/archive/fidelity.test.ts` asserts `archiveMeta(record).fidelity` |
| Retention | `test/archive/retention.test.ts`: write 5 records with increasing createdAt, GC to 3, assert names and index |
| GC failure warning | same file: make one file undeletable (directory permissions or a directory in its place), assert others still removed |
| Delete route | `test/server/archive-delete.test.ts`: gated and ungated cases, 404, double delete |
| Running game unaffected | HTTP test: finish game A, archive it, delete it, start game B with history off; B still plays (history interaction covered again in MEM-001) |

Run:

```
node --test test/archive/fidelity.test.ts test/archive/retention.test.ts test/server/archive-delete.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- **Do not rewrite `seq`.** A public record is for reading and review, not for `replayGame`. If a
  future tool wants replay, it must use a full record.
- `roleDealt`, `knowledge`, individual `questCard`, and `voteCast` stay in `public` because the
  post-game reveal already exposes them and reviews depend on them. `thinking`/`scratchpad` are the
  model's private prose and are the part that remains opt-in.
- Fidelity is a write-time decision. Changing the env later does not rewrite old records. A
  re-redaction tool belongs in ARCH-004, not here.
- The delete route is the first archive route. Keep the body cap in mind when adding others; a
  shared `readBodyLimited` helper can land here or in SHARED-001 follow-up.
- If `AVALON_ARCHIVE_KEEP_GAMES` is smaller than the number of games a live table needs for
  history, history selection simply sees fewer games. It never fails.
