// NB-010 diagnosis: why the structured good policy loses to the heuristic
// population while its vote-truth accuracy rises.
//
// A wrongly rejected clean team and a wrongly approved dirty team are not worth
// the same: rejecting a clean team costs one proposal, while approving a dirty
// team can cost a quest and the game. This reader was the first to separate the
// two directions, and it pairs them with the outcome channel that actually
// ended each game, which is what makes the adverse win rate legible. NB-013 has
// since promoted the split into the architecture report's own decision-quality
// block, so the classification now lives in vote-direction.ts and both readers
// share it. What stays here is the outcome-channel join.
//
// It reads artifacts already written by a bench run. It plays no games, makes no
// call, and joins the true role deal, so it is offline evaluation only.

import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'
import { MAX_PROPOSALS } from '../../engine/rules.ts'
import {
  approvedVotes,
  countVoteByDirection,
  emptyVoteConfusion,
  teamIsDirty,
  totalVotes,
} from './vote-direction.ts'
import type { VoteConfusionCounts } from './vote-direction.ts'
import { readArtifacts } from '../core/artifact.ts'
import { diagnosisPer, diagnosisPercent } from '../core/report-format.ts'
import type { GameArtifact } from '../core/artifact.ts'

export const GOOD_POLICY_DIAGNOSIS_VERSION = 'good-policy-diagnosis-v1'

export interface GoodPolicyDiagnosisCell {
  readonly bank: string
  readonly targetRole: string
  readonly variant: string
  readonly games: number
  readonly targetWins: number
  /** Games that ended on each terminal channel, keyed `winner:winReason`. */
  readonly outcomes: Readonly<Record<string, number>>
  readonly proposals: number
  readonly hammerProposals: number
  readonly targetVotes: number
  readonly targetApprovals: number
  /** The cheap vote error: one wasted proposal. */
  readonly rejectedCleanTeams: number
  /** The expensive vote error: a quest evil can fail. */
  readonly approvedDirtyTeams: number
  readonly questsRun: number
  readonly questsFailed: number
}

export interface GoodPolicyDiagnosis {
  readonly version: typeof GOOD_POLICY_DIAGNOSIS_VERSION
  readonly cells: readonly GoodPolicyDiagnosisCell[]
}

interface MutableCell {
  bank: string
  targetRole: string
  variant: string
  games: number
  targetWins: number
  outcomes: Map<string, number>
  proposals: number
  hammerProposals: number
  votes: VoteConfusionCounts
  questsRun: number
  questsFailed: number
}

function architectureOf(artifact: GameArtifact): Readonly<{
  bank: string
  variant: string
  targetRole: string
  targetSeat: number
}> {
  const architecture = artifact.architecture
  if (
    !architecture
    || typeof architecture.bank !== 'string'
    || typeof architecture.variant !== 'string'
    || typeof architecture.targetRole !== 'string'
    || !Number.isInteger(architecture.targetSeat)
  ) {
    throw new Error('artifact is not an architecture bench result')
  }
  return architecture as ReturnType<typeof architectureOf>
}

export function diagnoseGoodPolicy(
  artifacts: readonly GameArtifact[],
): GoodPolicyDiagnosis {
  const cells = new Map<string, MutableCell>()
  for (const artifact of artifacts) {
    const architecture = architectureOf(artifact)
    const key = [
      architecture.bank,
      architecture.targetRole,
      architecture.variant,
    ].join('\0')
    let cell = cells.get(key)
    if (!cell) {
      cell = {
        bank: architecture.bank,
        targetRole: architecture.targetRole,
        variant: architecture.variant,
        games: 0,
        targetWins: 0,
        outcomes: new Map(),
        proposals: 0,
        hammerProposals: 0,
        votes: emptyVoteConfusion(),
        questsRun: 0,
        questsFailed: 0,
      }
      cells.set(key, cell)
    }
    const targetPlayer = artifact.players
      .find((player) => player.seat === architecture.targetSeat)
    if (!targetPlayer) {
      // Silently counting the game would report a 0% win rate for a policy
      // that may have won it, which is worse than refusing the artifact.
      throw new Error(
        `artifact ${artifact.id} has no player at target seat `
        + `${architecture.targetSeat}`,
      )
    }
    const targetSide = targetPlayer.alignment
    cell.games++
    if (artifact.winner === targetSide) cell.targetWins++
    const outcome = `${artifact.winner}:${artifact.winReason}`
    cell.outcomes.set(outcome, (cell.outcomes.get(outcome) ?? 0) + 1)

    for (const event of artifact.log) {
      const payload = event.payload as Record<string, unknown>
      if (event.type === 'proposal') {
        cell.proposals++
        if (payload.proposalNum === MAX_PROPOSALS) cell.hammerProposals++
        continue
      }
      if (event.type === 'voteReveal') {
        const votes = payload.votes as
          readonly { seat: number; vote: string }[] | undefined
        const team = payload.team as readonly number[] | undefined
        if (!votes || !team) continue
        const targetVote = votes.find(
          (vote) => vote.seat === architecture.targetSeat,
        )
        if (!targetVote) continue
        countVoteByDirection(
          cell.votes,
          targetVote.vote,
          teamIsDirty(artifact.players, team, artifact.id),
        )
        continue
      }
      if (event.type === 'questResult') {
        cell.questsRun++
        if (payload.result === 'fail') cell.questsFailed++
      }
    }
  }
  return {
    version: GOOD_POLICY_DIAGNOSIS_VERSION,
    // Named field by field rather than spread, so a future counting field
    // cannot leak into this record without a decision about reporting it.
    cells: [...cells.values()].map((cell) => Object.freeze({
      bank: cell.bank,
      targetRole: cell.targetRole,
      variant: cell.variant,
      games: cell.games,
      targetWins: cell.targetWins,
      outcomes: Object.freeze(Object.fromEntries(
        [...cell.outcomes].sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0),
      )),
      proposals: cell.proposals,
      hammerProposals: cell.hammerProposals,
      targetVotes: totalVotes(cell.votes),
      targetApprovals: approvedVotes(cell.votes),
      rejectedCleanTeams: cell.votes.cleanRejects,
      approvedDirtyTeams: cell.votes.dirtyApprovals,
      questsRun: cell.questsRun,
      questsFailed: cell.questsFailed,
    })),
  }
}

export function renderGoodPolicyDiagnosis(
  diagnosis: GoodPolicyDiagnosis,
): string {
  const lines: string[] = [
    'columns: win = target-side win rate; prop/g = proposals per game '
    + '(rejection pressure);',
    '  rejClean = cheap vote error; apprDirty = expensive vote error, '
    + 'both as a share of all votes;',
    '  qFail = quests failed. The architecture report states the same two '
    + 'errors conditioned',
    '  on the teams offered, so its rates are the same or higher and are the '
    + 'ones a promotion gate reads.',
  ]
  const banks = [...new Set(diagnosis.cells.map((cell) => cell.bank))].sort()
  for (const bank of banks) {
    lines.push('', `bank ${bank}`)
    lines.push(
      '  role      variant             win  prop/g hammer  apprv rejClean '
      + 'apprDirty   qFail  outcomes',
    )
    for (const cell of diagnosis.cells.filter((row) => row.bank === bank)) {
      const outcomes = Object.entries(cell.outcomes)
        .map(([key, count]) => `${key} ${diagnosisPercent(count, cell.games).trim()}`)
        .join(', ')
      lines.push(
        `  ${cell.targetRole.padEnd(9)} ${cell.variant.padEnd(18)}`
        + `${diagnosisPercent(cell.targetWins, cell.games)}`
        + ` ${diagnosisPer(cell.proposals, cell.games)}`
        + ` ${diagnosisPer(cell.hammerProposals, cell.games)}`
        + ` ${diagnosisPercent(cell.targetApprovals, cell.targetVotes)}`
        + ` ${diagnosisPercent(cell.rejectedCleanTeams, cell.targetVotes)}`
        + ` ${diagnosisPercent(cell.approvedDirtyTeams, cell.targetVotes)}`
        + ` ${diagnosisPercent(cell.questsFailed, cell.questsRun)}`
        + `  ${outcomes}`,
      )
    }
  }
  return lines.join('\n')
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false } },
  })
  if (positionals.length !== 1) {
    throw new Error(
      'usage: node server/eval/good-policy-diagnosis.ts <artifacts.jsonl> [--json]',
    )
  }
  const diagnosis = diagnoseGoodPolicy(readArtifacts(positionals[0]!))
  process.stdout.write(
    values.json
      ? `${JSON.stringify(diagnosis, null, 2)}\n`
      : `${renderGoodPolicyDiagnosis(diagnosis)}\n`,
  )
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
