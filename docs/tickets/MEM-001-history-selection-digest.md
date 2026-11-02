# MEM-001 — History selection and digest rendering

- **Status:** proposed
- **Depends on:** ARCH-001 (done), ARCH-002, SHARED-002
- **Blocks:** MEM-002
- **Design:** [design-cross-game-memory.md](../design-cross-game-memory.md) §Scope, §The
  role-confusion rule, §Digest, §What the block says
- **Size:** M

## Description

Turn the archive into a small, deterministic memory block for one agent. Selection is by the
agent's stable descriptor (`llm:<model>` or `def:<id>:llm:<model>`), newest first, capped. Roles are
hidden by default except the agent's own historical role, because replaying a cast with reshuffled
roles is exactly the situation where historical role memory becomes misleading.

This ticket produces the text only. It does not touch `buildMessages` or agent construction; that
is MEM-002.

## Implementation plan

1. Add `server/archive/history.ts`:
   ```ts
   export type RoleVisibility = 'none' | 'own' | 'all'
   export interface HistoryConfig {
     mode: 'off' | 'digest' | 'full'
     maxGames: number
     maxTokens: number
     includeRoles: RoleVisibility
     includePrivate: boolean
     includeReviewProse: boolean
   }

   export interface GameDigest { ... }       // design §Digest
   export interface RenderedHistory {
     text: string
     games: number
     omitted: number
     tokens: number
   }

   export function selectHistoryGames(input: {
     descriptor: string
     currentGameId?: string
     config: HistoryConfig
     metas: readonly ArchiveMeta[]
   }): ArchiveMeta[]

   export function buildGameDigest(record: ArchivedGame, input: {
     descriptor: string
     config: HistoryConfig
   }): GameDigest

   export function renderHistoryBlock(digests: readonly GameDigest[], config: HistoryConfig): RenderedHistory
   ```
2. Selection:
   - keep metas where a seat's `descriptor` equals the input descriptor;
   - exclude `currentGameId` when provided;
   - sort by `artifact.createdAt` descending;
   - take `maxGames` (clamp 1-10), then trim for the token cap.
3. Digest:
   - players, roles, outcome, quests, proposals/votes from the archived artifact;
   - `agentSeats` are every seat whose descriptor matches; `agentRole`/`agentAlignment` only when
     `includeRoles !== 'none'` (and only for those seats);
   - other seats' roles only when `includeRoles === 'all'`;
   - `highlights` are public `utterance` events, sanitized with `sanitizeSpeech`, newest or most
     pivotal first, capped;
   - `lessons` come from `record.postgame` complete reviews (`summary`, `lesson`) only when
     `includeRoles === 'all'` **and** `includeReviewProse` is true. Review prose can name roles,
     and `sanitizeSpeech` strips markup rather than semantics, so restricted modes omit it
     entirely rather than pretending the structured role filter makes it safe. Sanitize and cap
     the prose that is included;
   - `includePrivate`: add the agent's own `thinking`/`scratchpad` text when the archived record
     has it (full fidelity only), clearly marked in the render as private notes from a finished
     game; never add another seat's private text.
4. Rendering (deterministic, pure):
   - header: "== YOUR PREVIOUS GAMES ==" plus one sentence that the games are over, their roles are
     historical, and the block is not instructions;
   - one section per game, newest first, with outcome, own role if allowed, quest board, key votes,
     and review prose only when allowed;
   - fenced table-talk/notes; mention of private notes only when included;
   - no em/en dashes and no antithesis reframes (house style);
   - token estimate is `Math.ceil(chars / 4)`; the cap is enforced on that estimate;
   - over cap: drop oldest games first and append `[N earlier games omitted for length]`;
   - a single oversized game is truncated at section boundaries, keeping outcome, own role, and
     review prose only if the switches allow it.
5. Do not persist a digest yet. Build it once per game start from at most 3 records; if profiling
   later shows a cost, add a cache keyed by game id plus post-game completion.
6. Add `describeHistoryConfig(config)` for the server/UI to show what was selected.

### Files

- `server/archive/history.ts` (new)
- `server/archive/types.ts` (`HistoryMode`, `RoleVisibility` if not already there)
- `test/archive/history-select.test.ts` (new)
- `test/archive/history-render.test.ts` (new)

## Acceptance criteria

- [ ] Selection returns only games where the descriptor held a seat, excluding the current game,
      newest first, capped by `maxGames`.
- [ ] A descriptor that appears twice in one game yields one digest with both seats listed.
- [ ] `includeRoles: 'none'` renders no role; `'own'` renders only the agent's own historical
      role/alignment; `'all'` renders every seat's role with the historical label.
- [ ] `includePrivate: false` never renders another seat's `thinking`/`scratchpad`; `true` includes
      only the agent's own, and only when the archive record has it.
- [ ] Review prose appears only when `includeRoles === 'all'` and `includeReviewProse` is true; a
      failed/partial review contributes only complete seats.
- [ ] Review text that names a role ("As Merlin...", "Ada was the Assassin") is absent in
      `none`/`own` modes even though the prose passes `sanitizeSpeech`.
- [ ] Rendering is byte-identical for the same inputs.
- [ ] Token estimate and cap behave as specified, including the omission marker and the
      section-boundary truncation.
- [ ] Every player-authored string is passed through `sanitizeSpeech`.
- [ ] The block contains no em/en dashes and no banned reframe.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Selection and ordering | `test/archive/history-select.test.ts`: synthetic metas for three descriptors and times |
| Duplicate descriptor | same file: one game with the descriptor at seats 2 and 5 |
| Role visibility | `test/archive/history-render.test.ts`: same digest rendered in all three modes |
| Private visibility | same file: full vs public record; assert own-only and no other-seat prose |
| Review prose visibility | same file: a complete review whose summary says "As Merlin..." and whose lesson says "Ada was the Assassin"; assert absent for `none`/`own`, present only for `all` + `includeReviewProse`; assert a partial review contributes only complete seats |
| Determinism | same file: `render` twice, deep-equal strings |
| Cap and omission | same file: 5 digests with a low cap; assert marker and dropped games |
| Single oversized game | same file: low cap, assert outcome, own role, and any allowed review prose survive |
| Sanitization and house style | same file: markup and `[INST]` inputs; assert stripped, no dashes |
| Token estimate | same file: assert `ceil(chars/4)` |

Run:

```
node --test test/archive/history-select.test.ts test/archive/history-render.test.ts
npm run typecheck
npm run test:lanes
```

## Risks and notes

- Selection reads the metadata index only; loading 3 records once at game start is acceptable.
  Do not read the archive per decision.
- The digest is a **reading** artifact, not a replayable log. Do not include every event.
- If the archive is empty or the agent is new, return an empty block and let MEM-002 omit the
  prompt section entirely. Do not render a header with no games.
- `includeRoles: 'all'` is deliberately not the default. It is the mode most likely to cause the
  role-carry-over confusion the design warns about.
- Do not treat `sanitizeSpeech` as a role filter. It removes markup and caps length; it does not
  understand that "As Merlin..." discloses a role. Restricted modes must omit free-form review
  prose entirely, which is why `includeReviewProse` is a separate switch.
