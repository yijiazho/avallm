---
name: avalon-ticket-implementation
description: Implement an AvaLLM implementation ticket end to end, including prerequisite detection, architecture-safe code changes, lane-marked tests, acceptance criteria, documentation updates, commit style, and pull request creation. Use when asked to implement a ticket in docs/tickets, land a design phase, or carry a feature from its ticket and design doc through tests and a PR.
---

# Avalon Ticket Implementation

Implement the ticket that was asked for, plus only the prerequisites it actually needs. The
repository is strict about layering, hidden information, test classification, and documentation, so
"code compiles" is not done.

## Preflight

1. Read the ticket and every linked design section, not just the Description.
2. List its dependencies from the ticket header and the dependency graph in
   `docs/tickets/README.md`. Check whether each dependency is already implemented. If it is not,
   either implement the smallest complete prerequisite or stop and report the blocker.
3. Inspect `git status`, the current branch, and recent commit messages. Never stage unrelated
   dirty files.
4. Find the existing owner of each concept before writing new code. Prefer extending the current
   chokepoint, writer, route, or test pattern over introducing a parallel one.
5. Read the relevant architecture gates in `tools/architecture-fitness.mjs` and the tests under
   `test/contract/` and `test/tools/` before choosing module boundaries.

## Plan The Ticket

Map every acceptance criterion to:

- the production file and function that will satisfy it,
- the test that will prove it,
- the documentation sentence or checklist that will record it.

If the ticket names an API shape, keep the names unless the existing code makes that impossible.
Record deliberate deviations in the ticket's implementation notes.

Do not pull in adjacent design ideas. Put them in a new ticket or the design doc's open questions.

## Implement Safely

- `server/shared/` stays domain-free and pure. `server/engine/` stays pure and deterministic. The
  engine must never import agents, evaluation, archive, or filesystem code.
- Hidden information still flows through `viewFor(game, seat)` and `viewForSpectator`. Any new
  player-facing payload starts private by default.
- The server stays zero-runtime-dependency and runs as `node server/server.ts`.
- Runtime state belongs under the one data root, `server/data-dir.ts`. Use `writeJsonAtomic` for
  durable JSON and skip `*.tmp-*` files during scans.
- A bookkeeping failure is warned and swallowed. It must never take down a live or finished game.
- Tests must not depend on ambient `AVALON_*` or `RAILWAY_*` variables and must never write into
  the repository's `data/` directory. Use a temp directory and set the environment before importing
  `server/server.ts`; when necessary use dynamic `await import(...)` so boot-time resolution sees
  the test environment.
- A new server module that imports a shared shape guard must import the shared predicate. Do not
  write a local `isRecord`; ARCH016 treats it as a private copy of `plainRecord`.
- A new exported production function with no production consumer is ARCH018 debt. Either wire a
  real consumer now or add a narrowly justified `TEST_ONLY_EXPORT_EXEMPTIONS` entry that explains
  which future ticket consumes it.
- If a new test file is added, its first ten lines must contain exactly one
  `// test-lane: fast|contract|eval|exhaustive|perf` marker.

## Prove It

Work from the narrowest test outward:

```text
node --test <ticket test files>
npm run typecheck
npm run test:lanes
npm run verify:quick
```

Run `npm run verify:contract` when the change touches layering, agent imports, prompt text, or the
engine boundary. Run `npm test` before declaring the ticket complete when the change crosses shared
server infrastructure.

Prefer tests that exercise the acceptance criterion directly:

- round-trip writers through their reader,
- drive HTTP through a real finished game when the ticket is about server wiring,
- make failure paths deterministic (a file where a directory belongs, a corrupt file, a future
  version),
- assert idempotence by the real key, not by a timing coincidence.

## Update The Record

A ticket is not done until its paper trail matches the code:

1. Change the ticket status to implemented with the date and PR.
2. Tick every acceptance criterion only after its test exists and passes.
3. Add implementation notes that name the real files, exported functions, environment switches,
   deliberate deviations, and tests.
4. Update the ticket index and dependency graph in `docs/tickets/README.md`.
5. Update the linked design doc wherever the built behavior differs from the proposal. Mark which
   phases are built and which remain proposed.
6. Update `CLAUDE.md`, `docs/design-implementation.md`, `docs/ROADMAP.md`, and any operator-facing
   docs when the change adds an environment key, layer, route, directory, or command.

## Commit And Open A PR

- Stage only the files belonging to this ticket. Leave unrelated pre-existing modifications alone.
- Use a descriptive subject and a detailed body with separate `-m` arguments: motivation, behavior,
  important implementation choices, documentation changes, and verification performed.
- Push a dedicated branch and open a non-draft PR against `master` unless the repository's current
  branch policy says otherwise.
- Re-read the commit with `git log -1 --format=fuller` and the PR metadata with
  `gh pr view --json state,isDraft,mergeable,url`.

## Definition Of Done

- [ ] Every acceptance criterion is checked and backed by a test.
- [ ] The listed ticket tests and `npm run typecheck` pass.
- [ ] `npm run test:lanes` reports no missing or duplicate classification.
- [ ] The appropriate verification level passes (`verify:quick`, `verify:contract`, or `npm test`).
- [ ] No new runtime dependency was added.
- [ ] Failure paths are logged and cannot crash a game.
- [ ] Ticket, design doc, ticket index, and operator docs match the code.
- [ ] The commit body records what changed and how it was verified.
- [ ] The PR is open, non-draft, and mergeable.
