// The facts dossier (design-evaluation.md §1.2, the engine-owned "facts layer").
//
// LLMs are mediocre at deduction over a raw transcript and worse at ACTING on
// their own deductions (the deduction-action gap — AvalonBench §4, research-
// strategy.md §4.5). The fix the literature converged on is to COMPUTE the
// signals deterministically and hand them to the model as neutral facts. The
// heuristic agent already reasons over exactly these signals (heuristic.ts
// `suspicion`); this exposes the same computed record to the LLM bots, which
// were previously denied it.
//
// Rules that keep this a FACTS layer, not a policy layer (design doc §1.2):
//   - Derived ONLY from PlayerView, and ONLY from PUBLIC record (quest results,
//     the vote matrix) — every fact here is one any player at the table can
//     compute, so nothing leaks hidden information. Private knowledge stays in
//     knowledgeText.
//   - Presented as DATA, zero imperatives. What to DO about a fact is the
//     agent's policy, never stated here — so a custom agent competes on
//     strategy, not on bookkeeping ability.
//
// FORMAT CONVENTIONS (read before adding a fact — the dossier grows by accretion,
// so a shared shape is what keeps it parseable; rationale + sources in
// docs/research-prompt-formats.md). The consumer is the model's attention, not a
// parser, so we optimise for cheap, unambiguous LOOKUP, not machine round-tripping:
//   1. NOT JSON / YAML / XML. Feeding the model a JSON blob in the prompt pushes
//      it into "schema-extraction mode", which measurably suppresses the flexible
//      inference this deduction game runs on; JSON is also the least token-dense
//      format (~35% heavier than the markdown-ish text here) and would blur into
//      our JSON *output* contracts. The industry rule of thumb is "markdown in,
//      JSON out" — our OUTPUT_CONTRACTS are the JSON-out half; this is markdown-in.
//   2. ONE ROW PER ENTITY, all of that entity's facts on its row. A fact about a
//      player must be a single lookup ("find Kimi's row"), never stitched across
//      sections — scattering is exactly what made the vote record un-followable.
//      Rows beat a markdown TABLE here because our fields are variable-length lists
//      (a fixed column grid would go ragged); labeled key:value rows are the
//      benchmarked sweet spot ("markdown-KV") for this shape.
//   3. Row shape: `<row-key> | <field>: <value> | <field>: <value> …`. The entity
//      id is the first cell; every other cell is `label: value`; cells are
//      pipe-separated. Omit an empty field entirely — never render a blank one.
//   4. Keep DISTINCT facts as DISTINCT labeled fields, even when correlated. The
//      whole P2 fix was splitting "on-team" (membership) from "voted" (the vote),
//      because the model silently fuses them otherwise.
//   5. Lead every section with a one-line legend defining its fields/symbols, so a
//      compact token like `Q3 reject→FAIL` is self-describing in-context.
//   6. Compact, stable vocabulary: `ok`/`FAIL` for quest results, `Q<n>` for
//      quests, `name(seat N)` for players. Reuse the existing tokens; don't invent
//      a second spelling for a thing already named.

import { MAX_PROPOSALS } from '../engine/rules.ts'
import type { PlayerView, Seat } from '../engine/types.ts'

const nameOf = (view: PlayerView, s: Seat) => `${view.players[s].name}(seat ${s})`

interface PlayerRecord {
  onQuests: { num: number; failed: boolean }[]
  // Per-PLAYED-quest vote: how this seat voted on each proposal that was approved
  // and actually played, keyed by the quest it produced. This is the per-player
  // (row = player) transpose of the per-proposal vote matrix — the lookup that
  // stops "how did Flash vote on Q3?" from being answered by confabulation.
  playedVotes: { questNum: number; vote: 'approve' | 'reject'; failed: boolean }[]
  ledFailed: number         // led a quest (approved) that failed
  approvedFailedOff: number // approved a team it was NOT on, which then failed
  rejectedSucceeded: number // voted reject on a team that was approved anyway and succeeded
}

function computeRecords(view: PlayerView): Map<Seat, PlayerRecord> {
  const rec = new Map<Seat, PlayerRecord>()
  for (const p of view.players) {
    rec.set(p.seat, { onQuests: [], playedVotes: [], ledFailed: 0, approvedFailedOff: 0, rejectedSucceeded: 0 })
  }

  // Quest membership from the ACTUAL played team (quest.team is the approved
  // proposal's team). Resolved quests only.
  for (const q of view.quests) {
    if (q.result === undefined || !q.team) continue
    const failed = q.result === 'fail'
    for (const s of q.team) rec.get(s)!.onQuests.push({ num: q.num, failed })
  }

  // Vote-matrix signals. Only APPROVED proposals produced a quest, so only they
  // carry an outcome; rejected proposals never played. Attribute against the
  // quest that resulted for that round.
  for (const prop of view.proposals) {
    if (!prop.approved || !prop.votes) continue
    const quest = view.quests[prop.round - 1]
    if (quest?.result === undefined) continue
    const failed = quest.result === 'fail'
    if (failed) rec.get(prop.leader)!.ledFailed += 1
    for (const v of prop.votes) {
      rec.get(v.seat)!.playedVotes.push({ questNum: prop.round, vote: v.vote, failed })
      if (v.vote === 'approve' && failed && !prop.team.includes(v.seat)) {
        rec.get(v.seat)!.approvedFailedOff += 1
      } else if (v.vote === 'reject' && !failed) {
        rec.get(v.seat)!.rejectedSucceeded += 1
      }
    }
  }
  return rec
}

// Facts about the DECIDING seat's own resolved public positions — the
// commitment record (design doc §4). A concept shared with the eval's
// commitment ledger (server/eval/ledger.ts); that one scores completed games
// from the full log, this one renders live facts from the seat's view. Kept
// separate to avoid inverting the agents->eval layering; a future refactor
// could unify the core derivation.
function ownPositions(view: PlayerView): string[] {
  const out: string[] = []
  for (const prop of view.proposals) {
    if (!prop.approved || !prop.votes) continue
    const quest = view.quests[prop.round - 1]
    if (quest?.result === undefined) continue
    const mine = prop.votes.find((v) => v.seat === view.seat)
    const led = prop.leader === view.seat
    const team = prop.team.map((s) => view.players[s].name).join('/')
    if ((led || mine?.vote === 'approve') && quest.result === 'fail') {
      out.push(`You ${led ? 'PROPOSED' : 'APPROVED'} the Q${prop.round} team [${team}] → it FAILED.`)
    } else if (mine?.vote === 'reject' && quest.result === 'success') {
      out.push(`You REJECTED the Q${prop.round} team [${team}] → it SUCCEEDED.`)
    }
  }
  return out
}

// Eval-only A/B switch: the dossier lives in the engine-owned facts layer, so
// it can't be toggled per agent-def — AVALON_NO_DOSSIER=1 suppresses it
// globally so a paired sim can measure default vs. default-plus-dossier on the
// same seeds. Default (unset) = on. Not for production; a measurement lever.
// Read at call time so a harness can set it per process and tests can flip it.
export function dossierEnabled(): boolean {
  return process.env.AVALON_NO_DOSSIER !== '1'
}

// Returns '' when there is nothing derived to report yet (early game), so the
// prompt doesn't carry an empty section.
export function factsDossier(view: PlayerView): string {
  if (!dossierEnabled()) return ''
  const rec = computeRecords(view)
  const anyResolved = view.quests.some((q) => q.result !== undefined)
  if (!anyResolved) return ''

  const sections: string[] = []

  // Per-player public record — ONE row per player, so every derived fact about a
  // player is a single lookup instead of being scattered across sections (which
  // is how the dossier grew, and how a fact about one player ended up in three
  // places). Two fields carry most of the weight:
  //   on-team = quests this seat PLAYED on, with each result (membership).
  //   voted   = how this seat voted on each team that was approved and PLAYED,
  //             keyed to the quest it produced (the per-player transpose of the
  //             per-proposal vote matrix in publicStateText).
  // They are deliberately separate, labeled fields: LLMs conflate "was placed on
  // a team" with "voted to approve it", and that slide has rewritten the vote
  // record at the table (a Merlin gaslit into disowning a reject it had cast).
  // The per-player vote row also surfaces CORRECT rejections of teams that then
  // failed — a strong good/Merlin tell the old aggregate signals hid entirely.
  const rows: string[] = []
  for (const p of view.players) {
    const r = rec.get(p.seat)!
    // Row shape (see the FORMAT CONVENTIONS note at the top of this file):
    //   <player> | <key>: <value> | <key>: <value> ...
    // The player id is the row key (first cell); every other cell is `key: value`,
    // cells pipe-separated. Empty fields are omitted, never rendered blank.
    const fields: string[] = [nameOf(view, p.seat)]
    fields.push(
      r.onQuests.length
        ? `on-team: ${r.onQuests.map((q) => `Q${q.num}(${q.failed ? 'FAIL' : 'ok'})`).join(', ')}`
        : `on-team: none`,
    )
    if (r.playedVotes.length) {
      fields.push(`voted: ${r.playedVotes.map((v) => `Q${v.questNum} ${v.vote}→${v.failed ? 'FAIL' : 'ok'}`).join(', ')}`)
    }
    const sig: string[] = []
    if (r.ledFailed) sig.push(`led ${r.ledFailed} failed quest${r.ledFailed > 1 ? 's' : ''}`)
    if (r.approvedFailedOff) sig.push(`approved ${r.approvedFailedOff} failed team${r.approvedFailedOff > 1 ? 's' : ''} it was not on`)
    if (r.rejectedSucceeded) sig.push(`rejected ${r.rejectedSucceeded} team${r.rejectedSucceeded > 1 ? 's' : ''} that then succeeded`)
    if (sig.length) fields.push(`signals: ${sig.join('; ')}`)
    rows.push(`  ${fields.join(' | ')}`)
  }
  sections.push(
    `Per-player record — one row each, pipe-separated "key: value" fields. ` +
    `on-team = quests this seat PLAYED on, with result. ` +
    `voted = how this seat voted on each approved-and-played team (Q<n> vote→result); ` +
    `being placed ON a team is NOT the same as voting to approve it. ` +
    `signals = notable vote/lead patterns.\n${rows.join('\n')}`,
  )

  // The deciding seat's own resolved positions.
  const positions = ownPositions(view)
  if (positions.length) sections.push(`Your resolved public positions:\n${positions.map((p) => `  ${p}`).join('\n')}`)

  // Hammer proximity — how much rejection runway is left this round.
  const rejectsLeft = MAX_PROPOSALS - view.proposalNum
  if (rejectsLeft <= 2 && view.proposalNum < MAX_PROPOSALS) {
    sections.push(`Hammer proximity: proposal ${view.proposalNum} of ${MAX_PROPOSALS} this round — up to ${rejectsLeft} more proposal${rejectsLeft > 1 ? 's' : ''} can be rejected before the 5th is auto-approved.`)
  }

  if (!sections.length) return ''
  return `== DERIVED FACTS (computed from the public record — anyone at the table can derive these) ==\n${sections.join('\n')}`
}
