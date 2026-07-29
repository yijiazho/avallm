import {
  applyDecisionWithOutcome,
  expectedDecisions,
} from '../../server/engine/game.ts'
import type {
  Decision,
  DecisionKind,
  DecisionRequest,
  Game,
  PlayerView,
} from '../../server/engine/types.ts'
import { viewFor } from '../../server/engine/view.ts'

export type DecisionFor<K extends DecisionKind> =
  Extract<Decision, { kind: K }>

export type DecisionCoordinate<K extends DecisionKind> = Readonly<{
  kind: K
  seat: number
  round: number
  proposalNum: number
}>

export type LegalReplayStep = {
  [K in DecisionKind]: Readonly<{
    request: DecisionCoordinate<K>
    decision: DecisionFor<K>
  }>
}[DecisionKind]

export type DecisionScenario<K extends DecisionKind> = Readonly<{
  request: Readonly<DecisionRequest & { kind: K }>
  view: Readonly<PlayerView>
  source: Readonly<{
    gameId: string
    seed: string
    throughSeq: number
  }>
}>

function sameCoordinate(
  request: DecisionRequest,
  coordinate: DecisionCoordinate<DecisionKind>,
): boolean {
  return request.kind === coordinate.kind
    && request.seat === coordinate.seat
    && request.round === coordinate.round
    && request.proposalNum === coordinate.proposalNum
}

function coordinateText(
  coordinate: DecisionCoordinate<DecisionKind>,
): string {
  return [
    coordinate.kind,
    `seat=${coordinate.seat}`,
    `round=${coordinate.round}`,
    `proposal=${coordinate.proposalNum}`,
  ].join(' ')
}

function exactExpectedRequest<K extends DecisionKind>(
  game: Game,
  coordinate: DecisionCoordinate<K>,
  label: string,
): DecisionRequest & { kind: K } {
  const matches = expectedDecisions(game).filter((request) =>
    sameCoordinate(request, coordinate))
  if (matches.length === 0) {
    throw new Error(
      `${label} coordinate is wrong or stale: ${coordinateText(coordinate)}`,
    )
  }
  if (matches.length !== 1) {
    throw new Error(
      `${label} coordinate is ambiguous: ${coordinateText(coordinate)}`,
    )
  }
  return matches[0] as DecisionRequest & { kind: K }
}

function deepFreeze<T>(value: T): T {
  if (
    value === null
    || typeof value !== 'object'
    || Object.isFrozen(value)
  ) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/**
 * Reconstruct a decision surface exclusively through production engine APIs.
 * The input game is cloned once so replay cannot mutate the caller's fixture.
 */
export function replayDecisionScenario<K extends DecisionKind>(
  game: Game,
  steps: readonly LegalReplayStep[],
  target: DecisionCoordinate<K>,
): DecisionScenario<K> {
  const replay = structuredClone(game)
  for (const [index, step] of steps.entries()) {
    const request = exactExpectedRequest(
      replay,
      step.request,
      `replay step ${index}`,
    )
    if (step.decision.kind !== request.kind) {
      throw new Error(
        `replay step ${index} decision kind does not match its request`,
      )
    }
    applyDecisionWithOutcome(replay, request.seat, step.decision)
  }

  const request = exactExpectedRequest(replay, target, 'target')
  const view = viewFor(replay, request.seat)
  const detached = structuredClone({
    request,
    view,
    source: {
      gameId: replay.id,
      seed: replay.seed,
      throughSeq: view.events.at(-1)?.seq ?? -1,
    },
  })
  return deepFreeze(detached)
}
