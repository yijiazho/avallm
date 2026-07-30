// Migration phase 7F1; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import test from 'node:test'
import { admitDecisionTrace } from '../server/agents/admission/composed-trace.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  ASSASSIN_MERLIN_POSTERIOR_COMPONENT,
  MORDRED_BLINDNESS_COMPONENT,
} from '../server/agents/components/native-role-components.ts'
import {
  MORGANA_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'
import { heuristicDecide } from '../server/agents/heuristic.ts'
import { FULL_ROLE_STACK_ATTRIBUTION_REASON } from '../server/agents/policy/full-role-score-contract.ts'
import {
  assassinMerlinTargetScorer,
  evilRoleObjectiveScorer,
  fullRolePolicyScorer,
  morganaRoleScorer,
  mordredBlindnessRoleScorer,
  roleObjectiveScorer,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  applyDecision,
  createGame,
  expectedDecisions,
} from '../server/engine/game.ts'
import type { AgentDecision } from '../server/agents/types.ts'
import type {
  DecisionRequest,
  PlayerView,
  Role,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
interface Fixture { readonly seed: string; readonly req: DecisionRequest; readonly view: PlayerView }
function proposal(role: Role, roles: readonly Role[]): Fixture {
  for (let attempt = 0; attempt < 100; attempt++) {
    const game = createGame({
      seed: `full-role-${role}-${attempt}`,
      playerCount: 5,
      roles: [...roles],
    })
    const actor = game.players.find((player) => player.role === role)!
    if (actor.seat !== game.leaderSeat) continue
    return {
      seed: game.seed,
      req: {
        kind: 'propose',
        seat: actor.seat,
        round: game.round,
        proposalNum: game.proposalNum,
      },
      view: viewFor(game, actor.seat),
    }
  }
  throw new Error(`could not find ${role} proposal`)
}
function assassination(): Fixture {
  const game = createGame({
    seed: 'full-role-assassination',
    playerCount: 5,
    roles: ['merlin', 'servant', 'servant', 'assassin', 'mordred'],
    talk: { maxRounds: 0, maxRoundsAfterChange: 0, leaderInDiscussion: 'none' },
  })
  while (game.phase !== 'assassination') {
    const req = expectedDecisions(game)[0]
    const view = viewFor(game, req.seat)
    applyDecision(
      game,
      req.seat,
      req.kind === 'quest'
        ? { kind: 'quest', card: 'success' }
        : heuristicDecide(req, view, game.seed),
    )
  }
  const req = expectedDecisions(game)[0]
  return { seed: game.seed, req, view: viewFor(game, req.seat) }
}
const mechanics = (
  trace: NonNullable<AgentDecision['trace']>,
) => trace.candidateScores!.map((row) => ({
  candidateId: row.candidateId,
  value: row.value,
  viable: row.viable,
  reasonCodes: row.reasonCodes
    .filter((reason) => reason !== FULL_ROLE_STACK_ATTRIBUTION_REASON),
}))
async function compare(input: Fixture, isolated: CandidateScorer) {
  const make = (scorer: CandidateScorer) => createComposedAgent({
    seed: input.seed,
    roleObjectiveRouter: true,
    scorer,
  })
  const baseline = await make(isolated).decide(input.req, input.view)
  const agent = make(fullRolePolicyScorer)
  const result = await agent.decide(input.req, input.view)
  assert.deepEqual(result.decision, baseline.decision)
  assert.deepEqual(mechanics(result.trace!), mechanics(baseline.trace!))
  assert.equal(
    result.trace!.componentVersions?.scorer,
    fullRolePolicyScorer.version,
  )
  assert.deepEqual(
    result.trace!.candidateScores!
      .filter((row) => row.reasonCodes.includes(
        FULL_ROLE_STACK_ATTRIBUTION_REASON,
      ))
      .map((row) => row.candidateId),
    result.trace!.candidateScores!
      .filter((row) => row.viable)
      .map((row) => row.candidateId),
  )
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: result.trace!,
    req: input.req,
    view: input.view,
    authoritativeAction: result.decision,
    selectedDecision: result.decision,
    deterministicSeed: input.seed,
    expectedArchitectureIdentity: projectResolvedArchitectureIdentity(
      agent.resolvedBrain().description,
    ),
  }).kind, 'trusted-exact')
  return { full: result.trace!, isolated: baseline.trace! }
}
test('one full-role scorer preserves every isolated role policy', async () => {
  const mordredCast: Role[] = ['merlin', 'servant', 'servant', 'assassin', 'mordred']
  const morganaCast: Role[] = ['merlin', 'percival', 'servant', 'assassin', 'morgana']
  const good = await compare(
    proposal('merlin', mordredCast),
    roleObjectiveScorer,
  )
  await compare(proposal('assassin', mordredCast), evilRoleObjectiveScorer)
  await compare(proposal('morgana', morganaCast), morganaRoleScorer)
  await compare(proposal('mordred', mordredCast), mordredBlindnessRoleScorer)
  await compare(assassination(), assassinMerlinTargetScorer)
  const unused = new Set([MORGANA_ROLE_UTILITY_COMPONENT.id,
    MORDRED_BLINDNESS_COMPONENT.id, ASSASSIN_MERLIN_POSTERIOR_COMPONENT.id])
  assert.ok([...unused].every((id) =>
    good.full.components!.configured.some((entry) => entry.id === id)))
  assert.ok(good.full.components!.policyUse
    .filter((entry) => unused.has(entry.component.id))
    .every((entry) => !entry.used && entry.stages.length === 0))
  const communicationSignature = (intent: typeof good.full.communicationIntent) =>
    [intent?.strategicReasonCodes, intent?.uncertainty, intent,
      intent?.claimCodes.includes('ACKNOWLEDGE_UNCERTAINTY')]
  assert.deepEqual(
    communicationSignature(good.full.communicationIntent),
    communicationSignature(good.isolated.communicationIntent),
  )
  assert.ok(!good.full.communicationIntent?.strategicReasonCodes
    .includes(FULL_ROLE_STACK_ATTRIBUTION_REASON))
})
