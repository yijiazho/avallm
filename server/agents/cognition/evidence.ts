import { clonePrivateInfo } from '../../engine/knowledge.ts'
import type { GameEvent, PlayerView, Seat } from '../../engine/types.ts'
import type { Evidence } from './types.ts'

const eventId = (seq: number, kind: Evidence['kind']): string =>
  `event:${seq}:${kind}`

const teamAt = (view: PlayerView, round: number): readonly Seat[] => {
  const quest = view.quests[round - 1]
  return quest?.status === 'complete' ? quest.team.slice() : []
}

function publicProposalContext(
  view: PlayerView,
  throughSeq: number,
): { round: number; proposalNum: number; team: readonly Seat[] } | undefined {
  let context: { round: number; proposalNum: number; team: readonly Seat[] } | undefined
  for (const event of view.events) {
    if (event.seq >= throughSeq) break
    if (event.type === 'proposal') {
      context = {
        round: event.payload.round,
        proposalNum: event.payload.proposalNum,
        team: event.payload.team.slice(),
      }
    } else if (event.type === 'proposalRevised' && context) {
      context = {
        round: event.payload.round,
        proposalNum: event.payload.proposalNum,
        team: event.payload.to.slice(),
      }
    }
  }
  return context
}

/** Convert one seat-visible engine event into zero or more typed records. */
export function evidenceFromEvent(
  view: PlayerView,
  event: GameEvent,
): readonly Evidence[] {
  switch (event.type) {
    case 'gameCreated':
      return [{
        id: eventId(event.seq, 'game-setup'),
        sourceSeq: event.seq,
        kind: 'game-setup',
        payload: {
          playerCount: event.payload.playerCount,
          rolesInPlay: event.payload.rolesInPlay.slice(),
          firstLeader: event.payload.firstLeader,
        },
      }]
    case 'roleDealt':
      if (event.payload.seat !== view.seat) return []
      return [{
        id: eventId(event.seq, 'private-role'),
        sourceSeq: event.seq,
        kind: 'private-role',
        actor: view.seat,
        payload: { role: view.role, alignment: view.alignment },
      }]
    case 'knowledge':
      if (event.payload.seat !== view.seat) return []
      return [{
        id: eventId(event.seq, 'private-knowledge'),
        sourceSeq: event.seq,
        kind: 'private-knowledge',
        actor: view.seat,
        payload: clonePrivateInfo(view.privateInfo),
      }]
    case 'leadChange':
      return [{
        id: eventId(event.seq, 'leader-change'),
        sourceSeq: event.seq,
        kind: 'leader-change',
        actor: event.payload.seat,
        payload: { round: event.payload.round, proposalNum: event.payload.proposalNum },
      }]
    case 'proposal':
      return [{
        id: eventId(event.seq, 'proposal'),
        sourceSeq: event.seq,
        kind: 'proposal',
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
          ...(typeof event.payload.pitch === 'string' ? { pitch: event.payload.pitch } : {}),
        },
      }]
    case 'proposalLocked':
      return [{
        id: eventId(event.seq, 'proposal-locked'),
        sourceSeq: event.seq,
        kind: 'proposal-locked',
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
        },
      }]
    case 'proposalRevised':
      return [{
        id: eventId(event.seq, 'proposal-revised'),
        sourceSeq: event.seq,
        kind: 'proposal-revised',
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          from: event.payload.from.slice(),
          to: event.payload.to.slice(),
          ...(typeof event.payload.reason === 'string' ? { reason: event.payload.reason } : {}),
        },
      }]
    case 'utterance': {
      const context = publicProposalContext(view, event.seq)
      const round = context?.round ?? view.round
      const proposalNum = context?.proposalNum ?? view.proposalNum
      const team = context?.team
      return [{
        id: eventId(event.seq, 'utterance'),
        sourceSeq: event.seq,
        kind: 'utterance',
        actor: event.payload.seat,
        payload: {
          text: event.payload.text,
          discussionRound: event.payload.round,
          postRevision: event.payload.postRevision === true,
          round,
          proposalNum,
          ...(team ? { team } : {}),
        },
      }]
    }
    case 'voteReveal':
      return [{
        id: eventId(event.seq, 'vote-reveal'),
        sourceSeq: event.seq,
        kind: 'vote-reveal',
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
          votes: event.payload.votes.map((vote) => ({ ...vote })),
          approved: event.payload.approved,
          automatic: event.payload.auto === true,
        },
      }]
    case 'questResult': {
      const questNum = event.payload.round
      return [{
        id: eventId(event.seq, 'quest-result'),
        sourceSeq: event.seq,
        kind: 'quest-result',
        payload: {
          questNum,
          team: teamAt(view, questNum),
          failCount: event.payload.failCount,
          failsRequired: event.payload.failsRequired,
          result: event.payload.result,
        },
      }]
    }
    case 'rename':
      return [{
        id: eventId(event.seq, 'rename'),
        sourceSeq: event.seq,
        kind: 'rename',
        actor: event.payload.seat,
        payload: { from: event.payload.from, to: event.payload.to },
      }]
    case 'assassination':
      return [{
        id: eventId(event.seq, 'assassination'),
        sourceSeq: event.seq,
        kind: 'assassination',
        actor: event.payload.assassin,
        payload: { target: event.payload.target, wasMerlin: event.payload.wasMerlin },
      }]
    case 'gameOver':
      return [{
        id: eventId(event.seq, 'game-result'),
        sourceSeq: event.seq,
        kind: 'game-result',
        payload: { winner: event.payload.winner, reason: event.payload.reason },
      }]
    // Hidden votes/cards and private model scratch data are deliberately not
    // evidence. voteReveal is the public vote source once the table can see it.
    case 'voteCast':
    case 'questCard':
    case 'thinking':
    case 'scratchpad':
      return []
  }
}

export function compareEvidence(a: Evidence, b: Evidence): number {
  return a.sourceSeq - b.sourceSeq || a.id.localeCompare(b.id)
}

export function extractEvidence(
  view: PlayerView,
  afterSeq = -1,
): readonly Evidence[] {
  return view.events
    .filter((event) => event.seq > afterSeq)
    .flatMap((event) => evidenceFromEvent(view, event))
    .sort(compareEvidence)
}
