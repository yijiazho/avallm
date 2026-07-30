// Headless simulation CLI. Run `npm run sim -- --help` for the full flag list;
// USAGE below is that help text, so the two can never drift apart.
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createGame } from '../engine/game.ts'
import { makeRng } from '../engine/prng.ts'
import { createAgent, createAgentFromDef } from '../agents/registry.ts'
import { loadAgentLibrary } from '../agents/defs.ts'
import { randomModels, seatPack } from '../agents/packs.ts'
import { ROSTER, rosterById } from '../llm/roster.ts'
import { runGame } from './runner.ts'
import { renderEvent, revealRoles } from './render.ts'
import { renderTranscript } from '../transcript.ts'
import { appendArtifact, toArtifact } from '../eval/artifact.ts'
import { FORCED_PLAY_RULES, forcedPlayViolations, type ForcedPlayRule } from '../eval/forced.ts'
import {
  SPEECH_NORMS, SPEECH_NORM_IDS, mergeSpeechNorms, newSpeechNormReport, speechNorms,
} from '../eval/norms.ts'
import type { AgentDef, TableSeat } from '../agents/defs.ts'
import {
  COMPOSED_BRAIN_PRESETS,
  type AgentSpec,
  type AvalonAgent,
  type ComposedBrainPreset,
} from '../agents/types.ts'
import {
  upsertDecisionTrace,
  type DecisionTrace,
} from '../agents/trace.ts'
import type { Seat } from '../engine/types.ts'

const USAGE = `npm run sim -- [flags]        headless Avalon simulator

TABLE (all LLM tables cost money; heuristic/random/composed are free)
  --agents <kind>       heuristic (default) | random | mixed | llm | composed
  --brain <preset>      composed brain preset (implies --agents composed):
                        full-role (default) seats the complete Phase 7 role stack,
                        good-base seats the Phase 4 structured good scorer.
                        Both are API-free and neither is the default agent.
  --model <roster-id>   force EVERY seat onto one model (implies --agents llm).
                        A homogeneous table isolates prompt quality from model spread.
  --tier <tier>         seat a RANDOM model of this cost tier per seat, redrawn per
                        game from that game's seed (implies --agents llm).
  --pack <pack-id>      seat a curated character pack; leftover seats come from the
                        default library (implies --agents llm).
  --players <n>         table size (default 7)

GAME
  --seed <string>       base seed (default "sim"). Aggregate runs suffix it per game,
                        so the same --seed always replays the same batch.
  --games <n>           how many games (default 1). >1 prints aggregate stats only.
  --talk <r[,r2]>       table-talk rounds, and rounds after a team revision (default 0)
  --concurrency <n>     aggregate mode: play n games at once (shares the spend ceiling)

OUTPUT
  --out <file.jsonl>    append replayable game artifacts for eval tooling. LLM runs
                        that pass --transcripts default this to <dir>/artifacts.jsonl,
                        since re-running a paid batch to recover them costs money.
  --transcripts <dir>   write one rendered transcript per game into <dir>. A single
                        game prints its transcript anyway; aggregate runs print none,
                        so this is how a batch stays readable.
  --reasoning           include every seat's PRIVATE thinking and running notes in
                        the transcripts. Reads what a bot believed, not just what
                        it said, which is what separates a reasoned assassin guess
                        from a lucky one. Offline analysis only; it prints hidden
                        information, so never share a transcript made with it.
  --quiet               suppress per-game chatter
  --help                this text

EXAMPLES
  npm run sim -- --players 7 --seed 42                    one free game, full transcript
  npm run sim -- --games 200 --talk 0                     aggregate win rates, no API cost
  npm run sim -- --agents composed --games 200            free full-role stack win rates
  npm run sim -- --agents llm --players 7 --talk 3,2      one real LLM game
  npm run sim -- --tier mid --games 8 --concurrency 4 \\
       --talk 3,2 --transcripts runs/          batch of mid-tier tables, readable after
  npm run sim -- --model kimi --games 5                   one model on every seat
  npm run sim -- --pack detectives --players 7            seat a curated cast

ROSTER IDS
${(['cheap', 'mid', 'premium'] as const)
    .map((t) => `  ${t.padEnd(8)} ${ROSTER.filter((r) => r.tier === t).map((r) => r.id).join(', ')}`)
    .join('\n')}`

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', default: false },
    players: { type: 'string', default: '7' },
    seed: { type: 'string', default: 'sim' },
    games: { type: 'string', default: '1' },
    agents: { type: 'string', default: 'heuristic' }, // heuristic | random | mixed | llm | composed
    brain: { type: 'string' },                        // composed preset: full-role | good-base (implies --agents composed)
    model: { type: 'string' },                        // force EVERY seat onto one roster id (implies --agents llm) — a homogeneous table to isolate prompt quality from model spread
    tier: { type: 'string' },                         // seat a RANDOM model from this cost tier per seat, redrawn per game (implies --agents llm)
    pack: { type: 'string' },                         // seat a curated pack (server/agents/packs.ts), leftovers from the default library (implies --agents llm)
    talk: { type: 'string', default: '0' },           // maxRounds[,maxRoundsAfterChange]
    out: { type: 'string' },                          // append game artifacts (JSONL) for eval tooling
    transcripts: { type: 'string' },                  // write one rendered transcript per game into this dir (aggregate runs print none)
    reasoning: { type: 'boolean', default: false },   // include each seat's PRIVATE thinking + notes in those transcripts (offline analysis only)
    concurrency: { type: 'string', default: '1' },    // aggregate mode: play this many independent games at once (shares the spend ceiling)
    quiet: { type: 'boolean', default: false },
  },
})

if (values.help) {
  console.log(USAGE)
  process.exit(0)
}

const playerCount = Number(values.players)
const games = Number(values.games)
const concurrency = Math.max(1, Math.floor(Number(values.concurrency) || 1))
const [maxRounds, maxRoundsAfterChange = 0] = values.talk!.split(',').map(Number)
// --model forces a homogeneous LLM table, so it implies --agents llm. Validate the
// id up front (rosterById throws on an unknown id) for a clear error before any game runs.
const forcedModel = values.model ? rosterById(values.model).id : undefined

// --tier draws a random model of one cost tier PER SEAT. Unlike --pack (one cast
// for the whole run) the draw is redrawn per game from that game's own seed, so a
// batch sweeps casts instead of repeating one, and any single game still replays
// exactly from its seed. Both --model and --pack decide seating themselves, so
// combining them with --tier would silently drop it: reject instead.
const TIERS = ['cheap', 'mid', 'premium'] as const
type Tier = typeof TIERS[number]
let tierModels: string[] | undefined
if (values.tier !== undefined) {
  if (!TIERS.includes(values.tier as Tier)) {
    throw new Error(`unknown tier: ${values.tier}. Known tiers: ${TIERS.join(', ')}`)
  }
  if (forcedModel) throw new Error('--tier and --model both choose seating; pass only one')
  if (values.pack) throw new Error('--tier and --pack both choose seating; pass only one')
  tierModels = ROSTER.filter((r) => r.tier === values.tier).map((r) => r.id)
  if (!tierModels.length) throw new Error(`no models in tier "${values.tier}"`)
}

// --reasoning only decides what goes INTO a written transcript, so on its own it
// does nothing at all. Silently doing nothing is the expensive failure here: the
// flag exists for LLM batches, so the way you would find out is by paying for
// one and then discovering the reasoning you asked for was never captured.
if (values.reasoning && !values.transcripts) {
  throw new Error('--reasoning writes into the transcript files; pass --transcripts <dir> as well')
}

// Create the transcript directory BEFORE any game runs. Created lazily at the
// first write it would surface an unwritable path only after a full LLM batch
// had been played and paid for, which is the most expensive possible moment to
// learn the output target is bad.
if (values.transcripts) fs.mkdirSync(values.transcripts, { recursive: true })

// The per-game cast for --tier, drawn from that game's seed so it is reproducible.
// randomModels deals by shuffle rather than independent picks, so a 7-seat table
// covers a 4-model tier instead of possibly seating one model four times.
function tierTableFor(seed: string): string[] | undefined {
  if (!tierModels) return undefined
  return randomModels(playerCount, makeRng(`${seed}:tier`), tierModels)
}

// --pack seats library defs instead of bare model specs. The table is resolved
// ONCE (from --seed, not per game) so an aggregate run compares the same cast
// across every seed; the random models handed to personality-only agents are
// part of that table, not a per-game reroll.
let packTable: TableSeat[] | undefined
let packDefs: AgentDef[] | undefined
if (values.pack) {
  const lib = loadAgentLibrary()
  const pack = lib.packs.find((p) => p.id === values.pack)
  if (!pack) {
    const known = lib.packs.map((p) => p.id).join(', ') || '(none)'
    throw new Error(`unknown pack: ${values.pack} — known packs: ${known}`)
  }
  for (const p of lib.problems) console.warn(`[agents] ${p.file}: ${p.reason}`)
  packTable = seatPack(pack, playerCount, lib.agents, makeRng(`${values.seed}:pack`))
  // --model means "force EVERY seat onto one roster id", so it outranks both
  // the roll seatPack deals a personality-only agent and any model a member's
  // def suggests: a pack on one model isolates persona from model spread.
  if (forcedModel) packTable = packTable.map((t) => ({ agent: t.agent, model: forcedModel }))
  packDefs = packTable.map((t) => lib.agents.find((a) => a.id === t.agent)!)
  if (!values.quiet) {
    const seats = packTable.map((t, i) => `${packDefs![i].name}${t.model ? ` (${t.model})` : ''}`)
    console.log(`pack "${pack.name}": ${seats.join(', ')}`)
  }
}

const isLlm = values.agents === 'llm' || forcedModel !== undefined || packTable !== undefined
  || tierModels !== undefined

// --brain implies --agents composed, mirroring how --model/--tier/--pack imply
// --agents llm. Validated here so a bad combination fails before any game runs
// rather than quietly seating a table the flags did not ask for.
if (
  values.brain !== undefined
  && !(COMPOSED_BRAIN_PRESETS as readonly string[]).includes(values.brain)
) {
  console.error(`--brain must be one of ${COMPOSED_BRAIN_PRESETS.join(', ')}`)
  process.exit(1)
}
// `--agents` carries a default, so an explicit conflict is only detectable for
// the kinds nobody would pair with a brain on purpose.
if (values.brain !== undefined && ['random', 'mixed'].includes(values.agents!)) {
  console.error(`--brain seats a composed table and conflicts with --agents ${values.agents}`)
  process.exit(1)
}
const composedBrain: ComposedBrainPreset | undefined =
  values.brain !== undefined
    ? values.brain as ComposedBrainPreset
    : values.agents === 'composed'
      ? 'full-role'
      : undefined
if (composedBrain !== undefined && isLlm) {
  console.error('--brain seats an API-free brain and cannot combine with an LLM table')
  process.exit(1)
}

// A PAID run that already names an output directory gets artifacts beside its
// transcripts, unless --out says otherwise. The asymmetry is the point: losing
// the artifacts of a free run costs seconds to recreate, losing the artifacts of
// an LLM batch costs money, and this session lost exactly that (two paid arms
// captured --transcripts and no --out, so neither could be graded afterwards).
//
// Still nothing written for a run that asked for no files: no --transcripts, no
// default. The user has already said where output goes, so this puts more of it
// there rather than inventing a location.
const artifactOut = values.out
  ?? (isLlm && values.transcripts ? path.join(values.transcripts, 'artifacts.jsonl') : undefined)
if (artifactOut && !values.out) {
  console.log(`[artifacts] paid run: appending game artifacts to ${artifactOut} (override with --out)`)
}

// What actually sat at the table, for the aggregate summary. Derived from the same
// seating decision as `isLlm` rather than echoing --agents: --model/--tier/--pack all
// seat LLMs without touching that flag, so printing the raw flag labelled a paid run
// "heuristic". Saved transcripts and benchmark output get compared long after the run,
// where a free-looking label on a table that cost money is misleading evidence.
const agentsLabel = packTable ? `pack:${values.pack}${forcedModel ? ` on llm:${forcedModel}` : ''}`
  : forcedModel ? `llm:${forcedModel} (homogeneous)`
  : tierModels ? `llm (tier=${values.tier})`
  : composedBrain ? `composed:${composedBrain}`
  : values.agents!

// `tierTable` is this game's cast for --tier, threaded through rather than read
// from module state: with --concurrency > 1 several games are in flight at once,
// each with its own draw, so a shared "current table" would let one game name its
// seats from another's cast.
function specFor(seat: Seat, tierTable?: string[]): AgentSpec {
  if (isLlm) return { type: 'llm', model: tierTable?.[seat] ?? forcedModel ?? ROSTER[seat % ROSTER.length].id }
  if (composedBrain) return { type: 'composed', brain: composedBrain }
  if (values.agents === 'random') return { type: 'random' }
  if (values.agents === 'mixed') return seat % 2 === 0 ? { type: 'heuristic' } : { type: 'random' }
  return { type: 'heuristic' }
}

function agentFor(
  seat: Seat,
  seed: string,
  tierTable?: string[],
  onDecisionTrace?: (trace: DecisionTrace) => void,
): AvalonAgent {
  const context = { seed, seat, onDecisionTrace }
  if (packTable && packDefs) {
    return createAgentFromDef(packDefs[seat], context, packTable[seat].model)
  }
  return createAgent(specFor(seat, tierTable), context)
}

// LLM tables are named after their models — the premise of the game. A homogeneous
// table numbers every seat (Kimi 1..Kimi 7) so the transcript can still tell them apart.
// A pack table is named after its characters (the models still show in the spend
// breakdown), with the same dedupe if a name repeats.
function namesFor(count: number, tierTable?: string[]): string[] | undefined {
  if (!isLlm) return undefined
  // A --tier cast repeats models freely (4 mid models over 7 seats), so dedupe by
  // display name the same way a homogeneous table does.
  if (tierTable) {
    const used = new Map<string, number>()
    return Array.from({ length: count }, (_, seat) => {
      const display = rosterById(tierTable[seat]).displayName
      const n = (used.get(display) ?? 0) + 1
      used.set(display, n)
      return n === 1 ? display : `${display} ${n}`
    })
  }
  if (packDefs) {
    const used = new Map<string, number>()
    return packDefs.slice(0, count).map((def) => {
      const n = (used.get(def.name) ?? 0) + 1
      used.set(def.name, n)
      return n === 1 ? def.name : `${def.name} ${n}`
    })
  }
  if (forcedModel) {
    const entry = rosterById(forcedModel)
    return Array.from({ length: count }, (_, seat) => `${entry.displayName} ${seat + 1}`)
  }
  return Array.from({ length: count }, (_, seat) => {
    const entry = ROSTER[seat % ROSTER.length]
    const dup = Math.floor(seat / ROSTER.length)
    return dup ? `${entry.displayName} ${dup + 1}` : entry.displayName
  })
}

const tally = {
  good: 0, evil: 0, reasons: new Map<string, number>(), degraded: 0,
  blunders: new Map<ForcedPlayRule, number>(),
  norms: newSpeechNormReport(),
}

// What actually sat in a seat, for the artifact AND the transcript header. One
// definition so a transcript can never disagree with the artifact beside it
// about which model played which seat.
function seatDescriptor(seat: Seat, tierTable?: string[]): string {
  if (packTable && packDefs) {
    const engine = packDefs[seat].engine
    const model = packTable[seat].model ?? (engine.type === 'llm' ? engine.model : undefined)
    return `${packDefs[seat].id}${model ? `:${model}` : ''}`
  }
  const spec = specFor(seat, tierTable)
  if (spec.type === 'llm') return `llm:${spec.model}`
  if (spec.type === 'composed') return `composed:${spec.brain}`
  return spec.type
}

async function playGame(i: number): Promise<void> {
  const seed = games === 1 ? values.seed! : `${values.seed}-${i}`
  const tierTable = tierTableFor(seed)
  const game = createGame({
    seed, playerCount, names: namesFor(playerCount, tierTable),
    talk: { maxRounds, maxRoundsAfterChange },
  })
  const decisionTraces: DecisionTrace[] = []
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [
      p.seat,
      agentFor(
        p.seat,
        seed,
        tierTable,
        (trace) => upsertDecisionTrace(decisionTraces, trace),
      ),
    ]),
  )
  const verbose = games === 1 && !values.quiet
  const result = await runGame({
    game, agents,
    // stdout only. The transcript FILE is rendered from the finished log below,
    // so nothing needs collecting here.
    onEvent: verbose ? (ev) => { const line = renderEvent(ev, game); if (line) console.log(line) } : undefined,
  })
  // Tally + artifact writes run synchronously between awaits, so even with games
  // in flight concurrently there is no interleaving here: no shared-state race on
  // the tally, and appendFileSync writes each artifact line atomically.
  tally[result.game.outcome!.winner]++
  tally.reasons.set(result.game.outcome!.reason, (tally.reasons.get(result.game.outcome!.reason) ?? 0) + 1)
  tally.degraded += result.degraded.length
  // Grade forced plays in-process. toArtifact allocates in memory and writes
  // nothing (its only impurity is a createdAt timestamp), so this runs whether or
  // not --out was passed.
  //
  // It is unconditional on purpose. Blunders are the measure that survives a
  // small sample: each violation is a specific play you can read and confirm as
  // wrong, whereas a win rate over 8 games is noise (and is evil-favoured anyway,
  // per research-strategy.md, so it does not answer "did the bots play better").
  // A metric that decides whether a paid run was worth anything should not be
  // gated behind remembering a flag.
  const artifact = toArtifact(game, {
    agents: game.players.map((p) => seatDescriptor(p.seat, tierTable)),
    degraded: result.degraded,
    steps: result.steps,
    decisionTraces,
  })
  const violations = forcedPlayViolations(artifact)
  // Same deal as the forced plays: computed from the artifact we already built,
  // so the number is free and never depends on remembering a flag.
  mergeSpeechNorms(tally.norms, speechNorms(artifact))
  for (const v of violations) tally.blunders.set(v.rule, (tally.blunders.get(v.rule) ?? 0) + 1)
  if (artifactOut) appendArtifact(artifactOut, artifact)
  // Roles, outcome, and degradations close both the printed transcript and the
  // written one: a transcript without the reveal cannot be read for play quality,
  // since who was evil is exactly what the table talk has to be judged against.
  const footer = [
    '',
    revealRoles(game),
    '',
    `Winner: ${game.outcome?.winner} (${game.outcome?.reason})  [seed ${seed}]`,
    ...result.degraded.map((d) => `degraded: seat ${d.seat} ${d.kind} — ${d.error.slice(0, 120)}`),
    // Alongside the reveal, because a blunder is only legible once you know who
    // was evil, and "which decisions were deterministically wrong" is the first
    // thing you want when reading a transcript for play quality.
    ...violations.map((v) =>
      `BLUNDER [${v.rule}] Q${v.round}: ${v.name}(seat ${v.seat}·${v.role}) ${FORCED_PLAY_RULES[v.rule]}`),
  ]
  if (verbose) console.log(footer.join('\n'))
  if (values.transcripts) {
    // Rendered through the SAME renderer as the in-app copy-log button, rather
    // than a sim-only format. Both artifacts exist to be read after the fact,
    // usually by an LLM analysing a batch, so one shape means whatever you learn
    // to skim in one reads identically in the other.
    //
    // Always a full reveal: this is a local debug file for the operator who just
    // paid for the game, not a per-seat feed. `--reasoning` decides only whether
    // the seat-private thinking and notes ride along, since including them
    // multiplies the file size and is not always what you want.
    const text = renderTranscript({
      id: game.id,
      seed,
      playerCount,
      phase: game.phase,
      round: game.round,
      proposalNum: game.proposalNum,
      leaderSeat: game.leaderSeat,
      quests: game.quests,
      seats: game.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        agent: seatDescriptor(p.seat, tierTable),
        role: p.role,
        alignment: p.alignment,
      })),
      log: values.reasoning
        ? game.log
        : game.log.filter((ev) => ev.type !== 'thinking' && ev.type !== 'scratchpad'),
      degraded: result.degraded.map((d) => ({ seat: d.seat, kind: d.kind, error: d.error })),
      // Into the FILE, not just the verbose footer. Aggregate runs are the whole
      // measurement path and they set verbose=false, so without this a batch
      // reports violation totals with nothing saying which game or seat, which is
      // the hand-parsing this reporting exists to remove.
      violations: violations.map((v) => ({ seat: v.seat, rule: v.rule, round: v.round, detail: v.detail })),
      winner: game.outcome?.winner,
      winReason: game.outcome?.reason,
      revealed: true,
      capturedAt: new Date().toISOString(),
      // The raw JSONL belongs to --out, which writes a replayable artifact.
      // Repeating it here would double every transcript for no new information.
      includeRaw: false,
    })
    // The seed is arbitrary user text and goes into a FILENAME. An unsanitized
    // "a/b" resolves into a subdirectory that does not exist, so the write threw
    // ENOENT after the game had already been played and paid for.
    const safeSeed = seed.replace(/[^a-zA-Z0-9._-]+/g, '_')
    fs.writeFileSync(
      path.join(values.transcripts, `game-${String(i + 1).padStart(3, '0')}-${safeSeed}.txt`),
      text,
    )
  }
}

// Games are independent, so play up to `concurrency` at once via a fixed worker
// pool that pulls the next index until every game is done (results are recorded
// as each finishes, order-independent). All games share one LLM client, so they
// share the spend ceiling — expected for an aggregate run.
let nextGame = 0
const worker = async (): Promise<void> => {
  while (true) {
    const i = nextGame++
    if (i >= games) break
    await playGame(i)
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, games) }, worker))

if (games > 1) {
  console.log(`\n${games} games, ${playerCount} players, agents=${agentsLabel}, talk=${values.talk}`)
  console.log(`good wins: ${tally.good} (${((tally.good / games) * 100).toFixed(1)}%)`)
  console.log(`evil wins: ${tally.evil} (${((tally.evil / games) * 100).toFixed(1)}%)`)
  for (const [reason, n] of [...tally.reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`)
  }
  if (tally.degraded) console.log(`degraded decisions total: ${tally.degraded}`)

  // Always printed, including the zero. "0 forced-play violations" is the result,
  // not the absence of one, and a line that appears only on failure trains you to
  // read its absence as "not measured".
  const blunders = [...tally.blunders.values()].reduce((a, b) => a + b, 0)
  console.log(`forced-play violations: ${blunders}${blunders ? '' : '  (no deterministically wrong decisions)'}`)
  for (const [rule, n] of [...tally.blunders].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${n} — ${FORCED_PLAY_RULES[rule]}`)
  }

  // House-style compliance in the speech the bots actually produced. The prompt
  // side of this rule is guarded by talk-norms.test.ts; this is the other half,
  // and it is reported per AGENT because compliance is model-dependent and the
  // actionable question is which models need the guidance tightened.
  const n = tally.norms
  if (n.turns) {
    const pct = ((n.violations / n.turns) * 100).toFixed(1)
    console.log(`speech-norm violations: ${n.violations} of ${n.turns} spoken turns (${pct}%)`)
    for (const rule of SPEECH_NORM_IDS) {
      if (!n.byRule[rule]) continue
      const who = Object.entries(n.byAgent[rule])
        .sort((a, b) => b[1] - a[1])
        .map(([agent, c]) => `${agent} ${c}`)
        .join(', ')
      console.log(`  ${rule}: ${n.byRule[rule]} — ${SPEECH_NORMS[rule].norm}`)
      console.log(`      ${who}`)
    }
  }

  // The one thing in-process grading cannot replace. Gated on artifactOut, NOT on
  // values.out: with the --transcripts default in place, checking the raw flag
  // told a run that had just written eight artifacts that it had written none,
  // contradicting the line this same run printed at startup. Anyone reading that
  // log would re-run a paid batch to recover artifacts they already had, which is
  // the exact waste the default exists to prevent.
  if (isLlm && !artifactOut) {
    console.log(`\nnote: no --out and no --transcripts, so these games were not saved as`)
    console.log(`      artifacts. The forced-play and speech-norm numbers above are complete,`)
    console.log(`      but the LLM judge (softer blunders, table talk quality) can only run over`)
    console.log(`      saved artifacts, and re-running a paid batch to recover them costs money.`)
  }
}

if (isLlm) {
  const { getClient } = await import('../llm/client.ts')
  const client = getClient()
  const spend = client.getSpend()
  console.log(`\nLLM spend: $${client.getTotalCost().toFixed(4)} total`)
  const byModel = new Map<string, { cost: number; calls: number; leaks: number }>()
  for (const [tag, e] of Object.entries(spend)) {
    const model = tag.split('/')[0]
    const agg = byModel.get(model) ?? { cost: 0, calls: 0, leaks: 0 }
    agg.cost += e.cost
    agg.calls += e.calls
    agg.leaks += e.reasoningLeakCalls
    byModel.set(model, agg)
  }
  for (const [model, agg] of [...byModel].sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`  ${model}: $${agg.cost.toFixed(4)} over ${agg.calls} calls${agg.leaks ? ` (${agg.leaks} reasoning leaks)` : ''}`)
  }
}
