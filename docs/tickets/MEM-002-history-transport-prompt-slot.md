# MEM-002 — History transport and prompt slot

- **Status:** proposed
- **Depends on:** MEM-001
- **Blocks:** MEM-003
- **Design:** [design-cross-game-memory.md](../design-cross-game-memory.md) §Prompt placement,
  §Transport into the agent, §Cost
- **Size:** M

## Description

Deliver the rendered history block to the raw-LLM agent and place it in the stable part of the
system prompt. The block is per seat, frozen at game start, and absent when history is off. No
other agent engine consumes it in v1.

This ticket also makes the extra input measurable: every model call from an agent with history gets
a `+history` suffix on its spend tag, so `/api/usage` can separate history-on from history-off
without a new accounting system.

## Implementation plan

1. Define the transport shape in `server/agents/types.ts`:
   ```ts
   export interface HistoryBlock {
     readonly mode: 'digest' | 'full'
     readonly text: string
     readonly games: number
     readonly omitted: number
     readonly tokens: number
   }

   export interface AgentContext {
     seed: string
     seat: number
     onDecisionTrace?: (trace: DecisionTrace) => void
     history?: HistoryBlock
   }
   ```
2. Add `historyAccess?: 'inherit' | 'deny'` to `LlmEngine` in `server/agents/def-types.ts`,
   validate it in `validateDef`, and default to `inherit` when absent. A def with `deny` never
   renders a block, even when the table enables history.
3. Add `history?: HistoryBlock` to `LlmAgentOpts` in `server/agents/raw-llm/agent.ts`:
   - store it once; do not rebuild it per call;
   - validate `history.text.trim()` is non-empty and `mode !== 'off'`, otherwise ignore it;
   - pass `history.text` into `buildMessages` features;
   - change the spend tag to `${tagId}/${kind}${history ? '+history' : ''}`.
4. Add `history?: string` to `PromptFeatures` in `server/agents/raw-llm/prompts.ts` and insert it
   in `buildMessages`:
   ```
   rulesDigest(view)
   blank
   You are <name>. Your secret role: ...
   blank + history.text          <-- new
   knowledgeText(...)
   alignment/role guidance
   ...
   ```
   The history block must be byte-identical for every call from one seat in one game. Do not
   interpolate the current phase, round, or per-call state into it.
5. Wire construction:
   - `createAgentFromDef(def, ctx, modelOverride, deps)` passes `ctx.history` to
     `createLlmAgent` when the engine is `llm` and `engine.historyAccess !== 'deny'`;
   - `createAgent` (internal `AgentSpec` path) accepts the same context but only the `llm` arm
     consumes it; document that composed/heuristic ignore it in v1;
   - `startLobby` builds `Session.history: Map<Seat, HistoryBlock>` from MEM-001, using
     `seatedAgents[seat].descriptor` and the lobby's history config, then passes the per-seat block
     into `createAgentFromDef`.
6. Session starts:
   - history is built after `seatedAgents` snapshots and before agents are constructed;
   - if the archive is empty, the block is omitted and the map entry absent;
   - `historyMode: 'off'` means no archive read and no map.
7. Preview/offline: leave `POST /api/agents/preview` unchanged in this ticket (MEM-003 adds a
   synthetic block). Never read the archive from preview.
8. Update the design doc if the final tag shape differs.

### Files

- `server/agents/types.ts` (`HistoryBlock`, `AgentContext.history`)
- `server/agents/def-types.ts` (`historyAccess`)
- `server/agents/defs.ts` (validation)
- `server/agents/registry.ts` (pass-through, deny rule)
- `server/agents/raw-llm/agent.ts` (`history`, tag suffix)
- `server/agents/raw-llm/prompts.ts` (`PromptFeatures.history`, placement)
- `server/server.ts` (`Session.history`, `startLobby` build)
- `test/agents/prompts/history.test.ts` (new)
- `test/agents/registry-history.test.ts` (new)
- `test/server/history-start.test.ts` (new)

## Acceptance criteria

- [ ] A raw-LLM agent with a history block renders it after the identity line and before
      `knowledgeText`.
- [ ] The block is identical across all calls from one seat in one game, and differs between
      seats when their histories differ.
- [ ] `historyMode: 'off'` renders no block and reads no archive.
- [ ] `historyAccess: 'deny'` renders no block even when the table enables history.
- [ ] Composed and heuristic agents ignore history; they still construct and play.
- [ ] Every call from a history-on agent is tagged `<agentId>/<kind>+history`; history-off calls
      keep the current tag.
- [ ] A block with empty text is treated as absent.
- [ ] `buildMessages` remains a pure function; no fs or archive import in the prompt module.
- [ ] Existing prompt tests still pass; the new prompt text follows the house style.

## Testing plan

| Acceptance criterion | Test |
|---|---|
| Placement | `test/agents/prompts/history.test.ts`: build messages for `discuss`/`vote`, assert index of history between identity and knowledge |
| Per-seat stability | same file: two calls for one seat have identical history segments; two seats with different blocks differ |
| Off/deny | `test/agents/registry-history.test.ts`: construct agents with `off`, `deny`, and `inherit`; assert block presence |
| Non-LLM ignore | same file: heuristic/composed construction with history does not throw |
| Spend tag | `test/agents/raw-llm` fake-client test: assert tag suffix on history-on and not on history-off |
| Empty block | same file: empty text is ignored |
| Purity | `npm run verify:contract` (ARCH015) |
| Start wiring | `test/server/history-start.test.ts`: start a game with a seeded archive and history on; assert the session has per-seat blocks |
| No archive read when off | same file: spy on the archive loader or use an empty dir; assert no read |

Run:

```
node --test test/agents/prompts/history.test.ts test/agents/registry-history.test.ts test/server/history-start.test.ts
npm run typecheck
npm run test:lanes
npm run verify:contract
```

## Risks and notes

- The history block is per seat, so it cannot sit in the prefix shared by all seats. It still sits
  in the stable prefix for that seat's calls; do not move it into the user message.
- `buildMessages` must stay pure. Pass rendered text in `PromptFeatures`; do not import
  `server/archive` from the prompt module.
- The `+history` tag changes spend grouping. Update any test or dashboard that asserts an exact tag
  list.
- Do not pass history to composed agents in v1. Their planner context is a separate audited
  projection; silently adding text there would bypass that audit.
