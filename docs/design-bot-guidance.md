# Bot guidance: turning the strategy research into prompts and code — design

**Status:** extracted 2026-07-25 from `research-strategy.md`, where it had grown by accretion.
Companions: [research-strategy.md](research-strategy.md) (the locked research brief this doc
implements), [design-implementation.md](design-implementation.md) (architecture),
[design-evaluation.md](design-evaluation.md) (metrics and the promotion loop),
[research-prompt-formats.md](research-prompt-formats.md) (how the facts layer is formatted).

research-strategy.md answers "how is this game played well" from strong human play and the
published literature, and stops there. This doc answers the three engineering questions that follow
from it, in the order you should ask them:

1. **What kind of lever is this even** — computed fact, guidance text, harness structure, or model
   capability (§8)? Asked first, because §6 and §7 both presuppose the answer is "guidance", and for
   a large class of failures it is not.
2. **Where does a heuristic belong** in the prompt the bots actually assemble, so the same advice
   is not maintained separately in five role blobs (§6)?
3. **How binding is it** — a rule the engine enforces, a play the board forces, or a default a good
   player breaks on purpose (§7)?

Everything here cites code and will go stale as the code moves; the research brief should not.
When guidance changes, this doc changes and research-strategy.md does not.

**Section numbering.** §6 and §7 keep the numbers they carried inside research-strategy.md, because
citations across the codebase (`board.ts`, `forced.ts`, the prompt builders, their tests) point at
them. So in this doc **§1–§5 always mean research-strategy.md**, and §6–§7 are the sections below.
New sections here continue at §8.

---

## 6. Prompt-slot placement map (implementation)

research-strategy.md §1–§5 are the strategy. This section maps it onto the concrete **prompt slots**
the bots actually assemble in `server/agents/prompts.ts`, so guidance placement becomes a
rule instead of a per-role blob written from scratch. The organizing question for every
heuristic is: **which slot's scope exactly matches the set of situations this advice applies
to?** Put it there, once, and no wider.

This map was written after we found the double-fail warning present in three evil role blobs
(assassin, oberon, minion) and missing from two others (morgana, mordred) — a scope mismatch:
the advice is *evil-shared*, but it was being maintained per-role, so holes were inevitable.
The fix is not to patch the two holes; it is to recognize the correct slot for each heuristic
and stop duplicating.

### 6.1 The slots (what exists today)

Assembled in `buildMessages` (system message top-to-bottom, then the user message):

| ID | Slot | Scope: who sees it, when | Source |
|----|------|--------------------------|--------|
| **S0** | `rulesDigest(view)` | Every bot, every call | `prompts.ts`, pruned to the cast (§6.1a) |
| **S1** | *(none yet)* universal strategy | Every bot, every call — **no baseline slot exists** | proposed |
| **S2** | `alignmentShared(view)` (`GOOD_SHARED` / `EVIL_SHARED`) | All good, or all evil, every call | `prompts.ts`, pruned to the cast (§6.1a) |
| **S3** | `ROLE_GUIDANCE[role]` | One role, every call | `prompts.ts` map, 8 keys |
| **S4** | `tableTalkNorms(view)` | Every bot, **only `discuss` + `pitch`** | `prompts.ts`, pruned to the cast (§6.1a) |
| **S5** | `ASKS[kind]` | Every bot, **only that decision kind** | `prompts.ts` map, 8 kinds |
| **S6** | `OUTPUT_CONTRACTS[kind]` | Every bot, that kind — format-bound | `prompts.ts` map, 8 kinds |
| **S7** | `factsDossier` | Every bot, every call — **DATA only** | `facts.ts` |
| **S8** | agent-config overrides (`strategy`/`personality`/`roleGuidance`/`kindGuidance`) | One custom agent | `defs.ts` |

Two of these are not strategy homes and must stay that way:

- **S7 is a facts layer, not a policy layer** (`facts.ts` header, design doc §1.2). It carries
  *computed observations* — one labeled row per player ("Kimi(seat 3) | on-team: Q2(FAIL), Q3(ok)
  | voted: Q2 approve→FAIL, Q3 reject→ok") with zero imperatives, so custom
  agents compete on strategy rather than on bookkeeping. A heuristic ("treat fail-count as hard
  evidence") never goes in S7; the *number* it reasons over does. When a heuristic and a fact
  are two halves of one idea, split them: the datum to S7, the "what to do about it" to a
  guidance slot. **Before adding a fact, follow the FORMAT CONVENTIONS in `facts.ts`'s header**
  (one row per entity, `key: value` cells, markdown-in-not-JSON) — the dossier grows by
  accretion, and the shared shape is what keeps it a single-lookup record instead of a pile.
- **S6 owns format, and strategy only where it is inseparable from format** (e.g. discuss's
  `"say" is heard by everyone — never reveal private knowledge in it`). Don't grow S6 into a
  strategy slot; if advice would survive a format change, it belongs in S3/S2/S1/S5.

### 6.1a The cast invariant: role-set claims are computed, never constant

**No prompt text may assert anything about which roles are in play except as a function of
the view.** A module-level `const` cannot see `view.rolesInPlay`, so any role-set claim baked
into one describes a *default* deal rather than the one being played.

Sort the slots by how their text is produced and the old bug separates perfectly. Everything
computed from a `PlayerView` was already correct (`factsDossier`'s `shotRemains`, the `ASKS`
gates on Oberon and Percival); every hoisted constant was wrong — S0, S2, S3's `merlin` entry,
S4, and the two hedges in `knowledgeText`. The hoisting was for prompt-cache friendliness, and
that is exactly why the bug lived there and only there.

It was not cosmetic. `RULES_DIGEST` named Mordred, Oberon and Minions in every game, and bots
believed it: in a no-Oberon deal a Morgana twice wrote a seat off as *"likely evil or Oberon"*
at 75% and 80% confidence, a proposition its own partner list refutes. `ROLE_GUIDANCE.merlin`
carried *"If Mordred is in play ... never claim total confidence in anyone's goodness"* — a
conditional first clause with an unconditional imperative, so it fired in every game and talked
Merlin out of certainty it actually held (observed: two provably-good seats carried at 65-70%
for a whole game). Meanwhile `publicStateText` was already rendering the true role list, so the
prompt contradicted itself.

Each constant is now the **unpruned superset**, kept for the `/api/agents` anatomy display where
there is no game to key off and an author needs to see the whole space their text may run in.
Live calls go through the paired function:

| unpruned constant (S8 display) | pruned for the cast (live calls) |
|--------------------------------|-----------------------------------|
| `RULES_DIGEST` | `rulesDigest(view)` |
| `ALIGNMENT_SHARED` / `GOOD_SHARED` | `alignmentShared(view)` |
| `TABLE_TALK_NORMS` | `tableTalkNorms(view)` |
| `ROLE_GUIDANCE[role]` | `roleGuidanceFor(role, overrides, view)`, which appends `roleAddendumFor` |

Caching survives because all of these vary by **cast**, not by seat or turn, so the shared
prefix is byte-identical across a game.

**The lattice is what keeps this from combinatorial.** `ROLE_REQUIRES` in `engine/rules.ts` is
the authority: a special role is only dealt when the role it acts on is dealt, each entry names
one direct requirement, and transitivity carries the rest (Morgana needs Percival, who needs
Merlin). So `ROLE_GUIDANCE.morgana` may say *"Percival sees you and Merlin"* with no gate at
all. `client/src/setup.ts` mirrors it and is deliberately **stricter** (it also ties Oberon to
Merlin): a picker stricter than the engine only narrows what it offers, while a picker looser
than the engine would offer setups that can only ever 400.

Gating predicates in use, all read off `rolesInPlay`:

| predicate | where | gates |
|-----------|-------|-------|
| `shotRemains` / `shotExists` | `facts.ts`, `prompts.ts` | the assassination endgame, and all of `GOOD_SHARED`'s Merlin-protection doctrine |
| `rolesInPlay.includes('mordred')` | `knowledgeText`, `roleAddendumFor` | whether Merlin's sight is complete |
| `rolesInPlay.includes('oberon')` | `knowledgeText` | whether an evil partner list is complete |
| `alignmentComplete` | `board.ts` `roleCertainties` | whether a seat can *prove* its Merlin-candidate pool rather than guess it |

`test/phantom-roles.test.ts` pins the invariant over **rendered** prompts across a matrix of
legal casts, so the knowledge lines, ASKs and view renderers are covered rather than just the
exported constants (same approach as `talk-norms.test.ts`). `test/certainties.test.ts` pins the
deductions themselves.

### 6.1a-bis Audits over rendered prompts, and what each one catches

Three audits now run over **rendered** prompts rather than the exported constants, for the same
reason each time: a constant does not tell you what the model actually receives.

| audit | catches | how it is scoped |
|-------|---------|------------------|
| `test/phantom-roles.test.ts` | a prompt naming a role nobody holds | all 71 legal casts, every seat, every call kind |
| `test/talk-norms.test.ts` | house-style violations (dashes, "not X, that's Y") | rendered prompts, so `ASKS` and view renderers are covered |
| `test/prompt-coherence.test.ts` | a sentence that contradicts **itself** | 71 casts on boards with a FAILED quest, so failure-gated text renders |

The third one is newer and worth explaining, because it catches a failure the other two cannot see:
no individual word is wrong. Text assembled by joining a variable-length list can be true for one
item and self-refuting for two. `recordLine` captioned each deduction "of the players on it he is
the only one left you cannot already account for" — correct for one seat, and printed about each of
two players in the same sentence whenever a quest took more Fails than its team could account for.
**929 of 2713 renders.** The diff read clean and the test written alongside it passed, because it
only built the single-item case.

Two detectors, both deliberately shallow (they judge whether a sentence contradicts itself on its
face, never whether a claim is true):

- **repeated uniqueness** — "the only one/seat/player", "is the one who", "nobody else" appearing
  twice in one sentence. Runs everywhere: a data row never makes a singular claim.
- **repeated run** — the same eight words twice in one sentence. Runs on prose only. The dossier and
  vote record are data renderers whose format conventions (`facts.ts` header) make every row share
  its column labels, so repetition there is the format working.

Two properties keep it honest. It asserts it reached the text it audits (a floor on how often
`recordLine` renders, since a sweep of all-successful boards would pass while covering nothing —
the coverage gap `phantom-roles` still has). And a self-test pins both detectors against the
verbatim shipped bug plus three corpus sentences that use the same phrases once, so widening a
pattern until it stops biting has to break that test first.

**Known gap:** contradiction ACROSS sentences is not covered. The same review turned up a
consequence rendered before its premise ("it follows once the seats above are placed", printed
first), which no sentence-scoped check can see.

### 6.1b The second gating dimension: board state

Cast gating (§6.1a) is free, because a cast is fixed for a whole game. **Board gating is not**:
text keyed to the score or the quest record changes mid-game, so it breaks the shared prefix from
that point on. Use it only where the advice is genuinely wrong on the other side of the switch,
which is a much higher bar than "would be nice to mention".

Two places currently clear that bar:

| gate | where | why the un-gated text was wrong |
|------|-------|--------------------------------|
| `matchPoint(view).good` | `goodSharedFor`'s endgame clause (S2) | "Make confident reads so Merlin does not stand out" is right while quests are contested and inverts at 2 successes, where the quests are effectively decided and the only remaining loss is the shot. Observed: at 2-0 a seat publicly certified another's vote record as perfect, and the Assassin shot that seat |
| resolved failed quests | `recordLine` in `knowledgeText` | The deal-only closure left seats open that the record had already closed |

The second one is also the answer to a standing §8.4 problem. S7 has printed the quest arithmetic
("2 Fails, so at least 2 of these 4 are evil") since the start and it stayed inert: across every
observed game no bot used it to *eliminate* anything, and one closing model had all three players
on a quest it had watched fail reading good. So the elimination moved into `board.ts`
(`roleCertainties` now propagates each failed quest as a cardinality constraint, plus the cast's
fixed evil budget, to a fixpoint) and `knowledgeText` states the conclusion.

That does **not** relocate policy into the facts layer. What crossed is a *derivation*, not a
judgement: "Kimi is evil" is as checkable as the row it comes from, while "so keep him off the
team" is still policy and still lives in a guidance slot. The split it does force is a disclosure
one, which the line carries with it: a deduction resting on a quest the seat sat on is one the
table can follow, and a deduction resting on who the seat was shown at the deal is the leak the
rest of `knowledgeText` is gagged for.

`RoleCertainties.fromRecord` exists so the two stay distinguishable — it holds exactly the seats
the deal alone leaves open and the record closes, computed by running the same closure twice.
`test/certainties.test.ts` re-runs the never-wrong sweep over **played-out** boards for all 71
casts, with a floor on how often the new rules fire so the propagation cannot regress to a no-op
and still pass.

### 6.2 The placement rule

For any heuristic, choose the **widest slot whose scope exactly matches its applicability**:

1. Applies to **every role, every decision** → S1 (universal strategy). *S1 does not exist as a
   baseline slot today; see §6.5.* The one universal strategy line we currently ship rides at
   the end of S0 ("Watch the vote history — it is the main evidence").
2. Applies to **one whole alignment** → S2 (`GOOD_SHARED` / `EVIL_SHARED`). This is the home for the
   largest cluster of advice that was previously duplicated across role blobs.
3. Specific to **one role's private knowledge or win condition** → S3.
4. About a **specific decision moment, independent of role** (how to play a quest card, what
   hammer means for a vote, what the assassination shot requires) → S5 (the ASK for that kind).
   Kind-gating is a feature: the advice appears exactly when it is actionable and does not bloat
   the other six calls.
5. About **how to talk** → S4.
6. A **computed datum** → S7 (and its policy half to 1–5).

Corollaries:
- **Never place at a slot wider than the scope** (universal advice that is actually good-only
  mis-teaches evil bots) **or narrower** (alignment advice copied into N role blobs rots into
  holes — the bug that motivated this map).
- **Phase advice prefers S5 over S3.** "Lone evil fails quest 2 by default" is tempting to write
  into every evil role blob, but it is a property of the `quest` decision, not of being the
  Assassin. One S5 `quest` ASK branch (evil vs good) serves all evil roles and can't drift.
- **S8 mirrors S3's shape**, so anything we standardize in S3/S2 automatically gives custom
  agents a coherent `append`-mode baseline to build on (`roleGuidanceMode`).

### 6.3 Master map: heuristic → slot

Alignment-wide and universal heuristics (the S1/S2 cluster). "→ S2" means `ALIGNMENT_SHARED`.

| Heuristic (source §) | Correct slot | Rationale |
|---|---|---|
| A vote is public, permanent evidence; track the matrix (§1.2, §3.1) | S0 tail / S1 | Universal; already the one strategy line in S0. |
| Second-order check before any public act ("what does this reveal about me?") (§4.2) | S4 | Speech-scoped; already in `TABLE_TALK_NORMS`. Keep. |
| Speak with purpose; engage the newest concrete info (§4.1 failure mode) | S4 | Speech-scoped; already present. |
| Good: reject teams excluding you early unless validated; you are the one certain-good slot (§1.2) | **S2 good** | True for every good role, not just Servant. |
| Good: a succeeded quest is weak evidence — slow-play exists; never assume "1 fail = 1 evil" (§1.4) | **S2 good** | Deduction hygiene common to all good. |
| Good: everyone plays Merlin — act confident, make reads, generate cover traffic (§3.2) | **S2 good** | Currently half-stated in Servant and Percival blobs; it is a good-team meta. |
| Good: on/near hammer, approve rather than burn the last proposal; rejecting on hammer is near-proof evil (§1.2, §3.1) | **S5 `vote`** (good branch) + S2 good | It is a vote-moment rule; the ASK is where it bites. Dossier already surfaces hammer proximity (S7). |
| Evil: double-fail reveals two of you at once — fear it early (§1.3, §2.6) | **S2 evil** | The motivating bug. Belongs to all evil, not 3 of 5 blobs. |
| Evil: no private channel on a shared quest — read your partner's style; pre-agree a deterministic failer convention (§2.6) | **S2 evil** | Multi-evil coordination, alignment-wide. |
| Evil: mix rejections of dirty teams / approvals of clean teams into your vote record; never be the lone rejector of a clean team (§2.6, §3.1) | **S2 evil** | Vote-matrix discipline for every evil role. |
| Evil: bussing — sacrifice a burned teammate to launder your own credibility (§2.6, §3.4) | **S2 evil** | Team-level tactic, not role-specific. |
| Evil: allocate one teammate (Mordred if present) to deep cover; don't have both evils slow-play (§3.4) | **S2 evil** (+ S3 mordred) | The allocation is a team decision (S2); Mordred's default posture is role flavor (S3). |
| Evil: after a fail you were on, don't go quiet — push an alternative theory (§2.6, §4.1) | **S2 evil** | Applies to any evil caught on a failed quest. |

Phase heuristics (S5 ASK, role-independent or alignment-branched).

| Heuristic (source §) | Correct slot | Rationale |
|---|---|---|
| Fail decision table: pass 2-person Q1, often fail 3-person Q1; fail Q2/Q3 by default when lone evil; lone evil passes a 2-fail Q4; always fail for evil's 3rd point (§1.3, §1.4, §2.6, §5.4) | **S5 `quest`** (evil branch) | A property of the quest card decision; one branch serves all evil roles. Currently absent from the `quest` ASK entirely. |
| Good must play success (already enforced) | S5 `quest` + code | Present in ASK; hard rule in engine. |
| Propose yourself + best objective records; late-game prefer fail-count-validated players over talk-validated (§5.1) | **S5 `propose`** | Property of the proposal decision, shared by any leader. |
| Reflect: chain observations into standing deductions, revise disproven ones (§4.3, §5.0) | S5 `reflect` + S6 | Already well-developed in the `reflect` ASK/contract. Keep. |
| Assassin shot: compute per-good vote-accuracy; flat-high-from-round-1 = Merlin, noisy-then-accurate = Percival; weight teammates' input; break ties toward the quieter candidate (§2.3, §5.5) | **S5 `assassinate`** | The assassinate ASK is currently bare ("name Merlin"). This is the single highest-leverage phase (>50% of evil wins). |
| Vote can't silently contradict your public lean (consistency) | S5 `vote` | Already present as `leanNote`. Keep. |
| Pitch can't silently contradict table talk; acknowledge flips | S5 `pitch` / S6 | Already present. Keep. |

Role heuristics (S3 — genuinely private-knowledge or win-condition specific).

| Role | Keep in S3 | Move OUT of S3 (to noted slot) |
|---|---|---|
| **Merlin** | Knows evil (except Mordred); never state it; vote wrong sometimes; endorse others' reads over originating; Mordred-uncertainty; endgame decoy / take a public wrong position when pegged (§2.1, §5.2) | "act confident so you don't make Merlin stand out" logic is good-shared (S2). |
| **Percival** | Sees Merlin+Morgana ambiguously; distinguish by tracking each candidate's votes/proposals against realized outcomes (fails are the acid test — who endorsed the failed team is Morgana); never name/defend Merlin directly; be the decoy; claim Percival only late and only when quest math demands (§2.2, §5.3) | "act confident/knowledgeable" overlaps S2 good; keep only the Percival-specific decoy framing. |
| **Servant** | *(no private knowledge)* — Servant's whole blob is good-shared advice. | Nearly all of it → S2 good. S3 servant can shrink to a one-liner or empty. |
| **Assassin** | Win-con: the shot is yours; the *how* of the shot → S5 `assassinate`. | Double-fail + no-private-channel → S2 evil (already duplicated here). |
| **Morgana** | Counterfeit-Merlin: run the Merlin script to capture Percival; identify who mirrors you (§2.4, §5.6) | Double-fail (currently MISSING here) comes free from S2 evil. |
| **Mordred** | Hidden from Merlin; deep-cover posture; being trusted by suspected-Merlin is endgame evidence (§2.5) | Double-fail (currently MISSING) comes free from S2 evil. |
| **Oberon** | Unknown to/unaware of other evil; must infer teammates; his fail card signals his identity to teammates (§2.5) | Generic evil coordination → S2 evil; keep the *inversion* (he can't coordinate) as role flavor. |
| **Minion** | Support partners; role has little unique beyond generic evil. | Double-fail + no-private-channel + fail-timing → S2 evil / S5 `quest`. Minion blob can shrink. |

### 6.4 Gaps and duplication this map exposes

**Duplication (same advice maintained in multiple S3 blobs — collapse into S2/S5):**

- **Double-fail warning** in `assassin`, `oberon`, `minion`; **missing** from `morgana`,
  `mordred`. → S2 evil. (The bug that started this.)
- **"No private channel, read your partner's style"** in `assassin` + `minion` only. → S2 evil.
- **"Act confident / don't make Merlin stand out"** split across `servant` and `percival`. → S2
  good.

**Gaps (playbook §5 heuristics with no prompt presence):**

- **Evil fail decision table** — the `quest` ASK says only "play success or fail"; none of the
  Q1-pass/Q3-fail/always-fail-for-the-point logic reaches the bot at the quest moment. Highest-
  value gap after the assassination.
- **Assassination method** — the `assassinate` ASK is bare; the vote-accuracy / Merlin-vs-
  Percival trajectory logic (§5.5) is absent at the exact moment it matters most.
- **Servant baseline** — "reject teams excluding you unless validated," "succeeded quest is weak
  evidence," "never assume 1 fail = 1 evil" are in §5.1 but not in the `servant` blob (which is
  vaguer than the research).
- **Bussing, deep-cover allocation, post-fail behavior** — §2.6/§3.4 evil tactics with no slot.
- **Percival acid-test and claim-timing** — §5.3's sharpest tools (fails reveal Morgana; claim
  late or never) are thinner in the blob than in the research.
- **Good hammer discipline** — "approve rather than burn the last proposal" exists as a *fact*
  in S7 (hammer proximity) but never as *policy* in a guidance slot.

**Boundary notes (acceptable, but worth a comment):**

- S0's closing line ("Watch the vote history…") is the lone strategy sentence in the facts
  digest. Fine as a universal nudge; if S1 is created, move it there so S0 is purely rules.
- S6 discuss's "never reveal private knowledge" is strategy, but it is format-bound (about the
  `say` field). Correctly placed; do not generalize the pattern.

### 6.5 Prioritized edit list

> **Status: items 1–7 have all landed**, and the S2 fragment the **[T1]** items were waiting on now
> exists (`ALIGNMENT_SHARED`, §6.1). Item 8 remains open and is still conditional on an S1 slot,
> which does not exist. Kept as a record rather than a queue: it explains *why* each line sits where
> it does, which is the thing a reader needs when deciding where the next one goes.

Ordered by expected win-rate leverage. **Coordination (historical):** items tagged **[T1]** wrote
into the alignment-shared fragment that task #1 owned, so they had to wait for that slot to exist;
items tagged **[safe]** touched S5 ASKs, individual S3 blobs, or S7 and could land without
collision. Run `npm test` after any `prompts.ts` change, and note that prompt text has since
acquired a house style enforced by `test/talk-norms.test.ts` (no dashes, no antithesis slogans, in
any string the model sees — this doc is dev-facing, so dashes here are fine).

1. **[safe] Fill the `assassinate` ASK (S5)** with the §5.5 method: rank good players by vote-
   accuracy against the now-known truth; flat-high-from-round-1 reads as Merlin, noisy-then-
   accurate as Percival; weight teammates' input; tie-break toward the quieter candidate. Highest
   leverage (>50% of evil wins run through this shot) and fully independent of task #1.
2. **[safe] Add an evil branch to the `quest` ASK (S5)** encoding the fail decision table (§5.4):
   Q1 pass on 2-person / often fail on 3-person, fail Q2–Q3 by default when lone evil, lone evil
   passes a 2-fail Q4, always fail for evil's third point. Pair with the existing engine hard
   rule. Removes the need to teach fail-timing in five separate role blobs.
3. **[T1] Author the evil-shared fragment (S2 evil):** double-fail fear, no-private-channel +
   deterministic failer convention, vote-matrix discipline, bussing, deep-cover allocation, don't-
   go-quiet-after-a-fail. Then **delete** those lines from `assassin`/`oberon`/`minion` (and note
   they were never needed in `morgana`/`mordred`). This closes the motivating bug structurally.
4. **[T1] Author the good-shared fragment (S2 good):** reject-off-team-unless-validated, succeeded-
   quest-is-weak-evidence, never-assume-1-fail-1-evil, everyone-plays-Merlin cover, good hammer
   discipline. Then shrink the `servant` blob to (near) empty, since it was entirely good-shared.
5. **[safe] Sharpen `percival` (S3):** add the fail acid-test (whoever endorsed the failed team is
   Morgana) and claim-timing (late or never). Independent of task #1.
6. **[safe] Sharpen `merlin` (S3):** add explicit Mordred-uncertainty and the endgame-decoy /
   take-a-public-wrong-position line from §5.2. Independent.
7. **[safe] Enrich the `propose` ASK (S5)** with §5.1's "yourself + best objective records; late-
   game trust fail-count over talk."
8. **[safe, low] Move S0's vote-history line to S1** *if and only if* a universal strategy slot is
   introduced; otherwise leave it. Cosmetic; do last or skip.

Sequencing with task #1: land 1, 2, 5, 6, 7 (all **[safe]**) independently whenever; do 3 and 4
*after* task #1's fragment slot exists so there is a place to put them and the S3 deletions don't
race the fragment's creation.

---

## 7. Bindingness: forced plays vs. defaults

research-strategy.md §1–§5 say what good play looks like, and §6 above says *where* each line goes.
Neither says **how binding a line is**, and that gap has cost real games twice:

- An evil leader at good's match point proposed a team with no evil on it and then argued the table
  into approving it. The `propose` ASK said "you usually want exactly ONE evil on the team". The
  word *usually* read as permission to sit out the last team that would ever be picked.
- On the two-Fail quest with both known evil aboard — evil's winning team — both of them voted
  reject to protect cover. Nothing in the prompt said that vote threw the game away, because the
  guidance we had was about looking loyal, which is a default, not a rule.

Both are placement successes and force failures: the advice was in the right slot and had the wrong
strength. This section adds the missing axis.

### 7.1 The tiers

| Tier | Meaning | Wording | Can a good player break it? |
|---|---|---|---|
| **T0 Engine rule** | Enforced in code; violation is impossible | Stated in prompts for comprehension only | No |
| **T1 Forced play** | Deterministically correct given the public board **plus the deciding seat's own knowledge**. No read of the table, no cover judgement, no probability | Bare imperative ("Play fail.", "Put yourself on it.") | No — breaking it is a blunder, full stop |
| **T2 Default** | Correct most of the time, with a **named** exception | "by default", "usually", "lean" — and the exception in the same breath | Yes, and knowing when is the skill |
| **T3 Style** | Table-talk behaviour, persona, pacing | Descriptive | Not a correctness question |

T0 has exactly one member: **good cannot play Fail** (`applyDecision` in `server/engine/game.ts`,
commented "Rule, not honor system"). Everything else that feels absolute is T1 — enforced by
nothing, which is why it needs both the strongest wording and a measurement (§7.5).

### 7.2 The forced plays (T1 catalogue)

Every trigger below is computable from `PlayerView` plus the seat's own knowledge. **If a rule needs
omniscience to evaluate, it is not T1** — it is a read, and reads belong to the model.

| Forced play | Trigger (in view terms) | Why it is forced | Lives in |
|---|---|---|---|
| Fail the quest that would be good's third | on the team, `successes === 2`, known Fails aboard ≥ `failsRequired` | A success ends the quest phase; cover is worthless in a game you have lost | `quest` ASK, first branch |
| Fail the quest that would be evil's third | on the team, `fails === 2`, known Fails aboard ≥ `failsRequired` | It wins the game outright | `quest` ASK |
| Do **not** Fail below the requirement | on the team, known Fails aboard < `failsRequired` | The card cannot sink the quest and only advertises an evil. **Exception: Oberon**, whose extra card is how unseen teammates locate it | `quest` ASK, needs-two branch |
| Approve a team your side can sink | evil voter, known Fails aboard ≥ `failsRequired`, decisive board | Approval preserves the option; the card is a later, secret decision. Rejecting destroys it | `vote` ASK |
| Reject a team your side cannot fail | evil voter, `successes === 2`, known Fails aboard < `failsRequired` | Approving hands good the quest phase and leaves only the Assassin's guess | `vote` ASK |
| Be on the team you lead at good's match point | evil leader, `successes === 2` | It is the last team that will ever be picked | `propose` ASK |

"Known Fails aboard" is deliberately narrow: `knownEvilAboard` in `server/agents/board.ts` counts
the seat plus partners the deal lets it see. Oberon is invisible to the rest of evil, so a count
over the whole team would both leak the deal into the prompt and let a note claim a team is
evil-free while Oberon rides along. `matchPoint` (same file) and `failsRequired` (`rules.ts`) are
the other shared pieces — one definition each, so a rule and its detector can never drift apart.
`board.ts` exists because these triggers have three consumers, not one: `prompts.ts` writes them
into ASK branches for LLM seats, `heuristic.ts` branches on them directly, and `forced.ts`
re-derives them from the artifact to grade the result.

**All six are graded**, as `FORCED_PLAY_RULES` in `eval/forced.ts`, and `npm run sim` reports them
on every run without needing `--out`. Keep that mapping total: a forced play in this table with no
rule beside it reports clean forever, which is worse than not claiming it is forced. The propose
row was exactly that gap until it was closed, and closing it showed why the grader cannot follow
the table's wording literally — "be on the team you lead" would flag a leader who seated a
*visible partner* instead, which is a fine pick. What is forced is a Fail the leader can count on,
so the rule tests `knownEvilAboard >= failsRequired` like its siblings, and stands down entirely
when the leader's visible pool was too small to build a sinkable team at all.

### 7.3 Defaults, and what breaks them (T2)

| Default | Breaks when | Lives in |
|---|---|---|
| Good: reject teams you are not on | Near the hammer (a reject hands the next leader an unvoted team); before any quest has cleared anyone | `GOOD_SHARED` |
| Evil: exactly one evil per team | Quests needing two Fails; good's match point (a second evil is worth it to hold a Fail) | `propose` ASK |
| Evil: never be the lone rejector of a clean team | Good's match point — the tell is worth it when the alternative is losing now | `EVIL_SHARED` + `vote` ASK |
| Evil: slow-play to buy cover | Any decisive board (both match points) | `quest` ASK |
| Merlin: vote your read | Merlin must deliberately vote "wrong" sometimes. **The only heuristic whose violation IS the correct play** — a Merlin who never breaks it is the most conspicuous good player at the table | `merlin` blob |
| Percival: claim late or never | When the quest math needs one trusted team assembled now | `percival` blob |
| Q1 fail timing: pass a 2-person Q1, often fail a 3-person one | Probabilistic (human data: ~6% vs ~67% fail rates), never forced | `quest` ASK |

### 7.4 Implementation rules that follow

1. **T1 goes in a state-keyed ASK branch that is evaluated before any cover logic**, worded as a
   bare imperative. Precedent: the `quest` ASK computes both match-point checks first and returns
   immediately, specifically so they outrank the fail-timing table below them.
2. **T2 goes in alignment/role prose with its exception in the same sentence.** An unqualified
   default is the bug from the opening of this section.
3. **When a T2 default's exception is itself a T1 trigger, replace the default rather than stacking
   it.** The `propose` ASK swaps the whole "usually one evil" sentence out at match point; leaving
   both in would have preserved the escape hatch that caused the miss.
4. **Placement still follows §6.2** (widest slot whose scope matches). Tier governs *force* and
   *evaluation order*, not location.
5. **T1 beats every T2 it touches.** If a new note contradicts an existing default, that is the
   system working — say so in the note rather than hedging both.

### 7.5 Measure, never enforce

The forced tier is tempting to enforce in code. **Do not.** Playing the forced move on the bot's
behalf injects a decision it never reached — the same line the reverted "lowest seat on the team
fails" convention crossed (§6.5 note; the user called it cheating, correctly) — and it destroys the
signal we are trying to read. A bot that cannot find a forced play is telling us something about the
guidance or the model, and we want to hear it.

So T1 is **measured**: `server/eval/forced.ts` detects violations from a game artifact,
`computeMetrics` exposes them per seat (`forcedPlayViolations`) and in full (`forcedPlays`), and
`npm run report` prints a per-rule breakdown. This is ground truth like the vote scores, not an
opinion like the judge's incident families — which is why forced plays get their own detector
instead of leaning on the judge's `blunder` family, where they used to hide.

Two properties of the detector worth preserving:

- **It judges what the seat could know**, via `computeKnowledge` (the engine's single producer of
  night knowledge), so an unseen Oberon aboard can never make a teammate's reasonable play look like
  a blunder. The flip side is that a play can be scored as forced-and-followed and still fail for
  reasons the seat could not see. That is the correct accounting for decision quality.
- **It is silent on undecided boards.** Cover plays on Q1 are defaults, not violations.
- **No card rule fires on a quest that sank.** A Fail was not "wasted" if the quest failed, and no
  forced Fail was materially declined if the quest failed without this seat's card. Judging cards
  outcome-blind contradicted both the artifact and our own doctrine: it flagged the coverer in the
  two-evil split that `EVIL_SHARED` explicitly asks for (one Fails, one covers, because a double
  Fail sinks nothing extra and exposes both), and it flagged the partner whose Fail an unseen Oberon
  completed. Re-grading the original 40-game corpus with this guard dropped 101 violations to 83, so
  roughly a fifth of the first measurement was the detector being wrong.

The heuristic table runs clean (0 violations over 100 games each at 5p, 7p and 10p), so a non-zero
count points at the LLM seats rather than at the fallback. It did not start that way: the first run
found ~2 per game, almost all on Q4, which is what drove the board conditions into `heuristic.ts`
— the forever-fallback every degraded LLM seat lands on.

**When adding a T1 rule, add the prompt branch and the detector row together.** Guidance without a
detector is unmeasurable, and a detector without guidance measures nothing we chose.

---

## 8. Choosing the lever: computable, policy, structural, model

§6 asks *where* guidance goes and §7 asks *how binding* it is. Both presuppose the fix is guidance.
For a large class of failures it is not, and reaching for prose by reflex is how a prompt accretes
text that does not work — text that then competes for attention with the text that does.

This section is the triage step that runs before §6. It came out of the 2026-07-25 mid-tier
benchmark (8 games, 4 models, `npm run sim -- --tier mid`), where the same four levers kept
separating the failures cleanly.

### 8.1 The four levers

| Lever | Test: does it fit? | Home | Example from the benchmark |
|---|---|---|---|
| **Computable** | Could any player at the table derive it from the public record? Then the model should not be asked to derive it. | S7 `factsDossier` | "3 Fails on a 4-person team means at least 3 of those 4 are evil" — arithmetic every model skipped |
| **Policy** | Is it a judgement about what to DO, given facts already in hand? | S0–S5 (place by §6.2, tier by §7.1) | When to break the one-evil-per-team default |
| **Structural** | Is the failure shaped by the harness — turn order, round count, what a decision even offers? | engine / sim config / flow | Stall-loops at proposals 3–5, where the talk budget is a fixed `--talk 3,2` regardless of how many proposals have already been argued |
| **Model** | Does the rule already exist, in the right slot, at the right force, and the seat still misses it? | model choice; measure, do not re-word | Two-Fail miscoordination in one model while the rule-based fallback executes it correctly |

### 8.2 Ask in this order

1. **Computable?** Then compute it. A fact costs tokens once and is never wrong; guidance to perform
   the same derivation costs tokens every turn and is wrong whenever the model is lazy. This is the
   lever teams under-use, because writing a sentence feels cheaper than writing a function.
2. **Policy?** Then §6.2 for placement and §7.1 for force.
3. **Structural?** Then change the harness. Some failures are properties of the shape of the turn,
   and no wording survives contact with them.
4. **Model?** Then stop editing text. Record it and pick differently.

### 8.3 Telling them apart

Three diagnostics, each cheap:

- **The cross-model test.** Run the same prompt across several models. A failure in *every* model is
  a prompt or facts gap; a failure in *one* while others comply is a model limit. The benchmark
  separated these sharply: "a success clears its team" appeared in all four models (prompt), while
  the two-Fail miscoordination appeared in exactly one (model).
- **The fallback control.** `heuristic.ts` plays from the same board with no prose at all. If the
  rule-based agent gets it right, the *rule* is expressible and present — what failed is execution,
  not instruction. Master measured this directly for the two-Fail quest: the fallback went from
  sinking 1 of 32 such quests to 14 of 32 once the board condition was added to the code, which is
  what proved the remaining LLM misses were not a missing rule.
- **The point-of-use test.** Before writing a *new* line, check whether the guidance already exists
  somewhere the model is not reading. Both benchmark prompt-failures were already covered: the rules
  digest says evil may play Success, and `GOOD_SHARED` says a success is weak evidence. Stated once
  in a 1,200-word preamble, both lost to the vivid quest board. Restating a fact **on the row the bot
  is reasoning over** is a different intervention from saying it again in the preamble, and usually
  the right one. Prompt real estate is not uniform.

### 8.4 The facts/policy boundary

The most useful lever is also the easiest to abuse, because a fact that is *nearly* advice feels
more helpful than one that is not. Hold the line at the sentence:

- **Fact:** "Q4 FAILED with 3 Fails on a 4-person team, so at least 3 of these 4 are evil."
- **Policy:** "…so do not put them on the next team."

The first is an observation any seat can compute and belongs in S7. The second is a judgement, it
belongs in a guidance slot, and putting it in S7 would quietly make the facts layer a second prompt
that custom agents cannot override — defeating the reason S7 carries zero imperatives (§6.1).
`test/facts.test.ts` guards this boundary directly for the quest-evidence section, which sits one
short step from crossing it.

### 8.5 What a new fact costs

Facts are not free, and the benchmark is also the evidence for that:

- **Instruction budget is finite and compliance is model-dependent.** Under one identical prompt,
  two of four models followed the table-talk rules exactly while the other two ignored specific ones
  (~20 spoken lean announcements in a single Seed game against zero in every Gemini Flash Lite and
  GPT Nano game). Every added fact competes for the same attention as the rules that currently work.
- **So measure the delta, not the intention.** Add the fact, then A/B it on fixed seeds with only
  that section changed — `AVALON_NO_DOSSIER=1` toggles the whole dossier and is therefore the wrong
  instrument for a single section; use a same-seed run against the previous commit instead.
- **Prefer one row over one section.** The dossier grows by accretion, and its FORMAT CONVENTIONS
  (`facts.ts` header) exist because a pile of sections stops being a single-lookup record.
