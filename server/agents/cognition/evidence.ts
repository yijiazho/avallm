import { clonePrivateInfo } from '../../engine/knowledge.ts'
import type { GameEvent, PlayerView, Seat } from '../../engine/types.ts'
import { evidenceRecord } from './types.ts'
import type { Evidence } from './types.ts'

// Returns [] for a quest that is not yet complete by design: the finished team
// is only settled once the quest resolves.
const teamAt = (view: PlayerView, round: number): readonly Seat[] => {
  const quest = view.quests[round - 1]
  return quest?.status === 'complete' ? quest.team.slice() : []
}

interface ProposalContext {
  round: number
  proposalNum: number
  team: readonly Seat[]
}

function publicProposalContext(
  view: PlayerView,
  throughSeq: number,
): ProposalContext | undefined {
  let context: ProposalContext | undefined
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
      return evidenceRecord(event.seq, 'game-setup', {
        payload: {
          playerCount: event.payload.playerCount,
          rolesInPlay: event.payload.rolesInPlay.slice(),
          firstLeader: event.payload.firstLeader,
        },
      })
    case 'roleDealt':
      if (event.payload.seat !== view.seat) return []
      return evidenceRecord(event.seq, 'private-role', {
        actor: view.seat,
        payload: { role: view.role, alignment: view.alignment },
      })
    case 'knowledge':
      if (event.payload.seat !== view.seat) return []
      return evidenceRecord(event.seq, 'private-knowledge', {
        actor: view.seat,
        payload: clonePrivateInfo(view.privateInfo),
      })
    case 'leadChange':
      return evidenceRecord(event.seq, 'leader-change', {
        actor: event.payload.seat,
        payload: { round: event.payload.round, proposalNum: event.payload.proposalNum },
      })
    case 'proposal':
      return evidenceRecord(event.seq, 'proposal', {
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
          ...(typeof event.payload.pitch === 'string' ? { pitch: event.payload.pitch } : {}),
        },
      })
    case 'proposalLocked':
      return evidenceRecord(event.seq, 'proposal-locked', {
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
        },
      })
    case 'proposalRevised':
      return evidenceRecord(event.seq, 'proposal-revised', {
        actor: event.payload.leader,
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          from: event.payload.from.slice(),
          to: event.payload.to.slice(),
          ...(typeof event.payload.reason === 'string' ? { reason: event.payload.reason } : {}),
        },
      })
    case 'utterance': {
      const context = publicProposalContext(view, event.seq)
      const team = context?.team
      return evidenceRecord(event.seq, 'utterance', {
        actor: event.payload.seat,
        payload: {
          text: event.payload.text,
          discussionRound: event.payload.round,
          postRevision: event.payload.postRevision === true,
          round: context?.round ?? view.round,
          proposalNum: context?.proposalNum ?? view.proposalNum,
          ...(team ? { team } : {}),
        },
      })
    }
    case 'voteReveal':
      return evidenceRecord(event.seq, 'vote-reveal', {
        payload: {
          round: event.payload.round,
          proposalNum: event.payload.proposalNum,
          team: event.payload.team.slice(),
          votes: event.payload.votes.map((vote) => ({ ...vote })),
          approved: event.payload.approved,
          automatic: event.payload.auto === true,
        },
      })
    case 'questResult': {
      const questNum = event.payload.round
      return evidenceRecord(event.seq, 'quest-result', {
        payload: {
          questNum,
          team: teamAt(view, questNum),
          failCount: event.payload.failCount,
          failsRequired: event.payload.failsRequired,
          result: event.payload.result,
        },
      })
    }
    case 'rename':
      return evidenceRecord(event.seq, 'rename', {
        actor: event.payload.seat,
        payload: { from: event.payload.from, to: event.payload.to },
      })
    case 'assassination':
      return evidenceRecord(event.seq, 'assassination', {
        actor: event.payload.assassin,
        payload: { target: event.payload.target, wasMerlin: event.payload.wasMerlin },
      })
    case 'gameOver':
      return evidenceRecord(event.seq, 'game-result', {
        payload: { winner: event.payload.winner, reason: event.payload.reason },
      })
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
