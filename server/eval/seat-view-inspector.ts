// Deterministic, API-free inspection of the exact agent boundary.
//
// This module deliberately accepts DecisionRequest + PlayerView, never Game.
// Keep richer cognition, posterior, candidate, and component-trace inspection
// in a separate layer so this tool remains useful while those schemas evolve.

import fs from 'node:fs'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { eventVisibleTo } from '../engine/view.ts'
import type {
  DecisionRequest,
  GameEvent,
  Lean,
  Phase,
  PlayerView,
  ProposalRecord,
  Quest,
  Role,
  Seat,
} from '../engine/types.ts'

export const SEAT_VIEW_INSPECTION_SCHEMA = 1
export const DEFAULT_SEAT_VIEW_FIXTURE_FILE =
  'test/fixtures/architecture-decision-views.json'

interface SeatRef {
  seat: Seat
  name: string
}

export type InspectedPrivateKnowledge =
  | { kind: 'known-evil'; seats: SeatRef[] }
  | { kind: 'merlin-candidates'; seats: SeatRef[]; ordering: 'unordered' }
  | { kind: 'evil-partners'; seats: SeatRef[] }
  | { kind: 'none'; seats: [] }

export interface InspectedEvent {
  seq: number
  type: GameEvent['type']
  scope: 'public' | 'private-to-viewer'
  payload: Record<string, unknown>
}

export interface SeatViewInspection {
  schema: number
  provenance: {
    source: 'DecisionRequest + PlayerView'
    board: 'PlayerView public fields'
    privateKnowledge: 'PlayerView.privateInfo'
    visibleHistory: 'PlayerView.events and PlayerView.transcript'
  }
  decisionPoint: {
    kind: DecisionRequest['kind']
    seat: Seat
    round: number
    proposalNum: number
  }
  self: {
    seat: Seat
    name: string
    role: Role
    alignment: PlayerView['alignment']
  }
  privateKnowledge: InspectedPrivateKnowledge
  publicBoard: {
    playerCount: number
    rolesInPlay: Role[]
    players: SeatRef[]
    phase: Phase
    round: number
    proposalNum: number
    leader: SeatRef
    quests: Quest[]
    proposals: ProposalRecord[]
    currentTeam?: SeatRef[]
    discussionRound?: number
    discussionPostRevision?: boolean
    winner?: PlayerView['winner']
    winReason?: string
  }
  visibleHistory: {
    transcript: {
      seat: Seat
      name: string
      text: string
      lean?: Lean
      prop?: {
        round: number
        proposalNum: number
        leader: Seat
        team: Seat[]
      }
    }[]
    events: InspectedEvent[]
  }
  omissions: string[]
}

const RAW_GAME_FIELDS = [
  'config',
  'log',
  'pendingCards',
  'pendingVotes',
  'seed',
] as const

function fail(message: string): never {
  throw new Error(`seat-view inspection rejected: ${message}`)
}

function clonePlain<T>(value: T, label: string): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return fail(`${label} is not JSON-serializable plain data`)
  }
}

function assertSeat(seat: unknown, playerCount: number, label: string): asserts seat is Seat {
  if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= playerCount) {
    fail(`${label} is not a seat in this view`)
  }
}

function validateBoundary(req: DecisionRequest, view: PlayerView): void {
  if (req.seat !== view.seat) fail(`request seat ${req.seat} does not match view seat ${view.seat}`)
  if (req.round !== view.round || req.proposalNum !== view.proposalNum) {
    fail(
      `request cursor Q${req.round}.${req.proposalNum} does not match `
      + `view cursor Q${view.round}.${view.proposalNum}`,
    )
  }
  if (!Number.isSafeInteger(view.playerCount) || view.playerCount < 1) {
    fail('playerCount is invalid')
  }
  assertSeat(view.seat, view.playerCount, 'viewer seat')

  const opaqueView = view as unknown as Record<string, unknown>
  for (const field of RAW_GAME_FIELDS) {
    if (Object.hasOwn(opaqueView, field)) fail(`raw Game field "${field}" is present`)
  }

  const seen = new Set<Seat>()
  for (const player of view.players) {
    assertSeat(player.seat, view.playerCount, 'public player seat')
    if (seen.has(player.seat)) fail(`public player seat ${player.seat} is duplicated`)
    seen.add(player.seat)
    const opaquePlayer = player as unknown as Record<string, unknown>
    if (Object.hasOwn(opaquePlayer, 'role') || Object.hasOwn(opaquePlayer, 'alignment')) {
      fail(`public player seat ${player.seat} carries hidden role or alignment`)
    }
  }
  if (seen.size !== view.playerCount) fail('public player list is incomplete')

  const knowledgeKeys = [
    view.privateInfo.knownEvil,
    view.privateInfo.merlinCandidates,
    view.privateInfo.evilPartners,
  ].filter((seats) => seats !== undefined)
  if (knowledgeKeys.length > 1) fail('privateInfo has more than one knowledge shape')
  for (const seats of knowledgeKeys) {
    for (const seat of seats!) assertSeat(seat, view.playerCount, 'private knowledge seat')
  }

  for (const event of view.events) {
    if (!eventVisibleTo(event, view.seat)) {
      fail(`event seq=${event.seq} type=${event.type} is not visible to seat ${view.seat}`)
    }
  }
}

function seatLookup(view: PlayerView): Map<Seat, SeatRef> {
  return new Map(view.players.map((player) => [
    player.seat,
    { seat: player.seat, name: player.name },
  ]))
}

function refFor(seat: Seat, refs: Map<Seat, SeatRef>): SeatRef {
  const ref = refs.get(seat)
  if (!ref) return fail(`seat ${seat} is absent from the public player list`)
  return { ...ref }
}

function refsFor(seats: Seat[], refs: Map<Seat, SeatRef>): SeatRef[] {
  return seats
    .slice()
    .sort((a, b) => a - b)
    .map((seat) => refFor(seat, refs))
}

function inspectPrivateKnowledge(
  view: PlayerView,
  refs: Map<Seat, SeatRef>,
): InspectedPrivateKnowledge {
  if (view.privateInfo.knownEvil !== undefined) {
    return { kind: 'known-evil', seats: refsFor(view.privateInfo.knownEvil, refs) }
  }
  if (view.privateInfo.merlinCandidates !== undefined) {
    return {
      kind: 'merlin-candidates',
      seats: refsFor(view.privateInfo.merlinCandidates, refs),
      ordering: 'unordered',
    }
  }
  if (view.privateInfo.evilPartners !== undefined) {
    return { kind: 'evil-partners', seats: refsFor(view.privateInfo.evilPartners, refs) }
  }
  return { kind: 'none', seats: [] }
}

/**
 * Build a deterministic diagnostic from the same two values an agent receives.
 * Input objects are never spread into the output; every output field is
 * explicitly selected from the PlayerView contract.
 */
export function inspectSeatView(
  req: DecisionRequest,
  view: PlayerView,
): SeatViewInspection {
  validateBoundary(req, view)
  const refs = seatLookup(view)
  const inspection: SeatViewInspection = {
    schema: SEAT_VIEW_INSPECTION_SCHEMA,
    provenance: {
      source: 'DecisionRequest + PlayerView',
      board: 'PlayerView public fields',
      privateKnowledge: 'PlayerView.privateInfo',
      visibleHistory: 'PlayerView.events and PlayerView.transcript',
    },
    decisionPoint: {
      kind: req.kind,
      seat: req.seat,
      round: req.round,
      proposalNum: req.proposalNum,
    },
    self: {
      seat: view.seat,
      name: view.name,
      role: view.role,
      alignment: view.alignment,
    },
    privateKnowledge: inspectPrivateKnowledge(view, refs),
    publicBoard: {
      playerCount: view.playerCount,
      rolesInPlay: view.rolesInPlay.slice(),
      players: view.players.map((player) => ({ seat: player.seat, name: player.name })),
      phase: view.phase,
      round: view.round,
      proposalNum: view.proposalNum,
      leader: refFor(view.leaderSeat, refs),
      quests: clonePlain(view.quests, 'quests'),
      proposals: clonePlain(view.proposals, 'proposals'),
      ...(view.currentTeam === undefined
        ? {}
        : { currentTeam: refsFor(view.currentTeam, refs) }),
      ...(view.discussionRound === undefined
        ? {}
        : { discussionRound: view.discussionRound }),
      ...(view.discussionPostRevision === undefined
        ? {}
        : { discussionPostRevision: view.discussionPostRevision }),
      ...(view.winner === undefined ? {} : { winner: view.winner }),
      ...(view.winReason === undefined ? {} : { winReason: view.winReason }),
    },
    visibleHistory: {
      transcript: clonePlain(view.transcript, 'transcript'),
      events: view.events.map((event) => ({
        seq: event.seq,
        type: event.type,
        scope: event.visibility === 'public' ? 'public' : 'private-to-viewer',
        payload: clonePlain(event.payload, `event seq=${event.seq} payload`),
      })),
    },
    omissions: [
      'Other seats expose only public seat and name; no role or alignment is inferred.',
      'Unrevealed votes and quest cards are not reconstructed.',
      'Events invisible to the viewing seat are absent.',
      'No raw Game, posterior, policy score, component trace, or true deal is consulted.',
    ],
  }
  return inspection
}

function seatList(refs: SeatRef[]): string {
  return refs.length === 0
    ? 'none'
    : refs.map((ref) => `${ref.seat}:${ref.name}`).join(', ')
}

/** Render a compact deterministic text view for terminal debugging. */
export function renderSeatViewInspection(inspection: SeatViewInspection): string {
  const lines = [
    `Seat view inspection v${inspection.schema}`,
    `Source: ${inspection.provenance.source}`,
    `Decision: ${inspection.decisionPoint.kind} by seat ${inspection.decisionPoint.seat}`
      + ` at Q${inspection.decisionPoint.round}.${inspection.decisionPoint.proposalNum}`,
    `Self: ${inspection.self.seat}:${inspection.self.name}`
      + ` (${inspection.self.role}, ${inspection.self.alignment})`,
    `Private knowledge: ${inspection.privateKnowledge.kind}`
      + ` [${seatList(inspection.privateKnowledge.seats)}]`,
    '',
    'Public board',
    `Phase: ${inspection.publicBoard.phase}`,
    `Leader: ${inspection.publicBoard.leader.seat}:${inspection.publicBoard.leader.name}`,
    `Players: ${seatList(inspection.publicBoard.players)}`,
    `Roles in play: ${inspection.publicBoard.rolesInPlay.join(', ')}`,
    `Current team: ${seatList(inspection.publicBoard.currentTeam ?? [])}`,
    `Quests: ${inspection.publicBoard.quests.map((quest) => {
      const team = quest.team === undefined ? 'unassigned' : quest.team.join(',')
      const result = quest.result === undefined
        ? ''
        : ` ${quest.result} (${quest.failCount ?? 0} fail)`
      return `Q${quest.num}[${team}] needs ${quest.failsRequired}${result}`
    }).join(' | ')}`,
    `Proposals visible: ${inspection.publicBoard.proposals.length}`,
    `Transcript entries visible: ${inspection.visibleHistory.transcript.length}`,
    '',
    `Visible events (${inspection.visibleHistory.events.length})`,
    ...inspection.visibleHistory.events.map((event) =>
      `#${event.seq} [${event.scope}] ${event.type} ${JSON.stringify(event.payload)}`),
    '',
    'Omitted by design',
    ...inspection.omissions.map((omission) => `- ${omission}`),
  ]
  return `${lines.join('\n')}\n`
}

interface SnapshotFileEntry {
  id?: string
  req: DecisionRequest
  view: PlayerView
}

function readSnapshotFile(file: string): SnapshotFileEntry[] {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  if (Array.isArray(value)) return value as SnapshotFileEntry[]
  if (typeof value === 'object' && value !== null) return [value as SnapshotFileEntry]
  return fail(`${file} must contain a snapshot object or fixture array`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: DEFAULT_SEAT_VIEW_FIXTURE_FILE },
      fixture: { type: 'string' },
      format: { type: 'string', default: 'text' },
      list: { type: 'boolean', default: false },
    },
  })
  const entries = readSnapshotFile(values.file)
  if (values.list) {
    for (const entry of entries) console.log(entry.id ?? '(unnamed)')
    return
  }
  const entry = values.fixture === undefined
    ? entries.length === 1 ? entries[0] : undefined
    : entries.find((candidate) => candidate.id === values.fixture)
  if (!entry) {
    const hint = entries.length === 1
      ? ''
      : `; choose --fixture from: ${entries.map((candidate) => candidate.id).join(', ')}`
    fail(`no snapshot selected from ${values.file}${hint}`)
  }
  const inspection = inspectSeatView(entry.req, entry.view)
  if (values.format === 'json') {
    console.log(JSON.stringify(inspection, null, 2))
  } else if (values.format === 'text') {
    process.stdout.write(renderSeatViewInspection(inspection))
  } else {
    fail(`unsupported format "${values.format}"; expected text or json`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
