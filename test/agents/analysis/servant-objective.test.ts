// test-lane: contract
// The servant objective (server/agents/analysis/servant-objective.ts), and the
// first consumer of the shared public read. Servants used to route to 'off',
// on the reasoning that the concealment machinery had nothing to offer a role
// with no secret. These tests pin the two things that made that reasoning
// wrong: a servant pays for a dirty public image in standing, and profits from
// a Merlin-like one as a decoy.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildServantObjective,
  validateAdmittedServantObjectiveHostJoin,
  validateServantObjectiveSnapshot,
} from '../../../server/agents/analysis/servant-objective.ts'
import {
  SERVANT_OBJECTIVE_CONSTANTS,
  SERVANT_OBJECTIVE_MODEL_VERSION,
} from '../../../server/agents/analysis/servant-objective-types.ts'
import { buildPublicSelfRead } from '../../../server/agents/analysis/public-self-read.ts'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import {
  componentPayload,
  publicDecisionComponentRun,
} from '../../../server/agents/components/kernel.ts'
import { SERVANT_OBJECTIVE_COMPONENT } from '../../../server/agents/components/native-score-components.ts'
import { admitDecisionTrace } from '../../../server/agents/admission/composed-trace.ts'
import { revalidatedArchitectureIdentity } from '../../../server/agents/components/resolved-brain.ts'
import { readDecisionFixtures } from '../../../server/eval/replay/decision-fixtures.ts'
import type { DecisionTrace } from '../../../server/agents/trace.ts'
import { createGame, expectedDecisions } from '../../../server/engine/game.ts'
import { validateRoles } from '../../../server/engine/rules.ts'
import type { Role } from '../../../server/engine/types.ts'
import { viewFor } from '../../../server/engine/view.ts'
// Seats 0 and 1 carried a failed quest; seats 2, 3 and 4 stayed off it.
import { failedQuestRecord } from '../../support/public-records.ts'

const fixtureFor = (role: string) => {
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.view.role === role,
  )
  assert.ok(fixture, `a ${role} decision fixture must exist`)
  return fixture
}

const servantEntry = (trace: DecisionTrace) =>
  trace.components?.entries.find(
    (entry) => entry.component.id === SERVANT_OBJECTIVE_COMPONENT.id,
  )

const decide = async (role: string, servantObjectives: boolean) => {
  const fixture = fixtureFor(role)
  const decision = await createComposedAgent({
    seed: 'servant-wiring',
    ...(servantObjectives ? { servantObjectives: true } : {}),
  }).decide(fixture.req, fixture.view)
  assert.ok(decision.trace)
  return decision.trace
}

test('the snapshot is well formed and reconstructs from its input', () => {
  const input = { record: failedQuestRecord(), seat: 3 }
  const snapshot = buildServantObjective(input)

  assert.equal(snapshot.version, SERVANT_OBJECTIVE_MODEL_VERSION)
  assert.equal(snapshot.objective.seat, 3)
  assert.ok(validateServantObjectiveSnapshot(snapshot))
  assert.ok(validateAdmittedServantObjectiveHostJoin(snapshot, input))
})

// The standing half. A servant seen on a failed quest is not in danger, it is
// simply no longer listened to, and that is a real cost this role pays.
test('a seat on the failed quest has worse standing than one that was not', () => {
  const record = failedQuestRecord()
  const onQuest = buildServantObjective({ record, seat: 0 }).objective
  const offQuest = buildServantObjective({ record, seat: 3 }).objective

  assert.ok(
    onQuest.standingValue < offQuest.standingValue,
    'sitting on a failed quest must cost standing',
  )
  assert.ok(
    onQuest.roleValue < offQuest.roleValue,
    'and must show up in the blended value, not just the component',
  )
})

// The decoy half, and the reason a servant is not simply "a good player with
// no model": looking like the one who knows is worth something to a seat that
// loses nothing by being shot.
test('reading more Merlin-like raises the decoy value', () => {
  const record = failedQuestRecord()
  const read = buildPublicSelfRead(record)
  const ranked = [...read.seats].sort(
    (left, right) => left.merlinReadDeviation - right.merlinReadDeviation,
  )
  const least = ranked[0]!
  const most = ranked[ranked.length - 1]!
  assert.notEqual(
    least.merlinReadDeviation,
    most.merlinReadDeviation,
    'this board must separate the seats for the assertion to mean anything',
  )

  const leastDecoy = buildServantObjective({ record, seat: least.seat })
  const mostDecoy = buildServantObjective({ record, seat: most.seat })
  assert.ok(
    mostDecoy.objective.decoyValue > leastDecoy.objective.decoyValue,
    'the more Merlin-like seat must be the better decoy',
  )
})

// The whole point of the refactor: a role is a weight pair, and the weights
// are legible enough to state the blend in one line here.
test('the role value is exactly the declared blend of the two halves', () => {
  const snapshot = buildServantObjective({
    record: failedQuestRecord(), seat: 1,
  })
  const { standingValue, decoyValue, roleValue } = snapshot.objective
  const expected =
    SERVANT_OBJECTIVE_CONSTANTS.standingWeight * standingValue
    + SERVANT_OBJECTIVE_CONSTANTS.decoyWeight * decoyValue
  assert.ok(Math.abs(expected - roleValue) < 1e-9)
})

// Standing outweighs decoy on purpose: the standing tax is charged on every
// proposal, while the decoy payoff is collected once and only in games that
// reach the assassin. The ratio is tunable; this ORDER is the claim.
test('standing is weighted above decoy', () => {
  assert.ok(
    SERVANT_OBJECTIVE_CONSTANTS.standingWeight
      > SERVANT_OBJECTIVE_CONSTANTS.decoyWeight,
  )
  const total = SERVANT_OBJECTIVE_CONSTANTS.standingWeight
    + SERVANT_OBJECTIVE_CONSTANTS.decoyWeight
  assert.ok(
    Math.abs(total - 1) < 1e-9,
    'the weights must partition the value so roleValue stays in [0, 1]',
  )
})

test('a snapshot that disagrees with its own arithmetic is rejected', () => {
  const input = { record: failedQuestRecord(), seat: 0 }

  const movedStanding = structuredClone(buildServantObjective(input))
  movedStanding.objective.standingValue = 0.5
  assert.equal(validateServantObjectiveSnapshot(movedStanding), false)

  const movedDecoy = structuredClone(buildServantObjective(input))
  movedDecoy.objective.decoyValue = 0.5
  assert.equal(validateServantObjectiveSnapshot(movedDecoy), false)

  const movedRoleValue = structuredClone(buildServantObjective(input))
  movedRoleValue.objective.roleValue = 0.5
  assert.equal(validateServantObjectiveSnapshot(movedRoleValue), false)

  // A deviation change is caught through the values it should have moved.
  const movedDeviation = structuredClone(buildServantObjective(input))
  movedDeviation.objective.evilReadDeviation = 0.25
  assert.equal(validateServantObjectiveSnapshot(movedDeviation), false)
})

test('a servant seat admits the objective when the option is on', async () => {
  const trace = await decide('servant', true)
  const entry = servantEntry(trace)
  assert.equal(entry?.status, 'admitted')
  const payload = componentPayload(
    trace.components!, SERVANT_OBJECTIVE_COMPONENT,
  )
  assert.ok(validateServantObjectiveSnapshot(payload))
  assert.equal(payload.objective.seat, fixtureFor('servant').view.seat)
})

// The applies gate, checked from the other side. A non-servant seat still
// carries the entry (the component was requested) but must never carry a
// payload, since the objective would be meaningless and its presence a claim.
test('a non-servant seat leaves the objective inapplicable', async () => {
  const trace = await decide('merlin', true)
  const entry = servantEntry(trace)
  assert.equal(entry?.status, 'inapplicable')
  assert.equal(
    componentPayload(trace.components!, SERVANT_OBJECTIVE_COMPONENT),
    undefined,
  )
})

test('the option off leaves no servant entry at all', async () => {
  const trace = await decide('servant', false)
  assert.equal(servantEntry(trace), undefined)
})

// Why the token is private even though every input is public. Nothing in the
// payload is secret, but the component only APPLIES to a servant, so a public
// entry would publish "this seat is a servant" to spectators through the run
// without a single secret field. The public projection must drop it entirely.
test('the servant entry never survives the public projection', async () => {
  const trace = await decide('servant', true)
  assert.equal(servantEntry(trace)?.status, 'admitted')

  const projected = publicDecisionComponentRun(trace.components!)
  assert.ok(
    projected.entries.every(
      (entry) => entry.component.id !== SERVANT_OBJECTIVE_COMPONENT.id,
    ),
    'a public servant entry would leak the role it is gated on',
  )
  assert.ok(
    projected.configured.every(
      (entry) => entry.id !== SERVANT_OBJECTIVE_COMPONENT.id,
    ),
    'the configured graph leaks the same fact if it keeps the id',
  )
})

// The claim the whole approach rests on, asserted rather than argued.
//
// This objective is registered as a component instead of being routed through
// roleObjectiveRouter, and the reason that is safe is that generic v2 trace
// admission carries a new component with no closed-list edits anywhere. If
// that were false (an unregistered id, a stage or use mismatch, a privacy
// projection disagreement) every other test here would still pass while real
// ingress refused the decision. So admit a real one, and check a forged
// payload is still refused so the pass is not vacuous.
test('a servant trace survives real admission and forgery does not', async () => {
  const fixture = fixtureFor('servant')
  const agent = createComposedAgent({
    seed: 'servant-admission',
    servantObjectives: true,
  })
  const output = await agent.decide(fixture.req, fixture.view)
  const trace = output.trace!
  assert.equal(servantEntry(trace)?.status, 'admitted')

  const admissionInput = {
    kind: 'finalized-artifact' as const,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: 'servant-admission',
    expectedArchitectureIdentity:
      revalidatedArchitectureIdentity(agent.resolvedBrain().description),
  }
  // trusted-exact, not merely accepted: the host rebuilt the servant payload
  // byte for byte. Anything weaker would admit a plausible-looking objective.
  assert.equal(
    admitDecisionTrace({ ...admissionInput, trace }).kind,
    'trusted-exact',
  )

  const forged = structuredClone(trace)
  const payload = componentPayload(
    forged.components!, SERVANT_OBJECTIVE_COMPONENT,
  )!
  payload.objective.roleValue = 1 - payload.objective.roleValue
  assert.equal(
    admitDecisionTrace({ ...admissionInput, trace: forged }).kind,
    'rejected',
  )
})

// The applies gate has TWO conditions, and this is the second one. A cast with
// no Merlin is legal (validateRoles only demands one when Percival or Mordred
// is present), and the Merlin-likeness axis does not exist there. The entry
// must say inapplicable, not degraded: nothing broke.
test('a cast without Merlin leaves the objective inapplicable, not degraded', async () => {
  const roles: Role[] = ['servant', 'servant', 'servant', 'minion', 'oberon']
  assert.doesNotThrow(() => validateRoles(roles.length, [...roles]))

  for (let attempt = 0; attempt < 300; attempt++) {
    const game = createGame({
      seed: `servant-no-merlin-${attempt}`,
      playerCount: roles.length,
      roles: [...roles],
    })
    const req = expectedDecisions(game).find(
      (decision) => game.players[decision.seat]!.role === 'servant',
    )
    if (!req) continue
    const trace = (await createComposedAgent({
      seed: 'no-merlin',
      servantObjectives: true,
    }).decide(req, viewFor(game, req.seat))).trace!
    // Status alone is the whole assertion: the entry union gives the
    // inapplicable variant no failureCode field at all, so "inapplicable and
    // carrying no failure" is one fact the types already make unrepresentable
    // rather than two facts to check.
    assert.equal(servantEntry(trace)?.status, 'inapplicable')
    return
  }
  assert.fail('no servant decision was reachable in a Merlin-less cast')
})

// The objective is built from public state and a seat index, and never asks
// whether that seat is really a servant, because the public record cannot say.
// Role gating belongs to the caller holding the private view.
test('the objective builds for any seat without consulting a role', () => {
  const record = failedQuestRecord()
  for (let seat = 0; seat < record.playerCount; seat++) {
    const snapshot = buildServantObjective({ record, seat })
    assert.equal(snapshot.objective.seat, seat)
    assert.ok(validateServantObjectiveSnapshot(snapshot))
  }
})
