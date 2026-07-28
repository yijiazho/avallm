import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import test from 'node:test'

const fixtureFile = 'test/fixtures/phase7r3a-score-equivalence.json'
const captureTool = 'tools/capture-phase7r3a-score-oracle.mjs'
const expectedSource =
  'b9f710389d2dfad03ec03e85313f672872c2b825'
const expectedScenarioSha256 =
  'ce3a51425cdac1d3ef342ba950e31f923a78d14bcf20639cd9237e8f98efe2f2'
const maxScenarioCount = 16
const maxScenarioJsonBytes = 64 * 1024
const maxTotalScenarioJsonBytes = 384 * 1024
const maxPrettyFixtureBytes = 768 * 1024

interface OracleScenario {
  id: string
  coverage: string[]
  input: {
    configuration: string
    seed: string
    req: {
      kind: string
      seat: number
      round: number
      proposalNum: number
    }
    view: {
      seat: number
      role: string
      phase: string
      round: number
      proposalNum: number
      currentTeam?: number[]
      proposals: {
        round: number
        proposalNum: number
        team: number[]
      }[]
      events: {
        seq: number
        type: string
        payload: Record<string, unknown>
      }[]
    }
  }
  expected: {
    mechanicalDecision: { kind: string }
    candidateScores: {
      candidateId: string
      viable: boolean
      reasonCodes: string[]
      evilRoleObjectiveFeatures?: {
        utility?: { role?: string }
      }
    }[]
    forcedPolicyResult: {
      applied: boolean
      allowedCandidateIds: string[]
      selectedCandidateId?: string
    }
    structuredCandidateId: string
    selectedCandidateId: string
    selectedScoreReasonCodes: string[]
    communicationStrategicReasonCodes: string[]
    degradation: string[]
    causalUse: {
      configured: unknown[]
      entries: unknown[]
      policyUse: unknown[]
    }
    agentMode: string
    componentPlan: unknown
    componentVersions: unknown
    appliedVersions: {
      scorer: string
    }
    plannerInput: unknown | null
    voiceInput: unknown | null
  }
}

interface ScoreOracle {
  schema: number
  capturedFrom: string
  sourceDirty: boolean
  capturePolicy: string
  excludedMigrationMetadata: string[]
  bounds: {
    scenarioCount: number
    maxScenarioJsonBytes: number
    totalScenarioJsonBytes: number
  }
  scenarios: OracleScenario[]
  scenarioSha256: string
}

const digest = (value: unknown): string => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')

function sameTeam(left: unknown, right: unknown): boolean {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((seat, index) => seat === right[index])
}

function assertCoherentStoredBoundary(scenario: OracleScenario): void {
  const { req, view } = scenario.input
  assert.equal(req.seat, view.seat, scenario.id)
  assert.equal(req.round, view.round, scenario.id)
  assert.equal(req.proposalNum, view.proposalNum, scenario.id)
  assert.equal(
    view.phase,
    req.kind === 'propose' ? 'proposal' : 'vote',
    scenario.id,
  )
  for (let index = 1; index < view.events.length; index++) {
    assert.ok(
      view.events[index - 1].seq < view.events[index].seq,
      `${scenario.id}: visible event cursor must be strictly ordered`,
    )
  }
  const proposals = view.proposals.filter(
    (proposal) =>
      proposal.round === req.round
      && proposal.proposalNum === req.proposalNum,
  )
  const events = view.events.filter(
    (event) =>
      ['proposal', 'proposalLocked', 'proposalRevised'].includes(event.type)
      && event.payload.round === req.round
      && event.payload.proposalNum === req.proposalNum,
  )
  if (req.kind === 'propose') {
    assert.equal(view.currentTeam, undefined, scenario.id)
    assert.equal(proposals.length, 0, scenario.id)
    assert.equal(events.length, 0, scenario.id)
    return
  }
  assert.equal(proposals.length, 1, scenario.id)
  assert.ok(sameTeam(proposals[0].team, view.currentTeam), scenario.id)
  assert.ok(events.length > 0, scenario.id)
  assert.ok(
    sameTeam(events[events.length - 1].payload.team, view.currentTeam),
    scenario.id,
  )
}

test('Phase 7R3A score oracle is provenance-pinned and coverage-complete', () => {
  const oracle = JSON.parse(
    fs.readFileSync(fixtureFile, 'utf8'),
  ) as ScoreOracle
  assert.equal(oracle.schema, 1)
  assert.equal(oracle.capturedFrom, expectedSource)
  assert.equal(oracle.sourceDirty, false)
  assert.equal(oracle.capturePolicy, 'archival-pinned-source-only')
  assert.deepEqual(oracle.excludedMigrationMetadata, [
    'resolved architecture descriptor scoreLayerOrder',
    'architecture identity digest derived from scoreLayerOrder',
  ])
  assert.equal(oracle.scenarios.length, 16)
  assert.equal(oracle.bounds.scenarioCount, oracle.scenarios.length)
  assert.ok(oracle.bounds.scenarioCount <= maxScenarioCount)
  const scenarioSizes = oracle.scenarios.map((scenario) =>
    Buffer.byteLength(JSON.stringify(scenario), 'utf8'))
  assert.equal(
    oracle.bounds.maxScenarioJsonBytes,
    Math.max(...scenarioSizes),
  )
  assert.equal(
    oracle.bounds.totalScenarioJsonBytes,
    Buffer.byteLength(JSON.stringify(oracle.scenarios), 'utf8'),
  )
  assert.ok(oracle.bounds.maxScenarioJsonBytes <= maxScenarioJsonBytes)
  assert.ok(
    oracle.bounds.totalScenarioJsonBytes <= maxTotalScenarioJsonBytes,
  )
  assert.ok(fs.statSync(fixtureFile).size <= maxPrettyFixtureBytes)
  assert.equal(oracle.scenarioSha256, expectedScenarioSha256)
  assert.equal(digest(oracle.scenarios), expectedScenarioSha256)
  assert.equal(
    new Set(oracle.scenarios.map((scenario) => scenario.id)).size,
    oracle.scenarios.length,
  )

  const coverage = new Set(
    oracle.scenarios.flatMap((scenario) => scenario.coverage),
  )
  for (const required of [
    'base',
    'compatibility',
    'phase4',
    'c2',
    'd2',
    'minion',
    'oberon',
    'e1',
    'morgana',
    'proposal',
    'vote',
    'deterministic',
    'seeded',
    'forced-removal',
    'forced-selection',
    'degradation',
    'fallback',
    'planner',
    'voice',
  ]) {
    assert.ok(coverage.has(required), `missing oracle coverage: ${required}`)
  }

  for (const scenario of oracle.scenarios) {
    assertCoherentStoredBoundary(scenario)
    assert.equal(scenario.input.req.seat, scenario.input.view.seat, scenario.id)
    assert.equal(
      scenario.expected.mechanicalDecision.kind,
      scenario.input.req.kind,
      scenario.id,
    )
    const byId = new Map(
      scenario.expected.candidateScores.map((candidate) => [
        candidate.candidateId,
        candidate,
      ]),
    )
    assert.ok(
      byId.get(scenario.expected.structuredCandidateId)?.viable,
      `${scenario.id}: structured choice must be viable`,
    )
    assert.ok(
      byId.get(scenario.expected.selectedCandidateId)?.viable,
      `${scenario.id}: selected choice must be viable`,
    )
    assert.ok(
      scenario.expected.forcedPolicyResult.allowedCandidateIds.includes(
        scenario.expected.selectedCandidateId,
      ),
      `${scenario.id}: selected choice must survive forced policy`,
    )
    if (scenario.coverage.includes('forced-selection')) {
      assert.equal(
        scenario.expected.forcedPolicyResult.selectedCandidateId,
        scenario.expected.selectedCandidateId,
        scenario.id,
      )
    }
    if (scenario.coverage.includes('forced-removal')) {
      assert.ok(
        scenario.expected.forcedPolicyResult.allowedCandidateIds.length
          < scenario.expected.candidateScores.length,
        `${scenario.id}: forced filter must remove candidates`,
      )
      assert.ok(
        scenario.expected.candidateScores.some((candidate) =>
          !candidate.viable
          && !scenario.expected.forcedPolicyResult.allowedCandidateIds
            .includes(candidate.candidateId)),
        `${scenario.id}: removed score must be nonviable`,
      )
    }
    if (scenario.coverage.includes('degradation')) {
      assert.ok(scenario.expected.degradation.length > 0, scenario.id)
    }
    if (scenario.coverage.includes('planner')) {
      assert.ok(scenario.expected.plannerInput, scenario.id)
    }
    if (scenario.coverage.includes('voice')) {
      assert.ok(scenario.expected.voiceInput, scenario.id)
    }
    assert.ok(scenario.expected.appliedVersions.scorer, scenario.id)
    assert.ok(scenario.expected.agentMode, scenario.id)
    assert.ok(scenario.expected.componentPlan, scenario.id)
    assert.ok(scenario.expected.componentVersions, scenario.id)
  }

  const fallback = new Map(
    oracle.scenarios
      .filter((scenario) => scenario.coverage.includes('fallback'))
      .map((scenario) => [scenario.id, scenario]),
  )
  assert.deepEqual(
    {
      scorer: fallback.get('c2:malformed-falls-to-phase4')
        ?.expected.appliedVersions.scorer,
      degradation: fallback.get('c2:malformed-falls-to-phase4')
        ?.expected.degradation,
    },
    {
      scorer: 'good-proposal-vote-scorer-v1',
      degradation: [
        'scorer-invalid-output',
        'role-objective-scorer-failed',
      ],
    },
  )
  assert.deepEqual(
    {
      scorer: fallback.get('d2:malformed-falls-to-phase4')
        ?.expected.appliedVersions.scorer,
      degradation: fallback.get('d2:malformed-falls-to-phase4')
        ?.expected.degradation,
    },
    {
      scorer: 'good-proposal-vote-seeded-band-v1',
      degradation: [
        'scorer-invalid-output',
        'evil-role-objective-scorer-failed',
      ],
    },
  )
  assert.deepEqual(
    {
      scorer: fallback.get('e1:malformed-falls-to-d2')
        ?.expected.appliedVersions.scorer,
      degradation: fallback.get('e1:malformed-falls-to-d2')
        ?.expected.degradation,
    },
    {
      scorer: 'evil-oberon-role-scorer-v1',
      degradation: [
        'scorer-invalid-output',
        'morgana-role-objective-scorer-failed',
      ],
    },
  )

  const compatibilityVote = oracle.scenarios.find(
    (scenario) => scenario.id === 'base:compatibility-vote',
  )
  assert.equal(compatibilityVote?.input.configuration, 'compatibility')
  assert.equal(compatibilityVote?.input.req.kind, 'vote')
  assert.equal(
    compatibilityVote?.expected.appliedVersions.scorer,
    'compatibility-scorer-v1',
  )
  const minion = oracle.scenarios.find(
    (scenario) => scenario.id === 'd2:minion-vote-deterministic',
  )
  assert.equal(minion?.input.configuration, 'd2-deterministic')
  assert.equal(minion?.input.req.kind, 'vote')
  assert.equal(minion?.input.view.role, 'minion')
  assert.equal(
    minion?.expected.appliedVersions.scorer,
    'evil-oberon-role-scorer-v1',
  )
  assert.ok(minion?.expected.candidateScores.every((score) =>
    score.evilRoleObjectiveFeatures?.utility?.role === 'minion'))
})

test('Phase 7R3A capture tool cannot bless a later policy implementation', () => {
  const source = fs.readFileSync(captureTool, 'utf8')
  assert.match(source, new RegExp(expectedSource))
  assert.match(source, /capturedFrom !== EXPECTED_SOURCE/)
  assert.match(source, /if \(sourceDirty\)/)
  assert.match(
    source,
    /readDecisionFixtures\(\s*path\.join\(root,\s*'test\/fixtures\/architecture-decision-views\.json'\)/,
  )
  assert.doesNotMatch(source, /function asProposal|function asVote/)
  assert.doesNotMatch(
    source,
    /phase7r3a-score-equivalence-oracle\.test\.ts/,
  )
})
