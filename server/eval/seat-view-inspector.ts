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
}

export interface InspectedQuest {
  num: number
  teamSize: number
  failsRequired: number
  team?: Seat[]
  result?: 'success' | 'fail'
  failCount?: number
}

export interface InspectedProposal {
  round: number
  proposalNum: number
  leader: Seat
  team: Seat[]
  pitch?: string
  revisedFrom?: Seat[]
  revisedReason?: string
  votes?: { seat: Seat; vote: 'approve' | 'reject' }[]
  approved?: boolean
  auto?: boolean
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
    quests: InspectedQuest[]
    proposals: InspectedProposal[]
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

const DECISION_KINDS = new Set([
  'discuss', 'propose', 'finalize', 'vote', 'quest', 'assassinate',
])
const EVENT_TYPES = new Set([
  'gameCreated', 'roleDealt', 'knowledge', 'leadChange',
  'utterance', 'proposal', 'proposalLocked', 'proposalRevised',
  'voteCast', 'voteReveal', 'questCard', 'questResult', 'assassination', 'gameOver',
  'thinking', 'rename', 'scratchpad',
])
const LEANS = new Set(['approve', 'reject', 'unsure'])
const PHASES = new Set([
  'discussion', 'proposal', 'finalize', 'vote', 'quest', 'assassination', 'gameOver',
])
const ROLES = new Set([
  'merlin', 'percival', 'servant',
  'assassin', 'morgana', 'mordred', 'oberon', 'minion',
])

type PlainRecord = Record<string, unknown>

function fail(message: string): never {
  throw new Error(`seat-view inspection rejected: ${message}`)
}

function asRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail(`${label} must be an object`)
  }
  return value as PlainRecord
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) return fail(`${label} must be an array`)
  return value
}

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') fail(`${label} must be a string`)
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`)
}

function assertSafeInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${label} must be a safe integer >= ${minimum}`)
  }
}

function assertSeat(seat: unknown, playerCount: number, label: string): asserts seat is Seat {
  if (!Number.isSafeInteger(seat) || (seat as number) < 0 || (seat as number) >= playerCount) {
    fail(`${label} is not a seat in this view`)
  }
}

function validateSeatArray(value: unknown, playerCount: number, label: string): void {
  for (const [index, seat] of asArray(value, label).entries()) {
    assertSeat(seat, playerCount, `${label}[${index}]`)
  }
}

function validateQuest(value: unknown, playerCount: number, index: number): void {
  const label = `quests[${index}]`
  const quest = asRecord(value, label)
  assertSafeInteger(quest.num, `${label}.num`, 1)
  assertSafeInteger(quest.teamSize, `${label}.teamSize`, 1)
  assertSafeInteger(quest.failsRequired, `${label}.failsRequired`, 1)
  if (quest.team !== undefined) validateSeatArray(quest.team, playerCount, `${label}.team`)
  if (quest.result !== undefined && quest.result !== 'success' && quest.result !== 'fail') {
    fail(`${label}.result must be success or fail`)
  }
  if (quest.failCount !== undefined) assertSafeInteger(quest.failCount, `${label}.failCount`)
}

function validateProposal(value: unknown, playerCount: number, index: number): void {
  const label = `proposals[${index}]`
  const proposal = asRecord(value, label)
  assertSafeInteger(proposal.round, `${label}.round`, 1)
  assertSafeInteger(proposal.proposalNum, `${label}.proposalNum`, 1)
  assertSeat(proposal.leader, playerCount, `${label}.leader`)
  validateSeatArray(proposal.team, playerCount, `${label}.team`)
  if (proposal.pitch !== undefined) assertString(proposal.pitch, `${label}.pitch`)
  if (proposal.revisedFrom !== undefined) {
    validateSeatArray(proposal.revisedFrom, playerCount, `${label}.revisedFrom`)
  }
  if (proposal.revisedReason !== undefined) {
    assertString(proposal.revisedReason, `${label}.revisedReason`)
  }
  if (proposal.votes !== undefined) {
    for (const [voteIndex, value] of asArray(proposal.votes, `${label}.votes`).entries()) {
      const voteLabel = `${label}.votes[${voteIndex}]`
      const vote = asRecord(value, voteLabel)
      assertSeat(vote.seat, playerCount, `${voteLabel}.seat`)
      if (vote.vote !== 'approve' && vote.vote !== 'reject') {
        fail(`${voteLabel}.vote must be approve or reject`)
      }
    }
  }
  if (proposal.approved !== undefined) assertBoolean(proposal.approved, `${label}.approved`)
  if (proposal.auto !== undefined) assertBoolean(proposal.auto, `${label}.auto`)
}

function validateTranscriptEntry(value: unknown, playerCount: number, index: number): void {
  const label = `transcript[${index}]`
  const entry = asRecord(value, label)
  assertSeat(entry.seat, playerCount, `${label}.seat`)
  assertString(entry.name, `${label}.name`)
  assertString(entry.text, `${label}.text`)
  if (entry.lean !== undefined && !LEANS.has(entry.lean as string)) {
    fail(`${label}.lean must be approve, reject, or unsure`)
  }
  if (entry.prop !== undefined) {
    const prop = asRecord(entry.prop, `${label}.prop`)
    assertSafeInteger(prop.round, `${label}.prop.round`, 1)
    assertSafeInteger(prop.proposalNum, `${label}.prop.proposalNum`, 1)
    assertSeat(prop.leader, playerCount, `${label}.prop.leader`)
    validateSeatArray(prop.team, playerCount, `${label}.prop.team`)
  }
}

function validateEvent(value: unknown, playerCount: number, viewer: Seat, index: number): void {
  const label = `events[${index}]`
  const event = asRecord(value, label)
  assertSafeInteger(event.seq, `${label}.seq`)
  if (typeof event.type !== 'string' || !EVENT_TYPES.has(event.type)) {
    fail(`${label}.type is not a known event type`)
  }
  asRecord(event.payload, `${label}.payload`)
  if (event.visibility !== 'public') {
    const visibility = asRecord(event.visibility, `${label}.visibility`)
    validateSeatArray(visibility.only, playerCount, `${label}.visibility.only`)
  }
  if (!eventVisibleTo(event as unknown as GameEvent, viewer)) {
    fail(`event seq=${event.seq} type=${event.type} is not visible to seat ${viewer}`)
  }
}

function validateBoundary(req: DecisionRequest, view: PlayerView): void {
  const request = asRecord(req, 'request')
  const inspectedView = asRecord(view, 'view')
  if (typeof request.kind !== 'string' || !DECISION_KINDS.has(request.kind)) {
    fail('request.kind is not a known decision kind')
  }
  assertSafeInteger(request.seat, 'request.seat')
  assertSafeInteger(request.round, 'request.round', 1)
  assertSafeInteger(request.proposalNum, 'request.proposalNum', 1)
  assertSafeInteger(inspectedView.playerCount, 'playerCount', 1)
  assertSafeInteger(inspectedView.seat, 'view.seat')
  assertString(inspectedView.name, 'view.name')
  if (typeof inspectedView.role !== 'string' || !ROLES.has(inspectedView.role)) {
    fail('view.role is not a playable role')
  }
  if (inspectedView.alignment !== 'good' && inspectedView.alignment !== 'evil') {
    fail('view.alignment must be good or evil')
  }
  if (typeof inspectedView.phase !== 'string' || !PHASES.has(inspectedView.phase)) {
    fail('view.phase is not a known phase')
  }
  assertSafeInteger(inspectedView.round, 'view.round', 1)
  assertSafeInteger(inspectedView.proposalNum, 'view.proposalNum', 1)

  if (req.seat !== view.seat) fail(`request seat ${req.seat} does not match view seat ${view.seat}`)
  if (req.round !== view.round || req.proposalNum !== view.proposalNum) {
    fail(
      `request cursor Q${req.round}.${req.proposalNum} does not match `
      + `view cursor Q${view.round}.${view.proposalNum}`,
    )
  }
  assertSeat(view.seat, view.playerCount, 'viewer seat')

  for (const field of RAW_GAME_FIELDS) {
    if (Object.hasOwn(inspectedView, field)) fail(`raw Game field "${field}" is present`)
  }

  const players = asArray(inspectedView.players, 'players')
  const seen = new Set<Seat>()
  for (const [index, value] of players.entries()) {
    const player = asRecord(value, `players[${index}]`)
    assertSeat(player.seat, view.playerCount, 'public player seat')
    assertString(player.name, `players[${index}].name`)
    if (seen.has(player.seat)) fail(`public player seat ${player.seat} is duplicated`)
    seen.add(player.seat)
    if (Object.hasOwn(player, 'role') || Object.hasOwn(player, 'alignment')) {
      fail(`public player seat ${player.seat} carries hidden role or alignment`)
    }
  }
  if (seen.size !== view.playerCount) fail('public player list is incomplete')
  assertSeat(inspectedView.leaderSeat, view.playerCount, 'leaderSeat')

  for (const [index, role] of asArray(inspectedView.rolesInPlay, 'rolesInPlay').entries()) {
    if (typeof role !== 'string' || !ROLES.has(role)) {
      fail(`rolesInPlay[${index}] is not a playable role`)
    }
  }

  const privateInfo = asRecord(inspectedView.privateInfo, 'privateInfo')
  const knowledgeKeys = [
    privateInfo.knownEvil,
    privateInfo.merlinCandidates,
    privateInfo.evilPartners,
  ].filter((seats) => seats !== undefined)
  if (knowledgeKeys.length > 1) fail('privateInfo has more than one knowledge shape')
  for (const seats of knowledgeKeys) {
    validateSeatArray(seats, view.playerCount, 'private knowledge')
  }

  asArray(inspectedView.quests, 'quests').forEach((quest, index) =>
    validateQuest(quest, view.playerCount, index))
  asArray(inspectedView.proposals, 'proposals').forEach((proposal, index) =>
    validateProposal(proposal, view.playerCount, index))
  asArray(inspectedView.transcript, 'transcript').forEach((entry, index) =>
    validateTranscriptEntry(entry, view.playerCount, index))
  asArray(inspectedView.events, 'events').forEach((event, index) =>
    validateEvent(event, view.playerCount, view.seat, index))

  if (inspectedView.currentTeam !== undefined) {
    validateSeatArray(inspectedView.currentTeam, view.playerCount, 'currentTeam')
  }
  if (inspectedView.discussionRound !== undefined) {
    assertSafeInteger(inspectedView.discussionRound, 'discussionRound', 1)
  }
  if (inspectedView.discussionPostRevision !== undefined) {
    assertBoolean(inspectedView.discussionPostRevision, 'discussionPostRevision')
  }
  if (inspectedView.winner !== undefined
      && inspectedView.winner !== 'good'
      && inspectedView.winner !== 'evil') {
    fail('winner must be good or evil')
  }
  if (inspectedView.winReason !== undefined) assertString(inspectedView.winReason, 'winReason')
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

function inspectQuest(quest: PlayerView['quests'][number]): InspectedQuest {
  return {
    num: quest.num,
    teamSize: quest.teamSize,
    failsRequired: quest.failsRequired,
    ...(quest.team === undefined ? {} : { team: quest.team.slice() }),
    ...(quest.result === undefined ? {} : { result: quest.result }),
    ...(quest.failCount === undefined ? {} : { failCount: quest.failCount }),
  }
}

function inspectProposal(
  proposal: PlayerView['proposals'][number],
): InspectedProposal {
  return {
    round: proposal.round,
    proposalNum: proposal.proposalNum,
    leader: proposal.leader,
    team: proposal.team.slice(),
    ...(proposal.pitch === undefined ? {} : { pitch: proposal.pitch }),
    ...(proposal.revisedFrom === undefined
      ? {}
      : { revisedFrom: proposal.revisedFrom.slice() }),
    ...(proposal.revisedReason === undefined
      ? {}
      : { revisedReason: proposal.revisedReason }),
    ...(proposal.votes === undefined
      ? {}
      : {
          votes: proposal.votes.map((vote) => ({
            seat: vote.seat,
            vote: vote.vote,
          })),
        }),
    ...(proposal.approved === undefined ? {} : { approved: proposal.approved }),
    ...(proposal.auto === undefined ? {} : { auto: proposal.auto }),
  }
}

function inspectTranscriptEntry(
  entry: PlayerView['transcript'][number],
): SeatViewInspection['visibleHistory']['transcript'][number] {
  return {
    seat: entry.seat,
    name: entry.name,
    text: entry.text,
    ...(entry.lean === undefined ? {} : { lean: entry.lean }),
    ...(entry.prop === undefined
      ? {}
      : {
          prop: {
            round: entry.prop.round,
            proposalNum: entry.prop.proposalNum,
            leader: entry.prop.leader,
            team: entry.prop.team.slice(),
          },
        }),
  }
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
      quests: view.quests.map(inspectQuest),
      proposals: view.proposals.map(inspectProposal),
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
      transcript: view.transcript.map(inspectTranscriptEntry),
      events: view.events.map((event) => ({
        seq: event.seq,
        type: event.type,
        scope: event.visibility === 'public' ? 'public' : 'private-to-viewer',
      })),
    },
    omissions: [
      'Other seats expose only public seat and name; no role or alignment is inferred.',
      'Unrevealed votes and quest cards are not reconstructed.',
      'Events invisible to the viewing seat are absent.',
      'Event diagnostics include only sequence, type, and public/private scope; payloads are not copied.',
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
      `#${event.seq} [${event.scope}] ${event.type}`),
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
  let value: unknown
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return fail(`cannot read ${file}: ${message}`)
  }
  const values = Array.isArray(value) ? value : [value]
  return values.map((candidate, index) => {
    const label = Array.isArray(value) ? `${file}[${index}]` : file
    const record = asRecord(candidate, label)
    if (record.id !== undefined) assertString(record.id, `${label}.id`)
    asRecord(record.req, `${label}.req`)
    asRecord(record.view, `${label}.view`)
    return {
      ...(record.id === undefined ? {} : { id: record.id }),
      req: record.req as unknown as DecisionRequest,
      view: record.view as unknown as PlayerView,
    }
  })
}

export const SEAT_VIEW_INSPECTOR_USAGE = `Usage:
  node server/eval/seat-view-inspector.ts --list [--file <snapshots.json>]
  node server/eval/seat-view-inspector.ts --fixture <id> [--format text|json]
  node server/eval/seat-view-inspector.ts --file <single-snapshot.json> [--format text|json]

The input must be a DecisionRequest + PlayerView snapshot or an array of named snapshots.
`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      file: { type: 'string', default: DEFAULT_SEAT_VIEW_FIXTURE_FILE },
      fixture: { type: 'string' },
      format: { type: 'string', default: 'text' },
      list: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(SEAT_VIEW_INSPECTOR_USAGE)
    return
  }
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
