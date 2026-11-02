# SHARED-001 — Data root and atomic JSON I/O

- **Status:** implemented 2026-11-02 (PR #2)
- **Depends on:** none
- **Blocks:** ARCH-001 (done), REVIEW-002, MEM-001
- **Design:** [design-game-archive.md](../design-game-archive.md) §Where it lives, §Write path
- **Size:** S

## Description

The server already resolves a persistent data location (`AVALON_DATA_DIR`, then
`RAILWAY_VOLUME_MOUNT_PATH`, then repo-local `data`), but only the agent library consumes it.
`useDataDir()` in `server/agents/defs.ts` owns the path, so a game archive would either duplicate
the resolution logic or make the archive import the agent store.

Extract one server-owned data root and one atomic JSON writer. This is a pure refactor: the agent
library must behave exactly as it does today, including the repo-local default when no base is
configured and the warning when a configured base does not exist.

## Implementation plan

1. Add `server/data-dir.ts`:
   - `resolveDataDirBase(env: NodeJS.ProcessEnv): string | undefined` returns the configured base,
     with `AVALON_DATA_DIR` winning over `RAILWAY_VOLUME_MOUNT_PATH`. Do not read `process.env`
     inside the pure resolver; the caller passes it.
   - `useDataDirBase(base: string | undefined): void` stores the resolved base once, at startup.
   - `dataDir(): string` returns the base or `<repo>/data`.
   - `userAgentsDir(): string` returns `<dataDir>/agents`.
   - `gamesDir(): string` returns `<dataDir>/games`.
2. Add `server/json-io.ts`:
   - `writeJsonAtomic(file: string, value: unknown): void`: `mkdir` the parent, write
     `<file>.tmp-<pid>`, then `rename` into place. On failure, remove the temp file and rethrow a
     message that names the file.
   - `readJsonFile<T>(file: string): T`: read and parse, with a parse error that names file and
     line/offset.
   - A helper that ignores `*.tmp-*` files during directory scans.
3. Change `server/server.ts` startup:
   - After `loadEnv(__dirname)`, call `useDataDirBase(resolveDataDirBase(process.env))`.
   - Keep the existing missing-base warning, but base it on `dataDir()`/the resolver rather than
     the raw env.
   - Remove the local `dataDirBase` variable.
4. Change `server/agents/defs.ts`:
   - `userAgentsDir()` delegates to `server/data-dir.ts`.
   - Keep `useDataDir(base)` as a deprecated adapter for callers that already import it; make it
     call `useDataDirBase(base)`.
   - `saveCustomDef` and `deleteCustomDef` use the shared atomic writer where it preserves the
     current temp+rename behavior. Do not change the file format or pretty-printing unless the
     shared writer exposes an option for it.
5. Add a small body-size guard? No. That is unrelated and belongs in REVIEW-003 if needed.

### Files

- `server/data-dir.ts` (new)
- `server/json-io.ts` (new)
- `server/server.ts` (startup only)
- `server/agents/defs.ts` (delegate path, writer)
- `test/archive/data-dir.test.ts` (new)
- `test/archive/json-io.test.ts` (new)

## Acceptance criteria

- [x] `AVALON_DATA_DIR` wins over `RAILWAY_VOLUME_MOUNT_PATH`; an empty value is treated as unset.
- [x] With no base configured, `dataDir()` is the repo-local `data`, exactly as today.
- [x] `userAgentsDir()` is `<base>/agents` and the library boot scan plus later saves/deletes use
      the same path.
- [x] A configured base that does not exist still produces the boot warning and does not crash.
- [x] `writeJsonAtomic` leaves no readable partial file: after a simulated write failure, the
      previous file content is unchanged and a stale temp file is not treated as a record.
- [x] `readJsonFile` reports the file path on malformed JSON.
- [x] No new runtime dependency; the server still runs under `node server/server.ts`.
- [x] `test/archive/*.test.ts` files declare `// test-lane: fast`.

## Implementation notes (2026-11-02)

Landed with ARCH-001 (PR #2), because the archive needs the shared root and writer.

- `server/data-dir.ts` owns `resolveDataDirBase`, `useDataDirBase`, `dataDir`, `userAgentsDir`,
  and `gamesDir`.
- `server/json-io.ts` owns `writeJsonAtomic`, `readJsonFile`, and `isTempFile`. The writer accepts
  `{ pretty: true }`, which lets `saveCustomDef` keep its existing two-space on-disk format.
- `server/server.ts` resolves the base once after `loadEnv`, warns when a configured base is
  missing, and calls `useDataDirBase` before the library scan and archive scan.
- `server/agents/defs.ts` delegates `userAgentsDir()` to the shared root; `useDataDir()` remains as
  a deprecated adapter for existing callers.
- Tests: `test/archive/data-dir.test.ts` and `test/archive/json-io.test.ts`, both lane `fast`.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Env precedence and empty-is-unset | `test/archive/data-dir.test.ts`: explicit env objects, no ambient reads |
| Repo-local default | same file, with an empty env |
| Agent path agreement | same file, plus existing `test/agents/library.test.ts` (or equivalent) |
| Missing-base warning | `test/archive/data-dir.test.ts` asserts the resolver result; the warning is a boot log, checked manually |
| Atomic write and failed write | `test/archive/json-io.test.ts`: write, overwrite, force a failure with a directory in place of the temp target; assert previous content |
| Malformed JSON error names the file | `test/archive/json-io.test.ts` |
| Temp files ignored | `test/archive/json-io.test.ts` with a `*.tmp-<pid>` sibling |
| Zero-dependency boot | manual: `node server/server.ts`, `GET /` returns 200 |

Run:

```
node --test test/archive/data-dir.test.ts test/archive/json-io.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- `server/shared/` has a purity obligation (ARCH019). `server/data-dir.ts` and `server/json-io.ts`
  are server-layer modules, not `server/shared/`; do not put `node:fs` under `shared`.
- Tests must never depend on a developer's ambient `AVALON_*` or `RAILWAY_*` variables. Pass env
  objects explicitly.
- `saveCustomDef` writes pretty JSON today. If the shared writer always writes compact JSON,
  keep the agent store on its own call or add a `pretty` option so existing files do not churn.
