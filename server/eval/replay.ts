// Deterministic replay: rebuild the live Game — and therefore any seat's
// PlayerView — at any decision point of an archived game. The artifact's
// unredacted log contains every decision (utterances, proposals, private
// voteCast/questCard, assassination, renames), and the engine is pure and
// seeded, so re-applying those decisions to createGame(same seed) reproduces
// the original event-for-event. Replay VERIFIES that: any divergence between
// the replayed log and the artifact log is a hard error, because a snapshot
// taken from a drifted replay would be fiction.
//
// This is the foundation of the situation bank (design doc §6): a judge
// incident cites an event seq; snapshotAt() turns that into the exact
// (DecisionRequest, PlayerView, scratchpad) the deciding agent faced, which
// any prompt version can then replay as a single LLM call.

import { isDeepStrictEqual } from 'node:util'
import {
  applyDecision,
  applyDecisionWithOutcome,
  createGame,
  renamePlayer,
} from '../engine/game.ts'
import {
  createIncrementalPlayerViewProjection,
  viewFor,
} from '../engine/view.ts'
import { MIN_REPLAYABLE_SCHEMA } from './artifact.ts'
import type { GameArtifact } from './artifact.ts'
import type {
  Decision, DecisionRequest, Game, GameEvent, PlayerView, Seat,
} from '../engine/types.ts'
import { decisionTraceId, type DecisionTrace } from '../agents/trace.ts'

interface ReplayStep {
  firstSeq: number  // first event this step emitted (thinking/scratchpad precede the action)
  actionSeq: number
  seat: Seat
  action: Decision | { kind: 'rename'; to: string }
  scratchpad: string
}

export type ReplayOperationKind =
  | 'log-event-scanned'
  | 'seat-view-event-projected'
  | 'authoritative-action-applied'
  | 'selected-action-probed'

export interface ReplayOperationCounts {
  logEventsScanned: number
  seatViewEventsProjected: number
  snapshotBytesEmitted: number
  authoritativeActionsApplied: number
  authoritativeDecisionsCaptured: number
  selectedActionsProbed: number
}

export interface SelectedDecisionProbe {
  targetSeat: Seat
  decisionId: string
  decision: Decision
}

export type SelectedDecisionReplay =
  | Readonly<{
      targetSeat: Seat
      status: 'applied'
      appliedDecision: Decision
    }>
  | Readonly<{
      targetSeat: Seat
      status: 'rejected'
      stateUnchanged: boolean
    }>

export interface DecisionReplayTimeline {
  snapshots: readonly DecisionSnapshot[]
  selectedDecisions: ReadonlyMap<string, SelectedDecisionReplay>
  operations: ReplayOperationCounts
}

export interface DecisionReplayTimelineOptions {
  selectedDecisions?: readonly SelectedDecisionProbe[]
  onOperation?: (kind: ReplayOperationKind) => void
}

// Reconstruct the decision stream from the log. thinking/scratchpad events are
// folded into the decision that emitted them so the replayed log reproduces
// the original seq-for-seq.
function extractSteps(
  log: readonly GameEvent[],
  onOperation?: (kind: ReplayOperationKind) => void,
  serializedEvents?: string[],
): ReplayStep[] {
  const steps: ReplayStep[] = []
  // seat -> pending private preamble (thinking/notes emitted just before the action)
  const pending = new Map<Seat, { thinking?: string; notes?: string; firstSeq: number }>()
  const lastScratchpad = new Map<Seat, string>()

  const take = (
    seat: Seat,
    actionSeq: number,
  ): {
    thinking?: string
    notes?: string
    firstSeq: number
    scratchpad: string
  } => {
    const p = pending.get(seat) ?? { firstSeq: actionSeq }
    pending.delete(seat)
    return {
      ...p,
      scratchpad: p.notes ?? lastScratchpad.get(seat) ?? '',
    }
  }

  for (const ev of log) {
    onOperation?.('log-event-scanned')
    serializedEvents?.push(JSON.stringify(ev))
    const p = ev.payload
    switch (ev.type) {
      case 'thinking': {
        const seat = p.seat as Seat
        const cur = pending.get(seat) ?? { firstSeq: ev.seq }
        cur.thinking = p.text as string
        pending.set(seat, cur)
        break
      }
      case 'scratchpad': {
        const seat = p.seat as Seat
        const cur = pending.get(seat) ?? { firstSeq: ev.seq }
        cur.notes = p.text as string
        pending.set(seat, cur)
        lastScratchpad.set(seat, p.text as string)
        break
      }
      case 'utterance': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'discuss', say: p.text as string,
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'proposal': {
        const seat = p.leader as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'propose', team: (p.team as Seat[]).slice(),
            ...(typeof p.pitch === 'string' ? { pitch: p.pitch } : {}),
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'voteCast': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'vote', vote: p.vote as 'approve' | 'reject',
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'questCard': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'quest', card: p.card as 'success' | 'fail',
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'assassination': {
        const seat = p.assassin as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'assassinate', target: p.target as Seat,
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'proposalLocked': {
        const seat = p.leader as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'finalize', stick: true,
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'proposalRevised': {
        const seat = p.leader as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'finalize', stick: false, team: (p.to as Seat[]).slice(),
            ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
          scratchpad: pre.scratchpad,
        })
        break
      }
      case 'rename':
        steps.push({
          firstSeq: ev.seq, actionSeq: ev.seq, seat: p.seat as Seat,
          action: { kind: 'rename', to: p.to as string },
          scratchpad: '',
        })
        break
      // Engine-emitted events (voteReveal, questResult, leadChange, gameOver,
      // gameCreated, roleDealt, knowledge) are consequences, not decisions.
    }
  }
  return steps
}

function createReplayGame(a: GameArtifact): Game {
  if (a.schema < MIN_REPLAYABLE_SCHEMA) {
    throw new Error(
      `artifact ${a.id} is schema ${a.schema}, below the replayable floor of ${MIN_REPLAYABLE_SCHEMA}: `
      + `readable as data, but the engine that produced its log no longer exists, so it cannot be replayed`,
    )
  }
  const created = a.log[0]
  if (created?.type !== 'gameCreated') {
    throw new Error('artifact log must start with gameCreated')
  }
  const game = createGame({
    seed: a.seed,
    playerCount: a.playerCount,
    ...(a.roles ? { roles: a.roles.slice() } : {}),
    names: initialReplayNames(a),
    talk: a.talk,
    id: a.id,
  })
  for (const p of game.players) {
    if (p.role !== a.players[p.seat].role) {
      throw new Error(
        `replay deal mismatch at seat ${p.seat}: dealt ${p.role}, archived ${a.players[p.seat].role}`
        + (a.roles ? '' : ' — pre-v2 artifact with no stored roles and a non-default deal'),
      )
    }
  }
  return game
}

function initialReplayNames(a: GameArtifact): string[] {
  const created = a.log[0]
  if (created?.type !== 'gameCreated') {
    throw new Error('artifact log must start with gameCreated')
  }
  const names = (created.payload.names as string[]).slice()
  for (let index = a.log.length - 1; index >= 0; index--) {
    const event = a.log[index]
    if (event.type !== 'rename') continue
    const seat = event.payload.seat as Seat
    const from = event.payload.from
    const to = event.payload.to
    if (
      Number.isInteger(seat)
      && typeof from === 'string'
      && typeof to === 'string'
      && names[seat] === to
    ) {
      names[seat] = from
    }
  }
  return names
}

function serializedArtifactEventForReplay(
  a: GameArtifact,
  index: number,
): string {
  const event = a.log[index]
  if (index !== 0 || event?.type !== 'gameCreated') {
    return JSON.stringify(event)
  }
  return JSON.stringify({
    seq: event.seq,
    type: event.type,
    payload: {
      ...event.payload,
      names: initialReplayNames(a),
    },
    visibility: event.visibility,
  })
}

function verifyPrefix(a: GameArtifact, game: Game): void {
  for (let i = 0; i < game.log.length; i++) {
    const archived = serializedArtifactEventForReplay(a, i)
    if (JSON.stringify(game.log[i]) !== archived) {
      throw new Error(
        `replay drift at seq ${i}: replayed ${JSON.stringify(game.log[i])} !== archived ${archived}`,
      )
    }
  }
}

// Replay up to (not including) the step whose event span contains untilSeq;
// omit untilSeq to replay the whole game. The returned Game's log is verified
// to be an exact prefix of the artifact's.
export function replayGame(a: GameArtifact, untilSeq?: number): Game {
  if (a.schema < MIN_REPLAYABLE_SCHEMA) {
    throw new Error(
      `artifact ${a.id} is schema ${a.schema}, below the replayable floor of ${MIN_REPLAYABLE_SCHEMA}: `
      + `readable as data, but the engine that produced its log no longer exists, so it cannot be replayed`,
    )
  }
  const created = a.log[0]
  if (created?.type !== 'gameCreated') throw new Error('artifact log must start with gameCreated')
  const game = createGame({
    seed: a.seed,
    playerCount: a.playerCount,
    // Pass the persisted config-order roles so the seeded shuffle reproduces the
    // exact deal — this is what makes custom-role games replayable. Pre-v2
    // artifacts lack `roles`; omitting it falls back to the default set, which
    // is what those games used, and the check below still guards against drift.
    ...(a.roles ? { roles: a.roles.slice() } : {}),
    names: initialReplayNames(a),
    talk: a.talk,
    id: a.id,
  })
  for (const p of game.players) {
    if (p.role !== a.players[p.seat].role) {
      throw new Error(
        `replay deal mismatch at seat ${p.seat}: dealt ${p.role}, archived ${a.players[p.seat].role}`
        + (a.roles ? '' : ' — pre-v2 artifact with no stored roles and a non-default deal'),
      )
    }
  }
  for (const step of extractSteps(a.log)) {
    if (untilSeq !== undefined && step.firstSeq >= untilSeq) break
    if (step.action.kind === 'rename') renamePlayer(game, step.seat, step.action.to)
    else applyDecision(game, step.seat, step.action)
  }
  verifyPrefix(a, game)
  if (untilSeq === undefined && game.log.length !== a.log.length) {
    throw new Error(`replay incomplete: ${game.log.length} events vs ${a.log.length} archived`)
  }
  return game
}

export interface DecisionSnapshot {
  artifactId: string
  seed: string
  seq: number        // the action event
  firstSeq: number
  seat: Seat
  kind: DecisionRequest['kind']
  role: string
  req: DecisionRequest
  view: PlayerView   // exactly what the deciding agent saw
  scratchpad: string // the agent's private notes at that moment ('' if none)
  original: Decision // what actually happened, including private thinking
  trace?: DecisionTrace
}

function snapshotForStep(
  a: GameArtifact,
  game: Game,
  step: ReplayStep,
  traces: ReadonlyMap<string, DecisionTrace>,
  view: PlayerView,
): DecisionSnapshot {
  if (step.action.kind === 'rename') {
    throw new Error('rename steps do not have decision snapshots')
  }
  const original = step.action
  const req: DecisionRequest = {
    kind: original.kind,
    seat: step.seat,
    round: game.round,
    proposalNum: game.proposalNum,
  }
  const traceId = decisionTraceId(
    req,
    view,
    view.events.reduce(
      (cursor, event) => Math.max(cursor, event.seq),
      -1,
    ),
  )
  const trace = traces.get(traceId)
  return {
    artifactId: a.id,
    seed: a.seed,
    seq: step.actionSeq,
    firstSeq: step.firstSeq,
    seat: step.seat,
    kind: original.kind,
    role: a.players[step.seat].role,
    req,
    view,
    scratchpad: step.scratchpad,
    original,
    ...(trace ? { trace } : {}),
  }
}

function verifySerializedEvents(
  expected: readonly string[],
  game: Game,
  from: number,
): number {
  for (let index = from; index < game.log.length; index++) {
    const replayed = JSON.stringify(game.log[index])
    if (replayed !== expected[index]) {
      throw new Error(
        `replay drift at seq ${index}: replayed ${replayed} !== archived ${expected[index]}`,
      )
    }
  }
  return game.log.length
}

/**
 * Replay a complete artifact once and capture every predecision seat view.
 *
 * Optional selected-decision probes run against a clone of the current
 * predecision state. Only normalized actions or rejection nonmutation
 * evidence leave this module; raw Game state never does.
 */
export function decisionReplayTimeline(
  a: GameArtifact,
  options: DecisionReplayTimelineOptions = {},
): DecisionReplayTimeline {
  const counts = {
    logEventsScanned: 0,
    seatViewEventsProjected: 0,
    snapshotBytesEmitted: 0,
    authoritativeActionsApplied: 0,
    authoritativeDecisionsCaptured: 0,
    selectedActionsProbed: 0,
  }
  const operation = (kind: ReplayOperationKind): void => {
    if (kind === 'log-event-scanned') {
      counts.logEventsScanned++
    } else if (kind === 'seat-view-event-projected') {
      counts.seatViewEventsProjected++
    } else if (kind === 'authoritative-action-applied') {
      counts.authoritativeActionsApplied++
    } else {
      counts.selectedActionsProbed++
    }
    options.onOperation?.(kind)
  }
  const probes = new Map<string, SelectedDecisionProbe>()
  for (const probe of options.selectedDecisions ?? []) {
    if (probes.has(probe.decisionId)) {
      throw new Error(
        `duplicate selected-decision probe ${probe.decisionId}`,
      )
    }
    probes.set(probe.decisionId, {
      targetSeat: probe.targetSeat,
      decisionId: probe.decisionId,
      decision: structuredClone(probe.decision),
    })
  }
  const traces = new Map<string, DecisionTrace>()
  for (const trace of a.decisionTraces ?? []) {
    if (!traces.has(trace.decisionId)) {
      traces.set(trace.decisionId, trace)
    }
  }

  const game = createReplayGame(a)
  const serializedEvents: string[] = []
  const snapshots: DecisionSnapshot[] = []
  const selectedDecisions = new Map<string, SelectedDecisionReplay>()
  const steps = extractSteps(a.log, operation, serializedEvents)
  serializedEvents[0] = serializedArtifactEventForReplay(a, 0)
  const viewProjection = createIncrementalPlayerViewProjection(
    game,
    () => operation('seat-view-event-projected'),
  )
  let verifiedThrough = verifySerializedEvents(
    serializedEvents,
    game,
    0,
  )
  for (const step of steps) {
    if (step.action.kind === 'rename') {
      operation('authoritative-action-applied')
      renamePlayer(game, step.seat, step.action.to)
      viewProjection.sync(game)
      verifiedThrough = verifySerializedEvents(
        serializedEvents,
        game,
        verifiedThrough,
      )
      continue
    }
    const snapshot = snapshotForStep(
      a,
      game,
      step,
      traces,
      viewProjection.viewFor(game, step.seat),
    )
    snapshots.push(snapshot)
    counts.authoritativeDecisionsCaptured++
    counts.snapshotBytesEmitted += Buffer.byteLength(
      JSON.stringify(snapshot.view),
      'utf8',
    )
    const id = decisionTraceId(
      snapshot.req,
      snapshot.view,
      snapshot.view.events.reduce(
        (cursor, event) => Math.max(cursor, event.seq),
        -1,
      ),
    )
    const selected = probes.get(id)
    if (selected && selected.targetSeat === step.seat) {
      operation('selected-action-probed')
      const probeGame = structuredClone(game)
      try {
        const appliedDecision = applyDecisionWithOutcome(
          probeGame,
          step.seat,
          selected.decision,
        ).appliedDecision
        selectedDecisions.set(id, Object.freeze({
          targetSeat: step.seat,
          status: 'applied',
          appliedDecision: structuredClone(appliedDecision),
        }))
      } catch {
        selectedDecisions.set(id, Object.freeze({
          targetSeat: step.seat,
          status: 'rejected',
          stateUnchanged: isDeepStrictEqual(probeGame, game),
        }))
      }
    }
    operation('authoritative-action-applied')
    applyDecision(game, step.seat, step.action)
    viewProjection.sync(game)
    verifiedThrough = verifySerializedEvents(
      serializedEvents,
      game,
      verifiedThrough,
    )
  }
  if (game.log.length !== serializedEvents.length) {
    throw new Error(
      `replay incomplete: ${game.log.length} events vs ${serializedEvents.length} archived`,
    )
  }
  return Object.freeze({
    snapshots: Object.freeze(snapshots),
    selectedDecisions,
    operations: Object.freeze({ ...counts }),
  })
}

// The situation-bank extractor: the full decision context at event seq.
// seq must be a decision's action event (utterance/proposal/proposalLocked/
// proposalRevised/voteCast/questCard/assassination) — engine-emitted
// consequences have no decider.
export function snapshotAt(a: GameArtifact, seq: number): DecisionSnapshot {
  const step = extractSteps(a.log).find((s) => s.firstSeq <= seq && seq <= s.actionSeq)
  if (!step || step.action.kind === 'rename') {
    throw new Error(`seq ${seq} is not a decision event in game ${a.id}`)
  }
  const original = step.action
  const game = replayGame(a, step.firstSeq)
  // The scratchpad the live prompt saw: when a reflect ran this turn, the new
  // notes ride THIS decision (original.notes) and were emitted in its own
  // preamble (seq >= firstSeq) — so a prior-only lookup would return the STALE
  // pad. Prefer the decision's own notes, else the last scratchpad emitted
  // before this step. (These are the exact runtime semantics in llm.ts.)
  const priorPad = a.log.findLast(
    (ev) => ev.type === 'scratchpad' && ev.payload.seat === step.seat && ev.seq < step.firstSeq,
  )
  const view = viewFor(game, step.seat)
  const req: DecisionRequest = {
    kind: original.kind, seat: step.seat,
    round: game.round, proposalNum: game.proposalNum,
  }
  const traceId = decisionTraceId(
    req,
    view,
    view.events.reduce((cursor, event) => Math.max(cursor, event.seq), -1),
  )
  const trace = a.decisionTraces?.find((candidate) => candidate.decisionId === traceId)
  return {
    artifactId: a.id,
    seed: a.seed,
    seq: step.actionSeq,
    firstSeq: step.firstSeq,
    seat: step.seat,
    kind: original.kind,
    role: a.players[step.seat].role,
    req,
    view,
    scratchpad: original.notes ?? (priorPad?.payload.text as string | undefined) ?? '',
    original,
    ...(trace ? { trace } : {}),
  }
}
