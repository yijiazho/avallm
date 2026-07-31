// Contract: `projectConfiguredScoreDiagnostics` is ADDITIVE over the native
// score-layer rows it is handed. A family projection may attach private
// per-candidate feature fields, but every mechanical field (value, viable,
// reasonCodes) must come from those rows.
//
// `withNativeScoringAuthority` depends on this. It merges the diagnostics onto
// the native surface and takes the mechanical fields from the native rows
// without re-deriving or re-checking them, so a family projection can never
// become a second scoring authority. This test is that guard: it feeds each
// family real admitted evidence plus deliberately perturbed mechanical rows and
// asserts the mechanical fields track the rows while the features do not move.
//
// Trace admission performs the separate, genuinely independent check: it
// replays the score layers from the trace and compares the recorded
// diagnostics against that replay.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createComposedAgent } from '../server/agents/composed.ts'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import { componentPayload } from '../server/agents/components/kernel.ts'
import {
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  candidateTeams,
  hypotheticalProposalCandidates,
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  projectConfiguredScoreDiagnostics,
} from '../server/agents/policy/project-score-diagnostics.ts'
import {
  EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  ROLE_OBJECTIVE_SCORER_VERSION,
  evilRoleObjectiveScorer,
  morganaRoleScorer,
  roleObjectiveScorer,
} from '../server/agents/policy/score.ts'
import type {
  CandidateScore,
  CandidateScoringContext,
} from '../server/agents/policy/score.ts'
import type {
  ScoreLayerRow,
} from '../server/agents/policy/score-layer/types.ts'
import {
  MORGANA_ROLE_SCORER_VERSION,
} from '../server/agents/analysis/morgana-role-utility.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'

const fixtures = readDecisionFixtures()
const fixture = (role: Role) =>
  fixtures.find((candidate) => candidate.view.role === role)!

function voteFixture(role: Role): { req: DecisionRequest; view: PlayerView } {
  const source = fixture(role)
  const teamSize = source.view.quests[source.view.round - 1].teamSize
  const view: PlayerView = {
    ...structuredClone(source.view),
    phase: 'vote',
    currentTeam: source.view.players
      .slice(0, teamSize)
      .map((player) => player.seat),
  }
  return {
    req: {
      kind: 'vote',
      seat: view.seat,
      round: view.round,
      proposalNum: view.proposalNum,
    },
    view,
  }
}

function morganaProposal(): { seed: string; req: DecisionRequest; view: PlayerView } {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const seed = `native-score-diagnostics-${attempt}`
    const game = createGame({ seed, playerCount: 9 })
    const morgana = game.players.find((player) => player.role === 'morgana')!
    if (morgana.seat !== game.leaderSeat) continue
    return {
      seed,
      req: {
        kind: 'propose',
        seat: morgana.seat,
        round: game.round,
        proposalNum: game.proposalNum,
      },
      view: viewFor(game, morgana.seat),
    }
  }
  throw new Error('could not find a Morgana proposal fixture')
}

const mechanicalOf = (score: CandidateScore) => ({
  candidateId: score.candidateId,
  value: score.value,
  viable: score.viable,
  reasonCodes: [...score.reasonCodes],
})

/** Everything a projection may legitimately add, plus the scorer identity. */
const additiveOf = (score: CandidateScore): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...score }
  delete rest.candidateId
  delete rest.value
  delete rest.viable
  delete rest.reasonCodes
  return rest
}

/**
 * Rows the native layers could plausibly have produced, and a perturbation of
 * the same candidate set. Only mechanical fields differ between the two.
 */
function rowsFor(
  candidateIds: readonly string[],
): { readonly plain: readonly ScoreLayerRow[]; readonly perturbed: readonly ScoreLayerRow[] } {
  const plain = candidateIds.map((candidateId, index) => ({
    candidateId,
    value: index / (candidateIds.length + 1),
    viable: true,
    reasonCodes: ['NATIVE_PROBE'],
  }))
  const perturbed = plain.map((row) => ({
    candidateId: row.candidateId,
    value: row.value + 0.25,
    viable: !row.viable,
    reasonCodes: [...row.reasonCodes, 'PERTURBED'],
  }))
  return { plain, perturbed }
}

function assertAdditiveProjection(
  label: string,
  context: CandidateScoringContext,
  scorerVersion: string,
): void {
  const { plain, perturbed } = rowsFor(
    context.candidates.map((candidate) => candidate.id),
  )
  const projected = projectConfiguredScoreDiagnostics(
    context,
    plain,
    scorerVersion,
  )
  const reprojected = projectConfiguredScoreDiagnostics(
    context,
    perturbed,
    scorerVersion,
  )

  assert.equal(projected.length, plain.length, `${label}: row count`)
  assert.deepEqual(
    projected.map(mechanicalOf),
    plain.map((row) => ({ ...row, reasonCodes: [...row.reasonCodes] })),
    `${label}: mechanical fields must come from the native rows`,
  )
  assert.deepEqual(
    reprojected.map(mechanicalOf),
    perturbed.map((row) => ({ ...row, reasonCodes: [...row.reasonCodes] })),
    `${label}: perturbed mechanical fields must still come from the rows`,
  )
  assert.deepEqual(
    reprojected.map(additiveOf),
    projected.map(additiveOf),
    `${label}: diagnostics must not depend on native mechanical values`,
  )
  assert.ok(
    projected.some((score) => Object.keys(additiveOf(score)).length > 1),
    `${label}: expected this family to attach at least one feature field`,
  )
}

async function contextFor(
  seed: string,
  req: DecisionRequest,
  view: PlayerView,
  scorer: Parameters<typeof createComposedAgent>[0]['scorer'],
): Promise<CandidateScoringContext> {
  const output = await createComposedAgent({
    seed,
    roleObjectiveRouter: true,
    scorer,
  }).decide(req, view)
  const trace = output.trace!
  const candidates = legalCandidates(req, view)
  const hypotheticalTeamCandidates = hypotheticalProposalCandidates(view)
  const analysis = analyzeSituation(view, {
    belief: exactBelief(view),
    policyCandidateAssessments:
      candidateTeams(hypotheticalTeamCandidates, view),
    // The vote projection needs a current team; proposals have none.
    ...(req.kind === 'vote' ? { goodVote: true } : {}),
  })
  const forced = trace.forcedPolicyResult!
  const roleUtility = componentPayload(
    trace.components!,
    GOOD_ROLE_UTILITY_COMPONENT,
  )
  const evilRoleUtility = componentPayload(
    trace.components!,
    EVIL_ROLE_UTILITY_COMPONENT,
  )
  const morganaRoleUtility = componentPayload(
    trace.components!,
    MORGANA_ROLE_UTILITY_COMPONENT,
  )
  return {
    deterministicSeed: seed,
    request: req,
    view,
    analysis,
    candidates,
    hypotheticalTeamCandidates,
    forced,
    candidateBoundary: {
      survivorCandidateIds: forced.allowedCandidateIds,
      ...(forced.selectedCandidateId
        ? { selectedCandidateId: forced.selectedCandidateId }
        : {}),
      reasonCodes: forced.reasonCodes,
    },
    compatibilityCandidateId: candidates[0].id,
    ...(roleUtility ? { roleUtility } : {}),
    ...(evilRoleUtility ? { evilRoleUtility } : {}),
    ...(morganaRoleUtility ? { morganaRoleUtility } : {}),
  }
}

test('good role diagnostics are additive over the native rows', async () => {
  const { req, view } = voteFixture('merlin')
  const context = await contextFor(
    'native-score-diagnostics-good',
    req,
    view,
    roleObjectiveScorer,
  )
  assertAdditiveProjection(
    'good-role',
    context,
    ROLE_OBJECTIVE_SCORER_VERSION,
  )
})

test('evil role diagnostics are additive over the native rows', async () => {
  const { req, view } = voteFixture('mordred')
  const context = await contextFor(
    'native-score-diagnostics-evil',
    req,
    view,
    evilRoleObjectiveScorer,
  )
  assertAdditiveProjection(
    'evil-role',
    context,
    EVIL_ROLE_OBJECTIVE_SCORER_VERSION,
  )
})

test('Morgana diagnostics are additive over the native rows', async () => {
  const { seed, req, view } = morganaProposal()
  const context = await contextFor(seed, req, view, morganaRoleScorer)
  assertAdditiveProjection('morgana', context, MORGANA_ROLE_SCORER_VERSION)
})
