# Phase-discriminated state types: a design investigation

**Status:** investigation only, written 2026-07-30. No code changed. This doc
decides whether to reshape `Game` / `PlayerView` (`server/engine/types.ts`) from
single flat structs into phase-discriminated unions, or to do something smaller,
or nothing. Companion: [design-implementation.md](design-implementation.md) §1
(layering), [design-snapshots.md](design-snapshots.md) (Game-is-JSON persistence).

**Verdict up front:** do **not** build the full union now. Optionally add one
small engine accessor (`teamOnTable`) to harden the six non-null assertions the
engine leans on; that is the only part with a clear, low-risk payoff, and it is a
hardening play, not a cost eliminator. Everything else the smell touches is either
already fixed (the `teamsEqual` consolidation) or is a genuinely-optional field
that the flat type is telling the truth about. Full reasoning below.

## 1. The smell

`Game` (`server/engine/types.ts:67`) and `PlayerView` (`:142`) each flatten all
seven phases (`discussion | proposal | finalize | vote | quest | assassination |
gameOver`) into one struct. Because one type serves every phase, a field that is
present only in some phases must be declared optional even where, within a given
phase, it is invariantly present or invariantly absent. The type cannot say
"`currentTeam` always exists during `vote`," so the code proves it by hand with
`!` and re-guards it with `?? []`.

## 2. Inventory: every phase-conditioned optional field

Classification key: **INVARIANT** = the flatness is lying (always present in some
phase, always absent in another — a union could remove the optional);
**GENUINE** = actually sometimes-present within a single phase or for a single
viewer, so a phase union would *not* remove the optional.

### `Game`

| Field | Present when | Absent when | Class |
|---|---|---|---|
| `currentTeam?: Seat[]` | `finalize`, `vote`, `quest` (set on propose `game.ts:412`) | `discussion` before 1st proposal; between a resolved quest and the next proposal (`game.ts:160`, reset `:499`) | **INVARIANT** — the six `game.currentTeam!` sites (`:218,:282,:318,:428,:435,:489`) are the type failing to express this |
| `discussion?: {...}` | `discussion` only | every other phase (set `game.ts:143`, cleared `:152`,`:231`) | **INVARIANT** |
| `winner?`, `winReason?` | `gameOver` only | every other phase (set `game.ts:229`) | **INVARIANT** |
| `pendingVotes`, `pendingCards` | always (init `{}` at create, reset to `{}`, never `undefined`) | never | already **non-optional** — no cost |
| `Quest.team?/result?/failCount?` | per-quest lifecycle: a *past* quest has them, the *current* one accrues them, *future* quests lack them | — | **GENUINE** — the `quests` array holds past+current+future at once, so no single game-phase makes these invariant |

### `PlayerView`

`PlayerView` mirrors `Game`'s phase optionals through the `viewFor` chokepoint
(`server/engine/view.ts:222-224`, `:239-240`):

| Field | Class | Note |
|---|---|---|
| `currentTeam?: Seat[]` | **INVARIANT** | same invariant as `Game.currentTeam`, re-projected |
| `discussionRound?`, `discussionPostRevision?` | **INVARIANT** | derived from `Game.discussion?` |
| `winner?`, `winReason?` | **INVARIANT** | `gameOver` only |
| `PrivateInfo.evilPartners?/knownEvil?/merlinCandidates?` | **GENUINE (role, not phase)** | keyed on the *viewer's role*, present in every phase or none; a phase union does nothing for these |
| `ProposalRecord.votes?/approved?/revisedFrom?/auto?` | **GENUINE (record lifecycle)** | a proposal record accrues these as it resolves; `proposals` is a growing history, not phase state |
| `Quest.team?/result?/failCount?` | **GENUINE** | as above |
| `transcript[].prop?` | **GENUINE** | absent only for utterances before the first proposal (`view.ts:159-161`); inherent, not a phase artifact |

The load-bearing observation: on `PlayerView`, exactly **four** field groups are
INVARIANT (`currentTeam`, the two `discussion*`, `winner`/`winReason`). Every
other optional a reader trips over is GENUINE and survives any phase union
untouched.

## 3. The quantified cost

Counts from `rg` over `server/`, `client/`, `test/` on 2026-07-30. Disambiguated
from the unrelated `SituationAnalysis.currentTeam` (a computed clean-probability
object, 12 hits, out of scope).

**Non-null assertions attributable to the flat phase shape (`currentTeam!` /
`discussion!`):**

| Site | `currentTeam!` | `discussion!` |
|---|---|---|
| `server/engine/game.ts` | 6 | 3 |
| `server/agents/**` | 2 | 0 |
| `test/**` | 14 | 8 |
| **total** | **22** | **11** |

**Optional-absorbing guards (`currentTeam ?? []`, `currentTeam?.`):**

- `currentTeam ?? []`: 16 (agents 6, sim 3, client 4, test 1, +2 elsewhere)
- `currentTeam?.` optional chains: 17

The most telling sites are not the raw `!` — they are places in `server/agents/`
where **the phase is already known and the guard is still forced by the type**:

```
role-objectives.ts:103   return decision.stick ? view.currentTeam : decision.team   // finalize ⇒ always present
evil-objectives.ts:178   if (decision.kind === 'vote') return view.currentTeam      // vote ⇒ always present
role-utility.ts:214      if (candidate.decision.kind === 'vote' && view.currentTeam) // the `&&` can never be false
policy/forced.ts:31      return decision.stick ? view.currentTeam : decision.team
```

Each returns `Seat[] | undefined` where `undefined` is unreachable, and every
caller then re-absorbs the phantom `undefined`. That is the tax the flat type
levies even on code that has already discriminated by decision kind.

**What a full phase union would actually remove:** the 4 INVARIANT field groups'
guards. Concretely, roughly the **22 `currentTeam!` + 11 `discussion!` + ~15
`currentTeam ?? []`/`?.` on the view + the `winner?`/`winReason?` guards**. It
would **not** touch the larger `?? []` population in the codebase, which is
dominated by `privateInfo.* ?? []`, `proposal.votes ?? []`, and `quest.team ?? []`
— all GENUINE optionals. A `rg '?? []'` returns ~120 hits; the phase shape is
responsible for well under a third of them. This matters: the union pays a
whole-reducer restructuring cost to eliminate a *minority* of the guard sprawl,
concentrated overwhelmingly on a single field, `currentTeam`.

## 4. Evaluating the full phase-discriminated union

Design sketch:

```ts
type Game =
  | { phase: 'discussion'; discussion: {...}; /* no currentTeam */ ... }
  | { phase: 'proposal';   /* no currentTeam, no discussion */ ... }
  | { phase: 'finalize';   currentTeam: Seat[]; ... }
  | { phase: 'vote';       currentTeam: Seat[]; pendingVotes: {...}; ... }
  | { phase: 'quest';      currentTeam: Seat[]; pendingCards: {...}; ... }
  | { phase: 'assassination'; ... }
  | { phase: 'gameOver';   winner: Alignment; winReason: string; ... }
```

### 4a. Interaction with event-sourcing

The engine is event-sourced: `game.log` is the record, and per-seat views derive
from it via `viewFor` (CLAUDE.md invariant). But the derivation is **not** a pure
`fold(log)`. `Game` is a *mutable running cache* that `applyDecision` advances
imperatively — it is never rebuilt from the log during play. `viewFor`
(`view.ts:299`) even re-projects proposals/transcript from the log each call, but
it reads the *scalar* phase state (`phase`, `round`, `currentTeam`, `discussion`)
straight off the mutable `Game`. A union does not conflict with event-sourcing in
principle (you could fold the log into a union just as easily), but it collides
with the fact that the reducer mutates in place rather than replacing.

### 4b. Mutability — the real cost center

`applyDecision` mutates `Game` fields across ~15 sites in one big `switch`
(`game.ts:385-530`): `game.phase = 'vote'`, `game.currentTeam = ...`,
`game.discussion = undefined`, `game.round += 1`, and so on. A discriminated union
is unsound under in-place mutation: you cannot assign `game.phase = 'quest'` and
have TypeScript accept the object as the `quest` variant, because the other
variant-specific fields were never set in the same statement. Making the union
sound forces **replace-on-transition** — every phase transition rebuilds the
`Game` object (`game = { ...game, phase: 'vote', currentTeam }`) rather than
poking a field.

That replacement is invasive for three concrete reasons:

1. **`game.log` is a non-writable, non-configurable own property** installed via
   `Object.defineProperty` (`game.ts:100-105`), and each log slot is likewise
   frozen and locked (`emit`, `:45-50`). A spread `{ ...game }` produces a plain
   object whose `log` is writable again — you would have to re-run the
   defineProperty dance on every transition, or thread the locked array through by
   reference and hope. The append-only guarantees the incremental projector
   asserts (`view.ts:70-84`, "incremental player-view projection mutable log")
   are built on that identity holding across the whole game; replacing `Game`
   per transition means re-establishing them each time.
2. **`applyDecision` returns `game` and callers hold the reference.** The server
   (`server/server.ts`), sim drivers (`server/sim/`), and every test mutate a
   `Game` they captured earlier and read it back. `applyDecision(game, ...)`
   would have to become `game = applyDecision(game, ...)` at every call site, and
   any code holding a stale reference (the incremental projector binds
   `boundGame`/`boundLog` at construction, `view.ts:41-42`) breaks.
3. **The reducer's mid-transition states are not valid union members.** Casting a
   vote sets `pendingVotes[seat]` and only *then*, once the last vote lands,
   flips to `quest` and sets `currentTeam` for the quest (`game.ts:457-468`).
   Between the first and last vote the object is a `vote` variant being mutated —
   fine under a flat struct, but under a union every intermediate write needs to
   typecheck against the current variant, which pushes you toward rebuilding on
   *every* field write, not just phase flips.

### 4c. Purity / ARCH014

A union is pure data; it does not by itself introduce clocks, randomness, or
`process`, so ARCH014 and the zero-runtime-dependency constraint are not
threatened. Neutral.

### 4d. The hidden-info boundary (`knowledge.test.ts`, `leaks.test.ts`)

`viewForSpectator` (`view.ts:271`) names every field EXPLICITLY specifically so
that a new private `PlayerView` field is excluded-by-default rather than leaked.
A `PlayerView` union would replace that single explicit object with a
per-variant construction. That is *survivable* — you would build the right
variant and the spectator neutralizer would still enumerate — but the
"private-by-default" property currently rides on one flat object literal being
easy to audit. Splitting it into seven variant literals multiplies the surface
that the leak tests guard and that a reviewer must eyeball. Not a blocker;
a genuine increase in the audit surface for the most security-sensitive file in
the engine.

### 4e. Client / wire impact

`PlayerView` is the wire contract, re-exported into the client
(`client/src/types.ts:13-28`; see commit 53a5b61). A union changes the JSON shape
the client destructures. Mixed picture:

- **Helps:** `Feed.tsx` and `QuestParty.tsx` already branch on
  `view.phase === 'quest'` / `=== 'vote'` (`Feed.tsx:290-326`,
  `QuestParty.tsx:16-25`). Under a union those comparisons would *narrow* `view`
  and hand the branch `currentTeam` non-optionally — a real ergonomic win, and it
  would delete the `view.currentTeam ?? []` in `QuestParty.tsx:21`,
  `Feed.tsx:332`.
- **Does not help / adds friction:** `ActionBar.tsx` switches on the
  **`DecisionRequest.kind`**, not `view.phase`, and passes the whole `view` down
  to `<Vote>` / `<QuestCard>` (`ActionBar.tsx:29-31`). Inside those components
  `view` is still the un-narrowed union, so `view.currentTeam` stays optional
  (`ActionBar.tsx:43,:125,:196`) unless each component re-narrows on `view.phase`.
  So the client would need its own follow-on refactor to cash in the union, and
  some union-illegal reads (a component that reads `currentTeam` without first
  proving the phase) would newly fail to compile and need rewriting.

### 4f. Test blast radius

`test/**` alone holds 14 `currentTeam!` + 8 `discussion!` + assorted
`view.currentTeam` reads (85 `view.currentTeam` references total across the tree).
Many tests reach into `g.discussion!.roundNum` (`flow.test.ts`,
`talk-default.test.ts`) and `view.currentTeam!` (`forced-policy.test.ts`,
`morgana-counterfeit.test.ts`). A union turns each of those into a narrow-or-cast
edit. None are hard, but the count is real and every one is a chance to regress a
contract test.

### 4g. Net on the full union

Large, cross-cutting change to the engine reducer (replace-not-mutate), the wire
contract, the spectator neutralizer's audit surface, ~30 agent/client sites, and
~40 test sites — to remove guards concentrated on **one** field plus `discussion`
and `winner`. The benefit is real but narrow and diluted; the cost lands squarely
on the two most invariant-critical pieces of the system (the mutation reducer and
the leak boundary). **Not worth it as a standalone project.** The one condition
that would flip this: if `PlayerView` / `Game` is being reshaped anyway for
another reason — the snapshot/restore work in [ROADMAP §1](ROADMAP.md) touches
Game serialization — folding a union in *then* would amortize the restructuring
cost against work already being paid for.

## 5. Lighter-weight alternatives

### 5a. Engine accessor `teamOnTable(game): Seat[]` — RECOMMENDED (small, optional)

Centralize the six `game.currentTeam!` into one audited assertion:

```ts
// The team currently on the table. Defined in finalize | vote | quest — the
// phases between a locked/proposed team and its resolved quest. Throws rather
// than returning undefined so a phase-logic bug surfaces here, not as a silent
// `undefined.slice()` three frames away.
function teamOnTable(game: Game): Seat[] {
  if (game.currentTeam === undefined) {
    throw new EngineError(`no team on the table in phase ${game.phase}`)
  }
  return game.currentTeam
}
```

All six engine sites (`game.ts:218,:282,:318,:428,:435,:489`) are provably inside
`{finalize, vote, quest}`, where `currentTeam` is invariant — verified against the
lifecycle (set on propose `:412`, cleared at round start `:160` and post-quest
`:499`). So the accessor's precondition always holds at those sites; it converts
six silent `!` into six calls that read as intent and share one real runtime
check.

- **Cost:** ~net-neutral line count (one function; six `!`→calls). Engine-only;
  does not touch agents, client, tests, the wire, or the leak boundary.
- **Benefit:** one documented invariant instead of six restatements; a throw
  instead of a `TypeError` on the invariant's first violation; a chokepoint to
  grep. This is the deletion-bounty-shaped move (make the assertion structural and
  owned in one place) — but honestly it is *hardening*, not cleanup: it removes no
  guard sprawl outside the engine, because agent/client/test consumers read
  `PlayerView.currentTeam`, which stays legitimately optional (a viewer can be in
  any phase).
- **Risk:** very low. Same runtime behavior on the happy path; the only new
  behavior is a clearer throw on a state that is already unreachable.

Verdict: worth doing, and **done** — `teamOnTable` is implemented in
`server/engine/game.ts` and the six `game.currentTeam!` sites now call it. It
stays module-private (agents/client/tests read `PlayerView.currentTeam`, not the
engine field). Net-neutral lines, engine-local, hardening-only. Verified: strict
server typecheck clean, `test:fast` green (489 tests).

### 5b. Phase-narrowed view sub-types from `viewFor`

Have `viewFor` return `DiscussionView | VoteView | QuestView | ...`. This is the
`PlayerView` union by another name — it changes the same wire shape and imposes
the same client narrowing work (§4e) without the engine-mutation cost of §4b.
It buys the client-side ergonomics of the union while leaving stored `Game`
flat. But it still splits the leak-boundary audit surface (§4d) and still needs
the client action components to re-narrow. Middle-weight; only attractive if the
goal is specifically client ergonomics and the stored-Game churn is the dealbreaker.
Not recommended ahead of 5a.

### 5c. Leave as-is

Defensible for `PlayerView` specifically: for a *viewer* who may be looking at any
phase, `currentTeam?` is arguably telling the truth — the guard is honest, not
phantom. The dishonesty is concentrated in (i) the engine's six `!` and (ii) the
handful of agent sites that have already discriminated by decision kind (§3).
(i) is addressed by 5a; (ii) is a small, tolerable residue.

## 6. What already de-risked this smell

The specific bug the smell *caused* is already fixed. Five private
re-implementations of order-insensitive team equality disagreed on the
absent/absent case — precisely because the optional type never forced anyone to
decide what an absent team means. That was consolidated onto
`teamsEqual(a: Seat[], b: Seat[])` (`server/engine/rules.ts:191`), which takes
two non-optional arrays and pushes the "what does absent mean" decision back to
each call site (`?? []`) where it is visible. So the flat type's worst
consequence — silent semantic drift across duplicated helpers — has a structural
fix in place. What remains is ergonomic tax, not a latent correctness bug.

## 7. Recommendation

1. **Do not build the full phase-discriminated union now.** Cost is large and
   lands on the mutation reducer and the leak boundary; benefit is narrow
   (essentially one field) and diluted by the many GENUINE optionals a union
   cannot touch. Revisit **only** if `Game`/`PlayerView` is being reshaped for
   snapshots ([ROADMAP §1](ROADMAP.md)), where the restructuring is already paid.
2. **`teamOnTable` (§5a) is implemented** — the engine's six `!` are now one
   owned, throwing accessor. Low-risk, engine-local, net-neutral lines; a
   hardening play, not a guard-sprawl eliminator.
3. **Accept `PlayerView.currentTeam?` as honest** for viewers; the leak boundary
   and the flat wire shape are better served staying simple than split seven ways.

## 8. Risks if the full union is pursued anyway

- **Mutation→replacement rewrite** of `applyDecision` risks breaking the
  `log`/append-only invariants the incremental projector asserts at runtime
  (`view.ts:70-103`) — those are the guardrails, and they assume stable object
  identity across the game.
- **Leak-boundary audit surface** multiplies from one explicit object literal to
  seven variant literals in the most security-sensitive file
  (`viewForSpectator`); `leaks.test.ts` / `knowledge.test.ts` must stay green
  through the split.
- **Client action components** (`ActionBar` and children) switch on
  `DecisionRequest.kind`, not `view.phase`, so the union does not narrow for them
  automatically — expect a follow-on client refactor, not a free win.
- **~40 test sites** reach into `g.discussion!` / `view.currentTeam!` and each
  needs a narrow-or-cast edit; every one is a chance to regress a contract test.
