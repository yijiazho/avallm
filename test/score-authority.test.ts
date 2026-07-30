// Migration phase 7R3A4B; see docs/agent-architecture-migration.md.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createComposedAgent } from '../server/agents/composed.ts'
import {
  CANDIDATE_SCORER_VERSION,
  seededEvilRoleObjectiveScorer,
  seededGoodProposalVoteScorer,
  seededMorganaRoleScorer,
  seededRoleObjectiveScorer,
  type CandidateScorer,
} from '../server/agents/policy/score.ts'
import {
  COMPATIBILITY_SCORE_LAYER,
  SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
  SEEDED_GOOD_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/good.ts'
import {
  SEEDED_EVIL_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/evil.ts'
import {
  SEEDED_MORGANA_ROLE_SCORE_LAYER,
} from '../server/agents/score-layers/morgana.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'
import {
  legalCandidates,
} from '../server/agents/policy/candidates.ts'
import {
  buildScorerSituationSurface,
} from '../server/agents/analysis/scorer-situation-surface.ts'
import { exactBelief } from '../server/agents/belief/exact.ts'
import {
  configuredScoreLayerChainForVersion,
} from '../server/agents/score-layers/configured.ts'
import {
  replayNativeScoresForAdmission,
} from '../server/agents/policy/score-layer/admission-replay.ts'
import {
  createProductionComponentRegistry,
} from '../server/agents/components/production-registry.ts'
import { componentPayload } from '../server/agents/components/kernel.ts'
import {
  EVIL_ROLE_OBJECTIVE_COMPONENT,
  EVIL_ROLE_UTILITY_COMPONENT,
  GOOD_ROLE_OBJECTIVE_COMPONENT,
  GOOD_ROLE_UTILITY_COMPONENT,
  MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import { createGame } from '../server/engine/game.ts'
import { viewFor } from '../server/engine/view.ts'
import type {
  DecisionRequest,
  PlayerView,
} from '../server/engine/types.ts'
import {
  parseStdioDecisionReply,
} from '../server/agents/stdio.ts'
import {
  admitDecisionTrace,
} from '../server/agents/admission/composed-trace.ts'
import type { DecisionTrace } from '../server/agents/trace.ts'
import {
  projectResolvedArchitectureIdentity,
} from '../server/agents/components/resolved-brain.ts'

const roleUtilityFrom = (trace: DecisionTrace) =>
  componentPayload(trace.components!, GOOD_ROLE_UTILITY_COMPONENT)

test('default compatibility scoring is native for every frozen decision kind', async () => {
  const fixtures = readDecisionFixtures()
  assert.deepEqual(
    createComposedAgent({ seed: 'native-default-proof' })
      .resolvedBrain().description.scoreLayerOrder,
    [{
      id: COMPATIBILITY_SCORE_LAYER.id,
      version: COMPATIBILITY_SCORE_LAYER.version,
    }],
  )
  const kinds = new Set<string>()
  for (const fixture of fixtures) {
    kinds.add(fixture.req.kind)
    const output = await createComposedAgent({
      seed: fixture.source.seed,
    }).decide(fixture.req, fixture.view)
    assert.equal(
      output.trace!.componentVersions!.scorer,
      CANDIDATE_SCORER_VERSION,
      fixture.id,
    )
    assert.ok(output.trace!.candidateScores?.length, fixture.id)
    assert.ok(output.trace!.structuredCandidateId, fixture.id)
    assert.ok(output.trace!.chosenCandidateId, fixture.id)
  }
  assert.deepEqual(
    [...kinds].sort(),
    ['assassinate', 'discuss', 'finalize', 'propose', 'quest', 'vote'],
  )
})

test('custom scorer remains an alternate producer for the sole scored frame', async () => {
  let calls = 0
  const custom: CandidateScorer = {
    version: 'a4b-custom-scorer-v1',
    score(context) {
      calls++
      const allowed = new Set(context.forced.allowedCandidateIds)
      return context.candidates.map((candidate, index) => ({
        version: 'a4b-custom-scorer-v1',
        candidateId: candidate.id,
        value: allowed.has(candidate.id)
          ? -index
          : -Number.MAX_SAFE_INTEGER,
        viable: allowed.has(candidate.id),
        reasonCodes: [
          allowed.has(candidate.id)
            ? 'FORCED_POLICY_ALLOWED'
            : 'FORCED_POLICY_REMOVED',
        ],
      }))
    },
  }
  const fixture = readDecisionFixtures().find(
    (candidate) => candidate.req.kind === 'propose',
  )!
  const agent = createComposedAgent({
    seed: fixture.source.seed,
    scorer: custom,
  })
  assert.deepEqual(
    agent.resolvedBrain().description.scoreLayerOrder,
    [{
      id: COMPATIBILITY_SCORE_LAYER.id,
      version: COMPATIBILITY_SCORE_LAYER.version,
    }],
  )
  const output = await agent.decide(
    fixture.req,
    fixture.view,
  )
  assert.equal(calls, 1)
  assert.equal(
    output.trace!.componentVersions!.scorer,
    custom.version,
  )
  assert.ok(output.trace!.chosenCandidateId)
})

test('native family replays retain concrete journal and transitive component attribution', async () => {
  const fixtures = readDecisionFixtures()
  const merlin = fixtures.find((entry) =>
    entry.id === 'merlin-opening-proposal')!
  const servant = fixtures.find((entry) =>
    entry.id === 'servant-vote-after-evidence')!
  const mordred = fixtures.find((entry) =>
    entry.id === 'mordred-late-vote')!
  const morganaGame = createGame({
    id: 'a4b-morgana-journal',
    seed: 'a4b-morgana-journal',
    playerCount: 5,
  })
  const morganaSeat = morganaGame.players.find(
    (player) => player.role === 'morgana',
  )!.seat
  const morganaView: PlayerView = {
    ...viewFor(morganaGame, morganaSeat),
    phase: 'vote',
    currentTeam: morganaGame.players
      .slice(0, morganaGame.quests[0].teamSize)
      .map((player) => player.seat),
  }
  const morganaReq: DecisionRequest = {
    kind: 'vote',
    seat: morganaSeat,
    round: morganaView.round,
    proposalNum: morganaView.proposalNum,
  }
  const cases = [
    {
      id: 'good',
      seed: servant.source.seed,
      req: servant.req,
      view: servant.view,
      scorer: seededGoodProposalVoteScorer,
      expectedLayers: [
        COMPATIBILITY_SCORE_LAYER,
        SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
      ],
      expectedStatuses: ['generated', 'applied'],
      expectedReads: [],
      expectedAttribution: [],
    },
    {
      id: 'c2',
      seed: merlin.source.seed,
      req: merlin.req,
      view: merlin.view,
      scorer: seededRoleObjectiveScorer,
      expectedLayers: [
        COMPATIBILITY_SCORE_LAYER,
        SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
        SEEDED_GOOD_ROLE_SCORE_LAYER,
      ],
      expectedStatuses: ['generated', 'applied', 'applied'],
      expectedReads: [GOOD_ROLE_UTILITY_COMPONENT],
      expectedAttribution: [
        GOOD_ROLE_OBJECTIVE_COMPONENT,
        GOOD_ROLE_UTILITY_COMPONENT,
      ],
    },
    {
      id: 'd2',
      seed: mordred.source.seed,
      req: mordred.req,
      view: mordred.view,
      scorer: seededEvilRoleObjectiveScorer,
      expectedLayers: [
        COMPATIBILITY_SCORE_LAYER,
        SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
        SEEDED_GOOD_ROLE_SCORE_LAYER,
        SEEDED_EVIL_ROLE_SCORE_LAYER,
      ],
      expectedStatuses: [
        'generated', 'applied', 'inapplicable', 'applied',
      ],
      expectedReads: [EVIL_ROLE_UTILITY_COMPONENT],
      expectedAttribution: [
        EVIL_ROLE_OBJECTIVE_COMPONENT,
        EVIL_ROLE_UTILITY_COMPONENT,
      ],
    },
    {
      id: 'morgana',
      seed: morganaGame.seed,
      req: morganaReq,
      view: morganaView,
      scorer: seededMorganaRoleScorer,
      expectedLayers: [
        COMPATIBILITY_SCORE_LAYER,
        SEEDED_GOOD_PROPOSAL_VOTE_SCORE_LAYER,
        SEEDED_GOOD_ROLE_SCORE_LAYER,
        SEEDED_EVIL_ROLE_SCORE_LAYER,
        SEEDED_MORGANA_ROLE_SCORE_LAYER,
      ],
      expectedStatuses: [
        'generated', 'applied', 'inapplicable', 'applied', 'applied',
      ],
      expectedReads: [MORGANA_ROLE_UTILITY_SEEDED_COMPONENT],
      expectedAttribution: [
        EVIL_ROLE_OBJECTIVE_COMPONENT,
        EVIL_ROLE_UTILITY_COMPONENT,
        MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
        MORGANA_COUNTERFEIT_OBJECTIVE_COMPONENT,
        MORGANA_ROLE_UTILITY_SEEDED_COMPONENT,
      ],
    },
  ] as const
  for (const entry of cases) {
    const output = await createComposedAgent({
      seed: entry.seed,
      roleObjectiveRouter: entry.id === 'd2' || entry.id === 'morgana',
      scorer: entry.scorer,
    }).decide(entry.req, entry.view)
    const candidates = legalCandidates(entry.req, entry.view)
    const {
      analysis,
      hypotheticalTeamCandidates,
    } = buildScorerSituationSurface({
      view: entry.view,
      belief: exactBelief(entry.view),
      legalCandidates: candidates,
      plan: entry.req.kind === 'vote' ? 'good-vote' : 'good-proposal',
    })
    const scorerVersion = output.trace!.componentVersions!.scorer
    const replay = replayNativeScoresForAdmission({
      chain: configuredScoreLayerChainForVersion(scorerVersion),
      request: entry.req,
      view: entry.view,
      analysis,
      candidates,
      ...(hypotheticalTeamCandidates !== null
        ? { hypotheticalTeamCandidates }
        : {}),
      forced: output.trace!.forcedPolicyResult!,
      candidateBoundary: output.trace!.decisionLayerRun!.surface,
      deterministicSeed: entry.seed,
      compatibilityCandidateId: candidates[0].id,
      expectedScorerVersion: scorerVersion,
      componentDefinitions: createProductionComponentRegistry({
        goodObjectiveAllDecisionKinds: true,
      }).definitions(),
      componentRun: output.trace!.components!,
    })
    assert.deepEqual(
      replay.journal.map((journal) => journal.layer),
      entry.expectedLayers,
      entry.id,
    )
    assert.deepEqual(
      replay.journal.map((journal) => journal.status),
      entry.expectedStatuses,
      entry.id,
    )
    const terminal = replay.journal.at(-1)!
    const expectedReads = entry.expectedReads.map(({ id, version }) => ({
      id,
      version,
    }))
    const expectedAttribution = entry.expectedAttribution.map(
      ({ id, version }) => ({ id, version }),
    )
    assert.deepEqual(terminal.componentReads, expectedReads, entry.id)
    assert.deepEqual(
      'attributedComponents' in terminal
        ? terminal.attributedComponents
        : [],
      expectedAttribution,
      entry.id,
    )
    assert.deepEqual(
      replay.survivorCandidateIds,
      output.trace!.forcedPolicyResult!.allowedCandidateIds,
      entry.id,
    )
    assert.equal(entry.req.seat, entry.view.seat, entry.id)
    const secondReplay = replayNativeScoresForAdmission({
      chain: configuredScoreLayerChainForVersion(scorerVersion),
      request: entry.req,
      view: entry.view,
      analysis,
      candidates,
      ...(hypotheticalTeamCandidates !== null
        ? { hypotheticalTeamCandidates }
        : {}),
      forced: output.trace!.forcedPolicyResult!,
      candidateBoundary: output.trace!.decisionLayerRun!.surface,
      deterministicSeed: entry.seed,
      compatibilityCandidateId: candidates[0].id,
      expectedScorerVersion: scorerVersion,
      componentDefinitions: createProductionComponentRegistry({
        goodObjectiveAllDecisionKinds: true,
      }).definitions(),
      componentRun: output.trace!.components!,
    })
    assert.deepEqual(secondReplay, replay, `${entry.id} deterministic replay`)
  }
})

test('trusted current-v2 replay rejects score, choice, attribution, and flat-state forgeries', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'merlin-opening-proposal',
  )!
  const agent = createComposedAgent({
    seed: fixture.source.seed,
    scorer: seededRoleObjectiveScorer,
  })
  const output = await agent.decide(fixture.req, fixture.view)
  const expectedIdentity = projectResolvedArchitectureIdentity(
    agent.resolvedBrain().description,
  )
  const expectedPlan = structuredClone(output.trace!.componentPlan!)
  const alternate = legalCandidates(fixture.req, fixture.view).find(
    (candidate) =>
      candidate.id !== output.trace!.structuredCandidateId,
  )!
  const mutations: readonly [
    string,
    (trace: any) => void,
  ][] = [
    ['value', (trace) => {
      trace.candidateScores![0].value += 0.01
    }],
    ['viability', (trace) => {
      trace.candidateScores![0].viable =
        !trace.candidateScores![0].viable
    }],
    ['reason codes', (trace) => {
      trace.candidateScores![0].reasonCodes = [
        ...trace.candidateScores![0].reasonCodes,
        'FORGED',
      ]
    }],
    ['structured id', (trace) => {
      trace.structuredCandidateId = alternate.id
    }],
    ['chosen id', (trace) => {
      trace.chosenCandidateId = alternate.id
    }],
    ['self-consistent selected action', (trace) => {
      trace.structuredCandidateId = alternate.id
      trace.chosenCandidateId = alternate.id
      trace.action = structuredClone(alternate.decision)
    }],
    ['missing native use stage', (trace) => {
      const use = trace.components!.policyUse.find(
        (entry: any) => entry.stages.includes('candidate-score'),
      )!
      use.stages = []
      use.used = false
    }],
    ['wrong native use stage', (trace) => {
      const use = trace.components!.policyUse.find(
        (entry: any) => entry.stages.includes('candidate-score'),
      )!
      use.stages = ['action-selection']
    }],
    ['migrated flat payload', (trace) => {
      trace.privateRoleUtility = structuredClone(roleUtilityFrom(trace)!)
    }],
    ['migrated flat version', (trace) => {
      trace.componentVersions!.roleUtility =
        GOOD_ROLE_UTILITY_COMPONENT.version
    }],
    ['migrated flat degradation', (trace) => {
      trace.degradation.push('role-utility-projection-failed')
    }],
  ]
  for (const [label, mutate] of mutations) {
    const forged = structuredClone(output)
    mutate(forged.trace!)
    const admission = admitDecisionTrace({
      kind: 'finalized-artifact',
      trace: forged.trace!,
      req: fixture.req,
      view: fixture.view,
      authoritativeAction: label === 'self-consistent selected action'
        ? alternate.decision
        : output.decision,
      selectedDecision: label === 'self-consistent selected action'
        ? alternate.decision
        : output.decision,
      deterministicSeed: fixture.source.seed,
      expectedComponentPlan: expectedPlan,
      expectedArchitectureIdentity: expectedIdentity,
      expectComponentTrace: true,
    })
    assert.equal(admission.kind, 'rejected', label)
    if (admission.kind === 'rejected') {
      assert.equal(
        admission.reason,
        'trusted-identity-host-join-failed',
        label,
      )
    }
  }
  const reasonForgery = structuredClone(output)
  reasonForgery.trace!.candidateScores![0].reasonCodes = [
    ...reasonForgery.trace!.candidateScores![0].reasonCodes,
    'FORGED',
  ]
  assert.deepEqual(
    parseStdioDecisionReply(
      fixture.req,
      reasonForgery,
      'a4b diagnostic reason rewrite',
      fixture.view,
    ),
    reasonForgery,
  )
})

test('self-described passive graphs stay diagnostic while trusted plan joins fail closed', async () => {
  const fixture = readDecisionFixtures().find(
    (entry) => entry.id === 'servant-vote-after-evidence',
  )!
  const passiveAgent = createComposedAgent({
    seed: 'a4b-passive-plan',
    roleObjectives: true,
  })
  const passive = await passiveAgent.decide(fixture.req, fixture.view)
  const passiveIdentity = projectResolvedArchitectureIdentity(
    passiveAgent.resolvedBrain().description,
  )
  const expectedPlan = structuredClone(passive.trace!.componentPlan!)
  assert.ok(expectedPlan.configured.length > 0)
  const erased: any = structuredClone(passive)
  erased.trace!.componentPlan!.configured = []
  erased.trace!.components!.configured = []
  erased.trace!.components!.entries = []
  erased.trace!.components!.policyUse = []
  assert.deepEqual(
    parseStdioDecisionReply(
      fixture.req,
      erased,
      'a4b self-described passive graph',
      fixture.view,
    ),
    erased,
  )
  const erasedAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: erased.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: erased.decision,
    selectedDecision: erased.decision,
    deterministicSeed: 'a4b-passive-plan',
    expectedComponentPlan: expectedPlan,
    expectedArchitectureIdentity: passiveIdentity,
    expectComponentTrace: true,
  })
  assert.equal(erasedAdmission.kind, 'rejected')
  if (erasedAdmission.kind === 'rejected') {
    assert.equal(
      erasedAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }

  const compatibilityAgent = createComposedAgent({
    seed: 'a4b-empty-plan',
  })
  const compatibility = await compatibilityAgent.decide(fixture.req, fixture.view)
  const compatibilityIdentity = projectResolvedArchitectureIdentity(
    compatibilityAgent.resolvedBrain().description,
  )
  assert.deepEqual(compatibility.trace!.componentPlan!.configured, [])
  assert.deepEqual(
    parseStdioDecisionReply(
      fixture.req,
      compatibility,
      'a4b genuine empty plan',
      fixture.view,
    ),
    compatibility,
  )
  const diagnosticAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: compatibility.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: compatibility.decision,
    selectedDecision: compatibility.decision,
    deterministicSeed: 'a4b-empty-plan',
    expectedComponentPlan: compatibility.trace!.componentPlan!,
    expectComponentTrace: true,
  })
  assert.equal(
    diagnosticAdmission.kind,
    'artifact-diagnostic',
    'witnessless current trace remains diagnostic',
  )
  assert.equal(diagnosticAdmission.promotionEvidenceEligible, false)
  const differentScoringIdentity = projectResolvedArchitectureIdentity(
    createComposedAgent({
      seed: 'identity',
      scorer: seededGoodProposalVoteScorer,
    }).resolvedBrain().description,
  )
  assert.deepEqual(
    differentScoringIdentity.components.configured,
    compatibilityIdentity.components.configured,
  )
  const wrongIdentityAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: compatibility.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: compatibility.decision,
    selectedDecision: compatibility.decision,
    deterministicSeed: 'a4b-empty-plan',
    expectedComponentPlan: compatibility.trace!.componentPlan!,
    expectedArchitectureIdentity: differentScoringIdentity,
    expectComponentTrace: true,
  })
  assert.equal(
    wrongIdentityAdmission.kind,
    'rejected',
    'same component plan cannot substitute scoring identity',
  )
  if (wrongIdentityAdmission.kind === 'rejected') {
    assert.equal(
      wrongIdentityAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
  const relabeled: any = structuredClone(compatibility)
  relabeled.trace!.componentVersions!.scorer =
    seededGoodProposalVoteScorer.version
  const relabeledAdmission = admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: relabeled.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: relabeled.decision,
    selectedDecision: relabeled.decision,
    deterministicSeed: 'a4b-empty-plan',
    expectedComponentPlan: relabeled.trace!.componentPlan!,
    expectedArchitectureIdentity: compatibilityIdentity,
    expectComponentTrace: true,
  })
  assert.equal(
    relabeledAdmission.kind,
    'rejected',
    'self-consistent scorer relabel is not provenance',
  )
  if (relabeledAdmission.kind === 'rejected') {
    assert.equal(
      relabeledAdmission.reason,
      'trusted-identity-host-join-failed',
    )
  }
  assert.equal(admitDecisionTrace({
    kind: 'finalized-artifact',
    trace: compatibility.trace!,
    req: fixture.req,
    view: fixture.view,
    authoritativeAction: compatibility.decision,
    selectedDecision: compatibility.decision,
    deterministicSeed: 'a4b-empty-plan',
    expectedComponentPlan: compatibility.trace!.componentPlan!,
    expectedArchitectureIdentity: compatibilityIdentity,
    expectComponentTrace: true,
  }).kind, 'trusted-exact')
})

test('A4B source has one downstream writer and exact survivor admission', () => {
  const composed = fs.readFileSync('server/agents/composed.ts', 'utf8')
  const frame = fs.readFileSync(
    'server/agents/policy/decision-frame.ts',
    'utf8',
  )
  assert.equal(
    [...composed.matchAll(/selectDecisionCandidate\(/g)].length,
    1,
  )
  assert.equal([...composed.matchAll(/commitDecision\(/g)].length, 1)
  assert.match(
    composed,
    /const scoredFrame = customScoredFrame[\s\S]*withNativeScoringAuthority/,
  )
  assert.match(composed, /selectDecisionCandidate\(\s*scoredFrame,/)
  assert.match(
    frame,
    /isDeepStrictEqual\(\s*resolution\.survivorCandidateIds,\s*candidateBoundary\.survivorCandidateIds/,
  )
  assert.doesNotMatch(composed, /withLegacyScoring|legacyScoredFrame/)
})
