import { teamsEqual } from '../../engine/rules.ts'
import type {
  Decision,
  DecisionKind,
  DecisionRequest,
  Lean,
  PlayerView,
  Seat,
} from '../../engine/types.ts'
import {
  LEGAL_CANDIDATE_VERSION,
  type DiscussionCandidate,
  type PolicyCandidate,
} from './types.ts'

const phaseForKind: Record<DecisionKind, PlayerView['phase']> = {
  discuss: 'discussion',
  propose: 'proposal',
  finalize: 'finalize',
  vote: 'vote',
  quest: 'quest',
  assassinate: 'assassination',
}

/**
 * Canonical candidate-ID order. JavaScript relational string comparison is a
 * deterministic lexicographic order over UTF-16 code units and never consults
 * the host locale.
 */
export function compareCandidateIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function combinations(items: readonly Seat[], size: number): readonly Seat[][] {
  const result: Seat[][] = []
  const selected: Seat[] = []
  const visit = (start: number): void => {
    if (selected.length === size) {
      result.push(selected.slice())
      return
    }
    for (let index = start; index <= items.length - (size - selected.length); index++) {
      selected.push(items[index])
      visit(index + 1)
      selected.pop()
    }
  }
  visit(0)
  return result
}

const teamKey = (team: readonly Seat[]): string =>
  [...team].sort((a, b) => a - b).join(',')

const candidate = <D extends Decision>(
  kind: D['kind'],
  suffix: string,
  decision: D,
): PolicyCandidate & { kind: D['kind']; decision: D } => ({
  id: `${LEGAL_CANDIDATE_VERSION}:${kind}:${suffix}`,
  version: LEGAL_CANDIDATE_VERSION,
  kind,
  decision,
})

/**
 * Canonical legal proposal teams for the current quest. This projection is
 * intentionally phase-independent so vote policy can compare the team on the
 * table with teams a later leader could legally propose. Candidate generation
 * remains the sole owner of that hypothetical surface.
 */
export function hypotheticalProposalCandidates(
  view: PlayerView,
): readonly (PolicyCandidate & {
  kind: 'propose'
  decision: Extract<Decision, { kind: 'propose' }>
})[] {
  const seats = view.players
    .map((player) => player.seat)
    .sort((a, b) => a - b)
  const size = view.quests[view.round - 1]?.teamSize
  if (!Number.isInteger(size) || size <= 0 || size > seats.length) {
    throw new Error(`cannot generate proposal teams for quest ${view.round}`)
  }
  return combinations(seats, size).map((team) =>
    candidate('propose', teamKey(team), { kind: 'propose', team }))
}

export function validateCandidateRequest(
  req: DecisionRequest,
  view: PlayerView,
): void {
  if (req.seat !== view.seat) {
    throw new Error(
      `candidate request seat ${req.seat} does not match view seat ${view.seat}`,
    )
  }
  if (view.phase !== phaseForKind[req.kind]) {
    throw new Error(
      `cannot generate ${req.kind} candidates from ${view.phase} view`,
    )
  }
  if (req.round !== view.round || req.proposalNum !== view.proposalNum) {
    throw new Error(
      `candidate request position ${req.round}.${req.proposalNum}`
      + ` does not match view position ${view.round}.${view.proposalNum}`,
    )
  }
}

/**
 * Enumerate the finite, mechanically legal decision surface visible to one
 * seat. The engine remains the legality authority; this module intentionally
 * uses only DecisionRequest + PlayerView and mirrors no hidden Game state.
 */
export function legalCandidates(
  req: DecisionRequest,
  view: PlayerView,
): readonly PolicyCandidate[] {
  validateCandidateRequest(req, view)
  const seats = view.players.map((player) => player.seat).sort((a, b) => a - b)
  switch (req.kind) {
    case 'discuss': {
      const leans: readonly (Lean | undefined)[] =
        view.leaderSeat === view.seat
          ? [undefined]
          : [undefined, 'approve', 'reject', 'unsure']
      return leans.map((lean): DiscussionCandidate => {
        const decision: Extract<Decision, { kind: 'discuss' }> = {
          kind: 'discuss',
          say: '',
          ...(lean ? { lean } : {}),
        }
        return {
          ...candidate(
            'discuss',
            `pass:${lean ?? 'none'}`,
            decision,
          ),
          template: 'pass',
        }
      })
    }
    case 'propose': {
      return hypotheticalProposalCandidates(view)
    }
    case 'finalize': {
      const size = view.quests[view.round - 1].teamSize
      const revisions = combinations(seats, size)
        .filter((team) => !teamsEqual(team, view.currentTeam ?? []))
        .map((team) =>
          candidate('finalize', `revise:${teamKey(team)}`, {
            kind: 'finalize',
            stick: false,
            team,
          }))
      return [
        candidate('finalize', 'stick', { kind: 'finalize', stick: true }),
        ...revisions,
      ]
    }
    case 'vote':
      return [
        candidate('vote', 'approve', { kind: 'vote', vote: 'approve' }),
        candidate('vote', 'reject', { kind: 'vote', vote: 'reject' }),
      ]
    case 'quest':
      return view.alignment === 'good'
        ? [candidate('quest', 'success', { kind: 'quest', card: 'success' })]
        : [
            candidate('quest', 'success', { kind: 'quest', card: 'success' }),
            candidate('quest', 'fail', { kind: 'quest', card: 'fail' }),
          ]
    case 'assassinate':
      return seats
        .filter((seat) => seat !== req.seat)
        .map((seat) =>
          candidate('assassinate', String(seat), {
            kind: 'assassinate',
            target: seat,
          }))
  }
}

export function candidateIdForDecision(decision: Decision): string {
  switch (decision.kind) {
    case 'discuss':
      return `${LEGAL_CANDIDATE_VERSION}:discuss:pass:${decision.lean ?? 'none'}`
    case 'propose':
      return `${LEGAL_CANDIDATE_VERSION}:propose:${teamKey(decision.team)}`
    case 'finalize':
      return decision.stick === true
        ? `${LEGAL_CANDIDATE_VERSION}:finalize:stick`
        : `${LEGAL_CANDIDATE_VERSION}:finalize:revise:${teamKey(decision.team)}`
    case 'vote':
      return `${LEGAL_CANDIDATE_VERSION}:vote:${decision.vote}`
    case 'quest':
      return `${LEGAL_CANDIDATE_VERSION}:quest:${decision.card}`
    case 'assassinate':
      return `${LEGAL_CANDIDATE_VERSION}:assassinate:${decision.target}`
  }
}

export function candidateTeams(
  candidates: readonly PolicyCandidate[],
  view: PlayerView,
): readonly { candidateId: string; team: readonly Seat[] }[] {
  return candidates.flatMap((entry) => {
    const decision = entry.decision
    if (decision.kind === 'propose') {
      return [{ candidateId: entry.id, team: decision.team }]
    }
    if (decision.kind === 'finalize' && decision.stick === true) {
      return view.currentTeam
        ? [{ candidateId: entry.id, team: view.currentTeam }]
        : []
    }
    if (decision.kind === 'finalize' && decision.stick === false) {
      return [{ candidateId: entry.id, team: decision.team }]
    }
    return []
  })
}
