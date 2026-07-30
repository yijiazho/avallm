// Migration phase 7F2B; see docs/agent-architecture-migration.md.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  buildPrivateEvilSeatMerlinPosterior,
} from '../agents/analysis/assassin-merlin-posterior.ts'
import { exactBelief } from '../agents/belief/exact.ts'
import { ROLE_ALIGNMENT } from '../engine/rules.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import type {
  PlayerView,
  Role,
  Seat,
} from '../engine/types.ts'

export const PHASE7_VIRTUAL_ASSASSIN_VERSION =
  'phase7-virtual-assassin-v1'

interface FrozenHistory {
  readonly id: string
  readonly seed: string
  readonly playerCount: number
  readonly roles: readonly Role[]
  readonly successfulProposalPrefix: readonly (readonly Seat[])[]
}

export interface VirtualAssassinPrediction {
  readonly version: typeof PHASE7_VIRTUAL_ASSASSIN_VERSION
  readonly historyId: string
  readonly playerCount: number
  readonly predictorSeat: Seat
  readonly predictorRole: Role
  readonly beliefThroughSeq: number
  readonly guessSeat: Seat
  readonly targets: readonly Readonly<{
    seat: Seat
    knownVisibleEvil: boolean
    probability: number
  }>[]
  readonly predictionDigest: string
}

export interface VirtualAssassinTruth {
  readonly historyId: string
  readonly merlinSeat: Seat
}

export interface VirtualAssassinEvidence extends VirtualAssassinPrediction {
  readonly merlinSeat: Seat
  readonly hit: boolean
}

export interface PreparedVirtualAssassinEvaluation {
  readonly predictions: readonly VirtualAssassinPrediction[]
  readonly truths: readonly VirtualAssassinTruth[]
}

function frozenHistories(): readonly FrozenHistory[] {
  const source = JSON.parse(readFileSync(
    new URL('./fixtures/virtual-assassin-v1.json', import.meta.url),
    'utf8',
  )) as FrozenHistory[]
  return Object.freeze(source.map((history) => Object.freeze({
    ...history,
    roles: Object.freeze([...history.roles]),
    successfulProposalPrefix: Object.freeze(
      history.successfulProposalPrefix.map((team) =>
        Object.freeze([...team])),
    ),
  })))
}

function replayPretruth(history: FrozenHistory) {
  const game = createGame({
    id: `virtual-assassin-${history.id}`,
    seed: history.seed,
    playerCount: history.playerCount,
    roles: [...history.roles],
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
  })
  for (const team of history.successfulProposalPrefix) {
    const proposal = expectedDecisions(game)
    if (proposal.length !== 1 || proposal[0].kind !== 'propose') {
      throw new Error(`${history.id}: frozen prefix expected a proposal`)
    }
    applyDecision(game, proposal[0].seat, { kind: 'propose', team: [...team] })
    while (game.phase === 'vote') {
      for (const req of expectedDecisions(game)) {
        applyDecision(game, req.seat, { kind: 'vote', vote: 'approve' })
      }
    }
    while (game.phase === 'quest') {
      const req = expectedDecisions(game)[0]
      applyDecision(game, req.seat, { kind: 'quest', card: 'success' })
    }
  }
  if (game.phase !== 'assassination') {
    throw new Error(`${history.id}: prefix did not stop before truth reveal`)
  }
  return game
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function predictVirtualAssassinFromView(
  inputView: PlayerView,
  historyId: string,
): VirtualAssassinPrediction {
  const view = structuredClone(inputView)
  if (view.phase !== 'assassination' || ROLE_ALIGNMENT[view.role] !== 'evil') {
    throw new Error('virtual Assassin prediction requires an evil pretruth view')
  }
  const posterior = buildPrivateEvilSeatMerlinPosterior({
    view,
    belief: exactBelief(view),
  })
  const supported = posterior.targets.filter(
    (target) => target.posteriorProbability > 0,
  )
  const guessSeat = supported.reduce((best, target) =>
    target.posteriorProbability > best.posteriorProbability
    || (
      target.posteriorProbability === best.posteriorProbability
      && target.seat < best.seat
    )
      ? target
      : best).seat
  const payload = {
    version: PHASE7_VIRTUAL_ASSASSIN_VERSION,
    historyId,
    playerCount: view.playerCount,
    predictorSeat: view.seat,
    predictorRole: view.role,
    beliefThroughSeq: posterior.source.beliefThroughSeq,
    guessSeat,
    targets: posterior.targets.map((target) => Object.freeze({
      seat: target.seat,
      knownVisibleEvil: target.knownVisibleEvil,
      probability: target.posteriorProbability,
    })),
  } as const
  return Object.freeze({
    ...payload,
    targets: Object.freeze(payload.targets),
    predictionDigest: digest(payload),
  })
}

export function joinVirtualAssassinTruth(
  predictions: readonly VirtualAssassinPrediction[],
  truths: readonly VirtualAssassinTruth[],
): readonly VirtualAssassinEvidence[] {
  const byHistory = new Map(truths.map((truth) => [truth.historyId, truth]))
  return Object.freeze(predictions.map((prediction) => {
    const truth = byHistory.get(prediction.historyId)
    if (!truth) throw new Error(`missing truth for ${prediction.historyId}`)
    return Object.freeze({
      ...prediction,
      merlinSeat: truth.merlinSeat,
      hit: prediction.guessSeat === truth.merlinSeat,
    })
  }))
}

export function prepareVirtualAssassinEvaluation():
PreparedVirtualAssassinEvaluation {
  const replayed = frozenHistories().map((history) => ({
    history,
    game: replayPretruth(history),
  }))
  const detachedViews = replayed.map(({ history, game }) => ({
    history,
    views: Object.freeze(game.players.map((player) =>
      Object.freeze(structuredClone(viewFor(game, player.seat))))),
    game,
  }))
  const predictions = Object.freeze(detachedViews.flatMap(({ history, views }) =>
    views
      .filter((view) => ROLE_ALIGNMENT[view.role] === 'evil')
      .map((view) => predictVirtualAssassinFromView(view, history.id))))
  const truths = detachedViews.map(({ history, game }) => Object.freeze({
    historyId: history.id,
    merlinSeat: game.players.find((player) => player.role === 'merlin')!.seat,
  }))
  return Object.freeze({
    predictions,
    truths: Object.freeze(truths),
  })
}

export function runVirtualAssassinEvaluation(): readonly VirtualAssassinEvidence[] {
  const prepared = prepareVirtualAssassinEvaluation()
  return joinVirtualAssassinTruth(prepared.predictions, prepared.truths)
}
