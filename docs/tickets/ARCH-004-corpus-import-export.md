# ARCH-004 — Artifact corpus import/export and dual-write

- **Status:** proposed
- **Depends on:** ARCH-001
- **Blocks:** none
- **Design:** [design-game-archive.md](../design-game-archive.md) §Relationship to the existing
  artifact corpus
- **Size:** S

## Description

The archive is the product record; `AVALON_ARTIFACTS` and the sim's `--out <jsonl>` are the eval
corpus. This ticket keeps the two compatible instead of letting them drift:

- import an existing artifact corpus into one archive file per game;
- export archive games back to a JSONL corpus the eval tools can read;
- prove that dual-write produces identical ids, roles, and winners;
- provide a migration path for deployments that already have an `AVALON_ARTIFACTS` file.

## Implementation plan

1. Add `tools/archive-import.ts`:
   - args: `--in <corpus.jsonl>` (required), `--data-dir <dir>` (optional; otherwise the normal data
     root), `--fidelity public|full` (default: the archive's configured default), `--skip-existing`
     (default true), `--dry-run`.
   - parse with the existing `readArtifacts` so schema rules stay in one place; a bad line reports
     its line number and aborts before writing anything (import is an operator action, not a live
     game path).
   - for each artifact, skip if the archive already has that id (unless `--overwrite`), otherwise
     wrap it in an `ArchivedGame` with `humanSeats` derived from `players[].agent === 'human'` and
     `botTable: []` (the corpus does not carry the original `TableSeat[]`).
   - apply fidelity redaction when requested.
   - print a summary: imported, skipped, failed.
2. Add `tools/archive-export.ts`:
   - args: `--out <file.jsonl>`, `--data-dir <dir>`, `--format artifact|archive` (default
     `artifact`), `--agent <descriptor>`, `--limit`.
   - `artifact` writes `GameArtifact` lines via `writeArtifacts`, preserving the eval shape.
   - `archive` writes whole `ArchivedGame` lines, preserving `postgame` and `config`.
   - refuse to write into the archive directory itself.
3. Add `tools/archive-verify.ts` (small): compare a corpus to an archive by ids and report
   duplicates, missing ids, differing winners, and differing role multisets. This is the guard
   against a botched migration.
4. Keep the ARCH-001 dual-write behavior; add a test that runs both sinks for one game and compares
   the two outputs field by field.
5. Document the commands in the archive design doc and in `npm run sim -- --help`? The sim help is
   generated from its own flags; do not touch it unless the tool is exposed as an npm script. Add
   `npm run archive:import` / `archive:export` only if the repo prefers scripts; otherwise document
   direct `node tools/...` invocations.

### Files

- `tools/archive-import.ts` (new)
- `tools/archive-export.ts` (new)
- `tools/archive-verify.ts` (new)
- `test/tools/archive-roundtrip.test.ts` (new)
- `test/server/archive-write.test.ts` (extend dual-write assertion)

## Acceptance criteria

- [ ] Import creates one archive file per artifact and preserves id, roles, players, winner, and
      log.
- [ ] Import is idempotent: a second run skips existing ids; `--overwrite` replaces them.
- [ ] A malformed corpus line aborts before any file is written and names the line.
- [ ] Import applies the requested fidelity; a public import contains no `thinking`/`scratchpad`.
- [ ] Export in `artifact` format produces a JSONL file `readArtifacts` can read, with the same
      ids and winners as the source.
- [ ] Export in `archive` format preserves `config` and `postgame`.
- [ ] Verify reports duplicate, missing, winner, and role-multiset mismatches with nonzero exit.
- [ ] Dual-write produces an archive record and an artifact JSONL line with the same id, roles, and
      winner.
- [ ] No tool writes into the repository's `data/` during tests.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Import round-trip | `test/tools/archive-roundtrip.test.ts`: fixture artifact → import → read archive |
| Idempotent import | same file: run twice, assert counts and mtimes/content |
| Malformed line aborts | same file: corpus with a bad line, assert no files created |
| Fidelity on import | same file: public import drops prose |
| Artifact export readable | same file: export → `readArtifacts` → compare ids/winners |
| Archive export preserves postgame | same file: record with a postgame stub → export → parse |
| Verify mismatches | same file: mutate winner/roles, assert exit code and message |
| Dual-write | `test/server/archive-write.test.ts` |
| No repo writes | tests use a temp data dir and assert `data/games` is untouched |

Run:

```
node --test test/tools/archive-roundtrip.test.ts test/server/archive-write.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- A corpus has no `botTable`; imported records get an empty table. History selection only needs the
  per-seat descriptors, which are in `artifact.players`, so this is safe.
- A corpus may contain future-schema artifacts. `readArtifacts` refuses the whole file; that is
  acceptable for an explicit import and safer than partially importing a corpus the tool does not
  understand.
- Do not make import part of server boot. It is an operator command.
- Export must never mutate the archive; open files read-only and write only the requested output.
