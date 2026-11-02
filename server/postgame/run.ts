// Post-game review runner. It runs beside the finished game, never inside it:
// the reveal is already complete when this starts, so every failure here is a
// status on one seat, never an error that reaches the table.
//
// The runner is deliberately handed a structural session shape rather than the
// HTTP server's `Session` type. That keeps server/postgame independent of the
// HTTP composition root (and lets the future archive CLI reuse the same runner
// without booting a server). A real Session satisfies this interface as-is.

import { viewForPostgame } from '../engine/view.ts'
import { getClient } from '../llm/client.ts'
import { POSTGAME_CALL_PARAMS } from './params.ts'
import { buildPostgameMessages } from './prompts.ts'
import { parsePostgameReply } from './parse.ts'
import {
  POSTGAME_ERROR_MAX_CHARS,
  postgameRecord,
  postgameStatusFromSeats,
} from './types.ts'
import type { PostgameRecord, PostgameSeat, PostgameSeatInit } from './types.ts'
import type { Game, Seat } from '../engine/types.ts'
import type { OpenRouterClient } from '../llm/openrouter.ts'
import type { SeatedAgent } from '../seated-agent.ts'

/** The mutable slice of a session the runner owns. */
export interface PostgameSession {
  postgame?: PostgameRecord
  postgameRev: number
  humans: ReadonlyMap<Seat, unknown>
  seatedAgents: Readonly<Record<number, SeatedAgent>>
}

export interface PostgameArchive {
  update(id: string, record: PostgameRecord): void
}

export interface PostgameDeps {
  /** Fake client in tests; the shared client otherwise. */
  client?: OpenRouterClient
  /** Durable sink. A throw is warned and swallowed, never fatal. */
  archive?: PostgameArchive
  /** A cheap change signal, typically the session's SSE broadcast. */
  notify?: (record: PostgameRecord) => void
}

/** The spend bucket for one review, unique per game and seat. */
export function reviewTag(agentId: string, gameId: string, seat: Seat): string {
  return `${agentId}/review/${gameId}/${seat}`
}

function postgameConcurrency(): number {
  const raw = Number(process.env.AVALON_POSTGAME_CONCURRENCY)
  if (!Number.isFinite(raw)) return 3
  return Math.min(4, Math.max(1, Math.trunc(raw)))
}

const clamp = (text: string, max: number): string => text.trim().slice(0, max)

function seatInit(session: PostgameSession, seat: Seat): PostgameSeatInit {
  if (session.humans.has(seat)) return { seat, kind: 'human' }
  const seated = session.seatedAgents[seat]
  // Raw LLM agents are the only seats with a review call in v1. A composed
  // agent's planner context is a separate audited projection, and heuristic or
  // random seats have no model to ask, so both are honestly unavailable.
  if (
    seated
    && seated.def.engine.type === 'llm'
    && seated.def.unavailable === undefined
    && !seated.info.model.includes(' (unavailable)')
  ) {
    return { seat, kind: 'agent', model: seated.info.model }
  }
  return { seat, kind: 'agent' }
}

function unavailableReason(session: PostgameSession, seat: Seat): string | undefined {
  const seated = session.seatedAgents[seat]
  if (!seated) return 'no agent on this seat'
  if (seated.def.unavailable) return seated.def.unavailable
  if (seated.info.model.includes(' (unavailable)')) {
    return `model "${seated.info.model}" is unavailable`
  }
  if (seated.def.engine.type === 'composed') {
    return 'composed agents do not run a review in v1'
  }
  return 'no model to ask for a review'
}

async function runBounded<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0
  const count = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: count }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      await worker(items[index]!)
    }
  }))
}

export async function runPostgame(
  session: PostgameSession,
  game: Game,
  deps: PostgameDeps = {},
): Promise<PostgameRecord> {
  const inits = game.players.map((player) => seatInit(session, player.seat))
  const record = postgameRecord(inits)
  const startsInits = new Map(inits.map((init) => [init.seat, init]))
  for (const seat of Object.values(record.seats)) {
    const init = startsInits.get(seat.seat)
    if (!init) continue
    if (init.kind === 'agent' && init.model === undefined) {
      seat.status = 'unavailable'
      const reason = unavailableReason(session, seat.seat)
      if (reason) seat.error = reason
    }
  }
  settleStatus(record, new Date().toISOString())
  session.postgame = record
  session.postgameRev += 1
  commit(session, game, record, deps)

  const modeled = Object.values(record.seats).filter(
    (seat) => seat.kind === 'agent' && seat.model !== undefined,
  )

  const reviewSeat = async (seat: PostgameSeat): Promise<void> => {
    const model = seat.model
    if (!model) return
    const client = deps.client ?? getClient()
    const seated = session.seatedAgents[seat.seat]
    const tag = reviewTag(seated?.def.id ?? 'agent', game.id, seat.seat)
    const before = client.getSpend()[tag]?.cost ?? 0
    seat.status = 'running'
    settleStatus(record, new Date().toISOString())
    session.postgameRev += 1
    commit(session, game, record, deps)

    let error = ''
    let content = ''
    try {
      const view = viewForPostgame(game, seat.seat)
      const params = POSTGAME_CALL_PARAMS.review
      const callOpts = {
        tag,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        ...(params.json ? { response_format: { type: 'json_object' } } : {}),
      } as const
      content = await client.call(
        model,
        buildPostgameMessages('review', view),
        callOpts,
      )
      let parsed = parsePostgameReply(content, view)
      if (!parsed.ok) {
        content = await client.call(
          model,
          buildPostgameMessages('review', view, {
            retryError: parsed.error,
            previousReply: content,
          }),
          callOpts,
        )
        parsed = parsePostgameReply(content, view)
      }
      if (parsed.ok) {
        seat.review = parsed.review
        seat.status = 'complete'
      } else {
        error = parsed.error
        seat.status = 'failed'
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      seat.status = 'failed'
    }

    const after = client.getSpend()[tag]
    if (after) {
      seat.cost = {
        promptTokens: after.prompt,
        completionTokens: after.completion,
        usd: Math.max(0, after.cost - before),
      }
    }
    if (error) {
      const snippet = content.trim().slice(0, 200)
      seat.error = clamp(
        `${error}${snippet ? ` | reply: ${snippet}` : ''}`,
        POSTGAME_ERROR_MAX_CHARS,
      )
    }
    settleStatus(record, new Date().toISOString())
    session.postgameRev += 1
    commit(session, game, record, deps)
  }

  try {
    await runBounded(modeled, postgameConcurrency(), reviewSeat)
  } catch (err) {
    // runBounded rejects only if a worker escaped reviewSeat's own guard, which
    // should be impossible. The finished game must still get a terminal record.
    console.warn(`[postgame] review fan-out failed for ${game.id}: ${err instanceof Error ? err.message : String(err)}`)
    for (const seat of modeled) {
      if (seat.status === 'pending' || seat.status === 'running') {
        seat.status = 'failed'
        seat.error ??= 'review fan-out failed'
      }
    }
    settleStatus(record, new Date().toISOString())
    session.postgameRev += 1
    commit(session, game, record, deps)
  }
  return record
}

/**
 * Set the aggregate status and stamp `completedAt` once. Human seats are not
 * consulted, so an unwritten note never keeps the record running.
 */
function settleStatus(record: PostgameRecord, now: string): void {
  record.status = postgameStatusFromSeats(Object.values(record.seats))
  if (record.status !== 'running' && record.completedAt === undefined) {
    record.completedAt = now
  }
}

function commit(
  session: PostgameSession,
  game: Game,
  record: PostgameRecord,
  deps: PostgameDeps,
): void {
  // The session holds the same object, so later mutations are visible without
  // another assignment. Keeping the assignment here makes the ownership clear
  // for a re-run that replaces the record.
  session.postgame = record
  if (deps.archive) {
    try {
      deps.archive.update(game.id, record)
    } catch (err) {
      console.warn(`[postgame] could not persist review for ${game.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (deps.notify) {
    try {
      deps.notify(record)
    } catch (err) {
      console.warn(`[postgame] could not announce review for ${game.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
