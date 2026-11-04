// Post-game review runner. It runs beside the finished game, never inside it:
// the reveal is already complete when this starts, so every failure here is a
// status on one seat, never an error that reaches the table.
//
// The runner is deliberately handed a structural session shape rather than the
// HTTP server's `Session` type. That keeps server/postgame independent of the
// HTTP composition root (and lets the future archive CLI reuse the same runner
// without booting a server). A real Session satisfies this interface as-is.
//
// The post-game work has two phases. The table talk runs first, sequentially in
// seat order, so every seat hears the table's outside view before it writes its
// own review. The reviews then run independently from the same completed talk,
// so one review cannot anchor another. The talk is the conversation; the review
// is the private analysis.

import { viewForPostgame } from '../engine/view.ts'
import { getClient } from '../llm/client.ts'
import { POSTGAME_CALL_PARAMS } from './params.ts'
import { buildPostgameMessages } from './prompts.ts'
import { parsePostgameReply, parsePostgameTalkReply } from './parse.ts'
import {
  POSTGAME_ERROR_MAX_CHARS,
  postgameRecord,
  postgameStatusFromSeats,
} from './types.ts'
import type {
  PostgameRecord,
  PostgameSeat,
  PostgameSeatInit,
} from './types.ts'
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
  /** How long the reviews wait for a human talk turn (default 5 minutes). */
  humanTalkTimeoutMs?: number
}

/** The spend bucket for one table-talk turn, unique per game and seat. */
export function talkTag(agentId: string, gameId: string, seat: Seat): string {
  return `${agentId}/talk/${gameId}/${seat}`
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

function humanTalkTimeout(deps: PostgameDeps): number {
  if (deps.humanTalkTimeoutMs !== undefined) {
    return Math.max(0, deps.humanTalkTimeoutMs)
  }
  const raw = Number(process.env.AVALON_POSTGAME_HUMAN_TALK_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60_000
}

async function waitForHumanTalk(
  record: PostgameRecord,
  humanSeats: readonly Seat[],
  timeoutMs: number,
): Promise<void> {
  if (!humanSeats.length) return
  const done = (): boolean => humanSeats.every((seat) =>
    record.tableTalk?.some((turn) => turn.seat === seat) === true
    || record.skippedTalk?.includes(seat) === true,
  )
  if (done()) return
  const deadline = Date.now() + timeoutMs
  while (!done() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const clamp = (text: string, max: number): string => text.trim().slice(0, max)

function seatInit(session: PostgameSession, seat: Seat): PostgameSeatInit {
  if (session.humans.has(seat)) return { seat, kind: 'human' }
  const seated = session.seatedAgents[seat]
  // Raw LLM agents are the only seats with model calls in v1. A composed
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

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function clampError(error: string, content: string): string {
  const snippet = content.trim().slice(0, 200)
  return clamp(
    `${error}${snippet ? ` | reply: ${snippet}` : ''}`,
    POSTGAME_ERROR_MAX_CHARS,
  )
}

function spendDelta(
  client: OpenRouterClient,
  tag: string,
  before: number,
): { promptTokens: number; completionTokens: number; usd: number } | undefined {
  const after = client.getSpend()[tag]
  if (!after) return undefined
  return {
    promptTokens: after.prompt,
    completionTokens: after.completion,
    usd: Math.max(0, after.cost - before),
  }
}

export async function runPostgame(
  session: PostgameSession,
  game: Game,
  deps: PostgameDeps = {},
): Promise<PostgameRecord> {
  const inits = game.players.map((player) => seatInit(session, player.seat))
  const record = postgameRecord(inits)
  record.phase = 'talk'
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
  bumpAndCommit(session, game, record, deps)

  const modeled = Object.values(record.seats)
    .filter((seat) => seat.kind === 'agent' && seat.model !== undefined)
    .sort((a, b) => a.seat - b.seat)
  const tableTalk = record.tableTalk ?? (record.tableTalk = [])

  // Phase 1: the table talk. Sequential by design, because each speaker needs
  // the earlier turns to answer them.
  const talkSeat = async (seat: PostgameSeat): Promise<void> => {
    const model = seat.model
    if (!model) return
    const client = deps.client ?? getClient()
    const seated = session.seatedAgents[seat.seat]
    const tag = talkTag(seated?.def.id ?? 'agent', game.id, seat.seat)
    const before = client.getSpend()[tag]?.cost ?? 0
    let error = ''
    let content = ''
    try {
      const view = viewForPostgame(game, seat.seat)
      const params = POSTGAME_CALL_PARAMS.tableTalk
      const callOpts = {
        tag,
        temperature: params.temperature,
        max_tokens: params.max_tokens,
        ...(params.json ? { response_format: { type: 'json_object' } } : {}),
      } as const
      const promptExtra = tableTalk.length ? { priorTurns: tableTalk } : {}
      content = await client.call(
        model,
        buildPostgameMessages('tableTalk', view, promptExtra),
        callOpts,
      )
      let parsed = parsePostgameTalkReply(content, view)
      if (!parsed.ok) {
        content = await client.call(
          model,
          buildPostgameMessages('tableTalk', view, {
            ...promptExtra,
            retryError: parsed.error,
            previousReply: content,
          }),
          callOpts,
        )
        parsed = parsePostgameTalkReply(content, view)
      }
      if (parsed.ok) {
        tableTalk.push(parsed.turn)
      } else {
        error = parsed.error
      }
    } catch (err) {
      error = errorText(err)
    }
    seat.talkCost = spendDelta(client, tag, before)
    if (error) {
      seat.talkError = clampError(error, content)
    } else {
      delete seat.talkError
    }
    settleStatus(record, new Date().toISOString())
    bumpAndCommit(session, game, record, deps)
  }

  for (const seat of modeled) {
    try {
      await talkSeat(seat)
    } catch (err) {
      // A client-resolution failure is a talk failure, not a reason to lose the
      // rest of the table. The review phase can still run.
      seat.talkError = clampError(errorText(err), '')
      bumpAndCommit(session, game, record, deps)
    }
  }

  // A seated human is part of the talk too. Give every human who is still at
  // the table a chance to speak after hearing the model turns; the reviews do
  // not start until each human has spoken, skipped, or the timeout expires.
  const humanSeats = [...session.humans.keys()].sort((a, b) => a - b)
  await waitForHumanTalk(record, humanSeats, humanTalkTimeout(deps))

  // Phase 2: independent reviews. Every review sees the completed talk, but no
  // review sees another review. That keeps the outside context without letting
  // one seat's conclusion anchor the next.
  record.phase = 'review'
  settleStatus(record, new Date().toISOString())
  bumpAndCommit(session, game, record, deps)

  const reviewSeat = async (seat: PostgameSeat): Promise<void> => {
    const model = seat.model
    if (!model) return
    const client = deps.client ?? getClient()
    const seated = session.seatedAgents[seat.seat]
    const tag = reviewTag(seated?.def.id ?? 'agent', game.id, seat.seat)
    const before = client.getSpend()[tag]?.cost ?? 0
    seat.status = 'running'
    settleStatus(record, new Date().toISOString())
    bumpAndCommit(session, game, record, deps)

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
      const promptExtra = tableTalk.length ? { tableTalk } : {}
      content = await client.call(
        model,
        buildPostgameMessages('review', view, promptExtra),
        callOpts,
      )
      let parsed = parsePostgameReply(content, view)
      if (!parsed.ok) {
        content = await client.call(
          model,
          buildPostgameMessages('review', view, {
            ...promptExtra,
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
      error = errorText(err)
      seat.status = 'failed'
    }
    seat.cost = spendDelta(client, tag, before)
    if (error) {
      seat.error = clampError(error, content)
    }
    settleStatus(record, new Date().toISOString())
    bumpAndCommit(session, game, record, deps)
  }

  try {
    await runBounded(modeled, postgameConcurrency(), reviewSeat)
  } catch (err) {
    // A worker escaped reviewSeat's own guard, which should be impossible. The
    // finished game must still get a terminal record.
    console.warn(`[postgame] review phase failed for ${game.id}: ${errorText(err)}`)
    for (const seat of modeled) {
      if (seat.status === 'pending' || seat.status === 'running') {
        seat.status = 'failed'
        seat.error ??= 'review fan-out failed'
      }
    }
    settleStatus(record, new Date().toISOString())
    bumpAndCommit(session, game, record, deps)
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

function bumpAndCommit(
  session: PostgameSession,
  game: Game,
  record: PostgameRecord,
  deps: PostgameDeps,
): void {
  session.postgame = record
  session.postgameRev += 1
  commit(session, game, record, deps)
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
      console.warn(`[postgame] could not persist review for ${game.id}: ${errorText(err)}`)
    }
  }
  if (deps.notify) {
    try {
      deps.notify(record)
    } catch (err) {
      console.warn(`[postgame] could not announce review for ${game.id}: ${errorText(err)}`)
    }
  }
}
