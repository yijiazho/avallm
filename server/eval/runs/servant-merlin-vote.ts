// Does a servant vote more accurately on the decisions where its belief has
// correctly identified Merlin?
//
// A servant has no private knowledge, so "identified Merlin" means its own
// feasible-world posterior puts the true Merlin as the unique most-likely
// Merlin. Vote accuracy is the usual truth alignment: reject iff the team
// seats evil. Both are read off the SAME belief the composed servant votes
// from, so a positive correlation is a coherence signal ("a sharper posterior
// helps both readouts") rather than evidence the servant strategically follows
// Merlin. The diagnostic buckets servant vote decisions by whether the belief
// identified Merlin and reports vote accuracy in each bucket, over composed
// self-play. API-free.

import { pathToFileURL } from 'node:url'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../engine/game.ts'
import { viewFor } from '../../engine/view.ts'
import { createAgent } from '../../agents/registry.ts'
import { questWeightedBeliefModel } from '../../agents/belief/quest-card-factor.ts'
import { ROLE_ALIGNMENT } from '../../engine/rules.ts'
import type { AvalonAgent } from '../../agents/types.ts'
import type { Seat, TalkConfig } from '../../engine/types.ts'

export const SERVANT_MERLIN_VOTE_VERSION = 'servant-merlin-vote-v1'

const SILENT_TALK: TalkConfig = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
}

interface Sample {
  /** The servant belief's probability that the TRUE Merlin is Merlin. */
  merlinConfidence: number
  /** Whether the servant voted truth-aligned (reject iff the team seats evil). */
  correct: boolean
}

export interface TercileSlice {
  readonly votes: number
  readonly meanMerlinConfidence: number
  readonly voteAccuracy: number
}

export interface ServantMerlinVoteResult {
  readonly version: typeof SERVANT_MERLIN_VOTE_VERSION
  readonly games: number
  readonly playerCount: number
  readonly servantVotes: number
  /** Mean belief-confidence that the true Merlin is Merlin, over servant votes. */
  readonly meanMerlinConfidence: number
  /**
   * Servant vote accuracy split into terciles by how confident the belief is
   * in the true Merlin (low/mid/high). A rising accuracy across terciles is the
   * coherence signal: when the belief leans more correctly toward Merlin, the
   * (same-belief) votes are more truth-aligned.
   */
  readonly byMerlinConfidence: {
    readonly low: TercileSlice
    readonly mid: TercileSlice
    readonly high: TercileSlice
  }
}

/** The belief's probability that seat `merlin` is Merlin. */
function merlinProbabilityOf(
  roleMarginals: readonly { seat: Seat; role: string; probability: number }[],
  merlin: Seat,
): number {
  return roleMarginals.find(
    (marginal) => marginal.role === 'merlin' && marginal.seat === merlin,
  )?.probability ?? 0
}

function tercile(samples: readonly Sample[]): TercileSlice {
  const votes = samples.length
  const correct = samples.filter((sample) => sample.correct).length
  const confidence = samples.reduce((sum, s) => sum + s.merlinConfidence, 0)
  return {
    votes,
    meanMerlinConfidence: votes ? confidence / votes : 0,
    voteAccuracy: votes ? correct / votes : 0,
  }
}

export async function runServantMerlinVoteDiagnostic(
  options: { games?: number; playerCount?: number; seedBase?: string } = {},
): Promise<ServantMerlinVoteResult> {
  const games = options.games ?? 40
  const playerCount = options.playerCount ?? 7
  const seedBase = options.seedBase ?? 'servant-merlin-vote'

  const samples: Sample[] = []

  for (let index = 0; index < games; index++) {
    const seed = `${seedBase}-${index}`
    const game = createGame({ seed, playerCount, talk: SILENT_TALK })
    const trueMerlin = game.players.find((p) => p.role === 'merlin')!.seat
    const isEvil = (seat: Seat) => ROLE_ALIGNMENT[game.players[seat]!.role] === 'evil'
    const agents = new Map<Seat, AvalonAgent>()
    for (const player of game.players) {
      agents.set(
        player.seat,
        createAgent({ type: 'composed', brain: 'full-role' }, { seed, seat: player.seat }),
      )
    }

    let guard = 0
    while (game.phase !== 'gameOver' && guard++ < 400) {
      const reqs = expectedDecisions(game)
      if (!reqs.length) break
      if (reqs[0]!.kind === 'vote') {
        const applications: { seat: Seat; decision: Awaited<ReturnType<AvalonAgent['decide']>>['decision'] }[] = []
        for (const req of reqs) {
          const view = viewFor(game, req.seat)
          const decision = (await agents.get(req.seat)!.decide(req, view)).decision
          if (game.players[req.seat]!.role === 'servant' && decision.kind === 'vote') {
            const teamSeatsEvil = (view.currentTeam ?? []).some(isEvil)
            samples.push({
              // The quest-weighted belief the full-role servant actually votes
              // from (BELIEF-002), so the confidence matches its real read.
              merlinConfidence: merlinProbabilityOf(
                questWeightedBeliefModel.infer(view).roleMarginals,
                trueMerlin,
              ),
              correct: (decision.vote === 'reject') === teamSeatsEvil,
            })
          }
          applications.push({ seat: req.seat, decision })
        }
        for (const application of applications) {
          applyDecision(game, application.seat, application.decision)
        }
      } else {
        for (const req of reqs) {
          const decision = (await agents.get(req.seat)!.decide(req, viewFor(game, req.seat))).decision
          applyDecision(game, req.seat, decision)
        }
      }
    }
  }

  // Terciles by belief-confidence in the true Merlin. Sort ascending, then cut
  // into thirds; ties at a cut land by their sort position, which is fine for
  // an aggregate rate.
  const sorted = [...samples].sort(
    (a, b) => a.merlinConfidence - b.merlinConfidence,
  )
  const third = Math.floor(sorted.length / 3)
  const meanConfidence = sorted.length
    ? sorted.reduce((sum, s) => sum + s.merlinConfidence, 0) / sorted.length
    : 0

  return {
    version: SERVANT_MERLIN_VOTE_VERSION,
    games,
    playerCount,
    servantVotes: sorted.length,
    meanMerlinConfidence: meanConfidence,
    byMerlinConfidence: {
      low: tercile(sorted.slice(0, third)),
      mid: tercile(sorted.slice(third, third * 2)),
      high: tercile(sorted.slice(third * 2)),
    },
  }
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const games = Number(process.argv[2] ?? 60)
  const playerCount = Number(process.argv[3] ?? 7)
  runServantMerlinVoteDiagnostic({ games, playerCount }).then((result) => {
    console.log(JSON.stringify(result, null, 2))
  })
}
