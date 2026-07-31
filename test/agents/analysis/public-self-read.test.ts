// test-lane: contract
// The shared two-axis public read (see server/agents/analysis/public-self-read.ts).
// Three role families were each measuring a private version of the same two
// public quantities, so the measurement is shared and only the weights stay
// private. These tests pin the two properties that make that sharing safe: the
// read is a pure function of PUBLIC state, and a stored snapshot cannot
// disagree with its own baseline arithmetic.

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPublicSelfRead,
  validateAdmittedPublicSelfReadHostJoin,
  validatePublicSelfReadSnapshot,
} from '../../../server/agents/analysis/public-self-read.ts'
import {
  PUBLIC_SELF_READ_VERSION,
} from '../../../server/agents/analysis/public-self-read-types.ts'
import { projectPublicRecord } from '../../../server/agents/record/public-record.ts'
import { createGame } from '../../../server/engine/game.ts'
import { MAX_PLAYERS, MIN_PLAYERS } from '../../../server/engine/rules.ts'
import { viewFor } from '../../../server/engine/view.ts'
import { failedQuestRecord, openingRecord } from '../../support/public-records.ts'

test('the snapshot is well formed and reconstructs from its record', () => {
  const record = failedQuestRecord()
  const snapshot = buildPublicSelfRead(record)

  assert.equal(snapshot.version, PUBLIC_SELF_READ_VERSION)
  assert.equal(snapshot.playerCount, 5)
  assert.equal(snapshot.seats.length, 5)
  snapshot.seats.forEach((seat, index) => assert.equal(seat.seat, index))

  assert.ok(validatePublicSelfReadSnapshot(snapshot))
  assert.ok(validateAdmittedPublicSelfReadHostJoin(snapshot, record))
})

test('every index stays inside its declared range', () => {
  const snapshot = buildPublicSelfRead(failedQuestRecord())
  for (const seat of snapshot.seats) {
    for (const value of [
      seat.evilProbability,
      seat.merlinProbability,
      seat.evilReadIndex,
      seat.merlinReadIndex,
      seat.servantWeight,
    ]) {
      assert.ok(value >= 0 && value <= 1, `${value} outside [0, 1]`)
    }
    for (const value of [seat.evilReadDeviation, seat.merlinReadDeviation]) {
      assert.ok(value >= -1 && value <= 1, `${value} outside [-1, 1]`)
    }
  }
})

test('the baseline is the servant-weighted centre of the seats', () => {
  const snapshot = buildPublicSelfRead(failedQuestRecord())
  const weightSum = snapshot.seats.reduce(
    (sum, seat) => sum + seat.servantWeight,
    0,
  )
  assert.ok(
    Math.abs(weightSum - snapshot.servantBaseline.servantWeightTotal) < 1e-9,
    'the stored total must equal the per-seat weights it came from',
  )
  assert.ok(
    snapshot.servantBaseline.evilReadMean > 0,
    'a five-player cast always carries evil, so the baseline cannot be zero',
  )
})

// The design claim this whole module rests on. Seats on a failed quest read
// dirtier than a typical servant and seats who stayed off it read cleaner, and
// the SIGN is what lets one measurement serve three roles: a negative reading
// reassures a servant and frightens Merlin, whose spotless record is the tell.
test('seats on a failed quest deviate dirty and the rest deviate clean', () => {
  const snapshot = buildPublicSelfRead(failedQuestRecord())
  const onFailedQuest = [0, 1]
  const offFailedQuest = [2, 3, 4]

  for (const seat of onFailedQuest) {
    assert.ok(
      snapshot.seats[seat].evilReadDeviation > 0,
      `seat ${seat} was on the failed quest and must read dirty`,
    )
  }
  for (const seat of offFailedQuest) {
    assert.ok(
      snapshot.seats[seat].evilReadDeviation < 0,
      `seat ${seat} stayed off the failed quest and must read clean`,
    )
  }

  const dirtiest = Math.min(
    ...onFailedQuest.map((seat) => snapshot.seats[seat].evilReadIndex),
  )
  const cleanest = Math.max(
    ...offFailedQuest.map((seat) => snapshot.seats[seat].evilReadIndex),
  )
  assert.ok(
    dirtiest > cleanest,
    'the two groups must not overlap on the raw index either',
  )
})

// A baseline with no width cannot rank anybody. Reporting zero is the honest
// answer, and the alternative is a division by zero dressed up as a read.
// Every legal cast size, because the degenerate baseline is not exactly zero
// at all of them. Where the weighted mean lands an ulp off the shared index,
// the spread is float residue near 1e-17, and dividing by that yielded the
// MAXIMUM deviation on a board where nobody had done anything. Ten players
// reproduced it; five did not, which is why one size was not enough.
test('an undistinguished board yields no deviation at any cast size', () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count++) {
    const snapshot = buildPublicSelfRead(openingRecord(count))
    for (const seat of snapshot.seats) {
      assert.equal(seat.evilReadDeviation, 0, `${count}p seat ${seat.seat}`)
      assert.equal(seat.merlinReadDeviation, 0, `${count}p seat ${seat.seat}`)
    }
    assert.ok(validatePublicSelfReadSnapshot(snapshot))
  }
})

// servantWeightTotal sums one marginal per seat, so it is an expected COUNT and
// runs to 4.0 at ten players. Validating it as a probability rejected every
// cast above five while the five-player suite stayed green.
test('a snapshot validates at every legal cast size', () => {
  for (let count = MIN_PLAYERS; count <= MAX_PLAYERS; count++) {
    const record = openingRecord(count)
    const snapshot = buildPublicSelfRead(record)
    assert.ok(
      snapshot.servantBaseline.servantWeightTotal > 0,
      `${count}p must carry servant weight`,
    )
    assert.ok(
      validatePublicSelfReadSnapshot(snapshot),
      `${count}p snapshot must validate`,
    )
    assert.ok(validateAdmittedPublicSelfReadHostJoin(snapshot, record))
  }
})

// The point of recomputing the baseline inside the schema rather than only
// shape-checking it. Each of these tampered snapshots has every field in range
// and the right keys, and is still internally inconsistent.
test('a snapshot that disagrees with its own arithmetic is rejected', () => {
  const record = failedQuestRecord()

  const movedMean = structuredClone(buildPublicSelfRead(record))
  movedMean.servantBaseline.evilReadMean = 0.5
  assert.equal(validatePublicSelfReadSnapshot(movedMean), false)

  const movedSpread = structuredClone(buildPublicSelfRead(record))
  movedSpread.servantBaseline.evilReadSpread = 0.25
  assert.equal(validatePublicSelfReadSnapshot(movedSpread), false)

  const movedDeviation = structuredClone(buildPublicSelfRead(record))
  movedDeviation.seats[0].evilReadDeviation = 0.5
  assert.equal(validatePublicSelfReadSnapshot(movedDeviation), false)

  const movedWeight = structuredClone(buildPublicSelfRead(record))
  movedWeight.seats[0].servantWeight = 0.5
  assert.equal(validatePublicSelfReadSnapshot(movedWeight), false)

  // An index change is caught through the deviation it should have moved.
  const movedIndex = structuredClone(buildPublicSelfRead(record))
  movedIndex.seats[0].evilReadIndex = 0.9
  assert.equal(validatePublicSelfReadSnapshot(movedIndex), false)

  // And the probability is bracketed against the index it feeds. Seat 2 reads
  // clean at an index of 0.20, which a 0.99 marginal rules out: the unstored
  // behavior term cannot be negative, so the index could not sit below 0.693.
  //
  // The bracket is one behavior-weight wide by construction, so it catches a
  // probability that contradicts its index rather than one that is merely off.
  // Exact reconstruction is the host-join rule's job, not the schema's.
  const movedProbability = structuredClone(buildPublicSelfRead(record))
  movedProbability.seats[2].evilProbability = 0.99
  assert.equal(validatePublicSelfReadSnapshot(movedProbability), false)
})

// The invariant that makes this projection safe to share across roles at all.
// Merlin, a minion, and a servant must measure the SAME public quantity, so if
// any private knowledge reached it, two seats in one game would disagree.
test('every seat in a game computes an identical read', () => {
  const game = createGame({ seed: 'public-self-read-shared', playerCount: 7 })
  const snapshots = game.players.map(
    (player) => buildPublicSelfRead(projectPublicRecord(viewFor(game, player.seat))),
  )
  for (const snapshot of snapshots.slice(1)) {
    assert.deepEqual(
      snapshot,
      snapshots[0],
      'a per-seat difference means private knowledge leaked into the read',
    )
  }
})
