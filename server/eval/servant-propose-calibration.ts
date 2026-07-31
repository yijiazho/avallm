// Per-decision calibration for servant proposal policies.
//
// The game bench (servant-propose-bench.ts) asks whether a proposal policy
// changes who wins. It cannot answer that: only about a third of its games
// diverge from the baseline at all, each by roughly one proposal, so twenty-odd
// single-decision changes have to carry a win-rate claim. Three orders of
// magnitude of sample are spent on the variance between a proposal and a result.
//
// This asks the question the policy actually answers. Every servant proposal in
// every game is one held-out case: the seat's view, and the true evil seats from
// the deal it cannot see. A policy is scored on whether the team it picks seats
// evil. Two policies scored on the SAME cases give a paired comparison whose
// denominator is decisions rather than games, which is where the n is.
//
// Generation is separate from scoring for the reason assassin-calibration.ts
// gives: replaying the games is the cost, and shared cases make two policies
// comparable denominator for denominator instead of each scoring whatever states
// its own play happened to reach. It also removes the game bench's deepest
// problem, that the two arms drift into different games and stop being paired.
//
// The states are on-policy for the heuristic table that generates them, not for
// either policy under test. That is the same bargain assassin-calibration makes,
// and it is what "held-out" means here: a policy is judged on states it did not
// choose, so it cannot be scored favorably by steering the game somewhere its
// own weaknesses do not show.
//
// What this deliberately does NOT measure: the decoy half of the servant
// objective. Looking Merlin-like pays off only when an assassin spends its shot
// wrongly, which is a game outcome and not a property of a proposal. A policy
// can win here and still lose overall if it buys clean teams with exposure.
// Everything is API-free, seeded, and makes no provider call.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import { ROLE_ALIGNMENT } from '../engine/rules.ts'
import { createHeuristicAgent } from '../agents/heuristic.ts'
import { createComposedAgent } from '../agents/composed.ts'
import {
  roleObjectiveScorer,
  servantRoleScorer,
  type CandidateScorer,
} from '../agents/policy/score.ts'
import { legalCandidates } from '../agents/policy/candidates.ts'
import {
  buildServantRoleUtilityProjection,
} from '../agents/analysis/servant-role-utility.ts'
import {
  SERVANT_ROLE_UTILITY_CONSTANTS,
} from '../agents/policy/servant-score-contract.ts'
import { diagnosisPercent } from './report-format.ts'
import type { DecisionRequest, PlayerView, Role, Seat } from '../engine/types.ts'

export const SERVANT_PROPOSE_CALIBRATION_VERSION =
  'servant-propose-calibration-v1'

export interface ServantCalibrationCast {
  readonly playerCount: number
  readonly roles: readonly Role[]
}

/**
 * One legal cast per player count, every one seating Merlin, because the
 * refinement and its projection both decline without one. Player counts differ
 * in team size and in how many evil seats there are to avoid, which is the axis
 * a proposal policy is most likely to behave differently along.
 */
export const SERVANT_CALIBRATION_CASTS:
readonly ServantCalibrationCast[] = Object.freeze([
  {
    playerCount: 5,
    roles: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  },
  {
    playerCount: 7,
    roles: [
      'merlin', 'percival', 'servant', 'servant', 'morgana', 'assassin',
      'oberon',
    ],
  },
  {
    playerCount: 9,
    roles: [
      'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
      'mordred', 'morgana', 'assassin',
    ],
  },
  {
    playerCount: 10,
    roles: [
      'merlin', 'percival', 'servant', 'servant', 'servant', 'servant',
      'mordred', 'morgana', 'oberon', 'assassin',
    ],
  },
].map((cast) => Object.freeze({
  playerCount: cast.playerCount,
  roles: Object.freeze([...cast.roles] as Role[]),
})))

export const SERVANT_CALIBRATION_SEEDS_PER = 150

/** One held-out servant proposal, with the deal the seat cannot see. */
export interface ServantProposeCase {
  readonly view: PlayerView
  readonly req: DecisionRequest & { kind: 'propose' }
  readonly evilSeats: readonly Seat[]
  readonly round: number
  readonly playerCount: number
  /**
   * Whether the public read discriminates here at all. On a flat board every
   * survivor scores the same and the refinement is the canonical tie-break by
   * construction, so the cases where it can act are the ones worth reading.
   */
  readonly readSeparates: boolean
}

/** A proposal policy under test: a team for one held-out case. */
export type ProposalPicker =
  (input: ServantProposeCase) => Promise<readonly Seat[]>

const NO_DISCUSSION = {
  maxRounds: 0,
  maxRoundsAfterChange: 0,
  leaderInDiscussion: 'none',
} as const

function separates(view: PlayerView, req: DecisionRequest): boolean {
  const values = buildServantRoleUtilityProjection({
    view,
    candidates: legalCandidates(req, view),
  }).assessments.map((entry) => entry.roleValue)
  return Math.max(...values) - Math.min(...values)
    > SERVANT_ROLE_UTILITY_CONSTANTS.separationBand
}

/**
 * Every servant proposal in one played-out game. The table is heuristic
 * throughout and the game runs to its natural end rather than being forced,
 * because the evidence the public read consumes IS resolved quests: forcing
 * success the way the assassin harness does would delete the signal under test.
 */
async function collectFromGame(
  seed: string,
  cast: ServantCalibrationCast,
  out: ServantProposeCase[],
): Promise<void> {
  const game = createGame({
    seed,
    playerCount: cast.playerCount,
    roles: [...cast.roles],
    talk: NO_DISCUSSION,
  })
  const evilSeats = Object.freeze(
    game.players
      .filter((player) => ROLE_ALIGNMENT[player.role] === 'evil')
      .map((player) => player.seat),
  )
  const agents = game.players.map((player) =>
    createHeuristicAgent({ seed, seat: player.seat }))
  for (let step = 0; step < 600; step++) {
    const pending = expectedDecisions(game)
    if (!pending.length) return
    for (const req of pending) {
      const view = viewFor(game, req.seat)
      if (req.kind === 'propose' && view.role === 'servant') {
        out.push(Object.freeze({
          view,
          req: { ...req, kind: 'propose' as const },
          evilSeats,
          round: view.round,
          playerCount: cast.playerCount,
          readSeparates: separates(view, req),
        }))
      }
      applyDecision(
        game,
        req.seat,
        (await agents[req.seat].decide(req, view)).decision,
      )
    }
  }
}

/** The held-out set. Deterministic: same seeds in, same cases out. */
export async function generateServantProposeCases(
  seedsPer: number = SERVANT_CALIBRATION_SEEDS_PER,
): Promise<readonly ServantProposeCase[]> {
  const out: ServantProposeCase[] = []
  for (const cast of SERVANT_CALIBRATION_CASTS) {
    for (let seed = 0; seed < seedsPer; seed++) {
      await collectFromGame(
        `servant-cal-${cast.playerCount}-${seed}`,
        cast,
        out,
      )
    }
  }
  if (!out.length) throw new Error('servant calibration generated no cases')
  return Object.freeze(out)
}

export interface ServantProposeSlice {
  readonly label: string
  readonly decisions: number
  readonly dirtyTeams: number
  readonly evilSeatsPlaced: number
}

export interface ServantProposeMetrics {
  readonly version: typeof SERVANT_PROPOSE_CALIBRATION_VERSION
  readonly decisions: number
  /** Teams seating at least one evil player. The primary quantity. */
  readonly dirtyTeams: number
  readonly dirtyRate: number
  /**
   * Total evil seats placed, which separates "one evil" from "two" on the
   * two-fail quest that seven-or-more-player tables deal.
   */
  readonly evilSeatsPlaced: number
  readonly meanEvilOnTeam: number
  readonly byRound: readonly ServantProposeSlice[]
  readonly bySeparation: readonly ServantProposeSlice[]
}

const dirtyCount = (team: readonly Seat[], evil: readonly Seat[]): number =>
  team.filter((seat) => evil.includes(seat)).length

function slices(
  cases: readonly ServantProposeCase[],
  picks: readonly (readonly Seat[])[],
  keyOf: (input: ServantProposeCase) => string,
): readonly ServantProposeSlice[] {
  const grouped = new Map<string, { n: number; dirty: number; evil: number }>()
  for (const [index, input] of cases.entries()) {
    const key = keyOf(input)
    const entry = grouped.get(key) ?? { n: 0, dirty: 0, evil: 0 }
    const placed = dirtyCount(picks[index], input.evilSeats)
    entry.n += 1
    entry.dirty += placed > 0 ? 1 : 0
    entry.evil += placed
    grouped.set(key, entry)
  }
  return Object.freeze(
    [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([label, entry]) => Object.freeze({
        label,
        decisions: entry.n,
        dirtyTeams: entry.dirty,
        evilSeatsPlaced: entry.evil,
      })),
  )
}

/** Run one policy over the held-out set and score it against the true deal. */
export async function scoreProposalPicker(
  cases: readonly ServantProposeCase[],
  picker: ProposalPicker,
): Promise<{
  readonly metrics: ServantProposeMetrics
  readonly picks: readonly (readonly Seat[])[]
}> {
  const picks: (readonly Seat[])[] = []
  for (const input of cases) picks.push(await picker(input))
  let dirtyTeams = 0
  let evilSeatsPlaced = 0
  for (const [index, input] of cases.entries()) {
    const placed = dirtyCount(picks[index], input.evilSeats)
    if (placed > 0) dirtyTeams += 1
    evilSeatsPlaced += placed
  }
  return {
    picks: Object.freeze(picks),
    metrics: Object.freeze({
      version: SERVANT_PROPOSE_CALIBRATION_VERSION,
      decisions: cases.length,
      dirtyTeams,
      dirtyRate: dirtyTeams / cases.length,
      evilSeatsPlaced,
      meanEvilOnTeam: evilSeatsPlaced / cases.length,
      byRound: slices(cases, picks, (input) => `q${input.round}`),
      bySeparation: slices(
        cases,
        picks,
        (input) => input.readSeparates ? 'separating' : 'flat',
      ),
    }),
  }
}

/**
 * The paired comparison, which is the whole point of scoring both policies on
 * one set of cases.
 *
 * `agreed` is not evidence about either policy: on a flat board the refinement
 * IS the base's tie-break, so those cases are identical by construction and
 * would only dilute the rates. The discordant pairs are the entire signal, and
 * `baseCleanCandidateDirty` against `candidateCleanBaseDirty` is the McNemar
 * table: under the null that the two policies are equally good, each discordant
 * pair is a fair coin, so the count is Binomial(b + c, 1/2).
 */
export interface ServantProposePairing {
  readonly decisions: number
  readonly differingPicks: number
  readonly bothClean: number
  readonly bothDirty: number
  readonly baseCleanCandidateDirty: number
  readonly candidateCleanBaseDirty: number
  /** Two-sided exact binomial p over the discordant pairs; 1 when none. */
  readonly discordantPValue: number
}

/** Exact two-sided binomial tail at p = 1/2, computed without a clock or float drift. */
function twoSidedSignPValue(left: number, right: number): number {
  const n = left + right
  if (n === 0) return 1
  const extreme = Math.min(left, right)
  // Sum the lower tail exactly with a rolling binomial coefficient, then double
  // and clamp: at p = 1/2 the distribution is symmetric, so the two-sided value
  // is twice the smaller tail.
  let coefficient = 1
  let tail = 1
  for (let k = 1; k <= extreme; k++) {
    coefficient = coefficient * (n - k + 1) / k
    tail += coefficient
  }
  return Math.min(1, 2 * tail / 2 ** n)
}

export function pairProposalPickers(
  cases: readonly ServantProposeCase[],
  base: readonly (readonly Seat[])[],
  candidate: readonly (readonly Seat[])[],
): ServantProposePairing {
  if (base.length !== cases.length || candidate.length !== cases.length) {
    throw new Error('servant calibration pairing needs one pick per case')
  }
  let differingPicks = 0
  let bothClean = 0
  let bothDirty = 0
  let baseCleanCandidateDirty = 0
  let candidateCleanBaseDirty = 0
  for (const [index, input] of cases.entries()) {
    const baseTeam = [...base[index]].sort((left, right) => left - right)
    const candidateTeam = [...candidate[index]].sort(
      (left, right) => left - right,
    )
    if (baseTeam.join(',') !== candidateTeam.join(',')) differingPicks += 1
    const baseDirty = dirtyCount(baseTeam, input.evilSeats) > 0
    const candidateDirty = dirtyCount(candidateTeam, input.evilSeats) > 0
    if (!baseDirty && !candidateDirty) bothClean += 1
    else if (baseDirty && candidateDirty) bothDirty += 1
    else if (candidateDirty) baseCleanCandidateDirty += 1
    else candidateCleanBaseDirty += 1
  }
  return Object.freeze({
    decisions: cases.length,
    differingPicks,
    bothClean,
    bothDirty,
    baseCleanCandidateDirty,
    candidateCleanBaseDirty,
    discordantPValue: twoSidedSignPValue(
      baseCleanCandidateDirty,
      candidateCleanBaseDirty,
    ),
  })
}

/** A picker driven by a configured native scorer, exactly as production runs it. */
export function scorerPicker(scorer: CandidateScorer): ProposalPicker {
  return async (input) => {
    const decision = (await createComposedAgent({
      seed: `servant-cal-${input.req.seat}`,
      scorer,
    }).decide(input.req, input.view)).decision
    if (decision.kind !== 'propose') {
      throw new Error('servant calibration picker produced a non-proposal')
    }
    return decision.team
  }
}

/** The base the refinement sits on: the good proposal value plus its tie-break. */
export const baseProposalPicker = scorerPicker(roleObjectiveScorer)

/** The refinement under test. */
export const servantProposalPicker = scorerPicker(servantRoleScorer)

export interface ServantProposeCalibration {
  readonly version: typeof SERVANT_PROPOSE_CALIBRATION_VERSION
  readonly cases: number
  readonly base: ServantProposeMetrics
  readonly candidate: ServantProposeMetrics
  readonly pairing: ServantProposePairing
  /** The same pairing over the cases where the read discriminates at all. */
  readonly separatingPairing: ServantProposePairing
}

export async function runServantProposeCalibration(
  seedsPer: number = SERVANT_CALIBRATION_SEEDS_PER,
  onProgress?: (line: string) => void,
): Promise<ServantProposeCalibration> {
  onProgress?.(`generating cases (${seedsPer} seeds per cast)`)
  const cases = await generateServantProposeCases(seedsPer)
  onProgress?.(`scoring base over ${cases.length} decisions`)
  const base = await scoreProposalPicker(cases, baseProposalPicker)
  onProgress?.(`scoring candidate over ${cases.length} decisions`)
  const candidate = await scoreProposalPicker(cases, servantProposalPicker)
  const separating = cases
    .map((input, index) => ({ input, index }))
    .filter((entry) => entry.input.readSeparates)
  return Object.freeze({
    version: SERVANT_PROPOSE_CALIBRATION_VERSION,
    cases: cases.length,
    base: base.metrics,
    candidate: candidate.metrics,
    pairing: pairProposalPickers(cases, base.picks, candidate.picks),
    separatingPairing: pairProposalPickers(
      separating.map((entry) => entry.input),
      separating.map((entry) => base.picks[entry.index]),
      separating.map((entry) => candidate.picks[entry.index]),
    ),
  })
}

export function renderServantProposeCalibration(
  report: ServantProposeCalibration,
): string {
  const lines: string[] = [
    `${report.version}: ${report.cases} held-out servant proposals`,
    '',
    '  dirty = the proposed team seated at least one evil player; evil/team',
    '  counts them, which separates one evil from two on a two-fail quest.',
    '  policy       decisions   dirty  evil/team',
  ]
  for (const [label, metrics] of [
    ['base', report.base],
    ['candidate', report.candidate],
  ] as const) {
    lines.push(
      `  ${label.padEnd(12)}${String(metrics.decisions).padStart(9)}`
      + `  ${diagnosisPercent(metrics.dirtyTeams, metrics.decisions)}`
      + `     ${metrics.meanEvilOnTeam.toFixed(3)}`,
    )
  }
  for (const [title, key] of [
    ['by round', 'byRound'],
    ['by whether the public read discriminates', 'bySeparation'],
  ] as const) {
    lines.push('', `  ${title}: decisions / dirty rate`)
    for (const [label, metrics] of [
      ['base', report.base],
      ['candidate', report.candidate],
    ] as const) {
      lines.push(
        `  ${label.padEnd(12)}`
        + metrics[key]
          .map((slice) =>
            `${slice.label} ${slice.decisions}/`
            + `${diagnosisPercent(slice.dirtyTeams, slice.decisions).trim()}`)
          .join('  '),
      )
    }
  }
  lines.push(
    '',
    '  paired. agreed pairs carry no signal (a flat board makes the two',
    '  policies identical by construction), so the discordant pairs are the',
    '  comparison: b = base clean and candidate dirty, c = the reverse, and p',
    '  is the exact two-sided sign test over b + c.',
    '  set              decisions  differing  bothClean  bothDirty      b'
    + '      c        p',
  )
  for (const [label, pairing] of [
    ['all', report.pairing],
    ['separating', report.separatingPairing],
  ] as const) {
    lines.push(
      `  ${label.padEnd(16)}${String(pairing.decisions).padStart(9)}`
      + `${String(pairing.differingPicks).padStart(11)}`
      + `${String(pairing.bothClean).padStart(11)}`
      + `${String(pairing.bothDirty).padStart(11)}`
      + `${String(pairing.baseCleanCandidateDirty).padStart(7)}`
      + `${String(pairing.candidateCleanBaseDirty).padStart(7)}`
      + `${pairing.discordantPValue.toFixed(4).padStart(9)}`,
    )
  }
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      seeds: { type: 'string' },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
  })
  const seedsPer = values.seeds === undefined
    ? SERVANT_CALIBRATION_SEEDS_PER
    : Number(values.seeds)
  if (!Number.isInteger(seedsPer) || seedsPer < 1) {
    throw new Error('--seeds must be a positive integer')
  }
  const report = await runServantProposeCalibration(
    seedsPer,
    values.quiet ? undefined : (line) => console.log(line),
  )
  process.stdout.write(
    values.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : `${renderServantProposeCalibration(report)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
