// test-lane: eval
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
import { composedBrainOptions } from '../../server/agents/registry.ts'
import { QUEST_WEIGHTED_BELIEF_VERSION } from '../../server/agents/belief/quest-card-factor.ts'
import {
  SERVANT_CALIBRATION_CASTS,
  SERVANT_PROPOSE_CALIBRATION_VERSION,
  baseProposalPicker,
  generateServantProposeCases,
  pairProposalPickers,
  runServantProposeCalibration,
  COMPOSED_OPPONENT_IDENTITY,
  scoreProposalPicker,
  servantProposalPicker,
  projectionAdjustedPicker,
  SERVANT_PROPOSE_HYPOTHESES,
} from '../../server/eval/runs/servant-propose-calibration.ts'
import { ROLE_ALIGNMENT } from '../../server/engine/rules.ts'

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

  // Above about a thousand discordant pairs the naive form overflows: a raw
  // binomial coefficient and 2**n both reach Infinity, and the p-value came
  // back NaN. This harness exists to push n into the thousands, so the failure
  // sat exactly where the module is meant to be used.
  const large = cases([
    ...Array.from({ length: 620 }, () => [false, true] as const),
    ...Array.from({ length: 600 }, () => [true, false] as const),
  ])
  assert.ok(
    Number.isFinite(large.discordantPValue),
    `a 620/600 split returned ${large.discordantPValue}`,
  )
  assert.ok(large.discordantPValue > 0 && large.discordantPValue <= 1)
  // A near-even split of that size is nowhere near significant, and a lopsided
  // one of the same size is decisive. Both must be reachable, or the guard
  // above would pass on a function that returned a constant.
  assert.ok(large.discordantPValue > 0.5)
  const lopsided = cases(
    Array.from({ length: 1200 }, () => [false, true] as const),
  )
  assert.ok(lopsided.discordantPValue < 1e-12)
})

// The refinement is a hypothesis scored offline, not a shipped layer, so the
// thing that has to hold is that turning the adjustment off reproduces the base
// exactly. If it did not, the harness would be comparing the base against
// something other than "the base plus this adjustment".
test('a zero adjustment reproduces the base policy exactly', async () => {
  const cases = (await generateServantProposeCases(SEEDS)).slice(0, 12)
  const base = await scoreProposalPicker(cases, baseProposalPicker)
  const inert = await scoreProposalPicker(cases, projectionAdjustedPicker(0))
  assert.deepEqual(inert.picks, base.picks)
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
  const entry = cases[0]!
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

// Every hypothesis is scored against the same held-out cases, which is the only
// thing that makes their answers comparable. A hypothesis that quietly scored a
// different set would look better or worse for a reason nobody could see.
test('every named hypothesis scores the same cases as the base', async () => {
  const names = Object.keys(SERVANT_PROPOSE_HYPOTHESES)
  assert.ok(names.includes('public-read'))
  assert.ok(names.includes('compatibility-tie-order'))
  assert.ok(names.includes('compatibility'))
  const cases = (await generateServantProposeCases(SEEDS)).slice(0, 8)
  const base = await scoreProposalPicker(cases, baseProposalPicker)
  for (const name of names) {
    const scored = await scoreProposalPicker(
      cases,
      SERVANT_PROPOSE_HYPOTHESES[name]!,
    )
    assert.equal(scored.metrics.decisions, base.metrics.decisions, name)
    assert.equal(scored.picks.length, cases.length, name)
    // A picker must return a team that was actually legal for the case, or it
    // is being scored on something the seat could not have proposed.
    for (const [index, team] of scored.picks.entries()) {
      assert.equal(
        team.length,
        cases[index]!.view.quests[cases[index]!.round - 1]!.teamSize,
        `${name} produced a wrong-sized team`,
      )
    }
  }
})

test('an unknown hypothesis is refused by name', async () => {
  await assert.rejects(
    () => runServantProposeCalibration(SEEDS, undefined, 'not-a-hypothesis'),
    /unknown hypothesis not-a-hypothesis/,
  )
})

test('each population generates a distinct corpus, and composed is one', async () => {
  // The populations are the whole point of this harness, and until now nothing
  // asserted they actually differ. A generator that silently ignored its
  // population argument would leave every cross-population claim in the
  // register resting on one corpus wearing three labels. That is not
  // hypothetical: the runner accepted `population` for a release without
  // passing it through, so the random corpus was unreachable from the CLI.
  // One seed is enough: different opponents diverge within the first round,
  // so the played-out records separate immediately and the eval lane does not
  // pay for a composed corpus it only needs to tell apart.
  const seeds = 1
  const [heuristic, random, composed] = await Promise.all([
    generateServantProposeCases(seeds, 'heuristic'),
    generateServantProposeCases(seeds, 'random'),
    generateServantProposeCases(seeds, 'composed'),
  ])
  for (const [label, cases] of [
    ['heuristic', heuristic], ['random', random], ['composed', composed],
  ] as const) {
    assert.ok(cases.length > 0, `${label} produced no cases`)
  }
  // Same seeds, same casts, different opponents, so the played-out records
  // must differ. Compared on the decision coordinates rather than on counts,
  // because two corpora can coincidentally hold the same number of cases.
  // Compared on the decision coordinates the case actually carries, rather
  // than on counts, because two corpora can coincidentally hold the same
  // number of cases while describing different games.
  const shape = (cases: Awaited<ReturnType<typeof generateServantProposeCases>>) =>
    JSON.stringify(cases.map(
      (c) => [c.round, c.playerCount, c.req.seat, [...c.evilSeats]]))
  assert.notEqual(shape(heuristic), shape(random))
  assert.notEqual(shape(heuristic), shape(composed))
  assert.notEqual(shape(random), shape(composed))
})

test('the composed opponent is frozen, not read from the registry', () => {
  // The property that makes a composed corpus comparable across commits, and
  // the one most likely to be "simplified" back into a registry lookup by
  // someone who notices the duplication.
  //
  // Reading `composedBrainOptions('full-role')` instead would look identical
  // today and rot silently: any future seating decision would change the
  // opponent table, two composed numbers a commit apart would describe
  // different experiments under one label, and seating a VOTE factor would put
  // that factor into the opponents a vote factor is measured against. This
  // pins the identity so that re-pointing it fails here rather than in a
  // number nobody can reproduce.
  assert.equal(
    COMPOSED_OPPONENT_IDENTITY,
    'full-role+exact-constraints+quest-card-v1',
  )
  // And the pin must agree with what full-role actually seats TODAY, because a
  // frozen opponent that never matched production was never the right baseline
  // to freeze. If these diverge, that is a deliberate re-baselining decision:
  // update the pin and say so, do not delete the assertion.
  assert.equal(
    composedBrainOptions('full-role').beliefModel?.version,
    QUEST_WEIGHTED_BELIEF_VERSION,
    'full-role no longer seats the belief the composed opponent is pinned to; '
    + 're-baseline deliberately or explain why the pin should lag',
  )
})
