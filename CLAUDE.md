# Agents.md

This file provides guidance to AI agents when working with code in this repository.

## What this is

AvaLLM — a web implementation of The Resistance: Avalon where the other players are LLM-powered bots (each openly labeled with its model). Authoritative Node server + React client, with a headless simulator for API-free development.

## Commands

```
npm ci                                     # root dev tooling only; production server remains zero-dependency
npm --prefix client install                # REQUIRED before npm test: the client typecheck gate needs these
npm test                                   # strict checks and all API-free tests
npm run typecheck                          # strict no-emit check of all server AND client TypeScript
npm run verify:quick                       # types, lane inventory, and fast tests
npm run verify:contract                    # quick gates plus architecture contracts
npm run verify:full                        # types, inventory, and complete API-free suite
npm run test:fast                          # short developer feedback lane
npm run test:contract                      # architecture and boundary contracts
npm run test:eval                          # evaluation tooling and fixture contracts
npm run test:exhaustive                    # combinatorial, fuzz, and privacy sweeps
npm run test:perf                          # isolated serial elapsed-time budgets
npm run test:lanes                         # fail on missing/duplicate test classification
node --test test/engine/rules.test.ts             # a single test file
npm run sim -- --help                      # EVERY sim flag, with examples and live roster ids
npm run sim -- --players 7 --seed 42       # one headless heuristic game, full transcript
npm run sim -- --games 200 --talk 0,0      # aggregate win-rate stats
npm run sim -- --agents llm --players 5    # headless game with real LLM calls + cost breakdown
npm run sim -- --tier mid --games 8 --concurrency 4 --talk 2,1 --transcripts runs/
                                           # benchmark a cost tier: random cast per game, readable after
npm run play                               # terminal play vs heuristic bots

npm --prefix client install                # client deps (one-time; also gates npm test, see above)
npm --prefix client run build              # build client into client/dist
npm --prefix client run dev                # vite build --watch (NOT a dev server — see below)

node server/server.ts                      # serve at http://localhost:8787
```

- **Server requires Node ≥ 24** and runs TypeScript natively — there is no server build step, and the production server must stay **zero runtime dependencies** (plain `node:http`). Root `node_modules` contains dev-only TypeScript tooling installed by `npm ci`; client runtime/build dependencies remain isolated under `client/`.
- There is no Vite dev server: the game server serves the static `client/dist`, so client changes need a build (or the `--watch` variant) to show up. `.claude/launch.json` defines the `avalon` preview config (port 8787, autoPort).
- Config comes from a `.env` found by walking up from cwd (`server/llm/env.ts`); real env vars win. Keys: `OPENROUTER_API_KEY`, `OPENROUTER_MAX_SPEND_USD` (spend ceiling), `AVALON_INVITE_CODE` (gates money-spending/disk-writing routes on public deploys; comma-separated list — any one code opens the gate), `AVALON_PORT`/`PORT`, `AVALON_DATA_DIR` (parent dir for runtime-written user agents and finished-game archives; defaults to `RAILWAY_VOLUME_MOUNT_PATH` then repo-local `./data` — point it at a mounted persistent disk so both survive redeploys), `AVALON_GAME_ARCHIVE` (`off` disables the default-on per-game archive under `<dataDir>/games`).

## Screenshot gallery (UI before/after)

`docs/screens/` holds committed screenshots of hard-to-reach UI states. Two sets:

- **`desktop/` + `mobile/`** — a live autopilot playthrough (setup variants, every game
  phase, Record/Codex sheets, reveal, lobby host, join screen, in-game spectator) at
  desktop 1280×800 and mobile 390×844.
- **`components/`** — a fixture-driven gallery (`client/src/gallery.tsx`, served at
  `/gallery.html`) for states a live deal reaches only by luck or by interaction: each
  role card (Merlin/Percival/Servant/Minion/Oberon/spectator), the leader/quest/assassin
  action bars, the expanded name editor, and the hover-only seat/quest tooltips. These are
  deterministic, so they're captured from hand-built fixtures rather than a real game.

Expectations:

- **Regenerate only when a commit visibly changes the client UI** (styles, layout, component
  markup), and include the refreshed images in that commit so reviewers get a before/after
  diff. Don't regenerate for non-visual changes — image churn drowns the signal, and each run
  is ~5 min. To decide cheaply (no Chrome): `node tools/screenshots.mjs --check` reports
  whether any UI source changed since the committed screenshots (it hashes `client/src/**` +
  `client/*.html` into `manifest.json`). If it's stale but your change has no visual effect,
  `node tools/screenshots.mjs --accept` records that without regenerating.
- Command: `npm --prefix client run build && node tools/screenshots.mjs` (~4–5 min; spawns its
  own server, auto-picking a free port from 18917 up; Chrome at the default Windows path or
  `CHROME` env). The run writes `docs/screens/manifest.json` and **exits non-zero if a required
  shot is missing**; luck-of-the-deal misses (propose/quest-card/assassinate) are logged as a
  note and their stale images pruned. What's required vs. optional lives in `tools/screens-expected.mjs`.
- The harness drives the live client through **stable `data-kind` / `data-t` hooks** on the
  action bar (`client/src/components/ActionBar.tsx`), not button copy or CSS classes — so keep
  those hooks when restyling. Setup/lobby/sheet/reveal are still matched by their (stable) text.
- `test/tools/screens.test.ts` (part of `npm test`) is the cheap drift guard: it asserts every
  required shot exists and is non-empty (no Chrome, no pixels) — so a partial run or a lost
  image reddens the suite. It skips entirely if the gallery was never generated in a checkout.
- Runs are **intentionally unseeded**: the seed determines the hidden role deal, so a
  client-chosen seed would be an information leak. Treat the gallery as a layout/design
  diff, not a pixel test — role names, chatter, and which optional states get captured vary
  run to run. (The `components/` fixtures are stable, since they don't depend on a deal.)
- Puppeteer-core lives in `client/` devDependencies (the server stays zero-dependency).
- Known gap: no error/reconnect-banner capture yet.

## Architecture

Layering (details in `docs/design-implementation.md` §1; rules reference in `docs/research-rules-and-visuals.md`):

- `server/shared/` — domain-free primitives any layer may import: seeded PRNG (`prng.ts`), `DeepReadonly` (`deep-readonly.ts`, aliased to `Immutable` by the policy layer), `LruMap`, and the key-list type guards. Nothing here names a seat, role, or quest. ARCH019 mechanizes both halves of that: the folder may import nothing in the repository except itself, and it inherits the engine's purity obligation (no ambient clock or randomness, no bare import beyond `node:util`/`node:assert`) because the engine depends on it.
- `server/engine/` — **pure deterministic game logic**: event-sourced (`game.log` is the record; per-seat views derive from it) and seeded. All rules live here and run headless under `node:test`. Purity is mechanized: ARCH001 rejects imports of agent or eval code, and ARCH014 rejects ambient clocks, unseeded randomness, `process`, non-pure packages, and repository dependencies outside `engine/` and `shared/`.
- `server/agents/` — the plugin boundary. Every agent implements `decide(req: DecisionRequest, view: PlayerView): Promise<Decision>` (`server/agents/types.ts`). Built-ins: `llm`, `heuristic` (the forever-fallback), `random`, and `composed`. Invalid/illegal agent output degrades to the heuristic; it never stalls the game. Any decision that did not come from an in-process built-in crosses `parseExternalDecisionReply` (`server/agents/external-reply.ts`), which rejects a mismatched decision kind and admits an optional trace only through the shared admission boundary. No such producer exists today, so that boundary is dormant in production and reached only by tests; it is kept as the future cross-language door and because its `pre-apply-external` lifecycle holds the only structural validation of language evidence, plan outcome, and belief marginals (`docs/design-implementation.md` §1). **Its subdirectories are ranked, not just named**: an import may only point at a rank at or below its own, and ARCH020 enforces it from `AGENT_DIRECTORY_TIERS` in `tools/architecture-fitness.mjs`. The order is `canonical` -> {`candidate`, `record`} -> `belief` -> `analysis` -> `cognition` -> {`components`, `policy`} -> `role-*-layers` -> `score-diagnostics` -> `communication` -> `admission` -> `composed`, with two stated exceptions: `components`/`policy` are one peer tier (mutual imports legal, because `resolveComposedBrain` is genuinely both), and files directly in `server/agents/` are outside the order because `trace.ts` is simultaneously the top of it and a shape vocabulary near the bottom. A test asserts every directory on disk appears in the table, so a new folder cannot be created unranked and silently ungoverned.
- `server/llm/` — the OpenRouter chokepoint: spend accounting + hard ceiling, per-model-family reasoning suppression, call-kind param table, model roster (`roster.ts` — `AgentSpec.model` is a roster id).
- `server/data-dir.ts` + `server/json-io.ts` — the shared server-layer data root (`AVALON_DATA_DIR` > Railway mount > repo `data/`) and atomic JSON read/write helpers. The agent library and archive both derive their paths from this root.
- `server/archive/` — durable finished-game records. `ARCH-001` writes one full-fidelity `ArchivedGame` per finished game to `<dataDir>/games/<gameId>.json`, wrapping the existing `GameArtifact`, and builds a read-only metadata index at boot. `AVALON_GAME_ARCHIVE=off` disables writes. No HTTP read route or public redaction yet (`ARCH-002`/`ARCH-003`). The engine must never import this layer.
- `server/postgame/` — the offline half of the post-game review (`REVIEW-001`): record types and caps, a `review` prompt built from `PostgameView`, a tolerant citation-checking parser, and a pure Markdown renderer. A review is not a `DecisionKind`, not a `GameEvent`, and not a `PlayerView` extension. `review` lives in a separate `POSTGAME_CALL_PARAMS` table, never in `CALL_PARAMS` or `/api/agents` kinds. The engine and every decision agent must never import this layer; the runner and HTTP/UI wiring are still `REVIEW-002`/`REVIEW-003`.
- `server/sim/` — headless drivers behind `npm run sim` / `npm run play`. Any table mix is simulatable at zero API cost because the engine never knows what kind of agent answered.
- `server/server.ts` — thin http glue: lobbies, in-memory games, per-seat SSE streams, static client. Seat identity is an opaque bearer token minted at join.
- `client/` — React/Vite; renders the human's `PlayerView` JSON and posts decisions.

### Invariants to preserve

- **Hidden information flows through one chokepoint**: `viewFor(game, seat)` in `server/engine/view.ts`. No prompt builder, client payload, or agent ever touches raw `Game` — they get a `PlayerView`. Contract tests `test/engine/knowledge.test.ts` and `test/contract/leaks.test.ts` pin this; new `PlayerView` fields are private-by-default for spectators (opt-in public in `viewForSpectator`). Post-game review has a deliberately separate chokepoint, `viewForPostgame(game, seat)`, which throws before `gameOver`, returns a deeply frozen full-reveal snapshot, is not assignable to `PlayerView`, and is consumed only by `server/postgame/` (`test/contract/postgame-boundary.test.ts`).
- **The OpenRouter key and live-game bot prompts never reach the browser.** The server owns all state and prompt construction; the client sees only the human's filtered view of a real game. Deliberate exceptions, transparency-by-design (docs/design-custom-agents.md §4/§7): the static prompt anatomy (rules digest, baseline guidance, table-talk norms, output contracts) served by `GET /api/agents`, and fully rendered prompts for the fixed-seed FIXTURE game served by `POST /api/agents/preview` — neither can carry state from any live session.
- **Player names are untrusted input** — they pass through sanitization plus a reserved-name policy (`nameIsReserved` in `server/engine/rules.ts`) before being embedded in other players' prompts. Anything else user-authored that lands in a prompt needs the same treatment.
- **Bots mimic the prose they are shown, so prompt text follows a house style**: no em/en dashes and no "that's not X, that's Y" reframes in any string that reaches the model (`server/agents/prompts.ts`, `server/agents/facts.ts`, and the curated `agent-cards/*.json` personality/strategy/guidance fields). Stripping dashes from the prompts measurably cut dashes in bot *speech* by roughly a third (matched A/B, 4 games). `test/agents/prompts/talk-norms.test.ts` enforces it over **rendered** prompts, so `ASKS` and the view renderers are covered too, not just the exported constants. The rule binds **our** text only: runtime user agents (`data/agents/*.json`) are deliberately never checked, because that text belongs to the user and mimicking their voice back is the point. Code comments are exempt. When adding prompt text, rewrite the sentence rather than weakening the test.
- Games live in memory; a restart ends running games (snapshot persistence is on the roadmap — `docs/ROADMAP.md`).

## Git

### Commit messages

Before committing, inspect recent commit messages and match the repository's established style.

Every commit must include:

- A descriptive subject.
- A non-empty, detailed body explaining the motivation, behavior changed, important implementation
  choices, and verification performed.

A subject-only commit is incomplete. Use separate `git commit -m` arguments for the subject and
each body paragraph. After committing, inspect `git log -1 --format=fuller` and amend immediately
if the body is missing or insufficient.

## Pushing vs. deploying

Railway tracks the `deploy` branch, not `master` — pushing `master` never triggers a deploy. Deploying means advancing `deploy` (only on explicit instruction, like any push):

```
git push origin master                     # publish code; no deploy
git push origin origin/master:deploy       # deploy origin/master
git push origin <sha>:deploy               # deploy a specific commit
git push --force-with-lease origin <old-sha>:deploy   # rollback
```

`origin/deploy` always names the deployed commit; `git log origin/deploy..origin/master` shows what's pushed but not yet deployed.

## Docs

`docs/design-implementation.md` is the architecture reference (kept current; cite sections when relevant). `docs/research-strategy.md` feeds the bot prompts and is a **locked research brief** — it describes the game and the literature only, so implementation detail (prompt slots, file paths, our own measurements) goes in `docs/design-bot-guidance.md` instead, which maps each heuristic to a prompt slot (§6) and grades how binding it is (§7). `docs/model-onboarding.md` is the playbook + living record for adding/retiring roster models (reasoning-suppression probe, cost/reliability gates, wiring checklist). `docs/ROADMAP.md` tracks deferred work.
