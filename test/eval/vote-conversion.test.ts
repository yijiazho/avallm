// test-lane: eval
// Migration phase 5C; see docs/agent-architecture-migration.md.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  runPhase5VoteConversionBench,
  phase5VoteConversionVariants,
  PHASE5_VOTE_CONVERSION_BANK_ID,
  PHASE5_VOTE_CONVERSION_EVAL_VERSION,
  PHASE5_VOTE_CONVERSION_VARIANTS,
} from '../../server/eval/runs/vote-conversion-bench.ts'
import {
  phase5VoteConversionReport,
  renderPhase5VoteConversionReport,
} from '../../server/eval/reports/vote-conversion-report.ts'
import {
  GOOD_PROPOSAL_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SCORER_VERSION,
  GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
} from '../../server/agents/policy/score.ts'
import {
  PHASE4_POLICY_BANK,
} from '../../server/eval/banks/good-policy-bank.ts'
import {
  runArchitectureBench,
} from '../../server/eval/harness/architecture-bench.ts'
import type { GameArtifact } from '../../server/eval/core/artifact.ts'
import type { GameEvent } from '../../server/engine/types.ts'

const ROLES = [
  'merlin',
  'percival',
  'servant',
  'morgana',
  'assassin',
] as const

function event(
  seq: number,
  type: GameEvent['type'],
  payload: Record<string, unknown>,
): GameEvent {
  return {
    seq,
    type,
    payload,
    visibility: 'public',
  } as GameEvent
}

function handArtifact(
  variant: string,
  caseId: string,
  input: {
    questResults: Array<'success' | 'fail'>
    cleanVote: 'approve' | 'reject'
    dirtyVote: 'approve' | 'reject'
    assassination?: boolean
    winner: 'good' | 'evil'
    winReason: string
  },
): GameArtifact {
  let seq = 1
  const log: GameEvent[] = [
    event(seq++, 'voteReveal', {
      team: [0, 1],
      votes: [{ seat: 0, vote: input.cleanVote }],
      approved: input.cleanVote === 'approve',
    }),
    event(seq++, 'voteReveal', {
      team: [0, 3],
      votes: [{ seat: 0, vote: input.dirtyVote }],
      approved: input.dirtyVote === 'approve',
    }),
    ...input.questResults.map((result, index) =>
      event(seq++, 'questResult', {
        round: index + 1,
        result,
        failCount: result === 'success' ? 0 : 1,
        failsRequired: 1,
      })),
    ...(input.assassination === undefined
      ? []
      : [event(seq++, 'assassination', {
          assassin: 4,
          target: input.assassination ? 0 : 1,
          wasMerlin: input.assassination,
        })]),
  ]
  return {
    schema: 3,
    id: `hand-${caseId}-${variant}`,
    seed: `hand-${caseId}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    playerCount: 5,
    roles: [...ROLES],
    talk: {
      maxRounds: 0,
      maxRoundsAfterChange: 0,
      leaderInDiscussion: 'none',
    },
    players: ROLES.map((role, seat) => ({
      seat,
      name: `P${seat + 1}`,
      role,
      alignment:
        role === 'morgana' || role === 'assassin' ? 'evil' : 'good',
      agent: seat === 0 ? `experiment:${variant}` : 'heuristic',
    })),
    winner: input.winner,
    winReason: input.winReason,
    steps: log.length,
    degraded: [],
    log,
    architecture: {
      bank: 'hand-phase5c',
      caseId,
      targetRole: 'merlin',
      targetSeat: 0,
      variant,
      components: {
        mode: variant === 'compatibility'
          ? 'compatibility'
          : 'structured-only',
        scorer: variant,
      },
    },
    tags: {
      opponentPopulation: 'heuristic-opponents',
    },
  }
}

function handCorpus(): GameArtifact[] {
  const baseline = [
    handArtifact('compatibility', 'case-a', {
      questResults: ['success', 'success', 'success'],
      cleanVote: 'reject',
      dirtyVote: 'approve',
      assassination: true,
      winner: 'evil',
      winReason: 'merlinAssassinated',
    }),
    handArtifact('compatibility', 'case-b', {
      questResults: ['fail', 'fail', 'fail'],
      cleanVote: 'approve',
      dirtyVote: 'reject',
      winner: 'evil',
      winReason: 'threeFails',
    }),
  ]
  const candidate = (variant: string) => [
    handArtifact(variant, 'case-a', {
      questResults: ['success', 'success', 'success'],
      cleanVote: 'approve',
      dirtyVote: 'reject',
      assassination: false,
      winner: 'good',
      winReason: 'assassinMissed',
    }),
    handArtifact(variant, 'case-b', {
      questResults: ['success', 'fail', 'success', 'success'],
      cleanVote: 'approve',
      dirtyVote: 'reject',
      assassination: true,
      winner: 'evil',
      winReason: 'merlinAssassinated',
    }),
  ]
  return [
    ...baseline,
    ...candidate('quest-proposal-only'),
    ...candidate('quest-proposal-top-v1'),
    ...candidate('quest-proposal-seeded-v1'),
  ]
}

test('Phase 5C hand-worked report exposes the full conversion diagnosis', () => {
  const artifacts = handCorpus()
  const report = phase5VoteConversionReport(artifacts)
  assert.deepEqual(phase5VoteConversionReport(artifacts), report)
  assert.equal(report.schema, 1)
  assert.equal(report.population, 'heuristic-opponents')
  assert.deepEqual(
    report.variants.map((variant) => variant.id),
    [
      'compatibility',
      'quest-proposal-only',
      'quest-proposal-top-v1',
      'quest-proposal-seeded-v1',
    ],
  )

  const baseline = report.variants[0]!
  assert.equal(baseline.funnel.resolvedQuests, 6)
  assert.equal(baseline.funnel.successfulQuests, 3)
  assert.equal(baseline.funnel.reachedAssassination, 1)
  assert.equal(baseline.funnel.survivedAssassination, 0)
  assert.equal(baseline.votes.cleanRejects, 1)
  assert.equal(baseline.votes.dirtyApprovals, 1)
  assert.deepEqual(baseline.winReasons, {
    merlinAssassinated: 1,
    threeFails: 1,
  })

  const proposal = report.variants[1]!
  assert.equal(proposal.funnel.resolvedQuests, 7)
  assert.equal(proposal.funnel.successfulQuests, 6)
  assert.equal(proposal.funnel.reachedAssassination, 2)
  assert.equal(proposal.funnel.survivedAssassination, 1)
  assert.equal(proposal.funnel.wins, 1)
  assert.equal(proposal.votes.cleanRejects, 0)
  assert.equal(proposal.votes.dirtyApprovals, 0)
  assert.equal(proposal.byRole[0]!.role, 'merlin')
  assert.equal(proposal.byRole[0]!.games, 2)
  assert.equal(proposal.byPlayerCount[0]!.playerCount, 5)
  assert.equal(proposal.byPlayerCount[0]!.games, 2)

  const comparison = report.comparisons[0]!
  assert.equal(comparison.matchedCases, 2)
  assert.deepEqual(comparison.winReasonTransitions, [
    { from: 'merlinAssassinated', to: 'assassinMissed', games: 1 },
    { from: 'threeFails', to: 'merlinAssassinated', games: 1 },
  ])
  assert.equal(comparison.targetWinRateDelta.delta, 0.5)
  assert.equal(comparison.assassinationReachRateDelta.delta, 0.5)
  assert.equal(
    comparison.conditionalAssassinationConversionDelta.delta,
    0.5,
  )
  assert.equal(comparison.cleanRejectRateDelta.delta, -0.5)
  assert.equal(comparison.dirtyApproveRateDelta.delta, -0.5)
  for (const estimate of [
    comparison.questSuccessRateDelta,
    comparison.assassinationReachRateDelta,
    comparison.conditionalAssassinationConversionDelta,
    comparison.targetWinRateDelta,
    comparison.cleanRejectRateDelta,
    comparison.dirtyApproveRateDelta,
  ]) {
    assert.ok(estimate.interval95)
    assert.ok(estimate.interval95!.low <= estimate.delta!)
    assert.ok(estimate.delta! <= estimate.interval95!.high)
  }

  const rendered = renderPhase5VoteConversionReport(report)
  assert.match(rendered, /reach assassination/)
  assert.match(rendered, /clean-reject/)
  assert.match(rendered, /dirty-approve/)
  assert.match(rendered, /95%/)
})

test('the direct conversion report rejects every unmatched-table facet', () => {
  // The benchmark path runs the architecture report first, which would catch
  // these. A caller invoking the post-hoc report directly gets no such pass, so
  // each facet is checked here at the report's own boundary.
  const perturb = (
    label: string,
    mutate: (artifact: GameArtifact) => void,
  ): void => {
    const artifacts = handCorpus()
    const candidate = artifacts.find(
      (artifact) =>
        artifact.architecture!.variant === 'quest-proposal-only'
        && artifact.architecture!.caseId === 'case-a',
    )!
    mutate(candidate)
    assert.throws(
      () => phase5VoteConversionReport(artifacts),
      /variants are not matched/,
      label,
    )
  }

  // Same configured role list, different seat-to-role deal: the old local
  // validator compared only `roles`, so this paired two different games.
  perturb('permuted deal', (artifact) => {
    const [first, second] = [artifact.players[1]!.role, artifact.players[2]!.role]
    artifact.players[1]!.role = second
    artifact.players[2]!.role = first
  })
  perturb('different opponent agent', (artifact) => {
    artifact.players[3]!.agent = 'random'
  })
  perturb('different seat names', (artifact) => {
    artifact.players[2]!.name = 'Renamed'
  })
  perturb('different talk configuration', (artifact) => {
    artifact.talk = { ...artifact.talk, maxRounds: 2 }
  })
  perturb('different seed', (artifact) => {
    artifact.seed = 'hand-case-a-other'
  })

  const mixedPopulation = handCorpus()
  const candidate = mixedPopulation.find(
    (artifact) =>
      artifact.architecture!.variant === 'quest-proposal-only'
      && artifact.architecture!.caseId === 'case-a',
  )!
  candidate.tags = { opponentPopulation: 'random-opponents' }
  assert.throws(
    () => phase5VoteConversionReport(mixedPopulation),
    /one bank and one population/,
  )

  // The unperturbed corpus still reports, so the checks above are not simply
  // rejecting everything.
  assert.ok(phase5VoteConversionReport(handCorpus()).variants.length)
})

test('Phase 5C lanes preserve proposal-only and v1 vote attribution', async () => {
  const variants = phase5VoteConversionVariants()
  assert.deepEqual(
    variants.map((variant) => variant.id),
    Object.values(PHASE5_VOTE_CONVERSION_VARIANTS),
  )
  assert.deepEqual(
    variants.map((variant) => variant.components.scorer),
    [
      'compatibility-scorer-v1',
      GOOD_PROPOSAL_SCORER_VERSION,
      GOOD_PROPOSAL_VOTE_SCORER_VERSION,
      GOOD_PROPOSAL_VOTE_SEEDED_SCORER_VERSION,
    ],
  )
  assert.deepEqual(
    variants.map((variant) => variant.components.evaluationRole),
    ['baseline', 'candidate', 'ablation', 'ablation'],
  )

  const artifacts = await runArchitectureBench({
    variants,
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    bankId: 'phase5c-lane-mechanics',
  })
  const byVariant = new Map(
    artifacts.map((artifact) => [
      artifact.architecture!.variant,
      artifact,
    ]),
  )
  const chosen = (
    variant: string,
    kind: 'propose' | 'vote',
  ) => (byVariant.get(variant)!.decisionTraces ?? [])
    .filter((trace) => trace.request.kind === kind)
    .map((trace) => trace.candidateScores?.find(
      (score) => score.candidateId === trace.chosenCandidateId,
    ))
  const proposalOnlyProposals = chosen(
    'quest-proposal-only',
    'propose',
  )
  const proposalOnlyVotes = chosen('quest-proposal-only', 'vote')
  const topVotes = chosen('quest-proposal-top-v1', 'vote')
  const seededVotes = chosen('quest-proposal-seeded-v1', 'vote')
  assert.ok(proposalOnlyProposals.length > 0)
  assert.ok(proposalOnlyVotes.length > 0)
  assert.ok(topVotes.length > 0)
  assert.ok(seededVotes.length > 0)
  assert.ok(proposalOnlyProposals.every(
    (score) => score?.features?.version === 'good-proposal-features-v1',
  ))
  assert.ok(proposalOnlyVotes.every(
    (score) =>
      score?.features === undefined
      && score?.reasonCodes.includes('COMPATIBILITY_CHOICE')
      && score.reasonCodes.includes(
        'GOOD_PROPOSAL_OUT_OF_SCOPE_COMPATIBILITY',
      ),
  ))
  assert.ok(topVotes.every(
    (score) =>
      score?.features?.version === 'good-vote-features-v1'
      && score.features.selectionMode === 'top-utility',
  ))
  assert.ok(seededVotes.every(
    (score) =>
      score?.features?.version === 'good-vote-features-v1'
      && score.features.selectionMode === 'seeded-band',
  ))

  const report = await runPhase5VoteConversionBench({
    cases: PHASE4_POLICY_BANK.slice(0, 1),
    opponentKinds: ['heuristic', 'random'],
  })
  assert.equal(report.bank, PHASE5_VOTE_CONVERSION_BANK_ID)
  for (const population of ['heuristic', 'random'] as const) {
    const selected = report.byPopulation[population]!
    assert.equal(selected.architecture.variants.length, 4)
    assert.equal(selected.conversion.variants.length, 4)
    assert.equal(
      selected.conversion.population,
      `${population}-opponents`,
    )
    for (const variant of selected.conversion.variants) {
      assert.equal(
        variant.components.evaluation,
        PHASE5_VOTE_CONVERSION_EVAL_VERSION,
      )
    }
    for (const variant of selected.architecture.variants) {
      assert.equal(variant.calls, 0)
      assert.equal(variant.cost, 0)
      assert.equal(variant.degraded, 0)
      assert.equal(variant.safety.hiddenInformationViolations, 0)
      assert.equal(variant.safety.traceAttributionViolations, 0)
    }
  }
})
