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

import { MAX_PROPOSALS, QUESTS_TO_WIN } from '../engine/rules.ts'
import type { PlayerView, Seat } from '../engine/types.ts'

const nameOf = (view: PlayerView, s: Seat) => `${view.players[s].name}(seat ${s})`

// The canonical rendering of a quest result token — `Q3(FAIL)` / `Q1(ok)`. Lives
// here (the facts layer that owns the dossier vocabulary) and is reused by the
// Percival candidate records in prompts.ts, so the token has ONE definition and
// the "one vocabulary across slots" rule can't drift between two copied literals.
export const questResultTag = (num: number, failed: boolean): string =>
  `Q${num}(${failed ? 'FAIL' : 'ok'})`

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

// Board stakes: the score, and what each outcome of the PENDING quest produces.
// Both are derivable from the quest board every player can already see, and
// neither gets derived in play. The `quest` ASK's match-point override (evil at
// good's third quest) is the one place a bot reliably notices the score, and it
// exists only at the card — so leaders proposed clean teams and evil voters
// campaigned FOR good's winning quest, having never counted the board at the
// decision that mattered (seed norms2, 2026-07-24: a Morgana leader proposed a
// zero-evil team at match point and argued the table into approving it).
//
// Stated as consequence, never as a call to act — which side benefits from a
// given outcome is the agent's policy, so the same rows serve good (press now)
// and evil (this is the last round that exists). Rule 2 of the format
// conventions, and the reason this belongs here rather than in three ASK
// branches: one fact, every decision, both alignments.
function boardStakesSection(view: PlayerView): string {
  const successes = view.quests.filter((q) => q.result === 'success').length
  const fails = view.quests.filter((q) => q.result === 'fail').length

  // A quest sits at quests[round-1] until it resolves, and `round` advances only
  // when the game continues (engine: applyDecision 'quest'). So "nothing pending
  // here" means exactly one thing — a side reached QUESTS_TO_WIN and the quest
  // phase is over, which is the board an assassin decides on.
  const q = view.quests[view.round - 1]
  const pending = q && q.result === undefined ? q : undefined

  const score = `Score: good ${successes} of ${QUESTS_TO_WIN} successes | evil ${fails} of ${QUESTS_TO_WIN} fails`
  if (!pending) {
    return `Board state: the score, with the quest phase over.\n  ${score} | no quest remains to be played.`
  }

  const after = view.quests.filter((x) => x.num > pending.num).map((x) => `Q${x.num}`)
  const runway = after.length
    ? ` | quests after this one: ${after.join(', ')}`
    : ` | none after this one, it is the last quest on the board`

  // Good reaching QUESTS_TO_WIN ends the quest phase, but it only ends the GAME
  // when there is no assassin-and-Merlin pair left to shoot. Role sets are
  // configurable (validateRoles requires neither), so read both off rolesInPlay
  // instead of assuming the default deal.
  const shotRemains = view.rolesInPlay.includes('assassin') && view.rolesInPlay.includes('merlin')
  const ifSuccess = successes + 1 >= QUESTS_TO_WIN
    ? `good's ${QUESTS_TO_WIN}rd success, which ends the quest phase` +
      (shotRemains
        ? `, after which no further quest is played and the Assassin's single shot at Merlin becomes the whole game`
        : ` and the game, with no assassination to follow`)
    : `good ${successes + 1} of ${QUESTS_TO_WIN}, needing ${QUESTS_TO_WIN - successes - 1} more`
  const ifFail = fails + 1 >= QUESTS_TO_WIN
    ? `evil's ${QUESTS_TO_WIN}rd failed quest, which ends the game for evil at once`
    : `evil ${fails + 1} of ${QUESTS_TO_WIN}, needing ${QUESTS_TO_WIN - fails - 1} more`
  const needs = pending.failsRequired === 2 ? ', needs 2 fails' : ''

  return `Board state: the score, and what each outcome of the pending quest would produce.\n` +
    `  ${score}${runway}\n` +
    `  Q${pending.num}(size ${pending.teamSize}${needs}) is pending | if it SUCCEEDS: ${ifSuccess} | if it FAILS: ${ifFail}`
}

// Eval-only A/B switch: the dossier lives in the engine-owned facts layer, so
// it can't be toggled per agent-def — AVALON_NO_DOSSIER=1 suppresses it
// globally so a paired sim can measure default vs. default-plus-dossier on the
// same seeds. Default (unset) = on. Not for production; a measurement lever.
// Read at call time so a harness can set it per process and tests can flip it.
export function dossierEnabled(): boolean {
  return process.env.AVALON_NO_DOSSIER !== '1'
}

// What each RESOLVED quest actually proves about the players who played it.
// Both halves fix a specific failure seen in every model of the 2026-07-25
// mid-tier benchmark:
//
//   - Bots treat "was on a team that succeeded" as CLEARED, and build later
//     teams from those players as though they were confirmed good. The rules
//     digest already says evil may play Success, but stated once in a
//     1200-word prompt it loses to the vivid quest board. Said per quest, at
//     the row the bot is reasoning over, it lands.
//   - Bots assert who played a Fail card as settled fact ("you literally
//     played the Fail card"), which is not public and cannot be derived. In
//     one benchmark game three players echoed a fabricated claim of this shape
//     until the table treated it as consensus, which put three evil on one
//     team. The fail COUNT is public; the identities are not, and the row that
//     carries the count is the place to say so.
//
// The arithmetic here is the one deduction that is decisive rather than
// probabilistic: a quest showing N Fails had at least N evil aboard, because a
// good player cannot play Fail (the single engine-enforced rule). Any player at
// the table can derive it, so it stays inside the facts layer's contract.
//
// Stated as evidence, never as instruction: "at least 3 of these 4 are evil" is
// a fact, while "so reject teams containing them" would be policy and belongs
// in a guidance slot (design-bot-guidance.md §6.1).
function questEvidenceSection(view: PlayerView): string {
  const rows: string[] = []
  for (const q of view.quests) {
    if (q.result === undefined || !q.team) continue
    const team = q.team.map((s) => nameOf(view, s)).join(', ')
    const cells = [questResultTag(q.num, q.result === 'fail'), `team: ${team}`]
    if (q.result === 'fail') {
      const n = q.failCount ?? 0
      cells.push(
        `${n} Fail card${n === 1 ? '' : 's'}, so at least ${n} of these ${q.team.length} are evil`,
        `which of them played a Fail is NOT public`,
      )
    } else {
      cells.push(`proves nothing about these players: evil may play Success to buy trust`)
    }
    rows.push(`  ${cells.join(' | ')}`)
  }
  if (!rows.length) return ''
  return 'What each resolved quest proves about the players who played it '
    + '(public arithmetic: a good player cannot play Fail, so N Fails means at least N evil were aboard).\n'
    + rows.join('\n')
}

// Returns '' when there is nothing derived to report yet (early game), so the
// prompt doesn't carry an empty section.
export function factsDossier(view: PlayerView): string {
  if (!dossierEnabled()) return ''
  const rec = computeRecords(view)
  const anyResolved = view.quests.some((q) => q.result !== undefined)
  if (!anyResolved) return ''

  const sections: string[] = []

  // Board stakes lead the dossier: they frame every player row that follows
  // (what a clean record is worth depends on how many quests are left to spend
  // it on). Suppressed with the rest of the dossier before the first resolve,
  // where the score is 0-0 and says nothing.
  sections.push(boardStakesSection(view))

  // Quest evidence sits between the board and the player rows on purpose: it is
  // the bridge between them. The board says what is at stake, this says what the
  // record has already proven, and the rows below say who did what.
  const questEvidence = questEvidenceSection(view)
  if (questEvidence) sections.push(questEvidence)

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
        ? `on-team: ${r.onQuests.map((q) => questResultTag(q.num, q.failed)).join(', ')}`
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
    `Per-player record, one row each, pipe-separated "key: value" fields. ` +
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
    sections.push(`Hammer proximity: proposal ${view.proposalNum} of ${MAX_PROPOSALS} this round, so up to ${rejectsLeft} more proposal${rejectsLeft > 1 ? 's' : ''} can be rejected before the 5th is auto-approved.`)
  }

  if (!sections.length) return ''
  return `== DERIVED FACTS (computed from the public record, so anyone at the table can derive these) ==\n${sections.join('\n')}`
}
