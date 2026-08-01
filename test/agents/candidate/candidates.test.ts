// test-lane: exhaustive
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EngineError,
  applyDecision,
  createGame,
  expectedDecisions,
} from '../../../server/engine/game.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { heuristicDecide } from '../../../server/agents/heuristic.ts'
import {
  candidateIdForDecision,
  legalCandidates,
} from '../../../server/agents/candidate/candidates.ts'
import { LEGAL_CANDIDATE_VERSION } from '../../../server/agents/candidate/types.ts'
import { TEAM_SIZES } from '../../../server/engine/rules.ts'
import { ARCHITECTURE_BANK } from '../../../server/eval/banks/architecture-bank.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import type {
  Decision,
  DecisionKind,
  DecisionRequest,
  Game,
  PlayerView,
  Seat,
} from '../../../server/engine/types.ts'

test('candidate IDs and order are deterministic and player-name invariant', () => {
  for (const fixture of readDecisionFixtures()) {
    const first = legalCandidates(fixture.req, fixture.view)
    const repeated = legalCandidates(fixture.req, fixture.view)
    const renamed = legalCandidates(fixture.req, {
      ...fixture.view,
      name: 'Renamed self',
      players: fixture.view.players.map((player) => ({
        ...player,
        name: `Renamed ${player.seat}`,
      })),
    })
    assert.deepEqual(repeated, first, fixture.id)
    assert.deepEqual(
      renamed.map((candidate) => candidate.id),
      first.map((candidate) => candidate.id),
      fixture.id,
    )
    assert.ok(first.every(
      (candidate) => candidate.version === LEGAL_CANDIDATE_VERSION,
    ))
    assert.equal(new Set(first.map((candidate) => candidate.id)).size, first.length)
    assert.ok(
      first.some(
        (candidate) =>
          candidate.id === candidateIdForDecision(fixture.baselineDecision),
      ),
      fixture.id,
    )
  }
})

test('discussion surface records an automatic transition without precommitting to silence', () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.req.kind === 'discuss',
  )!
  const candidates = legalCandidates(fixture.req, fixture.view)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]!.id, `${LEGAL_CANDIDATE_VERSION}:discuss:automatic`)
  assert.deepEqual(candidates[0]!.decision, { kind: 'discuss', say: '' })
  assert.equal(
    (candidates[0] as { template?: string }).template,
    'automatic',
  )
})

test('candidate generation rejects mismatched seats and decision phases', () => {
  const fixture = readDecisionFixtures()[0]!
  assert.throws(
    () => legalCandidates({ ...fixture.req, seat: (fixture.req.seat + 1) % 5 }, fixture.view),
    /does not match view seat/,
  )
  assert.throws(
    () => legalCandidates({ ...fixture.req, kind: 'vote' }, fixture.view),
    /cannot generate vote candidates from proposal view/,
  )
  assert.throws(
    () => legalCandidates({ ...fixture.req, round: fixture.req.round + 1 }, fixture.view),
    /does not match view position/,
  )
  assert.throws(
    () => legalCandidates({
      ...fixture.req,
      proposalNum: fixture.req.proposalNum + 1,
    }, fixture.view),
    /does not match view position/,
  )
})

/**
 * Drive every architecture bank case to completion with the heuristic and call
 * `visit` at each decision point. One walker keeps the bank driving convention,
 * discussion settings, and step guard identical across the laws below, so their
 * results stay comparable.
 */
function walkBank(
  visit: (
    game: Game,
    req: DecisionRequest,
    view: PlayerView,
    bankCase: (typeof ARCHITECTURE_BANK)[number],
  ) => void,
): void {
  for (const bankCase of ARCHITECTURE_BANK) {
    const game = createGame({
      seed: bankCase.seed,
      playerCount: bankCase.playerCount,
      roles: [...bankCase.roles],
      talk: {
        maxRounds: 1,
        maxRoundsAfterChange: 1,
        leaderInDiscussion: 'last',
      },
    })
    let guard = 0
    while (game.phase !== 'gameOver' && guard++ < 500) {
      const requests = expectedDecisions(game)
      assert.ok(requests.length)
      for (const req of requests) {
        const view = viewFor(game, req.seat)
        visit(game, req, view, bankCase)
        applyDecision(game, req.seat, heuristicDecide(req, view, bankCase.seed))
      }
    }
    assert.equal(game.phase, 'gameOver', bankCase.id)
  }
}

test('every generated candidate is accepted by the engine across the architecture bank', () => {
  const seen = new Set<DecisionKind>()
  const seenQuestSides = new Set<string>()
  walkBank((game, req, view, bankCase) => {
    seen.add(req.kind)
    if (req.kind === 'quest') seenQuestSides.add(view.alignment)
    for (const candidate of legalCandidates(req, view)) {
      const clone = structuredClone(game)
      assert.doesNotThrow(
        () => applyDecision(clone, req.seat, candidate.decision),
        `${bankCase.id} ${req.kind} ${candidate.id}`,
      )
    }
  })
  assert.deepEqual(
    [...seen].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
  assert.deepEqual([...seenQuestSides].sort(), ['evil', 'good'])
})

/**
 * Deliberately independent of `combinations()` in the generator: a defect
 * shared between the surface under test and its oracle would cancel itself
 * out, so the count comes from factorials and the published team-size table.
 */
const factorial = (n: number): number => (n <= 1 ? 1 : n * factorial(n - 1))

const binomial = (n: number, k: number): number =>
  k < 0 || k > n ? 0 : factorial(n) / (factorial(k) * factorial(n - k))

function expectedCandidateCount(req: DecisionRequest, view: PlayerView): number {
  const players = view.players.length
  const teamSize = TEAM_SIZES[players]![view.round - 1]!
  switch (req.kind) {
    case 'discuss':
      // Table talk has no enumerable mechanical content, so every seat has
      // exactly one automatic policy transition. Communication is separate.
      return 1
    case 'propose':
      return binomial(players, teamSize)
    case 'finalize':
      // Sticking, plus every legal team except the one already on the table.
      return 1 + (binomial(players, teamSize) - 1)
    case 'vote':
      return 2
    case 'quest':
      // The engine coerces a good seat's fail to success, so good has one
      // observable act on the quest.
      return view.alignment === 'good' ? 1 : 2
    case 'assassinate':
      return players - 1
  }
}

test('candidate counts match a closed-form oracle for every player count and kind', () => {
  const covered = new Set<string>()
  const check = (req: DecisionRequest, view: PlayerView, label: string): void => {
    if (req.kind === 'finalize') {
      // The closed form folds stick together with the excluded current team,
      // which is only sound while finalize always has a full team on the table.
      const current = view.currentTeam ?? []
      assert.equal(
        current.length,
        TEAM_SIZES[view.players.length]![view.round - 1],
        `${label} finalize without a full current team`,
      )
      assert.equal(new Set(current).size, current.length, label)
    }
    assert.equal(
      legalCandidates(req, view).length,
      expectedCandidateCount(req, view),
      `${label} ${req.kind}`,
    )
    covered.add(`${view.players.length}:${req.kind}`)
  }

  for (const fixture of readDecisionFixtures()) {
    check(fixture.req, fixture.view, fixture.id)
  }
  walkBank((_game, req, view, bankCase) => check(req, view, bankCase.id))

  for (let players = 5; players <= 10; players++) {
    for (const kind of ['discuss', 'propose', 'finalize', 'vote', 'quest'] as const) {
      assert.ok(covered.has(`${players}:${kind}`), `${players}p ${kind} never observed`)
    }
  }
  assert.ok(
    [...covered].some((entry) => entry.endsWith(':assassinate')),
    'no assassination decision observed',
  )
})

/** Every policy-owned alternative, holding voice-owned decoration empty. */
function policyOwnedDomain(req: DecisionRequest, view: PlayerView): readonly Decision[] {
  const seats = view.players.map((player) => player.seat).sort((a, b) => a - b)
  // Only the team-shaped kinds need the 2^n subsets, so the rest never pay for
  // building them.
  const everyTeam = (): Seat[][] => {
    const teams: Seat[][] = []
    for (let mask = 0; mask < 2 ** seats.length; mask++) {
      teams.push(seats.filter((_, index) => (mask & (1 << index)) !== 0))
    }
    return teams
  }
  switch (req.kind) {
    case 'discuss':
      // Speech text belongs to communication, not mechanical policy. The
      // policy-owned domain therefore contains only the automatic transition.
      return [{ kind: 'discuss', say: '' } as Decision]
    case 'propose':
      return everyTeam().map((team): Decision => ({ kind: 'propose', team }))
    case 'finalize':
      return [
        { kind: 'finalize', stick: true },
        ...everyTeam().map((team): Decision => ({
          kind: 'finalize',
          stick: false,
          team,
        })),
      ]
    case 'vote':
      return [
        { kind: 'vote', vote: 'approve' },
        { kind: 'vote', vote: 'reject' },
      ]
    case 'quest':
      return [
        { kind: 'quest', card: 'success' },
        { kind: 'quest', card: 'fail' },
      ]
    case 'assassinate':
      return seats.map((seat): Decision => ({ kind: 'assassinate', target: seat }))
  }
}

const outcomeOf = (game: Game, seat: Seat, decision: Decision): string => {
  const clone = structuredClone(game)
  applyDecision(clone, seat, decision)
  return JSON.stringify(clone)
}

/**
 * How much of the legal surface a sweep at this decision covers. The team-shaped
 * kinds change shape with the quest's team size, so one sweep per kind would
 * only ever exercise the opening quest; every other kind's surface depends on
 * the kind alone.
 */
function sweepKey(req: DecisionRequest, view: PlayerView): string {
  return req.kind === 'propose' || req.kind === 'finalize'
    ? `${req.kind}:${TEAM_SIZES[view.players.length]![view.round - 1]}`
    : req.kind
}

test('the candidate surface is complete over policy-owned mechanical alternatives', () => {
  const covered = new Set<DecisionKind>()
  // The exhaustive sweep enumerates every seat subset, so it runs once per
  // distinct surface shape per case rather than at every decision; the
  // closed-form oracle above covers the whole playthrough.
  const swept = new Set<string>()
  walkBank((game, req, view, bankCase) => {
    const key = sweepKey(req, view)
    if (swept.has(`${bankCase.id} ${key}`)) return
    swept.add(`${bankCase.id} ${key}`)
    covered.add(req.kind)

    const reachable = new Set<string>()
    for (const decision of policyOwnedDomain(req, view)) {
      try {
        reachable.add(outcomeOf(game, req.seat, decision))
      } catch (error) {
        // Only an engine verdict means "not part of the legal surface". Any
        // other failure is a defect in this enumeration and must not be
        // silently reported as an illegal action.
        if (!(error instanceof EngineError)) throw error
      }
    }
    const generated = new Map<string, string>()
    for (const entry of legalCandidates(req, view)) {
      const outcome = outcomeOf(game, req.seat, entry.decision)
      const duplicate = generated.get(outcome)
      assert.equal(
        duplicate,
        undefined,
        `${bankCase.id} ${entry.id} duplicates ${duplicate}`,
      )
      generated.set(outcome, entry.id)
    }
    assert.deepEqual(
      [...generated.keys()].sort(),
      [...reachable].sort(),
      `${bankCase.id} ${key} candidate surface is not the legal surface`,
    )
  })
  assert.deepEqual(
    [...covered].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
})

test('policy modules have no raw Game dependency', () => {
  for (const file of [
    'server/agents/candidate/candidates.ts',
    'server/agents/policy/forced.ts',
  ]) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /engine\/game/)
    assert.doesNotMatch(source, /type\s+Game(?:\s|,|\})/)
  }
})
