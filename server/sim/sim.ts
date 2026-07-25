// Headless simulation CLI.
//   node server/sim/sim.ts --players 7 --seed 42            # one game, transcript
//   node server/sim/sim.ts --players 7 --games 200          # aggregate stats
//   node server/sim/sim.ts --model kimi --games 5           # homogeneous LLM table (one model, every seat)
//   node server/sim/sim.ts --games 20 --concurrency 5       # 5 games at once (aggregate)
//   node server/sim/sim.ts --agents random --talk 0
import { parseArgs } from 'node:util'
import { createGame } from '../engine/game.ts'
import { createAgent } from '../agents/registry.ts'
import { ROSTER, rosterById } from '../llm/roster.ts'
import { runGame } from './runner.ts'
import { renderEvent, revealRoles } from './render.ts'
import { appendArtifact, toArtifact } from '../eval/artifact.ts'
import type { AgentSpec, AvalonAgent } from '../agents/types.ts'
import type { Seat } from '../engine/types.ts'

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '7' },
    seed: { type: 'string', default: 'sim' },
    games: { type: 'string', default: '1' },
    agents: { type: 'string', default: 'heuristic' }, // heuristic | random | mixed | llm
    model: { type: 'string' },                        // force EVERY seat onto one roster id (implies --agents llm) — a homogeneous table to isolate prompt quality from model spread
    talk: { type: 'string', default: '0' },           // maxRounds[,maxRoundsAfterChange]
    out: { type: 'string' },                          // append game artifacts (JSONL) for eval tooling
    concurrency: { type: 'string', default: '1' },    // aggregate mode: play this many independent games at once (shares the spend ceiling)
    quiet: { type: 'boolean', default: false },
  },
})

const playerCount = Number(values.players)
const games = Number(values.games)
const concurrency = Math.max(1, Math.floor(Number(values.concurrency) || 1))
const [maxRounds, maxRoundsAfterChange = 0] = values.talk!.split(',').map(Number)
// --model forces a homogeneous LLM table, so it implies --agents llm. Validate the
// id up front (rosterById throws on an unknown id) for a clear error before any game runs.
const forcedModel = values.model ? rosterById(values.model).id : undefined
const isLlm = values.agents === 'llm' || forcedModel !== undefined

function specFor(seat: Seat): AgentSpec {
  if (isLlm) return { type: 'llm', model: forcedModel ?? ROSTER[seat % ROSTER.length].id }
  if (values.agents === 'random') return { type: 'random' }
  if (values.agents === 'mixed') return seat % 2 === 0 ? { type: 'heuristic' } : { type: 'random' }
  return { type: 'heuristic' }
}

// LLM tables are named after their models — the premise of the game. A homogeneous
// table numbers every seat (Kimi 1..Kimi 7) so the transcript can still tell them apart.
function namesFor(count: number): string[] | undefined {
  if (!isLlm) return undefined
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

const tally = { good: 0, evil: 0, reasons: new Map<string, number>(), degraded: 0 }

async function playGame(i: number): Promise<void> {
  const seed = games === 1 ? values.seed! : `${values.seed}-${i}`
  const game = createGame({
    seed, playerCount, names: namesFor(playerCount),
    talk: { maxRounds, maxRoundsAfterChange },
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((p) => [p.seat, createAgent(specFor(p.seat), { seed, seat: p.seat })]),
  )
  const verbose = games === 1 && !values.quiet
  const result = await runGame({
    game, agents,
    onEvent: verbose ? (ev) => { const line = renderEvent(ev, game); if (line) console.log(line) } : undefined,
  })
  // Tally + artifact writes run synchronously between awaits, so even with games
  // in flight concurrently there is no interleaving here: no shared-state race on
  // the tally, and appendFileSync writes each artifact line atomically.
  tally[result.game.winner!]++
  tally.reasons.set(result.game.winReason!, (tally.reasons.get(result.game.winReason!) ?? 0) + 1)
  tally.degraded += result.degraded.length
  if (values.out) {
    const descriptor = (seat: Seat) => {
      const spec = specFor(seat)
      return spec.type === 'llm' ? `llm:${spec.model}` : spec.type
    }
    appendArtifact(values.out, toArtifact(game, {
      agents: game.players.map((p) => descriptor(p.seat)),
      degraded: result.degraded,
      steps: result.steps,
    }))
  }
  if (verbose) {
    console.log('\n' + revealRoles(game))
    console.log(`\nWinner: ${game.winner} (${game.winReason})  [seed ${seed}]`)
    for (const d of result.degraded) {
      console.log(`degraded: seat ${d.seat} ${d.kind} — ${d.error.slice(0, 120)}`)
    }
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
  const agentsLabel = forcedModel ? `llm:${forcedModel} (homogeneous)` : values.agents
  console.log(`\n${games} games, ${playerCount} players, agents=${agentsLabel}, talk=${values.talk}`)
  console.log(`good wins: ${tally.good} (${((tally.good / games) * 100).toFixed(1)}%)`)
  console.log(`evil wins: ${tally.evil} (${((tally.evil / games) * 100).toFixed(1)}%)`)
  for (const [reason, n] of [...tally.reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${n}`)
  }
  if (tally.degraded) console.log(`degraded decisions total: ${tally.degraded}`)
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
