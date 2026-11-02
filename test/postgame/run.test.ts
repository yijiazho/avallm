// test-lane: fast
// The post-game runner: one review call per modeled seat, one retry, bounded
// concurrency, honest unavailable seats, and a terminal record that ignores an
// unwritten human note. A fake client keeps every path offline and deterministic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgent } from '../../server/agents/registry.ts'
import { createGame } from '../../server/engine/game.ts'
import { runGame } from '../../server/sim/runner.ts'
import { snapshotSeatedAgent } from '../../server/seated-agent.ts'
import { runPostgame, reviewTag } from '../../server/postgame/run.ts'
import {
  postgameStatusFromSeats,
  settleInterruptedPostgame,
} from '../../server/postgame/types.ts'
import type { PostgameSession } from '../../server/postgame/run.ts'
import type { PostgameRecord, PostgameSeat } from '../../server/postgame/types.ts'
import type { AgentDef } from '../../server/agents/defs.ts'
import type { OpenRouterClient, CallOpts, Msg, SpendEntry } from '../../server/llm/openrouter.ts'
import type { AvalonAgent } from '../../server/agents/types.ts'
import type { Game, Seat } from '../../server/engine/types.ts'

const VALID = JSON.stringify({
  statement: 'I would take back the second team.',
  summary: 'A reasonable game.',
  decisions: [],
  commentary: [],
  lesson: 'Vote on the record, not on the volume.',
})

async function finishedGame(seed = 'postgame-run'): Promise<Game> {
  const game = createGame({
    seed,
    playerCount: 5,
    talk: { maxRounds: 0, maxRoundsAfterChange: 0 },
  })
  const agents = new Map<Seat, AvalonAgent>(
    game.players.map((player) => [
      player.seat,
      createAgent({ type: 'heuristic' }, { seed, seat: player.seat }),
    ]),
  )
  return (await runGame({ game, agents })).game
}

function llmDef(id = 'test-llm'): AgentDef {
  return {
    id,
    name: id,
    engine: { type: 'llm', model: 'deepseek-flash' },
    tier: 'user',
  }
}

interface FakeReply {
  content: string | (() => string)
  error?: Error
}

interface FakeClient extends OpenRouterClient {
  calls: { model: string; messages: Msg[]; opts: CallOpts }[]
}

function fakeClient(replyFor: (seat: number) => FakeReply[]): FakeClient {
  const calls: FakeClient['calls'] = []
  const spend: Record<string, SpendEntry> = {}
  const queue = new Map<number, FakeReply[]>()
  return {
    calls,
    async call(model, messages, opts = {}) {
      const tag = opts.tag ?? 'other'
      const seat = Number(tag.slice(tag.lastIndexOf('/') + 1))
      const replies = queue.get(seat) ?? replyFor(seat)
      queue.set(seat, replies)
      const next = replies.shift() ?? { content: VALID }
      calls.push({ model, messages, opts })
      const entry = spend[tag] ?? (spend[tag] = {
        cost: 0, calls: 0, prompt: 0, completion: 0, reasoning: 0,
        reasoningLeakCalls: 0, providerViolationCalls: 0, model, providers: {},
      })
      entry.calls += 1
      entry.cost += 0.01
      entry.prompt += 100
      entry.completion += 50
      if (next.error) throw next.error
      return typeof next.content === 'function' ? next.content() : next.content
    },
    getSpend: () => spend,
    getTotalCost: () => Object.values(spend).reduce((sum, entry) => sum + entry.cost, 0),
  }
}

function sessionFor(
  game: Game,
  config: { human?: Seat[]; modelSeats?: Seat[]; composedSeats?: Seat[] },
): PostgameSession {
  const humans = new Set(config.human ?? [])
  const modeled = new Set(config.modelSeats ?? [])
  const composed = new Set(config.composedSeats ?? [])
  const seatedAgents: Record<number, ReturnType<typeof snapshotSeatedAgent>> = {}
  for (const player of game.players) {
    if (humans.has(player.seat)) continue
    const def = composed.has(player.seat)
      ? {
          id: 'composed-seat',
          name: 'Composed',
          engine: { type: 'composed', brain: 'full-role', adapter: 'none' } as const,
        }
      : modeled.has(player.seat)
        ? llmDef(`llm-${player.seat}`)
        : llmDef(`unmodeled-${player.seat}`)
    // A raw LLM def is the model seat; an unmodeled seat is a heuristic with no
    // model so the runner marks it unavailable rather than calling a client.
    if (!modeled.has(player.seat) && !composed.has(player.seat)) {
      seatedAgents[player.seat] = snapshotSeatedAgent({
        id: 'autopilot',
        name: 'Rule-based',
        engine: { type: 'heuristic' },
      })
      continue
    }
    seatedAgents[player.seat] = snapshotSeatedAgent(def)
  }
  return {
    humans: new Map([...humans].map((seat) => [seat, { token: `t${seat}`, name: `H${seat}` }])),
    seatedAgents,
    postgameRev: 0,
  }
}

function statuses(record: PostgameRecord): Record<number, PostgameSeat['status']> {
  return Object.fromEntries(
    Object.values(record.seats).map((seat) => [seat.seat, seat.status]),
  )
}

test('a finished game yields one record with terminal statuses and ignored human pending', async () => {
  const game = await finishedGame('postgame-shape')
  const session = sessionFor(game, { human: [2], modelSeats: [0, 1] })
  const client = fakeClient(() => [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.equal(record.version, 1)
  assert.equal(record.status, 'complete')
  assert.ok(record.completedAt)
  assert.deepEqual(statuses(record), {
    0: 'complete',
    1: 'complete',
    2: 'pending',
    3: 'unavailable',
    4: 'unavailable',
  })
  assert.equal(record.seats[0]!.kind, 'agent')
  assert.equal(record.seats[3]!.error, 'no model to ask for a review')
  assert.equal(session.postgame, record)
  assert.ok(session.postgameRev > 0)
  // One call per model seat, no more.
  assert.equal(client.calls.length, 2)
  assert.deepEqual(
    client.calls.map((call) => call.opts.tag).sort(),
    [reviewTag('llm-0', game.id, 0), reviewTag('llm-1', game.id, 1)].sort(),
  )
})

test('the reveal is available while the fan-out is still running', async () => {
  const game = await finishedGame('postgame-running')
  const session = sessionFor(game, { human: [4], modelSeats: [0] })
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const client = fakeClient(() => [{ content: VALID }])
  // Replace the fake call with one that waits on the gate.
  client.call = async (model, messages, opts = {}) => {
    client.calls.push({ model, messages, opts })
    await gate
    return VALID
  }
  const running = runPostgame(session, game, { client })
  assert.equal(session.postgame?.status, 'running')
  assert.equal(session.postgame?.seats[0]!.status, 'running')
  release()
  const record = await running
  assert.equal(record.status, 'complete')
})

test('the round table runs in seat order and later turns see earlier statements', async () => {
  const game = await finishedGame('postgame-round-table')
  const session = sessionFor(game, { human: [4], modelSeats: [0, 1] })
  const client = fakeClient(() => [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.deepEqual(record.turnOrder, [0, 1])
  assert.deepEqual(
    client.calls.map((call) => Number(String(call.opts.tag).split('/').at(-1))),
    [0, 1],
    'turns are sequential in seat order',
  )
  assert.equal(record.seats[0]!.review?.statement, 'I would take back the second team.')

  const firstPrompt = client.calls[0]!.messages.map((message) => message.content).join('\n')
  assert.match(firstPrompt, /You speak first\./)
  const secondPrompt = client.calls[1]!.messages.map((message) => message.content).join('\n')
  assert.match(secondPrompt, /EARLIER POST-GAME TURNS/)
  assert.match(secondPrompt, /I would take back the second team\./)
  assert.doesNotMatch(secondPrompt, /You speak first\./)
})

test('a parse failure gets exactly one retry and can then complete', async () => {
  const game = await finishedGame('postgame-retry')
  const session = sessionFor(game, { human: [4], modelSeats: [0] })
  const client = fakeClient((seat) => seat === 0
    ? [{ content: 'not json' }, { content: VALID }]
    : [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.equal(client.calls.length, 2)
  assert.equal(record.seats[0]!.status, 'complete')
  assert.equal(record.seats[0]!.error, undefined)
  const retryMessages = client.calls[1]!.messages.map((m) => m.content).join('\n')
  assert.match(retryMessages, /RETRY/)
})

test('one seat failing twice leaves the others complete and the record partial', async () => {
  const game = await finishedGame('postgame-partial')
  const session = sessionFor(game, { human: [4], modelSeats: [0, 1] })
  const client = fakeClient((seat) => seat === 1
    ? [{ content: 'nope' }, { content: 'still nope' }]
    : [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.equal(record.status, 'partial')
  assert.equal(record.seats[0]!.status, 'complete')
  assert.equal(record.seats[1]!.status, 'failed')
  assert.match(record.seats[1]!.error ?? '', /expected one JSON object/)
  assert.equal(client.calls.length, 3)
})

test('an all-failed fan-out is terminal, not spinning', async () => {
  const game = await finishedGame('postgame-failed')
  const session = sessionFor(game, { human: [4], modelSeats: [0, 1] })
  const client = fakeClient(() => [{ content: 'bad' }, { content: 'bad again' }])
  const record = await runPostgame(session, game, { client })

  assert.equal(record.status, 'failed')
  assert.ok(record.completedAt)
  assert.equal(record.seats[0]!.status, 'failed')
  assert.equal(record.seats[1]!.status, 'failed')
})

test('a heuristic-only table makes no calls and settles complete', async () => {
  const game = await finishedGame('postgame-offline')
  const session = sessionFor(game, { human: [0] })
  const client = fakeClient(() => [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.equal(client.calls.length, 0)
  assert.equal(record.status, 'complete')
  for (const seat of Object.values(record.seats)) {
    assert.equal(seat.status, seat.kind === 'human' ? 'pending' : 'unavailable')
  }
})

test('composed seats are unavailable in v1', async () => {
  const game = await finishedGame('postgame-composed')
  const session = sessionFor(game, { human: [4], modelSeats: [0], composedSeats: [1] })
  const client = fakeClient(() => [{ content: VALID }])
  const record = await runPostgame(session, game, { client })

  assert.equal(record.seats[1]!.status, 'unavailable')
  assert.match(record.seats[1]!.error ?? '', /composed/)
  assert.equal(client.calls.length, 1)
})

test('archive updates are keyed by the finished game id and never fatal', async () => {
  const game = await finishedGame('postgame-archive')
  const session = sessionFor(game, { human: [4], modelSeats: [0] })
  const client = fakeClient(() => [{ content: VALID }])
  const updates: { id: string; record: PostgameRecord }[] = []
  const record = await runPostgame(session, game, {
    client,
    archive: {
      update(id, next) {
        updates.push({ id, record: structuredClone(next) })
        if (updates.length === 1) throw new Error('disk full')
      },
    },
  })

  assert.ok(updates.length >= 2)
  for (const update of updates) assert.equal(update.id, game.id)
  assert.equal(updates.at(-1)!.record.status, 'complete')
  assert.equal(record.status, 'complete')
})

test('commissioned reviews keep distinct spend tags per game and seat', async () => {
  const first = await finishedGame('postgame-tags-a')
  const second = await finishedGame('postgame-tags-b')
  const client = fakeClient(() => [{ content: VALID }])
  const [a, b] = await Promise.all([
    runPostgame(sessionFor(first, { human: [4], modelSeats: [0] }), first, { client }),
    runPostgame(sessionFor(second, { human: [4], modelSeats: [0] }), second, { client }),
  ])
  assert.equal(a.seats[0]!.cost?.usd, 0.01)
  assert.equal(b.seats[0]!.cost?.usd, 0.01)
  const tags = client.calls.map((call) => call.opts.tag)
  assert.equal(new Set(tags).size, 2)
  assert.deepEqual(new Set(tags), new Set([
    reviewTag('llm-0', first.id, 0),
    reviewTag('llm-0', second.id, 0),
  ]))
})

test('a model error is a seat failure, never an exception out of the runner', async () => {
  const game = await finishedGame('postgame-error')
  const session = sessionFor(game, { human: [4], modelSeats: [0] })
  const client = fakeClient(() => [{ content: VALID, error: new Error('provider exploded') }])
  const record = await runPostgame(session, game, { client })
  assert.equal(record.seats[0]!.status, 'failed')
  assert.match(record.seats[0]!.error ?? '', /provider exploded/)
})

test('restart settlement never spends money and settles partial or failed', () => {
  const partial = postgameRecordFor([
    { seat: 0, kind: 'agent', model: 'test/model', status: 'complete' },
    { seat: 1, kind: 'agent', model: 'test/model', status: 'running' },
    { seat: 2, kind: 'human', status: 'pending' },
  ])
  settleInterruptedPostgame(partial, '2026-01-01T01:00:00.000Z')
  assert.equal(partial.status, 'partial')
  assert.equal(partial.completedAt, '2026-01-01T01:00:00.000Z')
  assert.equal(partial.seats[1]!.status, 'failed')
  assert.match(partial.seats[1]!.error ?? '', /interrupted/)
  assert.equal(partial.seats[2]!.status, 'pending')

  const failed = postgameRecordFor([
    { seat: 0, kind: 'agent', model: 'test/model', status: 'running' },
    { seat: 1, kind: 'human', status: 'pending' },
  ])
  settleInterruptedPostgame(failed, '2026-01-01T01:00:00.000Z')
  assert.equal(failed.status, 'failed')
})

test('status aggregation consults model seats only', () => {
  const seat = (status: PostgameSeat['status'], model?: string): PostgameSeat => ({
    seat: 0,
    kind: 'agent',
    ...(model ? { model } : {}),
    status,
  })
  assert.equal(postgameStatusFromSeats([seat('pending', 'm'), seat('pending')]), 'running')
  assert.equal(postgameStatusFromSeats([seat('complete', 'm'), seat('pending')]), 'complete')
  assert.equal(postgameStatusFromSeats([seat('complete', 'm'), seat('failed', 'm')]), 'partial')
  assert.equal(postgameStatusFromSeats([seat('failed', 'm'), seat('failed', 'm')]), 'failed')
  assert.equal(postgameStatusFromSeats([seat('unavailable')]), 'complete')
})

function postgameRecordFor(
  seats: { seat: number; kind: 'agent' | 'human'; model?: string; status: PostgameSeat['status'] }[],
): PostgameRecord {
  return {
    version: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    seats: Object.fromEntries(seats.map((seat) => [seat.seat, { ...seat }])),
  }
}
