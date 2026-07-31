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
} from '../server/agents/analysis/servant-objective.ts'
import {
  SERVANT_OBJECTIVE_CONSTANTS,
  SERVANT_OBJECTIVE_MODEL_VERSION,
} from '../server/agents/analysis/servant-objective-types.ts'
import { buildPublicSelfRead } from '../server/agents/analysis/public-self-read.ts'
// Seats 0 and 1 carried a failed quest; seats 2, 3 and 4 stayed off it.
import { failedQuestRecord } from './public-records.ts'

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
  const least = ranked[0]
  const most = ranked[ranked.length - 1]
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
