import { clonePrivateInfo } from '../../engine/rules.ts'
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
        round: event.payload.round as number,
        proposalNum: event.payload.proposalNum as number,
        team: (event.payload.team as Seat[]).slice(),
      }
    } else if (event.type === 'proposalRevised' && context) {
      context = {
        round: event.payload.round as number,
        proposalNum: event.payload.proposalNum as number,
        team: (event.payload.to as Seat[]).slice(),
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
  const p = event.payload
  switch (event.type) {
    case 'gameCreated':
      return [{
        id: eventId(event.seq, 'game-setup'),
        sourceSeq: event.seq,
        kind: 'game-setup',
        payload: {
          playerCount: p.playerCount as number,
          rolesInPlay: (p.rolesInPlay as PlayerView['rolesInPlay']).slice(),
          firstLeader: p.firstLeader as Seat,
        },
      }]
    case 'roleDealt':
      if (p.seat !== view.seat) return []
      return [{
        id: eventId(event.seq, 'private-role'),
        sourceSeq: event.seq,
        kind: 'private-role',
        actor: view.seat,
        payload: { role: view.role, alignment: view.alignment },
      }]
    case 'knowledge':
      if (p.seat !== view.seat) return []
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
        actor: p.seat as Seat,
        payload: { round: p.round as number, proposalNum: p.proposalNum as number },
      }]
    case 'proposal':
      return [{
        id: eventId(event.seq, 'proposal'),
        sourceSeq: event.seq,
        kind: 'proposal',
        actor: p.leader as Seat,
        payload: {
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          team: (p.team as Seat[]).slice(),
          ...(typeof p.pitch === 'string' ? { pitch: p.pitch } : {}),
        },
      }]
    case 'proposalLocked':
      return [{
        id: eventId(event.seq, 'proposal-locked'),
        sourceSeq: event.seq,
        kind: 'proposal-locked',
        actor: p.leader as Seat,
        payload: {
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          team: (p.team as Seat[]).slice(),
        },
      }]
    case 'proposalRevised':
      return [{
        id: eventId(event.seq, 'proposal-revised'),
        sourceSeq: event.seq,
        kind: 'proposal-revised',
        actor: p.leader as Seat,
        payload: {
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          from: (p.from as Seat[]).slice(),
          to: (p.to as Seat[]).slice(),
          ...(typeof p.reason === 'string' ? { reason: p.reason } : {}),
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
        actor: p.seat as Seat,
        payload: {
          text: String(p.text ?? ''),
          discussionRound: p.round as number,
          postRevision: p.postRevision === true,
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
          round: p.round as number,
          proposalNum: p.proposalNum as number,
          team: (p.team as Seat[]).slice(),
          votes: ((p.votes ?? []) as { seat: Seat; vote: 'approve' | 'reject' }[])
            .map((vote) => ({ ...vote })),
          approved: p.approved as boolean,
          automatic: p.auto === true,
        },
      }]
    case 'questResult': {
      const questNum = p.round as number
      return [{
        id: eventId(event.seq, 'quest-result'),
        sourceSeq: event.seq,
        kind: 'quest-result',
        payload: {
          questNum,
          team: teamAt(view, questNum),
          failCount: p.failCount as number,
          failsRequired: p.failsRequired as number,
          result: p.result as 'success' | 'fail',
        },
      }]
    }
    case 'rename':
      return [{
        id: eventId(event.seq, 'rename'),
        sourceSeq: event.seq,
        kind: 'rename',
        actor: p.seat as Seat,
        payload: { from: String(p.from), to: String(p.to) },
      }]
    case 'assassination':
      return [{
        id: eventId(event.seq, 'assassination'),
        sourceSeq: event.seq,
        kind: 'assassination',
        actor: p.assassin as Seat,
        payload: { target: p.target as Seat, wasMerlin: p.wasMerlin as boolean },
      }]
    case 'gameOver':
      return [{
        id: eventId(event.seq, 'game-result'),
        sourceSeq: event.seq,
        kind: 'game-result',
        payload: { winner: p.winner as 'good' | 'evil', reason: String(p.reason) },
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
