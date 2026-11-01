# MEM-003 — History configuration, UI, and measurement

- **Status:** proposed
- **Depends on:** MEM-002
- **Blocks:** none
- **Design:** [design-cross-game-memory.md](../design-cross-game-memory.md) §Modes,
  §Configuration, §Cost, §Testing
- **Size:** M

## Description

Make cross-game memory an explicit, cost-visible choice. The setup screen gets an off/digest/full
toggle and the role-visibility setting; the server clamps every request to the deployment caps; the
prompt preview can show a synthetic history block without reading the archive; the reveal shows
which games an agent was given. Finally, measure the feature with a paired-seed A/B rather than
shipping it on vibes.

## Implementation plan

1. Server config:
   - `server/archive/history.ts` exports `parseHistoryConfig(raw, env)` with:
     - `mode` from the request, default `off`;
     - `maxGames` clamped to `AVALON_HISTORY_MAX_GAMES` (default 3) and 1-10;
     - `maxTokens` clamped to `AVALON_HISTORY_MAX_TOKENS` (default 1500 digest / 6000 full);
     - `includeRoles` from `AVALON_HISTORY_ROLES` or the request, default `own`;
     - `includePrivate` only when explicitly true and the archive fidelity is full;
     - an unknown/invalid value is a 400 at lobby creation, never a silent coercion.
   - `createLobby` accepts `history` and stores the effective config in `Lobby.config`.
   - `lobbyPayload` exposes the effective config and the server caps so the client can render a
     truthful control.
2. Client setup (`Launcher` / `TablePicker` area):
   - a "Table memory" control with `Off`, `Digest`, `Full` and a short one-line explanation of each;
   - an advanced row for role visibility (`Own role only` default, `No roles`, `All roles`) and a
     read-only cap display;
   - a cost estimate ("about N extra tokens per bot call, from M previous games");
   - default `Off`; if the archive is empty, show "no previous games yet" and keep the toggle
     selectable.
   - Send `history` in `POST /api/game/new` and `POST /api/lobby` bodies.
3. Agent editor:
   - show the `historyAccess` field (`Inherit table setting` / `Never read history`) for llm
     engines;
   - include it in create/update payloads and `publicInfo`/`agentConfigText` where the other engine
     fields are displayed.
4. Prompt preview:
   - `POST /api/agents/preview` accepts a `history` mode and, for non-off modes, renders a
     **synthetic** fixture history block ("example previous game") rather than reading the archive;
   - the response includes the synthetic block and its token estimate;
   - a preview request must never read `<dataDir>/games`.
5. Reveal:
   - add a read-only "Memory given to the bots" panel, listing the selected game ids, their
     outcomes, the number omitted, and the role-visibility mode;
   - link each game id to the archive detail route (ARCH-003);
   - if history was off, show a one-line "Memory was off for this game".
6. Measurement:
   - add `npm run history-bench -- --seeds <n> --mode digest|full` using the existing paired-seed
     harness: same deals, one arm with history off and one with history on, same cast/models;
   - record win rate, fallback rate, spend, and the `+history` tag delta;
   - assert deterministic paired seeds and identical deals between arms;
   - write a short result section in the design doc or a run report, not a new doc.
7. Update the README env table and the archive/design docs if a name changes.

### Files

- `server/archive/history.ts` (`parseHistoryConfig`)
- `server/server.ts` (lobby validation, payload, preview, reveal memory summary)
- `client/src/App.tsx` (setup controls, request bodies, reveal panel)
- `client/src/components/Reveal.tsx` (memory panel)
- `client/src/types.ts`
- `server/agents/defs.ts`, `server/agents/def-types.ts` (historyAccess editor)
- `tools/history-bench.ts` (new) or extend the existing bench runner
- `test/archive/history-config.test.ts` (new)
- `test/server/history-preview.test.ts` (new)
- `test/eval/history-paired.test.ts` (new)

## Acceptance criteria

- [ ] A lobby can request `off`, `digest`, or `full`; the effective config is clamped to the
      deployment caps and echoed in the lobby payload.
- [ ] An invalid mode/role visibility is 400 at creation; an invalid env value warns and uses the
      default.
- [ ] The setup UI defaults to `off`, explains the cost, sends the config, and shows the cap.
- [ ] `historyAccess: 'deny'` is editable and respected; an agent with deny shows no block.
- [ ] `POST /api/agents/preview` renders a synthetic history block without touching the archive,
      and reports its token estimate.
- [ ] The reveal shows which archived games were used, the omission count, and the role mode; it
      links to the archive.
- [ ] `npm run history-bench` runs paired seeds with identical deals, reports win rate, fallback
      rate, spend, and the `+history` delta, and is deterministic for a fixed seed.
- [ ] No client bundle change is needed to disable the feature; `off` sends no history field and
      the server default is off.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Config clamp and invalid values | `test/archive/history-config.test.ts`: request/env matrix |
| Lobby payload | `test/server/history-preview.test.ts` or `test/server/http.test.ts`: create a lobby with each mode; assert effective config |
| UI request bodies | `npm --prefix client run build`; manual: start a game in each mode and inspect the request |
| Deny field | server test: def with deny, table history on, assert no block |
| Preview synthetic | `test/server/history-preview.test.ts`: assert block present for `digest`, absent for `off`, and the archive dir is untouched |
| Reveal memory panel | manual + gallery fixture; assert game ids and omission count |
| Paired benchmark | `test/eval/history-paired.test.ts`: fake clients, two arms, same seeds; assert identical deals and deterministic report |
| Default off | server test: no `history` body → effective `off`, no archive read |

Run:

```
node --test test/archive/history-config.test.ts test/server/history-preview.test.ts test/eval/history-paired.test.ts
npm run typecheck
npm --prefix client run build
npm run test:lanes
```

## Risks and notes

- The UI must not imply that history improves the bots. It is experimental; say what it does and
  what it costs.
- The preview block is synthetic on purpose. Reading the archive in a preview request would let
  anyone with the preview route inspect prior games, including private records, without the archive
  API's gating.
- The paired benchmark is the only claim of play-strength improvement. A single-game anecdote is
  not evidence.
- `includePrivate: true` is only meaningful for full-fidelity archives. If the deployment is
  `public`, the server should reject or downgrade it with a clear message.
