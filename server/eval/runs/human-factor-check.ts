// The two behavioural factors, checked against human play instead of our own.
//
// Every other bank in this folder plays our agents against our agents. That is
// the right default and it has one blind spot this run exists to cover: a
// factor can score well by detecting a rule its opponent was told to follow.
// The proposal factor did exactly that. `heuristic.ts` `decidePropose`
// implements the camouflage convention the factor prices, citing the same
// sections of `docs/research-strategy.md` the model was built from, so the
// heuristic corpus was close to built to satisfy it.
//
// The corpus here is 20 annotated six-player human games with ground-truth
// roles (see `server/eval/fixtures/human-games.json` for provenance and
// licence). It is far too small to calibrate anything. It is large enough to
// answer a DIRECTION question, and direction is what both open factor
// decisions turn on.
//
// What it cannot reach, stated once so no caller has to rediscover it: six
// players means no Oberon and no Mordred, so no visibility asymmetry, and no
// two-Fail quest. Those are precisely the dimensions `visibleFailPower` and
// `twoFailsRequired` exist for, so neither is tested by anything here.
//
// Run: node server/eval/runs/human-factor-check.ts

import fs from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { diagnosisPercent } from '../core/report-format.ts'

const FIXTURE = fileURLToPath(
  new URL('../fixtures/human-games.json', import.meta.url),
)

export interface HumanProposal {
  quest: number
  leader: number
  team: readonly number[]
  votes: readonly { seat: number; approve: boolean }[] | null
}

export interface HumanGame {
  id: string
  playerCount: number
  roleBySeat: readonly string[]
  evilSeats: readonly number[]
  proposals: readonly HumanProposal[]
}

export function loadHumanGames(): readonly HumanGame[] {
  const parsed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as {
    games: HumanGame[]
  }
  return parsed.games
}

/** Odds of `rate` against odds of `base`. One means no discrimination. */
export function oddsRatio(rate: number, base: number): number {
  return (rate / (1 - rate)) / (base / (1 - base))
}

export interface InclusionResult {
  proposals: number
  observed: number
  expected: number
  rate: number
  baseRate: number
  oddsLift: number
}

/**
 * How often a leader seated evil, against how often chance would have.
 *
 * The baseline is the same quantity `proposal-factor.ts` derives: with the
 * leader's own seat set aside, a team of this size covers that share of the
 * remaining seats. It depends only on the public shape, so it is the honest
 * "no information" comparison.
 */
function inclusion(
  games: readonly HumanGame[],
  leaderIsEvil: boolean,
): InclusionResult {
  let observed = 0
  let expected = 0
  let proposals = 0
  let slots = 0
  for (const game of games) {
    const evil = new Set(game.evilSeats)
    for (const proposal of game.proposals) {
      if (evil.has(proposal.leader) !== leaderIsEvil) continue
      const others = game.playerCount - 1
      const draw = proposal.team.length
        - (proposal.team.includes(proposal.leader) ? 1 : 0)
      // Every evil seat other than the leader is a target: for an evil leader
      // that is its single partner, for a good leader it is the whole evil
      // team, none of which it is supposed to be able to see.
      const targets = [...evil].filter((seat) => seat !== proposal.leader)
      for (const seat of targets) {
        observed += proposal.team.includes(seat) ? 1 : 0
        expected += draw / others
        slots += 1
      }
      proposals += 1
    }
  }
  const rate = slots ? observed / slots : 0
  const baseRate = slots ? expected / slots : 0
  return {
    proposals,
    observed,
    expected,
    rate,
    baseRate,
    oddsLift: slots ? oddsRatio(rate, baseRate) : 1,
  }
}

export interface ProposalDiagnostic {
  evilLed: InclusionResult
  goodLed: InclusionResult
  /**
   * The quantity the proposal factor's usefulness reduces to. It prices good
   * leaders at 1.00 and evil leaders at 0.5 to 0.6, so it assumes roughly
   * 0.55. At 1.00 the behaviour is real and carries no information about which
   * leader produced it.
   */
  diagnosticRatio: number
}

export function proposalDiagnostic(
  games: readonly HumanGame[],
): ProposalDiagnostic {
  const evilLed = inclusion(games, true)
  const goodLed = inclusion(games, false)
  return {
    evilLed,
    goodLed,
    diagnosticRatio: evilLed.oddsLift / goodLed.oddsLift,
  }
}

export interface ApprovalSplit {
  withEvilAboard: { approvals: number; ballots: number }
  clean: { approvals: number; ballots: number }
  oddsRatio: number
}

function emptySplit(): ApprovalSplit {
  return {
    withEvilAboard: { approvals: 0, ballots: 0 },
    clean: { approvals: 0, ballots: 0 },
    oddsRatio: 1,
  }
}

function finishSplit(split: ApprovalSplit): ApprovalSplit {
  const dirty = split.withEvilAboard
  const clean = split.clean
  if (!dirty.ballots || !clean.ballots) return split
  split.oddsRatio = oddsRatio(
    dirty.approvals / dirty.ballots,
    clean.approvals / clean.ballots,
  )
  return split
}

export interface VoteDiagnostic {
  /** The factor's one claim. It prices this above one. */
  evil: ApprovalSplit
  /** The factor assumes this is exactly one, and it is not. */
  good: ApprovalSplit
  /** Good split by role, because Merlin knowing outright is the obvious out. */
  goodByRole: Record<string, ApprovalSplit>
}

export function voteDiagnostic(games: readonly HumanGame[]): VoteDiagnostic {
  const result: VoteDiagnostic = {
    evil: emptySplit(),
    good: emptySplit(),
    goodByRole: {},
  }
  for (const game of games) {
    const evil = new Set(game.evilSeats)
    for (const proposal of game.proposals) {
      if (!proposal.votes) continue
      const dirty = proposal.team.some((seat) => evil.has(seat))
      for (const vote of proposal.votes) {
        const cell = dirty ? 'withEvilAboard' : 'clean'
        const bucket = evil.has(vote.seat) ? result.evil : result.good
        bucket[cell].approvals += vote.approve ? 1 : 0
        bucket[cell].ballots += 1
        if (evil.has(vote.seat)) continue
        // Seat indices come from the fixture's own vote records, so the
        // lookup is total; the assertion matches how master's checked-index
        // pass handled the same shape in the factors.
        const role = game.roleBySeat[vote.seat]!
        const byRole = result.goodByRole[role] ?? emptySplit()
        byRole[cell].approvals += vote.approve ? 1 : 0
        byRole[cell].ballots += 1
        result.goodByRole[role] = byRole
      }
    }
  }
  finishSplit(result.evil)
  finishSplit(result.good)
  for (const split of Object.values(result.goodByRole)) finishSplit(split)
  return result
}

function main(): void {
  const games = loadHumanGames()
  const proposal = proposalDiagnostic(games)
  const vote = voteDiagnostic(games)
  // `diagnosisPercent` called directly rather than wrapped in a local alias.
  // report-format.ts owns every published number in this folder, and its guard
  // bans the shorthand NAMES too, because a local `pct` is how the previous
  // fork of renderRate started.
  console.log(`human corpus: ${games.length} games\n`)
  console.log('PROPOSAL FACTOR (BELIEF-004)')
  console.log(
    `  evil leader seats partner ${diagnosisPercent(proposal.evilLed.rate, 1)}`
    + ` vs chance ${diagnosisPercent(proposal.evilLed.baseRate, 1)}  odds lift `
    + `${proposal.evilLed.oddsLift.toFixed(2)}  (n=${proposal.evilLed.proposals})`)
  console.log(
    `  good leader seats evil    ${diagnosisPercent(proposal.goodLed.rate, 1)}`
    + ` vs chance ${diagnosisPercent(proposal.goodLed.baseRate, 1)}  odds lift `
    + `${proposal.goodLed.oddsLift.toFixed(2)}  (n=${proposal.goodLed.proposals})`)
  console.log(
    `  diagnostic ratio ${proposal.diagnosticRatio.toFixed(2)} `
    + '(the factor assumes about 0.55; 1.00 means no information)\n')
  console.log('VOTE FACTOR (BELIEF-003)')
  console.log(`  evil voter, odds ratio ${vote.evil.oddsRatio.toFixed(2)} `
    + '(the factor prices this above one)')
  console.log(`  good voter, odds ratio ${vote.good.oddsRatio.toFixed(2)} `
    + '(the factor assumes exactly one)')
  for (const [role, split] of Object.entries(vote.goodByRole)) {
    console.log(`    ${role.padEnd(9)} ${split.oddsRatio.toFixed(2)}`)
  }
}

// Same guard idiom as the other runs in this folder. A path comparison would
// differ from import.meta.url on any repo path containing a space.
if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
