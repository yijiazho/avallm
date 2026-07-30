import type { Evidence, PublicCommitment } from './types.ts'

const contextKey = (round?: number, proposalNum?: number): string =>
  `${round ?? 'none'}.${proposalNum ?? 'none'}`

const commitmentId = (sourceId: string, part: string): string =>
  `commitment:${sourceId}:${part}`

function supersede(
  commitments: PublicCommitment[],
  predicate: (commitment: PublicCommitment) => boolean,
  by: string,
): void {
  for (let index = 0; index < commitments.length; index++) {
    const commitment = commitments[index]
    if (commitment.status === 'current' && predicate(commitment)) {
      commitments[index] = { ...commitment, status: 'superseded', supersededBy: by }
    }
  }
}

function utterance(
  evidence: Evidence,
  text: string,
  channel: 'discussion' | 'pitch' | 'revision-reason',
  round: number,
  proposalNum: number,
  team?: readonly number[],
): PublicCommitment | undefined {
  if (!text.trim() || evidence.actor === undefined) return undefined
  return {
    id: commitmentId(evidence.id, channel),
    sourceId: evidence.id,
    sourceSeq: evidence.sourceSeq,
    actor: evidence.actor,
    kind: 'utterance',
    visibility: 'public',
    context: { round, proposalNum, ...(team ? { team: team.slice() } : {}) },
    payload: { type: 'utterance', text, channel },
    status: 'current',
  }
}

/** Rebuild the literal public-position ledger from typed evidence. */
export function buildCommitments(
  evidenceRecords: readonly Evidence[],
): readonly PublicCommitment[] {
  const commitments: PublicCommitment[] = []
  for (const evidence of evidenceRecords) {
    if (evidence.scope !== 'public') continue
    switch (evidence.kind) {
      case 'proposal': {
        const sourceId = commitmentId(evidence.id, 'team')
        supersede(
          commitments,
          (commitment) => commitment.kind === 'team',
          sourceId,
        )
        commitments.push({
          id: sourceId,
          sourceId: evidence.id,
          sourceSeq: evidence.sourceSeq,
          actor: evidence.actor,
          kind: 'team',
          visibility: 'public',
          context: {
            round: evidence.payload.round,
            proposalNum: evidence.payload.proposalNum,
            questNum: evidence.payload.round,
            team: evidence.payload.team.slice(),
          },
          payload: { type: 'team', action: 'proposed', team: evidence.payload.team.slice() },
          status: 'current',
        })
        if (evidence.payload.pitch) {
          const spoken = utterance(
            evidence,
            evidence.payload.pitch,
            'pitch',
            evidence.payload.round,
            evidence.payload.proposalNum,
            evidence.payload.team,
          )
          if (spoken) commitments.push(spoken)
        }
        break
      }
      case 'proposal-revised': {
        const sourceId = commitmentId(evidence.id, 'team')
        const key = contextKey(evidence.payload.round, evidence.payload.proposalNum)
        supersede(
          commitments,
          (commitment) =>
            commitment.kind === 'team'
            && contextKey(commitment.context.round, commitment.context.proposalNum) === key,
          sourceId,
        )
        commitments.push({
          id: sourceId,
          sourceId: evidence.id,
          sourceSeq: evidence.sourceSeq,
          actor: evidence.actor,
          kind: 'team',
          visibility: 'public',
          context: {
            round: evidence.payload.round,
            proposalNum: evidence.payload.proposalNum,
            questNum: evidence.payload.round,
            team: evidence.payload.to.slice(),
          },
          payload: { type: 'team', action: 'revised', team: evidence.payload.to.slice() },
          status: 'current',
        })
        if (evidence.payload.reason) {
          const spoken = utterance(
            evidence,
            evidence.payload.reason,
            'revision-reason',
            evidence.payload.round,
            evidence.payload.proposalNum,
            evidence.payload.to,
          )
          if (spoken) commitments.push(spoken)
        }
        break
      }
      case 'utterance': {
        const spoken = utterance(
          evidence,
          evidence.payload.text,
          'discussion',
          evidence.payload.round,
          evidence.payload.proposalNum,
          evidence.payload.team,
        )
        if (spoken) commitments.push(spoken)
        break
      }
      case 'vote-reveal': {
        for (const vote of evidence.payload.votes) {
          const sourceId = commitmentId(evidence.id, `vote-${vote.seat}`)
          commitments.push({
            id: sourceId,
            sourceId: evidence.id,
            sourceSeq: evidence.sourceSeq,
            actor: vote.seat,
            kind: 'vote',
            visibility: 'public',
            context: {
              round: evidence.payload.round,
              proposalNum: evidence.payload.proposalNum,
              questNum: evidence.payload.round,
              team: evidence.payload.team.slice(),
            },
            payload: { type: 'vote', vote: vote.vote },
            status: 'current',
          })
        }
        break
      }
    }
  }
  return commitments.sort(
    (a, b) => a.sourceSeq - b.sourceSeq || a.id.localeCompare(b.id),
  )
}
