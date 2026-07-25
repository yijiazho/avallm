# Onboarding a model

How a new OpenRouter model earns (or loses) a seat on the roster. The premise of
AvaLLM is that the bots *are* models, each openly badged — so which models sit at
the table is a product decision, not a config detail. This doc is the process for
making that decision defensibly, plus the living record of decisions already made.

The reasoning-suppression method in § 1 and the measured values in
[`server/llm/reasoning-policy.ts`](../server/llm/reasoning-policy.ts) are captured
here so onboarding is fully reproducible from this repo alone.

## The roster contract — the four gates

A seat must clear all four, checked in this order (cheapest to fail comes first, so
you stop early on a dud):

1. **Reasoning-suppressible** — the model's hidden reasoning can be turned off, or
   it's cheap enough that reasoning freely doesn't matter. Reasoning tokens count
   against `max_tokens` and against the bill; an uncontrollable reasoner blows small
   budgets and returns empty content (§ 1).
2. **Cost** — completion price × how many tokens it actually spends lands in a tier
   we're willing to pay on a hobby budget (§ 2).
3. **Structured-output reliability** — it honors `response_format: json_object`,
   rarely blanks, and degrades to the heuristic seldom enough to not drag the table
   (§ 3).
4. **Behavioral soundness** — it plays a non-broken game: doesn't compulsively
   reject, flip-flop, over-disclose as Merlin, or confabulate the vote record (§ 4).

Plus a standing requirement: **provider stability** — if the model's unconstrained
OpenRouter rotation leaks reasoning or parse-fails across quant/provider arms, it
needs a `provider-policy.ts` pin, or it's not a fit (§ 5, step 5).

Everything a seat touches is a small checked-in table, so "add a model" is a bounded
set of edits (§ 6) that the contract tests in
[`test/llm-policies.test.ts`](../test/llm-policies.test.ts) partly enforce.

## Step 0 — Find candidates

Browse [openrouter.ai/models](https://openrouter.ai/models). For each candidate note:
the exact **slug** (`vendor/model-name`), **$/M prompt and completion**, **context
window**, and **whether it's a reasoning model** (has a "reasoning" / thinking mode).
Favor family diversity — the table is more interesting when six vendors are
represented than when three are (see `DEFAULT_TABLE` in
[`server/llm/roster.ts`](../server/llm/roster.ts)).

## Step 1 — Reasoning-suppression probe (the plumbing gate)

**Reasoning suppression is per-model — measure `reasoning_tokens`, never trust the
flag name.** The traps already recorded in `reasoning-policy.ts` show why:

- **deepseek**: `effort:'low'` maps *up* to high — you have to send `effort:'none'`.
- **kimi (moonshot)**: burns ~3k reasoning tokens/turn unless `effort:'none'`.
- **gemini flash**: reasons *only if* a reasoning opt is present — suppress by
  sending **nothing** (`suppress: null`).
- **gpt-oss (openai reasoning)**: needs `effort:'low'` or it emits empty content —
  and even then suppression is leaky (this is why it was benched; see the record).
- **gemini pro**: reasoning is **mandatory** — disable flags return HTTP 400, and
  `low`/`minimal` still burn. `canSuppress: false`; not a fit for tight budgets.

Run the probe against the raw slug (spends a few cents; needs `OPENROUTER_API_KEY`):

```bash
node server/eval/reasoning-probe.ts --model <vendor/slug> --samples 5
```

It sweeps `{none-sent, effort:none, effort:minimal, effort:low, enabled:false}` and
prints, per variant, the mean `reasoning_tokens/call`, blank rate, and `$/call`, then
recommends the entry to add. Read the recommendation, but read the table too:

- A variant with **rt ≈ 0 and 0 blanks** is a clean suppression. The simplest clean
  one wins — sending nothing (`suppress: null`) beats sending a flag.
- Every disable flag **erroring** → reasoning is mandatory (`canSuppress: false`).
- Clean nowhere (leaks or blanks on every variant) → needs a bigger `max_tokens`, or
  it's out.

The winner maps 1:1 to a `POLICIES` row in `reasoning-policy.ts` (`suppress: null`
or `suppress: { effort: '…' }`). The probe's logic lives in
[`server/eval/reasoning-probe.ts`](../server/eval/reasoning-probe.ts); its decision
rules are pinned offline by [`test/reasoning-probe.test.ts`](../test/reasoning-probe.test.ts).

## Step 2 — Cost

The tier label (`cheap | mid | premium`) is a *rate-card* judgment; the real number
is **measured**. Reasoning tokens are the usual surprise: they count against
`max_tokens` and bill at the completion rate, so a model that "looks cheap" but
reasons 500 tokens/turn is not. This is why Step 1 comes first — a suppressible model
is a predictable bill.

- Rate card → provisional tier. Haiku was benched purely on cost (~10× every other
  seat); GPT-OSS was the *cheapest* seat yet still not worth it once reliability was
  priced in.
- Measured cost comes from a real headless game — see Step 3, which prints per-model
  `$` and reasoning-leak counts.
- One call is deliberately budget-generous: `assassinate` at 2000 tokens (fires once
  a game, > 50% of evil wins run through it — see the note in
  [`server/llm/call-params.ts`](../server/llm/call-params.ts)). A new model doesn't
  usually need a budget change, but if Step 1 shows it can't stop reasoning, that
  note is where the headroom would go.

## Step 3 — Structured-output reliability

Every live call passes `response_format: json_object` (see `call-params.ts`). The
OpenRouter chokepoint ([`server/llm/openrouter.ts`](../server/llm/openrouter.ts))
retries a **blank-under-json** reply once with `response_format` dropped, then the
agent layer degrades to the heuristic on any invalid output — so a flaky model never
stalls the game, it just quietly plays worse and costs a wasted call each time.

Provisionally add the candidate to the roster (Step 6 — the sim can only seat a
roster id) and run a headless LLM game:

```bash
npm run sim -- --agents llm --players 7 --talk 1,1
```

The tail prints per-model spend and **reasoning leaks**; the run also tallies
**degraded decisions**. Watch for: frequent blanks (wasted paid calls), a high
degrade count (the model isn't really playing), or reasoning-leak calls (Step 1's
suppression isn't holding in practice).

## Step 4 — Behavioral soundness

Mechanics can pass while play is broken. Read a full transcript and run the virtual-
assassin probe on saved games:

```bash
npm run sim -- --agents llm --players 7 --talk 2,1 --out playtest-logs/candidate.jsonl
node server/eval/probe.ts playtest-logs/candidate.jsonl
```

Known failure shapes worth grading against (each has bitten a real seat):

- **Compulsive rejection** — a good player that reflexively rejects teams reads as
  "the clearest evil tell" (a GPT-OSS Servant did this).
- **Flip-flopping** — approve → reject → approve on one team torches its own cover
  (GPT-OSS as Morgana).
- **Merlin over-disclosure** — naming evil too precisely gets Merlin assassinated.
- **Vote-record confabulation** — inventing who voted how in table talk.

The `probe.ts` Merlin-detectability rate is the closest thing to a behavioral score:
a good table hides Merlin near chance; a leaky seat spikes it.

## Step 5 — Provider stability

Most models need no `provider-policy.ts` entry. Add one only when the measured
evidence says the unconstrained rotation misbehaves — e.g. glm-5.2's pin exists
because its open rotation leaked reasoning across mixed-quant endpoints. An unmeasured
pin is just a silent routing experiment; leave it off until a run proves it's needed.
`test/llm-policies.test.ts` documents the one pin that exists.

## Step 6 — Wire it in (checklist)

Every edit for a new seat, and the test that guards it:

- **`server/llm/roster.ts`** — add a `ROSTER` entry: `id`, `displayName`, `slug`,
  `badge.color`, `tier`. Add to `DEFAULT_TABLE` only if it should be in the default
  6-bot game (and keep the seat count / family spread deliberate).
- **`server/llm/reasoning-policy.ts`** — add or confirm a `POLICIES` family that
  matches the slug, with the `suppress` value from Step 1. **Required:**
  `test/llm-policies.test.ts` asserts every roster slug resolves to a *known* family
  with `canSuppress`, so a missing/`unknown` family reddens the suite immediately.
- **`server/llm/provider-policy.ts`** — only if Step 5 found a real problem.
- **`client/src/components/Arcana.tsx`** — add the badge glyph keyed by roster id
  (the client's model badge). No glyph → the badge falls back, but add one for polish.
- **`server/llm/call-params.ts`** — usually untouched; bump a budget only if Step 1/3
  showed the model needs headroom, and leave a note like the existing ones.
- **Tests / screenshots** — run `npm test`. Regenerate the screenshot gallery only if
  the client roster UI visibly changed (see the CLAUDE.md screenshot section).

## Retiring a model

Retire with the **comment-out pattern**, not deletion, so restoring is a one-line
uncomment and the wiring stays intact:

- Comment out the `ROSTER` entry in `roster.ts` (with a note on *why* — cost or
  reliability). Leave its `reasoning-policy.ts` family and `Arcana.tsx` glyph wired.
- **Repoint anything that named it as a default** — `rosterById` throws on a
  commented-out id, so a stale default is a runtime crash, not a silent skip. When
  GPT-OSS went, `DEFAULT_TABLE` and `probe.ts`'s default model both had to move.
- Record the retirement in the table below.

Two worked examples in git history: Haiku (`455f748`, benched on cost) and GPT-OSS
(`bbea320`, benched on reliability).

## Living record

Update this whenever a model is seated, benched, or rejected. Reasoning control is the
`suppress` value from `reasoning-policy.ts`; tier is the rate-card label in `roster.ts`.
Prices move — treat the tier as the durable fact and check OpenRouter for live rates.

Tiers were recalibrated 2026-07 onto a **blended** number rather than a raw rate card.
This game spends roughly 2800 prompt tokens against 100 completion tokens per call
(solved from two measured games, confirmed within 1% on three more), so prompt price
dominates the bill about 27:1. Tier by `2800·prompt + 100·completion` in µ$/call:
cheap < 500, mid < 1200, premium above. That is why Kimi (1881) reads premium while
Qwen (1024) reads mid despite similar-looking cards — and why DeepSeek Pro, whose
completion rate is only 2× its prompt rate, still lands premium on prompt price alone.

Measured cost is quoted **per call**, not per game: game length varies wildly with how
many proposals get rejected (120 to 369 calls across the 2026-07 batch, same 7p setup),
so per-game totals compare game luck as much as they compare models. The 2026-07 batch
was also played 8-way concurrently on one machine, so **wall-clock timings from that run
are not a latency signal** and none are quoted here.

| Model | Slug | Status | Reasoning control | Tier | Notes |
|---|---|---|---|---|---|
| DeepSeek Flash (`deepseek-flash`) | `deepseek/deepseek-v4-flash` | **seated** (default) | `effort:'none'` (`'low'` maps up) | cheap | `DEFAULT_MODEL`; also the assassin-probe default. Renamed from `deepseek` 2026-07: ids name the specific model, since a family can seat siblings. |
| Gemini Flash Lite (`gemini-flash-lite`) | `google/gemini-3.1-flash-lite` | **seated** (default) | send nothing (`null`) | mid | Reasons only if asked. Renamed from `gemini` 2026-07 (same reason). |
| Gemini Flash (`gemini-flash`) | `google/gemini-3-flash-preview` | **seated** (pickable) | send nothing (`null`) | premium | Briefly held GPT-OSS's default seat; handed it to Nemotron to restore family diversity. Still selectable. No non-preview `gemini-3-flash` was ever published — Google went straight to 3.5/3.6 Flash at ~3× the price, so the preview slug stands until we decide to pay up. |
| Seed | `bytedance-seed/seed-2.0-lite` | **seated** (default) | `effort:'none'` | mid | Took Haiku's seat. |
| Kimi | `moonshotai/kimi-k2.5` | **seated** (default) | `effort:'none'` | premium | Burns ~3k reasoning tok/turn without it. |
| GLM | `z-ai/glm-4.6` | **seated** (default) | `effort:'none'` | premium | glm-*5.2* would need a provider pin; 4.6 does not. |
| Nemotron | `nvidia/nemotron-3-super-120b-a12b` | **seated** (default) | `effort:'none'` (probed; `'low'`/`'minimal'` do NOT suppress) | cheap | First model onboarded via this playbook (2026-07). New NVIDIA family. `:free` slug is rate-limited (429s) so the **paid** slug is used ($0.085/$0.40 per M). Behavioral playtest (7p, good won): 0 degrades, 0 reasoning leaks, balanced 6/6 approve/reject leans (no compulsive-reject), cheapest seat at ~$0.012/game. The context-free smoke's reject-4/4 did not recur once it had table information. |
| Qwen (`qwen`) | `qwen/qwen3.7-plus` | **seated** | `effort:'none'` | mid | 2026-07 batch. New Alibaba family, the biggest name the roster was missing. **Loudest default measured**: 1256 rt/call unsuppressed, so the existing `qwen` policy row is doing real work here. Playtest mechanically perfect (369 calls, 0 degrades, 0 leaks) but pricey: **$0.00155/call, ~3.7× the cheap seats**. Pickable, deliberately outside default-seating reach. |
| Mistral (`mistral`) | `mistralai/mistral-small-2603` | **seated** | send nothing (`null`) | cheap | 2026-07 batch. Mistral Small 4; clean by default. Playtest: 302 calls, $0.146/game, 0 leaks, **1 degrade — `finalize` returned a 3-man team where the rules demand 4, twice.** Watch that shape; a model that miscounts team size will do it again. |
| MiniMax (`minimax`) | `minimax/minimax-m3` | **benched** (reliability) | `effort:'none'` (clean in probe, **leaks in play** — unproven) | mid | 2026-07 batch, benched after one playtest. The only model so far to pass the suppression probe and then fail in play: rt 0 across 5 probe samples, then **3 reasoning leaks in 191 calls** of a real game — the Step 1 → Step 3 gap this playbook warns about. Also **2 degrades** (`propose` returned an out-of-range seat; `finalize` broke the stick/team contract) and, partly from paying for reasoning nobody asked for, 2-4× the cost of the other new seats. Commented in `roster.ts`; one-line restore, policy row and Arcana glyph still wired. **Re-probe with more samples before restoring — 5 did not catch this.** |
| Hunyuan (`hunyuan`) | `tencent/hy3` | **seated** | `effort:'none'` | cheap | 2026-07 batch. New Tencent family. **Blanks 5/5 unsuppressed** — without its policy row it reads as a broken model, not a chatty one. Playtest: 122 calls, $0.052/game, 0 degrades, 0 leaks. |
| MiMo (`mimo`) | `xiaomi/mimo-v2.5` | **seated** | `effort:'none'` | cheap | 2026-07 batch. New Xiaomi family. Also **blanks 5/5 unsuppressed**. Playtest: 171 calls, $0.072/game, 0 leaks, 1 degrade (`discuss` returned unparseable JSON twice). |
| Solar (`solar`) | `upstage/solar-pro-3` | **seated** | send nothing (`null`) | cheap | 2026-07 batch. New Upstage family; the only candidate clean on *every* probe variant. Playtest: 126 calls, $0.059/game, 0 degrades, 0 leaks — but its Merlin ran past the `discuss` budget and was cut mid-word while arguing about its own seat in the third person. Verbose, not broken. |
| GPT Nano (`gpt-nano`) | `openai/gpt-5.4-nano` | **seated** | send nothing (`null`) | mid | 2026-07 batch. Restores an OpenAI seat after GPT-OSS was benched. **The general `openai-gpt5` policy row is wrong for it** — `effort:'minimal'` leaks ~33 rt/call, `'low'` ~41, sending nothing leaks 0 — hence the narrower `openai-gpt5-nano` row ahead of it. Playtest: 120 calls, $0.091/game, 0 degrades, 0 leaks. |
| DeepSeek Pro (`deepseek-pro`) | `deepseek/deepseek-v4-pro` | **seated** | `effort:'none'` (existing `deepseek` row) | premium | 2026-07 batch. Doubles the DeepSeek family deliberately: the smart sibling of the default seat. Mechanically perfect (357 calls, 0 degrades, 0 leaks) and **the most expensive seat measured: $0.00278/call, 6.6× Hunyuan, $0.99 for one 7p game.** The rate card ($0.435/$0.87) reads mid, but this game feeds long transcripts into a 1M-context model, and prompt tokens dominate — the rate card understates it. Pickable, deliberately outside default-seating reach. |
| Haiku | `anthropic/claude-haiku-4.5` | **benched** (cost) | send nothing (`null`) | premium | ~10× the next seat. Commented in `roster.ts`; one-line restore. `455f748`. |
| GPT-OSS | `openai/gpt-oss-120b` | **benched** (reliability) | `effort:'low'` (leaky) | cheap | Cheapest seat but suppression didn't hold, blanked under json, erratic voting read as a false evil tell. `bbea320`. |
| Gemini Pro | `google/gemini-3.1-pro-preview` | **rejected** | mandatory (`canSuppress:false`) | premium | Reasoning can't be disabled (400 on disable); blows small budgets. |
