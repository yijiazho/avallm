import type {
  GameEvent,
  Phase,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import { exactKeys } from '../components/canonical-shape.ts'
import {
  LANGUAGE_CURSOR_VERSION,
  LANGUAGE_EVIDENCE_CLASSES,
  LANGUAGE_EVIDENCE_CONFIDENCES,
  LANGUAGE_EVIDENCE_DIRECTIONS,
  LANGUAGE_EVIDENCE_VERSION,
  LANGUAGE_INTERPRETER_INPUT_VERSION,
  type LanguageEvidence,
  type LanguageEvidenceAdmission,
  type LanguageEvidenceClass,
  type LanguageEvidenceConfidence,
  type LanguageEvidenceCursor,
  type LanguageEvidenceDirection,
  type LanguageInterpreterInput,
  type LanguagePublicContext,
  type LanguageUtteranceContext,
  type PublicAttributedUtterance,
  isLanguageUtteranceChannel,
} from './language-types.ts'
import { projectPublicRecord } from './public-record.ts'

const PUBLIC_RATIONALE_MAX_LENGTH = 500
const INTERPRETER_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/
const PHASES: readonly Phase[] = [
  'discussion',
  'proposal',
  'finalize',
  'vote',
  'quest',
  'assassination',
  'gameOver',
]

export function initialLanguageEvidenceCursor(): LanguageEvidenceCursor {
  return {
    schemaVersion: LANGUAGE_CURSOR_VERSION,
    throughSeq: -1,
    countedSourceSeqs: [],
  }
}

function publicEvents(view: PlayerView): readonly GameEvent[] {
  return view.events
    .filter((event) => event.visibility === 'public')
    .slice()
    .sort((a, b) => a.seq - b.seq)
}

function copyUtteranceContext(
  context: LanguageUtteranceContext | undefined,
): LanguageUtteranceContext | undefined {
  return context
    ? { ...context, team: context.team.slice() }
    : undefined
}

function attributedUtterances(
  view: PlayerView,
  events: readonly GameEvent[],
): readonly PublicAttributedUtterance[] {
  const names = new Map<Seat, string>()
  const initialNames = events.find((event) => event.type === 'gameCreated')
    ?.payload.names
  if (Array.isArray(initialNames)) {
    initialNames.forEach((name, seat) => names.set(seat, String(name)))
  } else {
    for (const player of view.players) names.set(player.seat, player.name)
  }

  let proposal:
    | { round: number; proposalNum: number; leader: Seat; team: readonly Seat[] }
    | undefined
  const utterances: PublicAttributedUtterance[] = []

  function speaker(seat: Seat): { seat: Seat; name: string } {
    return { seat, name: names.get(seat) ?? `Seat ${seat + 1}` }
  }

  for (const event of events) {
    const payload = event.payload
    if (event.type === 'rename') {
      names.set(payload.seat as Seat, String(payload.to))
      continue
    }
    if (event.type === 'proposal') {
      proposal = {
        round: payload.round as number,
        proposalNum: payload.proposalNum as number,
        leader: payload.leader as Seat,
        team: (payload.team as Seat[]).slice(),
      }
      if (typeof payload.pitch === 'string' && payload.pitch.length > 0) {
        utterances.push({
          sourceSeq: event.seq,
          channel: 'proposal-pitch',
          speaker: speaker(payload.leader as Seat),
          text: payload.pitch,
          context: copyUtteranceContext(proposal),
        })
      }
      continue
    }
    if (event.type === 'proposalRevised') {
      proposal = {
        round: payload.round as number,
        proposalNum: payload.proposalNum as number,
        leader: payload.leader as Seat,
        team: (payload.to as Seat[]).slice(),
      }
      if (typeof payload.reason === 'string' && payload.reason.length > 0) {
        utterances.push({
          sourceSeq: event.seq,
          channel: 'revision-reason',
          speaker: speaker(payload.leader as Seat),
          text: payload.reason,
          context: copyUtteranceContext(proposal),
        })
      }
      continue
    }
    if (
      event.type === 'utterance'
      && typeof payload.text === 'string'
      && payload.text.length > 0
    ) {
      const context = proposal
        ? {
            ...proposal,
            team: proposal.team.slice(),
            discussionRound: payload.round as number,
            ...(payload.postRevision === true ? { postRevision: true } : {}),
          }
        : undefined
      utterances.push({
        sourceSeq: event.seq,
        channel: 'discussion',
        speaker: speaker(payload.seat as Seat),
        text: payload.text,
        ...(context ? { context } : {}),
      })
    }
  }

  const sourceSeqs = utterances.map((utterance) => utterance.sourceSeq)
  if (new Set(sourceSeqs).size !== sourceSeqs.length) {
    throw new Error('language input has duplicate attributed source sequences')
  }
  return utterances
}

/**
 * Project a seat view through an explicit public allow-list.
 *
 * Private visible events, the viewing seat, role, alignment, privateInfo, and
 * private cognition are not copied. Public names and speech remain untrusted
 * data in the returned DTO.
 */
export function projectLanguageInterpreterInput(
  view: PlayerView,
  cursor: LanguageEvidenceCursor = initialLanguageEvidenceCursor(),
): LanguageInterpreterInput {
  validateLanguageEvidenceCursor(cursor)
  const events = publicEvents(view)
  const throughSeq = events.at(-1)?.seq ?? -1
  if (throughSeq < cursor.throughSeq) {
    throw new Error(
      `language input cannot rewind from seq ${cursor.throughSeq} to ${throughSeq}`,
    )
  }
  const utteranceHistory = attributedUtterances(view, events)
  const input: LanguageInterpreterInput = {
    schemaVersion: LANGUAGE_INTERPRETER_INPUT_VERSION,
    dataClassification: 'untrusted-public-player-data',
    throughSeq,
    newUtterances: utteranceHistory
      .filter((utterance) => utterance.sourceSeq > cursor.throughSeq)
      .map(copyAttributedUtterance),
    utteranceHistory: utteranceHistory.map(copyAttributedUtterance),
    publicContext: projectPublicRecord(view),
  }
  validateLanguageInterpreterInput(input)
  return input
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteSeat(value: unknown, playerCount: number): value is Seat {
  return Number.isInteger(value)
    && (value as number) >= 0
    && (value as number) < playerCount
}

function safeInteger(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= minimum
    && (value as number) <= maximum
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key))
}

function validSeatArray(value: unknown, playerCount: number): value is Seat[] {
  return Array.isArray(value)
    && value.every((seat) => finiteSeat(seat, playerCount))
    && new Set(value).size === value.length
}

function copyAttributedUtterance(
  utterance: PublicAttributedUtterance,
): PublicAttributedUtterance {
  return {
    sourceSeq: utterance.sourceSeq,
    channel: utterance.channel,
    speaker: {
      seat: utterance.speaker.seat,
      name: utterance.speaker.name,
    },
    text: utterance.text,
    ...(utterance.context
      ? { context: copyUtteranceContext(utterance.context) }
      : {}),
  }
}

function validUtterance(
  value: unknown,
  playerCount: number,
  throughSeq: number,
): value is PublicAttributedUtterance {
  if (
    !isRecord(value)
    || !exactOptionalKeys(
      value,
      ['sourceSeq', 'channel', 'speaker', 'text'],
      ['context'],
    )
    || !safeInteger(value.sourceSeq, 0, throughSeq)
    || !isLanguageUtteranceChannel(value.channel)
    || !isRecord(value.speaker)
    || !exactKeys(value.speaker, ['seat', 'name'])
    || !finiteSeat(value.speaker.seat, playerCount)
    || typeof value.speaker.name !== 'string'
    || typeof value.text !== 'string'
  ) {
    return false
  }
  if (value.context === undefined) return true
  return isRecord(value.context)
    && exactOptionalKeys(
      value.context,
      ['round', 'proposalNum', 'leader', 'team'],
      ['discussionRound', 'postRevision'],
    )
    && safeInteger(value.context.round, 1)
    && safeInteger(value.context.proposalNum, 1, 5)
    && finiteSeat(value.context.leader, playerCount)
    && validSeatArray(value.context.team, playerCount)
    && (
      value.context.discussionRound === undefined
      || safeInteger(value.context.discussionRound, 1)
    )
    && (
      value.context.postRevision === undefined
      || typeof value.context.postRevision === 'boolean'
    )
}

function validPublicContext(
  value: unknown,
): value is LanguagePublicContext {
  if (
    !isRecord(value)
    || !exactOptionalKeys(
      value,
      [
        'playerCount',
        'rolesInPlay',
        'players',
        'phase',
        'round',
        'proposalNum',
        'leaderSeat',
        'quests',
        'proposals',
      ],
      [
        'currentTeam',
        'discussionRound',
        'discussionPostRevision',
        'outcome',
      ],
    )
    || !safeInteger(value.playerCount, 5, 10)
  ) {
    return false
  }
  const playerCount = value.playerCount as number
  if (
    !Array.isArray(value.rolesInPlay)
    || value.rolesInPlay.length !== playerCount
    || !value.rolesInPlay.every((role) =>
      typeof role === 'string'
      && Object.prototype.hasOwnProperty.call(ROLE_ALIGNMENT, role))
    || !Array.isArray(value.players)
    || value.players.length !== playerCount
    || !value.players.every((player, index) =>
      isRecord(player)
      && exactKeys(player, ['seat', 'name'])
      && player.seat === index
      && typeof player.name === 'string')
    || !PHASES.includes(value.phase as Phase)
    || !safeInteger(value.round, 1, 5)
    || !safeInteger(value.proposalNum, 1, 5)
    || !finiteSeat(value.leaderSeat, playerCount)
    || !Array.isArray(value.quests)
    || value.quests.length !== 5
    || !value.quests.every((quest, index) =>
      isRecord(quest)
      && exactOptionalKeys(
        quest,
        ['num', 'teamSize', 'failsRequired'],
        ['team', 'result', 'failCount'],
      )
      && quest.num === index + 1
      && safeInteger(quest.teamSize, 2, playerCount)
      && safeInteger(quest.failsRequired, 1, 2)
      && (
        quest.team === undefined
        || validSeatArray(quest.team, playerCount)
      )
      && (
        quest.result === undefined
        || quest.result === 'success'
        || quest.result === 'fail'
      )
      && (
        quest.failCount === undefined
        || safeInteger(quest.failCount, 0, playerCount)
      ))
    || !Array.isArray(value.proposals)
    || !value.proposals.every((proposal) =>
      isRecord(proposal)
      && exactOptionalKeys(
        proposal,
        ['round', 'proposalNum', 'leader', 'team'],
        ['revisedFrom', 'votes', 'approved', 'auto'],
      )
      && safeInteger(proposal.round, 1, 5)
      && safeInteger(proposal.proposalNum, 1, 5)
      && finiteSeat(proposal.leader, playerCount)
      && validSeatArray(proposal.team, playerCount)
      && (
        proposal.revisedFrom === undefined
        || validSeatArray(proposal.revisedFrom, playerCount)
      )
      && (
        proposal.votes === undefined
        || (
          Array.isArray(proposal.votes)
          && proposal.votes.every((vote, index) =>
            isRecord(vote)
            && exactKeys(vote, ['seat', 'vote'])
            && vote.seat === index
            && (vote.vote === 'approve' || vote.vote === 'reject'))
        )
      )
      && (
        proposal.approved === undefined
        || typeof proposal.approved === 'boolean'
      )
      && (
        proposal.auto === undefined
        || typeof proposal.auto === 'boolean'
      ))
  ) {
    return false
  }
  return (
    value.currentTeam === undefined
    || validSeatArray(value.currentTeam, playerCount)
  )
    && (
      value.discussionRound === undefined
      || safeInteger(value.discussionRound, 1)
    )
    && (
      value.discussionPostRevision === undefined
      || typeof value.discussionPostRevision === 'boolean'
    )
    && (
      value.outcome === undefined
      || (
        isRecord(value.outcome)
        && exactKeys(value.outcome, ['winner', 'reason'])
        && (value.outcome.winner === 'good' || value.outcome.winner === 'evil')
        && typeof value.outcome.reason === 'string'
      )
    )
}

export function validateLanguageInterpreterInput(
  value: unknown,
): asserts value is LanguageInterpreterInput {
  if (
    !isRecord(value)
    || !exactKeys(value, [
      'schemaVersion',
      'dataClassification',
      'throughSeq',
      'newUtterances',
      'utteranceHistory',
      'publicContext',
    ])
    || value.schemaVersion !== LANGUAGE_INTERPRETER_INPUT_VERSION
    || value.dataClassification !== 'untrusted-public-player-data'
    || !safeInteger(value.throughSeq, -1)
    || !validPublicContext(value.publicContext)
    || !Array.isArray(value.newUtterances)
    || !Array.isArray(value.utteranceHistory)
  ) {
    throw new Error('language interpreter input failed v1 validation')
  }
  const playerCount = value.publicContext.playerCount
  const throughSeq = value.throughSeq
  const validOrderedUtterances = (items: unknown[]): boolean =>
    items.every((item) => validUtterance(item, playerCount, throughSeq))
    && items.every((item, index) =>
      index === 0
      || (
        item as PublicAttributedUtterance
      ).sourceSeq > (
        items[index - 1] as PublicAttributedUtterance
      ).sourceSeq)
  if (
    !validOrderedUtterances(value.newUtterances)
    || !validOrderedUtterances(value.utteranceHistory)
  ) {
    throw new Error('language interpreter input failed v1 validation')
  }
  const history = new Map(
    (value.utteranceHistory as PublicAttributedUtterance[]).map((item) => [
      item.sourceSeq,
      JSON.stringify(item),
    ]),
  )
  if (
    (value.newUtterances as PublicAttributedUtterance[]).some((item) =>
      history.get(item.sourceSeq) !== JSON.stringify(item))
  ) {
    throw new Error('language interpreter input failed v1 validation')
  }
}

function parseLanguageEvidence(
  value: unknown,
  input: LanguageInterpreterInput,
  interpreterVersion: string,
): LanguageEvidence {
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion',
    'sourceSeq',
    'subject',
    'direction',
    'class',
    'confidence',
    'publicRationale',
    'interpreterVersion',
  ])) {
    throw new Error('language evidence must have exactly the v1 keys')
  }
  const eligible = new Set(input.newUtterances.map((item) => item.sourceSeq))
  if (
    value.schemaVersion !== LANGUAGE_EVIDENCE_VERSION
    || !Number.isSafeInteger(value.sourceSeq)
    || !eligible.has(value.sourceSeq as number)
    || !finiteSeat(value.subject, input.publicContext.playerCount)
    || !LANGUAGE_EVIDENCE_DIRECTIONS.includes(
      value.direction as LanguageEvidenceDirection,
    )
    || !LANGUAGE_EVIDENCE_CLASSES.includes(
      value.class as LanguageEvidenceClass,
    )
    || !LANGUAGE_EVIDENCE_CONFIDENCES.includes(
      value.confidence as LanguageEvidenceConfidence,
    )
    || typeof value.publicRationale !== 'string'
    || value.publicRationale.trim().length === 0
    || value.publicRationale.length > PUBLIC_RATIONALE_MAX_LENGTH
    || value.interpreterVersion !== interpreterVersion
  ) {
    throw new Error('language evidence failed v1 validation')
  }
  return {
    schemaVersion: LANGUAGE_EVIDENCE_VERSION,
    sourceSeq: value.sourceSeq as number,
    subject: value.subject as Seat,
    direction: value.direction as LanguageEvidenceDirection,
    class: value.class as LanguageEvidenceClass,
    confidence: value.confidence as LanguageEvidenceConfidence,
    publicRationale: value.publicRationale,
    interpreterVersion,
  }
}

export function validateLanguageEvidenceCursor(
  value: unknown,
): asserts value is LanguageEvidenceCursor {
  if (!isRecord(value) || !exactKeys(value, [
    'schemaVersion',
    'throughSeq',
    'countedSourceSeqs',
  ])) {
    throw new Error('language cursor must have exactly the v1 keys')
  }
  if (
    value.schemaVersion !== LANGUAGE_CURSOR_VERSION
    || !Number.isSafeInteger(value.throughSeq)
    || (value.throughSeq as number) < -1
    || !Array.isArray(value.countedSourceSeqs)
    || !value.countedSourceSeqs.every((seq) =>
      Number.isSafeInteger(seq) && seq >= 0 && seq <= (value.throughSeq as number))
    || new Set(value.countedSourceSeqs).size !== value.countedSourceSeqs.length
    || !value.countedSourceSeqs.every(
      (seq, index, all) => index === 0 || all[index - 1] < seq,
    )
  ) {
    throw new Error('language cursor failed v1 validation')
  }
}

/**
 * Validate and admit one interpreter batch. Each public source sequence may
 * contribute at most one record for the lifetime represented by the cursor.
 */
export function admitLanguageEvidence(
  raw: unknown,
  input: LanguageInterpreterInput,
  cursor: LanguageEvidenceCursor,
  interpreterVersion: string,
): LanguageEvidenceAdmission {
  validateLanguageEvidenceCursor(cursor)
  validateLanguageInterpreterInput(input)
  if (
    !INTERPRETER_VERSION_PATTERN.test(interpreterVersion)
    || input.throughSeq < cursor.throughSeq
    || input.newUtterances.some(
      (utterance) => utterance.sourceSeq <= cursor.throughSeq,
    )
    || input.newUtterances.length !== input.utteranceHistory.filter(
      (utterance) => utterance.sourceSeq > cursor.throughSeq,
    ).length
  ) {
    throw new Error('language admission contract mismatch')
  }
  if (!Array.isArray(raw)) {
    throw new Error('language evidence reply must be an array')
  }
  const evidence = raw
    .map((item) => parseLanguageEvidence(item, input, interpreterVersion))
    .sort((left, right) => left.sourceSeq - right.sourceSeq)
  const batchSeqs = evidence.map((item) => item.sourceSeq)
  if (new Set(batchSeqs).size !== batchSeqs.length) {
    throw new Error('language evidence source sequence counted twice in batch')
  }
  const counted = new Set(cursor.countedSourceSeqs)
  if (batchSeqs.some((seq) => counted.has(seq))) {
    throw new Error('language evidence source sequence was already counted')
  }
  const countedSourceSeqs = [
    ...cursor.countedSourceSeqs,
    ...batchSeqs,
  ].sort((a, b) => a - b)
  return {
    evidence,
    cursor: {
      schemaVersion: LANGUAGE_CURSOR_VERSION,
      throughSeq: input.throughSeq,
      countedSourceSeqs,
    },
  }
}

/**
 * Mark a validated public batch as processed without admitting evidence.
 *
 * This is the fail-closed path for an unavailable or invalid interpreter and
 * the normal path for a public cursor advance that contains no new speech.
 * Previously admitted source identities remain authoritative.
 */
export function advanceLanguageEvidenceCursorWithoutEvidence(
  input: LanguageInterpreterInput,
  cursor: LanguageEvidenceCursor,
): LanguageEvidenceAdmission {
  validateLanguageEvidenceCursor(cursor)
  validateLanguageInterpreterInput(input)
  if (
    input.throughSeq < cursor.throughSeq
    || input.newUtterances.some(
      (utterance) => utterance.sourceSeq <= cursor.throughSeq,
    )
    || input.newUtterances.length !== input.utteranceHistory.filter(
      (utterance) => utterance.sourceSeq > cursor.throughSeq,
    ).length
  ) {
    throw new Error('language cursor-only admission contract mismatch')
  }
  return {
    evidence: [],
    cursor: {
      schemaVersion: LANGUAGE_CURSOR_VERSION,
      throughSeq: input.throughSeq,
      countedSourceSeqs: cursor.countedSourceSeqs.slice(),
    },
  }
}
