// test-lane: eval
// Migration NB-014; see docs/agent-architecture-migration.md.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  diagnoseProposalValue,
  renderProposalValueDiagnosis,
} from '../../server/eval/proposal-value-diagnosis.ts'
import type { GameArtifact } from '../../server/eval/artifact.ts'

/**
 * The reader consumes a narrow projection of a bench artifact: the deal, the
 * public log, and the target seat's proposal traces. These fixtures supply
 * exactly that rather than a whole replayable game.
 */

/** Seat 4 is the only evil seat in every fixture below. */
const EVIL_SEAT = 4

interface HandScore {
  /** Sorted team seats; also the candidate-id suffix. */
  team: readonly number[]
  cleanProbability: number
  viable?: boolean
}

interface HandProposal {
  round: number
  proposalNum: number
  /** The team actually proposed; must appear among `scores`. */
  team: readonly number[]
  scores?: readonly HandScore[]
  /** Override the stamped tie-break, to test the consistency guard. */
  tieBreakOn?: readonly number[]
  approved?: boolean
  revisedTo?: readonly number[]
  questResult?: 'success' | 'fail'
}

interface HandInput {
  bank?: string
  caseId: string
  variant: string
  targetRole?: string
  targetSeat?: number
  winner?: 'good' | 'evil'
  winReason?: string
  proposals: readonly HandProposal[]
  /** Suppress traces entirely, as a compatibility-only corpus would. */
  untraced?: boolean
}

const key = (team: readonly number[]): string =>
  [...team].sort((left, right) => left - right).join(',')

const candidateId = (team: readonly number[]): string =>
  `legal-candidates-v1:propose:${key(team)}`

function scoreRow(row: HandScore, tieBreak: boolean): unknown {
  return {
    version: 'good-proposal-scorer-v1',
    candidateId: candidateId(row.team),
    value: row.viable === false ? -Number.MAX_SAFE_INTEGER : row.cleanProbability,
    viable: row.viable !== false,
    reasonCodes: [
      row.viable === false ? 'FORCED_POLICY_REMOVED' : 'FORCED_POLICY_ALLOWED',
      'GOOD_PROPOSAL_JOINT_TEAM_CLEAN',
      ...(tieBreak ? ['GOOD_PROPOSAL_CANONICAL_TIE_BREAK'] : []),
    ],
    features: {
      version: 'good-proposal-features-v1',
      semantics: 'uniform-feasible-joint',
      beliefModelVersion: 'exact-constraints-v1',
      beliefThroughSeq: 11,
      team: [...row.team].sort((left, right) => left - right),
      cleanProbability: row.cleanProbability,
      evilCountDistribution: [row.cleanProbability, 1 - row.cleanProbability],
    },
  }
}

/**
 * Mirror the scorer's own rule: the code lands on the canonically first row of
 * an argmax that holds more than one team.
 */
function stampedTieBreak(
  proposal: HandProposal,
): readonly number[] | undefined {
  if (proposal.tieBreakOn) return proposal.tieBreakOn
  const viable = (proposal.scores ?? []).filter((row) => row.viable !== false)
  if (!viable.length) return undefined
  const max = Math.max(...viable.map((row) => row.cleanProbability))
  const argmax = viable
    .filter((row) => row.cleanProbability === max)
    .map((row) => row.team)
    .sort((left, right) => (candidateId(left) < candidateId(right) ? -1 : 1))
  return argmax.length > 1 ? argmax[0] : undefined
}

function handArtifact(input: HandInput): GameArtifact {
  const targetSeat = input.targetSeat ?? 0
  const log: unknown[] = []
  const traces: unknown[] = []
  let seq = 1
  for (const proposal of input.proposals) {
    log.push({
      seq: seq++,
      type: 'proposal',
      visibility: 'public',
      payload: {
        round: proposal.round,
        proposalNum: proposal.proposalNum,
        leader: targetSeat,
        team: [...proposal.team],
      },
    })
    if (proposal.revisedTo) {
      log.push({
        seq: seq++,
        type: 'proposalRevised',
        visibility: 'public',
        payload: {
          round: proposal.round,
          proposalNum: proposal.proposalNum,
          leader: targetSeat,
          from: [...proposal.team],
          to: [...proposal.revisedTo],
        },
      })
    }
    if (proposal.approved !== undefined) {
      log.push({
        seq: seq++,
        type: 'voteReveal',
        visibility: 'public',
        payload: {
          round: proposal.round,
          proposalNum: proposal.proposalNum,
          team: [...(proposal.revisedTo ?? proposal.team)],
          votes: [],
          approved: proposal.approved,
        },
      })
    }
    if (proposal.questResult) {
      log.push({
        seq: seq++,
        type: 'questResult',
        visibility: 'public',
        payload: {
          round: proposal.round,
          result: proposal.questResult,
          failCount: proposal.questResult === 'fail' ? 1 : 0,
        },
      })
    }
    if (input.untraced) continue
    const tieBreak = stampedTieBreak(proposal)
    traces.push({
      version: 'decision-trace-v2',
      decisionId:
        `decision:${targetSeat}:propose:q${proposal.round}`
        + `:p${proposal.proposalNum}:v11`,
      viewerSeat: targetSeat,
      request: {
        kind: 'propose',
        seat: targetSeat,
        round: proposal.round,
        proposalNum: proposal.proposalNum,
      },
      action: { kind: 'propose', team: [...proposal.team] },
      chosenCandidateId: candidateId(proposal.team),
      structuredCandidateId: candidateId(proposal.team),
      ...(proposal.scores
        ? {
            candidateScores: proposal.scores.map((row) =>
              scoreRow(
                row,
                tieBreak !== undefined && key(row.team) === key(tieBreak),
              )),
          }
        : {}),
    })
  }
  return {
    schema: 3,
    id: `hand-${input.caseId}-${input.variant}`,
    players: [0, 1, 2, 3, 4].map((seat) => ({
      seat,
      name: `P${seat + 1}`,
      role: seat === EVIL_SEAT ? 'assassin' : 'servant',
      alignment: seat === EVIL_SEAT ? 'evil' : 'good',
      agent: seat === targetSeat ? `experiment:${input.variant}` : 'heuristic',
    })),
    winner: input.winner ?? 'good',
    winReason: input.winReason ?? 'threeSuccesses',
    log,
    decisionTraces: traces,
    architecture: {
      bank: input.bank ?? 'hand-nb014',
      caseId: input.caseId,
      targetRole: input.targetRole ?? 'servant',
      targetSeat,
      variant: input.variant,
      components: {},
    },
  } as unknown as GameArtifact
}

const only = (artifacts: GameArtifact[]) => diagnoseProposalValue(artifacts).cells[0]

test('a flat posterior is reported as a tie the candidate order breaks', () => {
  // Three teams share the top clean probability, so nothing in the value
  // function distinguishes them and the canonical order picks 1,2.
  const cell = only([handArtifact({
    caseId: 'flat',
    variant: 'structured',
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [1, 2],
      scores: [
        { team: [1, 2], cleanProbability: 0.75 },
        { team: [1, 3], cleanProbability: 0.75 },
        { team: [2, 3], cleanProbability: 0.75 },
        { team: [1, 4], cleanProbability: 0.25 },
      ],
    }],
  })])
  assert.equal(cell.scoredProposals, 1)
  assert.equal(cell.argmaxTeams, 3)
  assert.equal(cell.tieDecided, 1)
  assert.equal(cell.uniqueDecided, 0)
  assert.equal(cell.chosenInArgmax, 1)
  // The margin separates the argmax set from the fourth team and still decides
  // nothing about the choice, which is why the two columns are both reported.
  assert.equal(cell.decisiveMarginSum, 0.5)
  assert.equal(cell.valueSpreadSum, 0.5)
  assert.equal(cell.lexRankSum, 0)
})

test('a sharp posterior is reported as a decided choice with a real margin', () => {
  const cell = only([handArtifact({
    caseId: 'sharp',
    variant: 'structured',
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [1, 2],
      scores: [
        { team: [1, 2], cleanProbability: 1 },
        { team: [1, 3], cleanProbability: 0.4 },
        { team: [1, 4], cleanProbability: 0 },
      ],
    }],
  })])
  assert.equal(cell.tieDecided, 0)
  assert.equal(cell.uniqueDecided, 1)
  assert.equal(cell.uniqueDecidedClean, 1)
  assert.equal(cell.argmaxTeams, 1)
  assert.equal(cell.decisiveMarginSum, 0.6)
  assert.equal(cell.tieArgmaxCleanFractionSum, 0)
})

test('cleanliness, the coin-flip null, and the posterior stay three numbers', () => {
  // The whole point of NB-014: a clean-proposal count alone cannot say whether
  // the tie-break was unlucky or badly chosen. Two of the three tied teams are
  // in fact clean and the canonical order took the third.
  const cell = only([handArtifact({
    caseId: 'null',
    variant: 'structured',
    targetSeat: 1,
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [1, 4],
      scores: [
        { team: [1, 4], cleanProbability: 0.6 },
        { team: [2, 3], cleanProbability: 0.6 },
        { team: [2, 5], cleanProbability: 0.6 },
        { team: [3, 5], cleanProbability: 0.1 },
      ],
    }],
  })])
  assert.equal(cell.cleanProposals, 0)
  assert.equal(cell.tieDecided, 1)
  assert.equal(cell.tieDecidedClean, 0)
  // Seats 2, 3 and 5 are good, seat 4 is evil, so two of the three tied teams
  // were clean and a coin flip would have scored 2/3.
  assert.equal(cell.tieArgmaxCleanFractionSum, 2 / 3)
  assert.equal(cell.tieChosenPosteriorSum, 0.6)
  assert.equal(cell.viableCleanFractionSum, 3 / 4)
})

test('the chosen team keeps its own lexicographic rank on the viable surface', () => {
  const cell = only([handArtifact({
    caseId: 'rank',
    variant: 'structured',
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [2, 3],
      scores: [
        { team: [1, 2], cleanProbability: 0.2 },
        { team: [1, 3], cleanProbability: 0.2 },
        { team: [2, 3], cleanProbability: 0.9 },
      ],
    }],
  })])
  assert.equal(cell.tracedProposals, 1)
  assert.equal(cell.viableTeams, 3)
  // Last of three viable ids in canonical order, so not the predictable floor.
  assert.equal(cell.lexRankSum, 1)
  assert.equal(cell.lexFloorChoices, 0)
})

test('rounds carry the argmax size, so a sharpening posterior is visible', () => {
  const cell = only([handArtifact({
    caseId: 'rounds',
    variant: 'structured',
    proposals: [
      {
        round: 1,
        proposalNum: 1,
        team: [1, 2],
        scores: [
          { team: [1, 2], cleanProbability: 0.5 },
          { team: [1, 3], cleanProbability: 0.5 },
          { team: [2, 3], cleanProbability: 0.5 },
        ],
      },
      {
        // A quest result has since removed most of the surface.
        round: 2,
        proposalNum: 1,
        team: [1, 2],
        scores: [
          { team: [1, 2], cleanProbability: 0.8 },
          { team: [1, 3], cleanProbability: 0.1 },
        ],
      },
    ],
  })])
  assert.deepEqual(
    cell.byRound.map((slice) => [
      slice.round,
      slice.proposals,
      slice.cleanProposals,
      slice.scoredProposals,
      slice.argmaxTeams,
      slice.viableTeams,
      slice.tieDecided,
    ]),
    // All three teams tie in round 1; in round 2 only one of two shares the top.
    [[1, 1, 1, 1, 3, 3, 1], [2, 1, 1, 1, 1, 2, 0]],
  )
  // Both took the canonically first viable team, one by tie-break and one on
  // a decisive value, which is why the floor count and the tie count differ.
  assert.equal(cell.lexFloorChoices, 2)
  assert.equal(cell.tieDecided, 1)
})

test('a removed candidate leaves the viable surface and its nulls', () => {
  const cell = only([handArtifact({
    caseId: 'removed',
    variant: 'structured',
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [1, 3],
      scores: [
        { team: [1, 2], cleanProbability: 0.9, viable: false },
        { team: [1, 3], cleanProbability: 0.5 },
        { team: [2, 3], cleanProbability: 0.5 },
      ],
    }],
  })])
  assert.equal(cell.viableTeams, 2)
  assert.equal(cell.argmaxTeams, 2)
  assert.equal(cell.tieDecided, 1)
  // Only the two survivors, both clean, feed the surface base rate.
  assert.equal(cell.viableCleanFractionSum, 1)
  assert.equal(cell.lexRankSum, 0)
})

test('a stamped tie-break the posterior does not show is refused', () => {
  const stray = handArtifact({
    caseId: 'stray',
    variant: 'structured',
    proposals: [{
      round: 1,
      proposalNum: 1,
      team: [1, 2],
      // A single maximum, yet the corpus claims the canonical order broke a tie.
      tieBreakOn: [1, 2],
      scores: [
        { team: [1, 2], cleanProbability: 0.9 },
        { team: [1, 3], cleanProbability: 0.2 },
      ],
    }],
  })
  assert.throws(
    () => diagnoseProposalValue([stray]),
    /stamps a tie-break the posterior does not show/,
  )
})

test('proposal numbers are separated, so a regression can be localized', () => {
  const cell = only([handArtifact({
    caseId: 'numbers',
    variant: 'structured',
    untraced: true,
    proposals: [
      { round: 1, proposalNum: 1, team: [1, 2] },
      { round: 2, proposalNum: 1, team: [1, 4] },
      { round: 3, proposalNum: 5, team: [2, 4], approved: true, questResult: 'fail' },
    ],
  })])
  assert.equal(cell.proposals, 3)
  assert.equal(cell.cleanProposals, 1)
  assert.deepEqual(
    cell.byProposalNum.map((slice) => [
      slice.proposalNum,
      slice.proposals,
      slice.cleanProposals,
      slice.approvedDirty,
    ]),
    [[1, 2, 1, 0], [5, 1, 0, 1]],
  )
  // No traces at all is a legal corpus shape; the posterior columns stay empty.
  assert.equal(cell.tracedProposals, 0)
  assert.equal(cell.scoredProposals, 0)
})

test('only an unrevised approved proposal can cost its own quest', () => {
  const cell = only([handArtifact({
    caseId: 'funnel',
    variant: 'structured',
    untraced: true,
    proposals: [
      // Dirty, approved, and the quest failed: the one path that costs.
      { round: 1, proposalNum: 1, team: [1, 4], approved: true, questResult: 'fail' },
      // Dirty and approved, but the quest held.
      { round: 2, proposalNum: 1, team: [2, 4], approved: true, questResult: 'success' },
      // Dirty and rejected.
      { round: 3, proposalNum: 1, team: [3, 4], approved: false },
      // Dirty at the propose step, but the leader revised it away, so this
      // proposal never reached the vote that passed.
      {
        round: 4,
        proposalNum: 1,
        team: [1, 4],
        revisedTo: [1, 2],
        approved: true,
        questResult: 'fail',
      },
    ],
  })])
  assert.equal(cell.proposals, 4)
  assert.equal(cell.cleanProposals, 0)
  assert.equal(cell.approved, 2)
  assert.equal(cell.approvedDirty, 2)
  assert.equal(cell.approvedDirtyFailedQuest, 1)
  assert.equal(cell.revisedAway, 1)
})

test('a repeated same-size team is counted only where a repeat was possible', () => {
  const cell = only([handArtifact({
    caseId: 'repeat',
    variant: 'structured',
    untraced: true,
    proposals: [
      { round: 1, proposalNum: 1, team: [0, 1] },
      { round: 2, proposalNum: 1, team: [0, 1, 2] },
      { round: 3, proposalNum: 1, team: [0, 1] },
      { round: 4, proposalNum: 1, team: [0, 2] },
    ],
  })])
  // Two later proposals had an earlier team of the same size to repeat; one did.
  assert.equal(cell.sameSizeRepeatPairs, 2)
  assert.equal(cell.sameSizeRepeats, 1)
  assert.equal(cell.selfIncluded, 4)
})

test('the matched pair is the first proposal both arms reach identically', () => {
  const baseline = (caseId: string, team: readonly number[]) =>
    handArtifact({
      caseId,
      variant: 'compatibility',
      proposals: [{
        round: 1,
        proposalNum: 1,
        team,
        scores: [
          { team: [1, 2], cleanProbability: 0.5 },
          { team: [1, 4], cleanProbability: 0.5 },
        ],
      }],
    })
  const candidate = (caseId: string, team: readonly number[]) =>
    handArtifact({
      caseId,
      variant: 'structured',
      proposals: [{
        round: 1,
        proposalNum: 1,
        team,
        scores: [
          { team: [1, 2], cleanProbability: 0.5 },
          { team: [1, 4], cleanProbability: 0.5 },
        ],
      }],
    })
  const diagnosis = diagnoseProposalValue([
    baseline('a', [1, 2]),
    candidate('a', [1, 4]),
    baseline('b', [1, 4]),
    candidate('b', [1, 2]),
    baseline('c', [1, 2]),
    candidate('c', [1, 2]),
  ])
  assert.equal(diagnosis.pairings.length, 1)
  const pairing = diagnosis.pairings[0]
  assert.equal(pairing.baseline, 'compatibility')
  assert.equal(pairing.candidate, 'structured')
  assert.equal(pairing.cases, 3)
  assert.equal(pairing.pairs, 3)
  assert.equal(pairing.agreed, 1)
  assert.equal(pairing.baselineClean, 2)
  assert.equal(pairing.candidateClean, 2)
  assert.equal(pairing.baselineCleanCandidateDirty, 1)
  assert.equal(pairing.candidateCleanBaselineDirty, 1)
  assert.equal(pairing.unmatchedPosition, 0)
})

test('a pair whose arms proposed from different positions is excluded, not folded', () => {
  const diagnosis = diagnoseProposalValue([
    handArtifact({
      caseId: 'drifted',
      variant: 'compatibility',
      proposals: [{ round: 1, proposalNum: 1, team: [1, 2] }],
    }),
    handArtifact({
      // A different round means a different game state, so the two proposals
      // are not the same decision and must not become a delta.
      caseId: 'drifted',
      variant: 'structured',
      proposals: [{ round: 2, proposalNum: 1, team: [1, 4] }],
    }),
    handArtifact({
      caseId: 'silent',
      variant: 'compatibility',
      proposals: [{ round: 1, proposalNum: 1, team: [1, 2] }],
    }),
    handArtifact({
      caseId: 'silent',
      variant: 'structured',
      proposals: [],
    }),
  ])
  const pairing = diagnosis.pairings[0]
  assert.equal(pairing.cases, 2)
  assert.equal(pairing.pairs, 0)
  assert.equal(pairing.unmatchedPosition, 1)
  assert.equal(pairing.onlyBaseline, 1)
  assert.equal(pairing.onlyCandidate, 0)
})

test('an explicit baseline that names no variant is refused', () => {
  assert.throws(
    () => diagnoseProposalValue(
      [handArtifact({
        caseId: 'a',
        variant: 'structured',
        untraced: true,
        proposals: [],
      })],
      { baselineVariant: 'compatibilty' },
    ),
    /no variant compatibilty in bank hand-nb014 for target servant/,
  )
})

test('cells never merge across banks, so populations stay separate', () => {
  const heuristic = handArtifact({
    bank: 'hand-nb014-heuristic',
    caseId: 'a',
    variant: 'structured',
    untraced: true,
    winner: 'good',
    proposals: [{ round: 1, proposalNum: 1, team: [1, 2] }],
  })
  const random = handArtifact({
    bank: 'hand-nb014-random',
    caseId: 'a',
    variant: 'structured',
    untraced: true,
    winner: 'evil',
    proposals: [{ round: 1, proposalNum: 1, team: [1, 4] }],
  })
  const diagnosis = diagnoseProposalValue([heuristic, random])
  assert.deepEqual(
    diagnosis.cells.map((cell) => [cell.bank, cell.targetWins, cell.cleanProposals]),
    [['hand-nb014-heuristic', 1, 1], ['hand-nb014-random', 0, 0]],
  )
  const rendered = renderProposalValueDiagnosis(diagnosis)
  assert.match(rendered, /bank hand-nb014-heuristic\b/)
  assert.match(rendered, /bank hand-nb014-random\b/)
  assert.match(rendered, /value structure/)
})

test('a target seat absent from the cast is refused, not scored as a loss', () => {
  const stray = handArtifact({
    caseId: 'stray',
    variant: 'structured',
    untraced: true,
    proposals: [],
  })
  ;(stray.architecture as { targetSeat: number }).targetSeat = 9
  assert.throws(
    () => diagnoseProposalValue([stray]),
    /no player at target seat 9/,
  )
})

test('a non-bench artifact is refused rather than silently grouped', () => {
  const stray = handArtifact({
    caseId: 'stray',
    variant: 'structured',
    untraced: true,
    proposals: [],
  })
  delete (stray as { architecture?: unknown }).architecture
  assert.throws(
    () => diagnoseProposalValue([stray]),
    /not an architecture bench result/,
  )
})

test('one variant cannot present the same case twice', () => {
  assert.throws(
    () => diagnoseProposalValue([
      handArtifact({
        caseId: 'a',
        variant: 'structured',
        untraced: true,
        proposals: [],
      }),
      handArtifact({
        caseId: 'a',
        variant: 'structured',
        untraced: true,
        proposals: [],
      }),
    ]),
    /duplicate case a for variant structured/,
  )
})
