# Prompt-Format Research: how to encode structured context for the bots

Scope: how AvaLLM should encode the *structured context* it feeds LLM bots — chiefly
the **facts dossier** (`server/agents/raw-llm/facts.ts`, prompt slot **S7**), but the same
reasoning applies to any computed data we put in a prompt (game state, vote records,
per-player summaries). This is about the *encoding* of data the model reads, not the
schema of what the model writes back (that is the JSON-out side; see §5).

The one-line answer: **markdown-ish labeled rows, one row per entity — never JSON.**
The rest of this doc is why, so the choice survives the next person who wonders
"wouldn't JSON be cleaner?".

---

## 1. TL;DR — the decision

- **Encode input context as compact markdown-style text, not JSON/YAML/XML.**
  "Markdown in, JSON out" is the production consensus: prose/markdown for what the
  model *reads*, JSON only for what it *writes* (and must be machine-parsed).
- **One row per entity; every fact about that entity on its row.** A fact must be a
  single lookup, never stitched across sections.
- **Labeled `key: value` cells, pipe-separated**, because our fields are
  variable-length lists that a fixed-column table can't hold without going ragged.
- **The gains that are real** are token efficiency, avoiding JSON's "schema-extraction
  mode", and a lookup-shaped layout. **Raw per-token accuracy differences between
  formats are usually small and model-dependent** — so we choose on cost, reasoning
  mode, and lookup ergonomics, not on a mythical "format X is 20% smarter" law.

The worked example that motivated all this is the **P2 fix** (§4).

---

## 2. What the research says

### 2.1 Aggregate accuracy is often format-insensitive — but not always

On several benchmarks, swapping the input format (JSON / YAML / Markdown / TOON)
leaves *aggregate* task accuracy roughly flat, with per-model swings in the
±3–8% range rather than a universal winner. So "just use JSON, models are fine with
it" is defensible on accuracy alone. The case against JSON is built on the *other*
axes below, plus our specific constraints (§3).

Where format *does* move accuracy, it tends to favor structured-but-natural encodings:
one nested-data study found **YAML ~17.7 points over XML**; table-comprehension work
found **markdown key-value ~20 points over CSV** — attributed to "structural priming",
i.e. the layout tells the model how to read the data, not just what it is.

### 2.2 Token efficiency clearly favors markdown / compact text

This one is robust and directional across studies:

- **Markdown is ~34–38% fewer tokens than equivalent JSON**, and ~10% fewer than YAML.
- JSON-LD / RDF-Turtle style encodings are dramatically heavier (multi-thousand-token
  prompts for the same facts).
- Tables and key-value rows are among the most compact encodings, letting more
  factual context fit per window at lower cost.

For a game where the dossier is rebuilt and re-sent on *every* decision, per-token
cost compounds fast — this is a first-order concern, not a rounding error.

### 2.3 JSON input changes the model's *reasoning mode*

The most decision-relevant finding: feeding a model JSON-encoded context nudges it
into **"schema-extraction mode"** — it treats the blob as fields to read out, which
*suppresses* the flexible inference/synthesis LLMs are otherwise good at. For a
hidden-role deduction game, inference is the entire job, so an encoding that dampens
it is actively harmful. Prose/markdown keeps the model in "read and reason" mode.

### 2.4 Structure beats prose for uniform records

Conversely, unstructured prose is worse than *some* structure: tabular / key-value
layouts improve factual lookup and comprehension over free text for record-like data.
So the target is the middle of the spectrum: **structured, but text — not JSON, not
prose.** Labeled rows land exactly there.

---

## 3. Why *our* choice, given our constraints

The generic guidance ("markdown for docs, JSON for records the model reasons over")
has a genuine tension: our dossier *is* records. Four project-specific constraints
break the tie toward labeled markdown rows:

1. **The consumer is the model's attention, not a parser.** Nothing downstream parses
   the dossier — the bot reads it and reasons. So machine-round-trippability (JSON's
   main advantage) buys us nothing, while its costs (§2.2, §2.3) are paid in full.
2. **JSON-in would collide with JSON-out.** Our `OUTPUT_CONTRACTS` require the bot to
   *reply* in strict JSON. Putting large JSON blobs in the *input* muddies the
   in/out boundary and invites format bleed. Keeping input as markdown makes the two
   channels visually distinct.
3. **Variable-length fields kill the table option.** A player's `voted` / `on-team`
   fields are lists whose length grows with the game. A fixed-column markdown table
   would go ragged (empty cells, or a cell holding a comma-list anyway). Labeled
   `key: value` rows carry variable-length values natively — the benchmarked
   "markdown-KV" shape (§2.1), which also topped the table-comprehension results.
4. **We need single-entity lookup.** The failure that started this (§4) was the model
   answering "how did Flash vote?" by confabulation because the fact was smeared
   across sections. One row per entity makes it a lookup. This is a layout property,
   independent of JSON-vs-markdown, and we bake it in either way.

---

## 4. The worked example (P2)

The concrete change this research backs: the facts dossier used to scatter one
player's facts across `Quest exposure:`, `Never on a quest:`, and `Vote/lead signals:`
sections, and it exposed *membership* ("Flash on Q3 FAIL") but not the per-player
*vote*. In a real playtest, the whole table then confabulated that Merlin had "voted
YES" on a team it actually voted **reject** on — and gaslit the real Merlin into
disowning its own correct vote. (Full incident: memory `avalon-llm-playtest-2`.)

The fix consolidated everything into **one labeled row per player**, with membership
and vote as *distinct* fields:

```
Before (facts smeared across three sections; the vote itself absent):
  Quest exposure:
    Gemini Flash(seat 2): on Q1(ok), Q2(ok), Q3(FAIL)
  Vote/lead signals (approved teams only):
    Kimi(seat 3): led 1 failed quest

After (one row per player; membership ≠ vote, both present):
  Gemini Flash(seat 2) | on-team: Q1(ok), Q2(ok), Q3(FAIL) | voted: Q1 approve→ok, Q2 approve→ok, Q3 reject→FAIL
  Kimi(seat 3) | on-team: Q2(ok), Q3(FAIL) | voted: Q1 approve→ok, Q2 approve→ok, Q3 approve→FAIL | signals: led 1 failed quest
```

`Gemini Flash … Q3 reject→FAIL` is now a one-hop lookup, and the row also surfaces
that Kimi *approved* the team that failed — evidence the old aggregate format hid.

---

## 5. The conventions (authoritative copy in code)

The rules a new fact must follow live in the header of `server/agents/raw-llm/facts.ts`
(kept next to the code so they can't drift from it). In brief:

1. **Not JSON/YAML/XML** — markdown-in, JSON-out (§2.3, §3.2).
2. **One row per entity**, all its facts on its row (§3.4).
3. **Row shape** `<row-key> | <field>: <value> | <field>: <value> …`; omit empty
   fields entirely.
4. **Distinct facts stay distinct labeled fields**, even when correlated (the P2
   membership-vs-vote split).
5. **Lead each section with a one-line legend** so compact tokens like `Q3 reject→FAIL`
   are self-describing in context.
6. **Compact, stable vocabulary** — `ok`/`FAIL`, `Q<n>`, `name(seat N)`; don't invent
   a second spelling for a thing already named.

Design-doc context: this is prompt slot **S7** in `design-bot-guidance.md` §6.1, and the
facts-vs-policy boundary is `design-evaluation.md` §1.2.

---

## 6. Where this applies (dossier vs knowledgeText vs prose)

The conventions in §5 are written around the facts dossier, but they are really about
*computed, record-like data* — multiple entities each carrying one or more fields —
**wherever it appears in a prompt**, not just slot S7. Two other slots touch this:

- **`knowledgeText` (private knowledge, system message).** Mostly single prose facts
  ("you see X, Y as evil"; "no special knowledge") — those are **correctly left as
  prose**. The research favors structure for *tabular* data, so do not tableify a
  one-liner. But where a line carries record-like data — the Percival branch listing
  each Merlin/Morgana candidate with its quest record — the principles **do** apply,
  and it follows them: co-located (record next to its candidate, a single side-by-side
  read) and using the **same `Q<n>(FAIL/ok)` vocabulary as the dossier**, so the bot
  reads one notation across both slots, not two dialects. At two entities it stays
  inline in a sentence; newline rows only earn their cost at many rows.
- **`publicStateText` (raw public state).** Pre-dates these conventions and renders the
  vote matrix *per proposal* (columns = players) — the very axis the dossier transposes
  in P2. That is deliberate (raw record vs. derived, per-player view), not a bug to
  reconcile; but if it is ever reworked, keep the shared vocabulary.

**The one rule that crosses every slot: one vocabulary.** `Q3(FAIL)`, `ok`, `name(seat N)`
must read identically in the dossier, `knowledgeText`, and anywhere else, so the model
never has to learn the same fact in two spellings. New computed context: match the
existing tokens before inventing any.

## Sources

- [Notation Matters: Token-Optimized Formats in Agentic AI Systems (arXiv)](https://arxiv.org/pdf/2605.29676)
- [Which Table Format Do LLMs Understand Best? (11 formats)](https://www.improvingagents.com/blog/best-input-data-format-for-llms/)
- [Which Nested Data Format Do LLMs Understand Best? JSON vs YAML vs XML vs Markdown](https://www.improvingagents.com/blog/best-nested-data-format/)
- [Better Think with Tables: Tabular Structures Enhance LLM Comprehension (arXiv)](https://arxiv.org/html/2412.17189v4)
- [The Context Format Decision: JSON vs Markdown vs Plain Text](https://tianpan.co/blog/2026-05-07-context-format-decision-agent-reasoning-json-markdown-plain-text)
- [JSON vs Markdown vs XML in LLM Prompts (JSONKit)](https://jsonkit.in/blog/json-vs-markdown-llm-prompts)
- [Enhancing structured data generation with GPT-4o: prompt efficiency across styles (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11979239/)
