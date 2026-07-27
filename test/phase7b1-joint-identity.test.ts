import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  validatePrivateIdentityHostJoin,
  validatePrivateIdentitySnapshot,
  type IdentityProjectionScope,
} from '../server/agents/belief/identity.ts'
import {
  beliefFromWeightedWorlds,
  exactBelief,
} from '../server/agents/belief/exact.ts'
import type {
  BeliefSnapshot,
  HiddenWorld,
  WeightedWorld,
} from '../server/agents/belief/types.ts'
import { createComposedAgent } from '../server/agents/composed.ts'
import { publicCognition } from '../server/agents/cognition/state.ts'
import {
  advanceCognition,
  advanceCognitionFromBelief,
} from '../server/agents/cognition/state.ts'
import { parseStdioDecisionReply } from '../server/agents/stdio.ts'
import type { DecisionTrace } from '../server/agents/trace.ts'
import { normalizeAgentOutput } from '../server/agents/types.ts'
import { createGame } from '../server/engine/game.ts'
import { ROLE_ALIGNMENT } from '../server/engine/rules.ts'
import type {
  Alignment,
  PlayerView,
  Role,
  Seat,
} from '../server/engine/types.ts'
import { viewFor } from '../server/engine/view.ts'
import { ARCHITECTURE_BANK } from '../server/eval/architecture-bank.ts'
import {
  runArchitectureBench,
  type ArchitectureVariant,
} from '../server/eval/architecture-bench.ts'
import { architectureReport } from '../server/eval/architecture-report.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

const ROLES: readonly Role[] = [
  'merlin',
  'morgana',
  'percival',
  'assassin',
  'servant',
]

const world = (roles: readonly Role[]): HiddenWorld => ({
  roleBySeat: [...roles],
  alignmentBySeat: roles.map((role) => ROLE_ALIGNMENT[role]),
  key: roles.join('|'),
})

function syntheticSnapshot(
  entries: readonly { roles: readonly Role[]; probability: number }[],
  modelVersion = 'weighted-test-v1',
  quality: BeliefSnapshot['quality'] = 'weighted',
): BeliefSnapshot {
  const worlds = entries.map(({ roles, probability }) => ({
    world: world(roles),
    probability,
  }))
  return {
    throughSeq: 11,
    modelVersion,
    quality,
    worlds,
    playerMarginals: [],
    roleMarginals: [],
    entropy: 0,
    topWorlds: worlds,
    provenance: [],
    degradation: [],
  }
}

const CORRELATED = syntheticSnapshot([
  { roles: ROLES, probability: 0.2 },
  {
    roles: ['merlin', 'percival', 'morgana', 'assassin', 'servant'],
    probability: 0.3,
  },
  {
    roles: ['percival', 'merlin', 'morgana', 'assassin', 'servant'],
    probability: 0.5,
  },
])

const FULL_SCOPE: IdentityProjectionScope = {
  roleQueries: [
    { roles: ['morgana', 'merlin'] },
    { roles: ['servant'] },
    { roles: ['assassin'] },
  ],
  hiddenTeam: true,
}

const ALTERNATE_5P_CAST: readonly Role[] = [
  'assassin',
  'merlin',
  'minion',
  'servant',
  'servant',
]

function substituteBeliefMarginals(
  trace: DecisionTrace,
): void {
  const marginals = trace.beliefPlayerMarginals!
  const left = marginals.findIndex((marginal, index) =>
    marginals.some(
      (candidate, candidateIndex) =>
        candidateIndex > index
        && candidate.evilProbability !== marginal.evilProbability,
    ))
  const right = marginals.findIndex(
    (marginal, index) =>
      index > left
      && marginal.evilProbability !== marginals[left].evilProbability,
  )
  assert.ok(left >= 0 && right >= 0)
  const leftValues = {
    goodProbability: marginals[left].goodProbability,
    evilProbability: marginals[left].evilProbability,
  }
  const rightValues = {
    goodProbability: marginals[right].goodProbability,
    evilProbability: marginals[right].evilProbability,
  }
  Object.assign(marginals[left], rightValues)
  Object.assign(marginals[right], leftValues)
}

function close(actual: number, expected: number): void {
  assert.ok(
    Math.abs(actual - expected) <= 1e-12,
    `expected ${expected}, got ${actual}`,
  )
}

test('joint role and hidden-team hypotheses are hand-summed from complete worlds', () => {
  const identity = projectJointIdentity(CORRELATED, FULL_SCOPE)
  assert.ok(validatePrivateIdentitySnapshot(identity))
  assert.equal(identity.version, JOINT_IDENTITY_MODEL_VERSION)
  assert.deepEqual(identity.sourceBelief, {
    modelVersion: 'weighted-test-v1',
    throughSeq: 11,
    quality: 'weighted',
    playerCount: 5,
    rolesInPlay: ['assassin', 'merlin', 'morgana', 'percival', 'servant'],
  })

  const pair = identity.rolePosteriors.find(
    (posterior) => posterior.queryKey === 'merlin:1|morgana:1',
  )!
  assert.deepEqual(
    pair.hypotheses.map((hypothesis) => hypothesis.probability),
    [0.2, 0.3, 0.5],
  )
  const joint = pair.hypotheses.find(
    (hypothesis) =>
      hypothesis.assignments[0].seats[0] === 0
      && hypothesis.assignments[1].seats[0] === 1,
  )!.probability
  const merlinAtZero = pair.hypotheses
    .filter((hypothesis) => hypothesis.assignments[0].seats[0] === 0)
    .reduce((sum, hypothesis) => sum + hypothesis.probability, 0)
  const morganaAtOne = pair.hypotheses
    .filter((hypothesis) => hypothesis.assignments[1].seats[0] === 1)
    .reduce((sum, hypothesis) => sum + hypothesis.probability, 0)
  close(joint, 0.2)
  close(merlinAtZero, 0.5)
  close(morganaAtOne, 0.2)
  assert.notEqual(joint, merlinAtZero * morganaAtOne)

  const hidden = identity.hiddenTeamPosterior!.hypotheses
  close(hidden.reduce((sum, hypothesis) => sum + hypothesis.probability, 0), 1)
  assert.deepEqual(hidden.map((hypothesis) => hypothesis.probability), [0.2, 0.8])
})

test('duplicate-role seat sets and canonical ordering ignore input permutations', () => {
  const forward = projectJointIdentity(CORRELATED, FULL_SCOPE)
  const reversed = projectJointIdentity(
    {
      ...CORRELATED,
      worlds: [...CORRELATED.worlds].reverse(),
    },
    {
      roleQueries: [
        { roles: ['assassin'] },
        { roles: ['servant'] },
        { roles: ['merlin', 'morgana'] },
      ],
      hiddenTeam: true,
    },
  )
  assert.deepEqual(reversed, forward)
  assert.deepEqual(
    forward.scope.roleQueries.map((query) => query.queryKey),
    ['assassin:1', 'merlin:1|morgana:1', 'servant:1'],
  )
  const servants = forward.rolePosteriors.find(
    (posterior) => posterior.queryKey === 'servant:1',
  )!
  assert.ok(servants.hypotheses.every(
    (hypothesis) =>
      hypothesis.assignments.length === 1
      && hypothesis.assignments[0].seats.length === 1,
  ))

  const duplicateBoth = syntheticSnapshot([
    {
      roles: ['servant', 'servant', 'servant', 'minion', 'minion'],
      probability: 0.5,
    },
    {
      roles: ['minion', 'servant', 'servant', 'servant', 'minion'],
      probability: 0.5,
    },
  ], 'exact-constraints-v1', 'constraints-only')
  const duplicateIdentity = projectJointIdentity(duplicateBoth, {
    roleQueries: [
      { roles: ['servant', 'servant', 'servant'] },
      { roles: ['minion', 'minion'] },
    ],
    hiddenTeam: false,
  })
  const minions = duplicateIdentity.rolePosteriors.find(
    (posterior) => posterior.queryKey === 'minion:2',
  )!
  assert.deepEqual(
    minions.hypotheses.map((hypothesis) => ({
      seats: hypothesis.assignments[0].seats,
      probability: hypothesis.probability,
    })),
    [
      { seats: [0, 4], probability: 0.5 },
      { seats: [3, 4], probability: 0.5 },
    ],
  )
})

test('identity projection rejects invalid support, scope, and output lattices', () => {
  assert.throws(
    () => projectJointIdentity(
      { ...CORRELATED, worlds: [
        { ...CORRELATED.worlds[0], probability: 0 },
        ...CORRELATED.worlds.slice(1),
      ] },
      FULL_SCOPE,
    ),
    /invalid weighted world/,
  )
  assert.throws(
    () => projectJointIdentity(
      { ...CORRELATED, worlds: CORRELATED.worlds.map(
        (weighted) => ({ ...weighted, probability: weighted.probability / 2 }),
      ) },
      FULL_SCOPE,
    ),
    /normalized positive support/,
  )
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: [{ roles: ['merlin'] }, { roles: ['merlin'] }],
      hiddenTeam: false,
    }),
    /duplicate role queries/,
  )
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: [{ roles: ['servant', 'servant'] }],
      hiddenTeam: false,
    }),
    /requests 2 servant copies but cast contains 1/,
  )
  const wrongAlignment = structuredClone(CORRELATED)
  wrongAlignment.worlds[0].world.alignmentBySeat[0] = 'evil'
  assert.throws(
    () => projectJointIdentity(wrongAlignment, FULL_SCOPE),
    /invalid weighted world/,
  )

  const valid = projectJointIdentity(CORRELATED, FULL_SCOPE)
  const forged = structuredClone(valid)
  forged.rolePosteriors[0].hypotheses[0].probability = 0.9
  assert.equal(validatePrivateIdentitySnapshot(forged), false)
  const unsorted = structuredClone(valid)
  unsorted.hiddenTeamPosterior!.hypotheses.reverse()
  assert.equal(validatePrivateIdentitySnapshot(unsorted), false)
  const wrongSource = structuredClone(valid)
  wrongSource.sourceBelief.playerCount = 4
  assert.equal(validatePrivateIdentitySnapshot(wrongSource), false)
  const duplicateMerlinOneEvil = structuredClone(valid)
  duplicateMerlinOneEvil.sourceBelief.rolesInPlay = [
    'assassin',
    'merlin',
    'merlin',
    'servant',
    'servant',
  ]
  for (
    const hypothesis
    of duplicateMerlinOneEvil.hiddenTeamPosterior!.hypotheses
  ) {
    hypothesis.evilSeats = [hypothesis.evilSeats[0]]
  }
  assert.equal(validatePrivateIdentitySnapshot(duplicateMerlinOneEvil), false)
  const assassinOutsideEvil = structuredClone(valid)
  assassinOutsideEvil.hiddenTeamPosterior!.hypotheses = [
    { evilSeats: [0, 1], probability: 0.2 },
    { evilSeats: [0, 2], probability: 0.8 },
  ]
  assert.equal(validatePrivateIdentitySnapshot(assassinOutsideEvil), false)
  const nonCanonicalCast = structuredClone(valid)
  nonCanonicalCast.sourceBelief.rolesInPlay = [
    'merlin',
    'assassin',
    'morgana',
    'percival',
    'servant',
  ]
  assert.equal(validatePrivateIdentitySnapshot(nonCanonicalCast), false)
  const sparseExternal = structuredClone(valid)
  delete sparseExternal.scope.roleQueries[0]
  assert.equal(validatePrivateIdentitySnapshot(sparseExternal), false)
  const sparsePosteriors = structuredClone(valid)
  delete sparsePosteriors.rolePosteriors[0]
  assert.equal(validatePrivateIdentitySnapshot(sparsePosteriors), false)
  const excessiveExternal = structuredClone(valid)
  excessiveExternal.scope.roleQueries[0] = {
    queryKey: 'assassin:1|merlin:1|morgana:1|percival:1|servant:2',
    queriedRoles: [
      'assassin',
      'merlin',
      'morgana',
      'percival',
      'servant',
      'servant',
    ],
  }
  assert.equal(validatePrivateIdentitySnapshot(excessiveExternal), false)
  const empty = structuredClone(valid)
  empty.scope.roleQueries = []
  empty.rolePosteriors = []
  empty.scope.hiddenTeam = false
  delete empty.hiddenTeamPosterior
  assert.equal(validatePrivateIdentitySnapshot(empty), false)

  assert.throws(
    () => projectJointIdentity(
      syntheticSnapshot([{
        roles: ['merlin', 'merlin', 'servant', 'servant', 'assassin'],
        probability: 1,
      }], 'invalid-cast-v1', 'constraints-only'),
      { roleQueries: [], hiddenTeam: true },
    ),
    /role set has 1 evil|duplicate unique role/,
  )
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: [{
        roles: [
          'merlin',
          'morgana',
          'percival',
          'assassin',
          'servant',
          'servant',
        ],
      }],
      hiddenTeam: false,
    }),
    /exceeds player count/,
  )
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: [{
        roles: Array<Role>(11).fill('servant'),
      }],
      hiddenTeam: false,
    }),
    /exceeds the supported player limit/,
  )
  const sparseRoles = Array<Role>(2)
  sparseRoles[0] = 'merlin'
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: [{ roles: sparseRoles }],
      hiddenTeam: false,
    }),
    /requires at least one role/,
  )
  const sparseQueries = Array<IdentityProjectionScope['roleQueries'][number]>(1)
  assert.throws(
    () => projectJointIdentity(CORRELATED, {
      roleQueries: sparseQueries,
      hiddenTeam: true,
    }),
    /invalid bounded query scope/,
  )

  const partial = projectJointIdentity(CORRELATED, {
    roleQueries: [{ roles: ['merlin'] }],
    hiddenTeam: false,
  })
  assert.ok(validatePrivateIdentitySnapshot(partial))
})

test('exact, quest-weighted, and language-weighted provenance is retained verbatim', () => {
  for (const [modelVersion, quality] of [
    ['exact-constraints-v1', 'constraints-only'],
    ['exact-constraints-v1+quest-card-factor-v1', 'weighted'],
    ['exact-constraints-v1+bounded-language-v1', 'weighted'],
  ] as const) {
    const probabilities = quality === 'constraints-only'
      ? CORRELATED.worlds.map(() => 1 / CORRELATED.worlds.length)
      : CORRELATED.worlds.map((weighted) => weighted.probability)
    const snapshot = syntheticSnapshot(
      CORRELATED.worlds.map((weighted, index) => ({
        roles: weighted.world.roleBySeat,
        probability: probabilities[index],
      })),
      modelVersion,
      quality,
    )
    const identity = projectJointIdentity(snapshot, FULL_SCOPE)
    assert.equal(identity.sourceBelief.modelVersion, modelVersion)
    assert.equal(identity.sourceBelief.quality, quality)
    assert.equal(identity.sourceBelief.throughSeq, snapshot.throughSeq)
  }
})

function scopeForView(view: PlayerView): IdentityProjectionScope {
  const roles = [...new Set(view.rolesInPlay)]
  return {
    roleQueries: roles.slice(0, 3).map((role) => ({
      roles: view.rolesInPlay.filter((candidate) => candidate === role),
    })),
    hiddenTeam: true,
  }
}

test('projection is deterministic, seat-rotation equivariant, and bounded for 5-10 players', () => {
  for (let playerCount = 5; playerCount <= 10; playerCount++) {
    const game = createGame({
      seed: `phase7b1-cast-${playerCount}`,
      playerCount,
    })
    const view = viewFor(game, 0)
    const belief = exactBelief(view)
    const started = performance.now()
    const one = projectJointIdentity(belief, scopeForView(view))
    const elapsed = performance.now() - started
    const two = projectJointIdentity(belief, scopeForView(view))
    assert.deepEqual(two, one)
    assert.ok(validatePrivateIdentitySnapshot(one))
    assert.ok(JSON.stringify(one).length < 250_000)
    assert.ok(
      elapsed < 5_000,
      `${playerCount}p identity took ${elapsed.toFixed(1)}ms`,
    )
  }

  const rotatedWorlds: WeightedWorld[] = CORRELATED.worlds.map((weighted) => {
    const rotate = <T>(values: readonly T[]): T[] =>
      values.map((_, seat) => values[(seat + values.length - 1) % values.length])
    const roles = rotate(weighted.world.roleBySeat)
    const alignments = rotate(weighted.world.alignmentBySeat)
    return {
      probability: weighted.probability,
      world: {
        roleBySeat: roles,
        alignmentBySeat: alignments,
        key: roles.join('|'),
      },
    }
  })
  const rotated = projectJointIdentity(
    { ...CORRELATED, worlds: rotatedWorlds },
    FULL_SCOPE,
  )
  const unrotated = projectJointIdentity(CORRELATED, FULL_SCOPE)
  const rotateSeat = (seat: Seat): Seat => (seat + 1) % 5
  const expected = structuredClone(unrotated)
  for (const posterior of expected.rolePosteriors) {
    for (const hypothesis of posterior.hypotheses) {
      for (const assignment of hypothesis.assignments) {
        assignment.seats = assignment.seats.map(rotateSeat).sort((a, b) => a - b)
      }
    }
    posterior.hypotheses.sort((a, b) =>
      JSON.stringify(a.assignments).localeCompare(JSON.stringify(b.assignments)))
  }
  for (const hypothesis of expected.hiddenTeamPosterior!.hypotheses) {
    hypothesis.evilSeats = hypothesis.evilSeats.map(rotateSeat).sort((a, b) => a - b)
  }
  expected.hiddenTeamPosterior!.hypotheses.sort((a, b) =>
    a.evilSeats.join('.').localeCompare(b.evilSeats.join('.')))
  assert.deepEqual(rotated, expected)
})

test('composed identity is orthogonal, private, attributable, and mechanically inert', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.req.kind === 'vote',
  )!
  const scope = scopeForView(fixture.view)
  const stages: string[] = []
  const run = (publicObserver: boolean, privateIdentity: boolean) =>
    createComposedAgent({
      seed: 'phase7b1-composed',
      ...(publicObserver ? { publicObserver: true } : {}),
      ...(privateIdentity ? { privateIdentity: scope } : {}),
    }).decide(fixture.req, fixture.view)
  const off = await run(false, false)
  const observer = await run(true, false)
  const identity = await run(false, true)
  const both = await run(true, true)
  await createComposedAgent({
    seed: 'phase7b1-stage-order',
    publicObserver: true,
    privateIdentity: scope,
    onStage: (stage) => stages.push(stage),
  }).decide(fixture.req, fixture.view)
  assert.deepEqual(observer.decision, off.decision)
  assert.deepEqual(identity.decision, off.decision)
  assert.deepEqual(both.decision, off.decision)
  assert.equal(off.trace!.componentVersions!.identityModel, undefined)
  assert.equal(off.trace!.privateIdentity, undefined)
  assert.equal(observer.trace!.componentVersions!.identityModel, undefined)
  assert.equal(observer.trace!.privateIdentity, undefined)
  assert.equal(identity.trace!.publicObserver, undefined)
  assert.equal(
    identity.trace!.componentVersions!.identityModel,
    JOINT_IDENTITY_MODEL_VERSION,
  )
  assert.ok(validatePrivateIdentitySnapshot(identity.trace!.privateIdentity))
  assert.ok(validatePrivateIdentitySnapshot(both.trace!.privateIdentity))
  assert.ok(both.trace!.publicObserver)
  assert.ok(
    stages.indexOf('cognition') < stages.indexOf('identity')
    && stages.indexOf('identity') < stages.indexOf('observer')
    && stages.indexOf('observer') < stages.indexOf('analysis'),
  )

  const accepted = parseStdioDecisionReply(
    fixture.req,
    identity,
    'external agent',
    fixture.view,
  )
  assert.deepEqual(accepted, identity)
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, identity),
    /invalid decision trace/,
  )
  const forgedOff = structuredClone(off)
  forgedOff.trace!.privateIdentity = structuredClone(identity.trace!.privateIdentity)
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, forgedOff),
    /invalid decision trace/,
  )
  const forgedOn = structuredClone(identity)
  delete forgedOn.trace!.privateIdentity
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, forgedOn),
    /invalid decision trace/,
  )
  const wrongBelief = structuredClone(identity)
  wrongBelief.trace!.privateIdentity!.sourceBelief.modelVersion = 'forged'
  assert.throws(
    () => parseStdioDecisionReply(fixture.req, wrongBelief),
    /invalid decision trace/,
  )

  const hostBound = await createComposedAgent({
    seed: 'phase7b1-host-join',
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }],
      hiddenTeam: true,
    },
  }).decide(fixture.req, fixture.view)
  assert.ok(validatePrivateIdentityHostJoin(
    hostBound.trace!.privateIdentity,
    fixture.view.rolesInPlay,
    hostBound.trace!.beliefPlayerMarginals,
  ))
  const substitutedCast = structuredClone(hostBound)
  substitutedCast.trace!.privateIdentity!.sourceBelief.rolesInPlay =
    [...ALTERNATE_5P_CAST]
  assert.ok(validatePrivateIdentitySnapshot(
    substitutedCast.trace!.privateIdentity,
  ))
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      substitutedCast,
      'external agent',
      fixture.view,
    ),
    /invalid decision trace/,
  )
  const substitutedMarginals = structuredClone(hostBound)
  substituteBeliefMarginals(substitutedMarginals.trace!)
  assert.throws(
    () => parseStdioDecisionReply(
      fixture.req,
      substitutedMarginals,
      'external agent',
      fixture.view,
    ),
    /invalid decision trace/,
  )

  const degraded = await createComposedAgent({
    seed: 'phase7b1-composed',
    privateIdentity: {
      roleQueries: [{ roles: ['merlin'] }, { roles: ['merlin'] }],
      hiddenTeam: true,
    },
  }).decide(fixture.req, fixture.view)
  assert.deepEqual(degraded.decision, off.decision)
  assert.ok(degraded.trace!.degradation.includes('identity-projection-failed'))
  assert.equal(degraded.trace!.privateIdentity, undefined)
  assert.deepEqual(
    parseStdioDecisionReply(fixture.req, degraded),
    degraded,
  )
})

test('private identity does not enter public cognition, PlayerView, logs, prompts, or observer', () => {
  const game = createGame({ seed: 'phase7b1-private-boundary', playerCount: 7 })
  const view = viewFor(game, 0)
  const cognition = advanceCognition(undefined, view)
  const identity = projectJointIdentity(cognition.belief, scopeForView(view))
  const withIdentity = {
    ...cognition,
    identity,
    versions: {
      ...cognition.versions,
      identityModel: JOINT_IDENTITY_MODEL_VERSION,
    },
  }
  const projected = publicCognition(withIdentity)
  assert.doesNotMatch(JSON.stringify(projected), /identity|posterior/i)
  assert.doesNotMatch(JSON.stringify(view), /privateIdentity|identityModel/)
  assert.doesNotMatch(JSON.stringify(game.log), /privateIdentity|identityModel/)
  const recomputed = advanceCognitionFromBelief(withIdentity, view, {
    belief: cognition.belief,
    mechanicalBelief: cognition.versions.mechanicalBelief,
    beliefPipeline: cognition.versions.beliefPipeline,
    languageEvidence: cognition.versions.languageEvidence,
  })
  assert.equal(recomputed.identity, undefined)
  assert.equal(recomputed.versions.identityModel, undefined)

  const observer = readFileSync('server/agents/analysis/observer.ts', 'utf8')
  assert.doesNotMatch(observer, /belief\/identity|PrivateIdentity|identityModel/)
  for (const publicOwner of [
    'server/agents/communication/public-record.ts',
    'server/agents/prompts.ts',
    'server/agents/communication/composed-renderer.ts',
    'server/agents/communication/planner-voice-adapter.ts',
  ]) {
    assert.doesNotMatch(
      readFileSync(publicOwner, 'utf8'),
      /belief\/identity|PrivateIdentity|identityModel/,
    )
  }
  const identitySource = readFileSync(
    'server/agents/belief/identity.ts',
    'utf8',
  )
  assert.doesNotMatch(identitySource, /\bPlayerView\b|\bPublicRecord\b|\bGame\b/)
  assert.doesNotMatch(
    identitySource,
    /from ['"][^'"]*(?:prompts?|provider|server\/eval|truth)[^'"]*['"]/,
  )
})

type IdentityForgery = 'none' | 'missing' | 'cast' | 'marginals'

function identityVariant(
  forgery: IdentityForgery = 'none',
): ArchitectureVariant {
  return {
    id: forgery === 'none' ? 'identity' : `identity-forged-${forgery}`,
    paid: false,
    components: {
      mode: 'compatibility',
      brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1',
      factors: 'off',
      languageEvidence: 'off',
      observerModel: 'off',
      identityModel: JOINT_IDENTITY_MODEL_VERSION,
      policy: 'composed-policy-v1',
      scorer: 'compatibility-scorer-v1',
      planner: 'planner-off',
      voice: 'voice-off',
    },
    createTargetAgent: (context) => {
      const inner = createComposedAgent({
        seed: context.seed,
        privateIdentity: {
          roleQueries: [{ roles: ['merlin'] }],
          hiddenTeam: true,
        },
      })
      return {
        recordDecisionTrace(trace) {
          context.onDecisionTrace?.(trace)
        },
        async decide(req, view) {
          const output = normalizeAgentOutput(await inner.decide(req, view))
          if (forgery === 'missing') delete output.trace!.privateIdentity
          if (forgery === 'cast') {
            output.trace!.privateIdentity!.sourceBelief.rolesInPlay =
              [...ALTERNATE_5P_CAST]
          }
          if (forgery === 'marginals') {
            substituteBeliefMarginals(output.trace!)
          }
          return output
        },
      }
    },
  }
}

function degradedIdentityVariant(): ArchitectureVariant {
  return {
    ...identityVariant(),
    id: 'identity-degraded',
    createTargetAgent: (context) => createComposedAgent({
      seed: context.seed,
      privateIdentity: {
        roleQueries: [{ roles: ['merlin'] }, { roles: ['merlin'] }],
        hiddenTeam: true,
      },
      onDecisionTrace: context.onDecisionTrace,
    }),
  }
}

test('architecture bench, report, and artifacts bind identity metadata to payload', async () => {
  const [artifact] = await runArchitectureBench({
    variants: [identityVariant()],
    cases: ARCHITECTURE_BANK.slice(0, 1),
    bankId: 'phase7b1-identity-attribution',
  })
  assert.deepEqual(
    artifact.strategyVersions?.identities,
    [JOINT_IDENTITY_MODEL_VERSION],
  )
  assert.equal(
    architectureReport([artifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
  assert.equal(
    architectureReport([artifact]).variants[0]
      .safety.hiddenInformationViolations,
    0,
  )

  const forgedMetadata = structuredClone(artifact)
  delete forgedMetadata.architecture!.components.identityModel
  assert.ok(
    architectureReport([forgedMetadata]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedManifest = structuredClone(artifact)
  delete forgedManifest.strategyVersions!.identities
  assert.ok(
    architectureReport([forgedManifest]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const forgedTrace = structuredClone(artifact)
  delete forgedTrace.decisionTraces![0].componentVersions!.identityModel
  delete forgedTrace.decisionTraces![0].privateIdentity
  assert.ok(
    architectureReport([forgedTrace]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const substitutedArtifactCast = structuredClone(artifact)
  substitutedArtifactCast.decisionTraces![0]
    .privateIdentity!.sourceBelief.rolesInPlay = [...ALTERNATE_5P_CAST]
  assert.ok(validatePrivateIdentitySnapshot(
    substitutedArtifactCast.decisionTraces![0].privateIdentity,
  ))
  assert.ok(
    architectureReport([substitutedArtifactCast]).variants[0]
      .safety.traceAttributionViolations > 0,
  )
  const substitutedArtifactMarginals = structuredClone(artifact)
  substituteBeliefMarginals(substitutedArtifactMarginals.decisionTraces![0])
  assert.ok(
    architectureReport([substitutedArtifactMarginals]).variants[0]
      .safety.traceAttributionViolations > 0,
  )

  const historicalOff = structuredClone(artifact)
  delete historicalOff.architecture!.components.identityModel
  delete historicalOff.strategyVersions!.identities
  for (const trace of historicalOff.decisionTraces ?? []) {
    delete trace.componentVersions!.identityModel
    delete trace.privateIdentity
  }
  assert.equal(
    architectureReport([historicalOff]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )

  await assert.rejects(
    () => runArchitectureBench({
      variants: [identityVariant('missing')],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7b1-identity-forged',
    }),
    /trace components do not match declared components/,
  )
  await assert.rejects(
    () => runArchitectureBench({
      variants: [identityVariant('cast')],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7b1-identity-cast-substitution',
    }),
    /trace components do not match declared components/,
  )
  await assert.rejects(
    () => runArchitectureBench({
      variants: [identityVariant('marginals')],
      cases: ARCHITECTURE_BANK.slice(0, 1),
      bankId: 'phase7b1-identity-marginal-substitution',
    }),
    /trace components do not match declared components/,
  )

  const [degradedArtifact] = await runArchitectureBench({
    variants: [degradedIdentityVariant()],
    cases: ARCHITECTURE_BANK.slice(0, 1),
    bankId: 'phase7b1-identity-degraded',
  })
  assert.ok(degradedArtifact.decisionTraces!.every(
    (trace) =>
      trace.componentVersions?.identityModel === JOINT_IDENTITY_MODEL_VERSION
      && trace.privateIdentity === undefined
      && trace.degradation.includes('identity-projection-failed'),
  ))
  assert.deepEqual(
    degradedArtifact.strategyVersions?.identities,
    [JOINT_IDENTITY_MODEL_VERSION],
  )
  assert.equal(
    architectureReport([degradedArtifact]).variants[0]
      .safety.traceAttributionViolations,
    0,
  )
})
