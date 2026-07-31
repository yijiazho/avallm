// The per-decision harness for servant proposal policies.
//
// The measured verdict lives in docs/design-perception-primitive.md. This suite
// pins the properties that make the number readable: the held-out set is
// deterministic, the two policies are scored on the SAME cases, a board the
// public read cannot separate produces identical picks by construction (so
// those pairs carry no signal and must not be counted as agreement evidence),
// and the sign test over the discordant pairs is the arithmetic it claims.

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SERVANT_CALIBRATION_CASTS,
  SERVANT_PROPOSE_CALIBRATION_VERSION,
  baseProposalPicker,
  generateServantProposeCases,
  pairProposalPickers,
  runServantProposeCalibration,
  scoreProposalPicker,
  servantProposalPicker,
} from '../server/eval/servant-propose-calibration.ts'
import { ROLE_ALIGNMENT } from '../server/engine/rules.ts'

const SEEDS = 2

test('every cast seats Merlin and a servant, or the refinement declines', () => {
  assert.ok(SERVANT_CALIBRATION_CASTS.length >= 4)
  for (const cast of SERVANT_CALIBRATION_CASTS) {
    assert.equal(cast.roles.length, cast.playerCount)
    assert.ok(cast.roles.includes('merlin'), `${cast.playerCount}p needs Merlin`)
    assert.ok(cast.roles.includes('servant'), `${cast.playerCount}p needs a servant`)
  }
  // Player count is the axis a proposal policy most plausibly varies along,
  // since it sets team size and how many evil seats there are to avoid.
  assert.equal(
    new Set(SERVANT_CALIBRATION_CASTS.map((cast) => cast.playerCount)).size,
    SERVANT_CALIBRATION_CASTS.length,
  )
})

test('the held-out set is deterministic and carries the true deal', async () => {
  const first = await generateServantProposeCases(SEEDS)
  const second = await generateServantProposeCases(SEEDS)
  assert.ok(first.length > 0)
  assert.equal(first.length, second.length)
  assert.deepEqual(
    first.map((entry) => `${entry.req.seat}:${entry.round}:${entry.view.seat}`),
    second.map((entry) => `${entry.req.seat}:${entry.round}:${entry.view.seat}`),
  )
  for (const entry of first) {
    assert.equal(entry.view.role, 'servant')
    assert.equal(entry.req.kind, 'propose')
    assert.equal(entry.req.seat, entry.view.seat)
    assert.ok(entry.evilSeats.length > 0, 'a case needs the deal it is scored on')
    // The ground truth has to come from the deal rather than the acting view,
    // which is the entire reason this is a held-out set. Nothing to assert: a
    // PlayerView's players carry seat and name only, so a harness that tried to
    // read the roles off the view would not compile.
    assert.ok(
      entry.evilSeats.every((seat) => seat >= 0 && seat < entry.playerCount),
    )
  }
})

test('a board the read cannot separate produces identical picks', async () => {
  const cases = await generateServantProposeCases(SEEDS)
  const flat = cases.filter((entry) => !entry.readSeparates)
  assert.ok(flat.length > 0, 'the sample must contain a flat board')
  const base = await scoreProposalPicker(flat, baseProposalPicker)
  const candidate = await scoreProposalPicker(flat, servantProposalPicker)
  // Not a coincidence to be asserted loosely: with no spread the centered
  // adjustment is zero for every candidate, so the refinement resolves to the
  // base's own tie-break. These pairs are agreement by construction and would
  // dilute any rate they were counted in.
  assert.deepEqual(base.picks, candidate.picks)
  const pairing = pairProposalPickers(flat, base.picks, candidate.picks)
  assert.equal(pairing.differingPicks, 0)
  assert.equal(pairing.baseCleanCandidateDirty, 0)
  assert.equal(pairing.candidateCleanBaseDirty, 0)
  assert.equal(pairing.discordantPValue, 1)
})

test('the sign test is the exact two-sided binomial over discordant pairs', () => {
  const cases = (counts: readonly (readonly [boolean, boolean])[]) => {
    const inputs = counts.map(() => ({
      evilSeats: [9] as const,
    })) as never as Parameters<typeof pairProposalPickers>[0]
    const base = counts.map(([baseDirty]) => baseDirty ? [9] : [0])
    const candidate = counts.map(([, candDirty]) => candDirty ? [9] : [0])
    return pairProposalPickers(inputs, base, candidate)
  }
  // No disagreement at all is p = 1, not p = 0: nothing was observed.
  assert.equal(cases([[false, false], [true, true]]).discordantPValue, 1)
  // Ten discordant pairs all one way: 2 * (1/2)^10 = 0.001953125.
  assert.equal(
    cases(Array.from({ length: 10 }, () => [false, true] as const))
      .discordantPValue,
    2 / 2 ** 10,
  )
  // A five-three split, the worked example in the module's own render output.
  const split = cases([
    ...Array.from({ length: 5 }, () => [false, true] as const),
    ...Array.from({ length: 3 }, () => [true, false] as const),
  ])
  assert.equal(split.baseCleanCandidateDirty, 5)
  assert.equal(split.candidateCleanBaseDirty, 3)
  assert.ok(Math.abs(split.discordantPValue - 0.7265625) < 1e-12)
})

test('pairing refuses pick lists that do not match the cases', async () => {
  const cases = await generateServantProposeCases(SEEDS)
  assert.throws(
    () => pairProposalPickers(cases, [], []),
    /one pick per case/,
  )
})

test('a small calibration run scores both policies on one shared set', async () => {
  const report = await runServantProposeCalibration(SEEDS)
  assert.equal(report.version, SERVANT_PROPOSE_CALIBRATION_VERSION)
  assert.equal(report.base.decisions, report.cases)
  assert.equal(report.candidate.decisions, report.cases)
  assert.equal(report.pairing.decisions, report.cases)
  // The four paired cells partition the cases; a drifting denominator is how a
  // comparison silently stops being paired.
  assert.equal(
    report.pairing.bothClean
    + report.pairing.bothDirty
    + report.pairing.baseCleanCandidateDirty
    + report.pairing.candidateCleanBaseDirty,
    report.cases,
  )
  // Every differing pick lives in the separating subset, since a flat board
  // makes the policies identical. If this ever fails the refinement is acting
  // where it declared it has nothing to say.
  assert.equal(
    report.separatingPairing.differingPicks,
    report.pairing.differingPicks,
  )
  assert.ok(report.separatingPairing.decisions <= report.cases)
  for (const metrics of [report.base, report.candidate]) {
    assert.ok(metrics.dirtyRate >= 0 && metrics.dirtyRate <= 1)
    // evil-per-team counts seats, so it can exceed the dirty rate but never
    // falls below it: a dirty team seats at least one.
    assert.ok(metrics.meanEvilOnTeam >= metrics.dirtyRate)
    assert.equal(
      metrics.byRound.reduce((sum, slice) => sum + slice.decisions, 0),
      report.cases,
    )
    assert.equal(
      metrics.bySeparation.reduce((sum, slice) => sum + slice.decisions, 0),
      report.cases,
    )
  }
})

test('the alignment table is what defines a dirty team', async () => {
  const cases = await generateServantProposeCases(SEEDS)
  const entry = cases[0]
  // The harness scores against ROLE_ALIGNMENT, not against a hand-listed set of
  // evil role names that a new role would silently fall out of.
  const expected = entry.view.players
    .map((player) => player.seat)
    .filter((seat) => entry.evilSeats.includes(seat))
  assert.deepEqual([...entry.evilSeats].sort((a, b) => a - b), expected)
  assert.ok(
    Object.entries(ROLE_ALIGNMENT)
      .filter(([, alignment]) => alignment === 'evil')
      .length >= 4,
  )
})
