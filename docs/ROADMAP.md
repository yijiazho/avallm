# AvaLLM roadmap

**Status:** written 2026-07-22, the day the first Railway deployment went live.
Companions: [design-implementation.md](design-implementation.md) (architecture),
[design-multiplayer.md](design-multiplayer.md) (MP phases). This collects everything deferred
during M1→MP1 plus what deployment newly unblocks, in rough priority order.

## Now — deployment made these urgent

1. **Session snapshots & restore.** Games live in memory; every Railway redeploy or restart kills
   every running game — fatal for the no-timer "mail chess" pacing where games span days. `Game`
   is already plain JSON: snapshot lobbies + sessions (minus agent instances, reconstructable from
   defs) to disk on every event append, restore on boot. Needs a Railway volume. Also persist the
   OpenRouter spend counter — the `OPENROUTER_MAX_SPEND_USD` ceiling currently resets per process,
   so today the only durable budget cap is the key-level limit on OpenRouter.
   **Design scoped in [design-snapshots.md](design-snapshots.md)** (Session anatomy, write-through
   at the pump chokepoint, boot restore, spend-counter durability, phasing).
2. **AFK → Autopilot seat handoff.** Correspondence play *will* strand games on a vanished human.
   Host action: permanently convert a human seat to the heuristic agent (per-seat version of the
   existing per-decision degrade), marked in the feed and the reveal.
3. **Cost / usage dashboard.** `/api/usage` already reports per-agent, per-kind real-USD spend;
   there is no UI. A small admin view (gated by invite code) showing spend by model, fallback
   rates, and reasoning-leak counters — the observability that keeps a shared deployment honest.
4. **Custom agents on deployments** (explicitly deferred): attach a volume at `/app/data`; add
   gated `DELETE /api/agents/:id`; surface (rather than silently skip) custom agents whose roster
   model id disappeared. Optional third tier: checked-in `agent-cards/*.json` — curated agents that
   version with the repo and appear on every deployment. **Design fleshed out (including
   author-controlled system prompts for smarter agents) in
   [design-custom-agents.md](design-custom-agents.md).**

## Next — gameplay quality (the M3 core)

> **2026-07-23:** #5, #7, #8 are absorbed into
> [design-evaluation.md](design-evaluation.md) — the eval/self-improvement framework design
> (paired-seed role-forced sims, behavioral metrics, LLM judge, situation bank, promotion loop).
> It also provides the measurement substrate #6 needs. The entries below stand as the original
> motivation.

5. **Model coherence harness.** Scripted golden-set game states with a known best action; score
   every roster model; drop or demote models that fallback >10% or play incoherently. This is the
   honest answer to "how much scaffolding before it stops being the model playing" and gates
   roster additions.
6. **Balance measurement with LLM tables.** Heuristic self-play is evil-favored (~66/34 at 7p,
   ~80/20 at 5p/10p) because heuristic good has no discussion channel. Measure LLM-table win
   rates now that bots talk and answer questions; only then tune.
7. **Semantic leak measurement.** Structural leaks are impossible by design; bots can still *say*
   too much ("us evil folks"). Measure incidence from reveal logs before deciding whether a cheap
   post-hoc leak-judge call on evil/Merlin utterances is worth the cost/latency.
8. **Prompt iteration from real games.** The reveal logs (private thinking + actions) are a
   goldmine: recurring confusions (early-game state muddles, talk-vs-vote contradictions) become
   prompt or nudge fixes, like the direct-address and leader-defends-own-team nudges already did.
   - **Scratchpad reflect cadence** (`server/agents/raw-llm/agent.ts` `maybeReflect`). The private
     scratchpad refreshes via an ~800-token `reflect` call; the cadence is `AVALON_REFLECT_CADENCE`
     (`evidence` default = reflect on a quest resolve OR a **rejected** proposal; `resolve` = the
     older resolve-only lever). Approved/unanimous vote reveals are deliberately skipped — a live
     capture showed a first-round "everyone approved" reflect spends a call to conclude "nothing to
     conclude yet," while its real test is the quest result to come (which already reflects).
     Deferred refinements to measure once #6's paired-seed harness can price play-strength gain
     against the extra spend: (a) also reflect on **non-unanimous approvals** (a 3-2 approve is
     contested signal a rejection-only gate misses); (b) gate all vote-triggered reflects to
     **post-first-resolve**, so a vote reflect always has a quest result to reason against; (c)
     revisit the flat 800-token `reflect` budget per model once coherence data (#5) exists.
9. **Kimi cosmetic reasoning leak** (1 token/call): silence or tolerate explicitly; currently
   noisy in logs only.

## Incoming — game history, reviews, memory

> **2026-11-01:** three requested features, designed as a dependency chain. The archive is the
> foundation; the other two read from it. A rematch was considered and dropped: replaying a cast
> with reshuffled roles makes historical role memories actively misleading. Implementation
> tickets (description, plan, acceptance criteria, tests) are indexed in
> [docs/tickets/README.md](tickets/README.md).

- **Durable game archive.** Keep one local record per finished game (plus retention), replacing
  the opt-in JSONL-only artifact path as the product record. Built on the existing `GameArtifact`.
  **Design in [design-game-archive.md](design-game-archive.md).**
- **Post-game review.** Each modeled seat reviews its own decisions with hindsight; humans can
  write a note. Stored beside the game, shown in the reveal, included in the transcript.
  **Design in [design-postgame-review.md](design-postgame-review.md).**
- **Optional cross-game memory.** Agents read bounded digests of games they played before, off by
  default because it raises input tokens and retention sensitivity. Other seats' historical roles
  are hidden by default so a new deal cannot be read through an old one. Depends on the archive
  and gets its best material from post-game reviews. **Design in
  [design-cross-game-memory.md](design-cross-game-memory.md).**

## Social & presentation

10. **Free-form human chat** (MP3 headline): humans interject any time during discussion via a
    non-turn `chat` event that feeds bot transcripts; bots stay turn-based (which also caps token
    spend). Turn-based-only talk is the biggest gap between AvaLLM multiplayer and a real table.
11. **Reveal dramatization.** Vote-chip flips, one-at-a-time quest card reveals (fail cards last),
    assassination staging, and a polished "what they were really thinking" timeline — the design
    doc's retention feature, still in its functional-only form.
12. **Career stats.** Per-agent (and per-human) records across games: win rate by alignment,
    assassination accuracy, fallback rate. Makes the agent library feel alive and gives custom
    agents something to compete on. Needs the same volume as #1.
13. **Lobby & spectate polish:** lobby chat, spectator count in game UI, host controls (kick,
    cancel lobby), 10-player tables in the web UI (engine supports 10; web caps at 9).

## Agents & ecosystem

14. **Per-user agent libraries** — requires identity, so parked until accounts matter for other
    reasons. Global-shared library is the right call at friends-scale.
15. **Roster refresh discipline.** OpenRouter slugs go stale; the roster is one file, additions
    should ride the coherence harness (#5). Revisit as OpenRouter's roster shifts.

## Rules content (engine-ready, unscheduled)

16. **Lady of the Lake** (loyalty inspection, quests 2–4) — biggest good-side buff, rulebook-
    recommended at 7+; **Targeting** (leader picks quest order); **Excalibur** (force-switch a
    played card). Research doc §4 has the exact rules. Each is an engine phase addition + UI.

## Internal quality (unscheduled)

17. **Parse the decision trace instead of validating it in place.** `validDecisionTrace` is an
    honest type guard over `unknown`, so it narrows to a raw record and every downstream helper
    reads fields through a cast: roughly 35 in `admission/composed-trace.ts` alone, plus the
    `TraceValidationInput` union that lets those helpers serve both the guard and the callers who
    already hold a `DecisionTrace`. None of that is removable by retyping, and both collapses were
    compiled rather than argued: to `DecisionTrace` it is 9 errors, seven of them the guard handing
    its own raw record to a helper, so that direction asserts validity inside the code that
    establishes it; to `Record<string, unknown>` it is 14 errors, every one a `DecisionTrace` call
    site that would need a fresh cast, so that direction only moves the casts outward. The real fix
    is a `parseDecisionTrace(value: unknown): DecisionTrace | null` that narrows each field once and
    builds a typed value, after which the helpers take `DecisionTrace` with no casts. That is a
    rewrite of a 4,347-line security boundary across 25 `valid*` validators, and it has to preserve
    every rejection reason exactly, so it wants its own project and a rejection-parity harness
    (same corpus through both implementations, asserting identical accept/reject *and* identical
    reason codes) rather than an incremental edit.

18. **Phase-discriminated engine state types** (investigated, not scheduled). `Game` and
    `PlayerView` flatten every phase into one flat struct, so phase-specific fields are optional
    even where a phase makes them invariant — the engine proves it with six `game.currentTeam!`
    and the guard sprawls into agents/client/tests. **Investigation concluded: don't build the
    full union.** Cost lands on the mutation reducer (union forces replace-not-mutate, which
    collides with the locked append-only `log`) and on the leak boundary (`viewForSpectator`'s
    one auditable literal would split seven ways), while the benefit is concentrated on a single
    field and diluted by the many genuinely-optional fields a union can't touch. The specific
    bug the smell caused (disagreeing team-equality helpers) is already fixed by the `teamsEqual`
    consolidation. The one low-risk follow-up — a `teamOnTable(game)` accessor hardening the six
    engine `!` — is done. **Full analysis in [design-phase-typing.md](design-phase-typing.md).**

## Deliberately not doing

- **Turn timers** — rejected by design; correspondence pacing is the identity.
- **Anti-cheat beyond hidden views** — friends-scale; screen-sharing is out of scope.
- **Prompt-injection "fixes" beyond format guards** — social-engineering the bots is the game.
- **AvalonBench bridge** — dropped 2026-07-30 after sitting designed-but-unbuilt. The `stdio` agent
  engine that existed to carry it (child processes speaking newline-delimited JSON) is deleted, with
  it the `external` execution mode and the `external` arm on six brain component unions. The
  untrusted reply/trace ingress it guarded survives as `parseExternalDecisionReply`
  (`server/agents/external-reply.ts`), so a future cross-language door does not start from zero.

## Known issues ledger

| Issue | Severity | Status |
|---|---|---|
| Redeploy kills running games | high (deployed) | → #1 |
| Spend ceiling resets per process | medium | → #1; key-level limit is the real cap today |
| Heuristic self-play evil-favored | low (baseline only) | → #6 measures the real (LLM) number |
| Kimi 1-token reasoning leak | cosmetic | → #9 |
| Early-game bot state confusion | low, shrinking | → #8 |
| Custom agents ephemeral on Railway | accepted for now | → #4 |
| Browser cache serves stale bundle after deploy | annoyance | hard-refresh; consider cache headers with #1's release work |
