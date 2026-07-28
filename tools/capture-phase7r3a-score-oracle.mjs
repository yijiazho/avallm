import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// This is an archival capture tool, not a golden-file update command. It can
// only read the clean legacy implementation from the Phase 7R2C exit commit.
// A later policy change must update intentional policy fixtures, never this
// migration oracle.
const EXPECTED_SOURCE =
  'b9f710389d2dfad03ec03e85313f672872c2b825'
const root = path.resolve(process.argv[2] ?? '.')
const output = path.resolve(
  process.argv[3] ?? 'test/fixtures/phase7r3a-score-equivalence.json',
)
const git = (...args) => execFileSync(
  'git',
  ['-c', `safe.directory=${root}`, '-C', root, ...args],
  { encoding: 'utf8' },
).trim()
const capturedFrom = git('rev-parse', 'HEAD')
const sourceDirty = git(
  '-c',
  'core.symlinks=false',
  'status',
  '--porcelain',
).length > 0
if (capturedFrom !== EXPECTED_SOURCE) {
  throw new Error(
    `Phase 7R3A oracle requires ${EXPECTED_SOURCE}; got ${capturedFrom}`,
  )
}
if (sourceDirty) {
  throw new Error('Phase 7R3A oracle requires a clean source worktree')
}

const load = (relative) =>
  import(pathToFileURL(path.join(root, relative)))
const [
  { createComposedAgent },
  { readDecisionFixtures },
  score,
  { createGame },
  { createAgent },
  { runGame },
  { toArtifact },
  { decisionReplayTimeline },
  { ARCHITECTURE_BANK },
] = await Promise.all([
  load('server/agents/composed.ts'),
  load('server/eval/decision-fixtures.ts'),
  load('server/agents/policy/score.ts'),
  load('server/engine/game.ts'),
  load('server/agents/registry.ts'),
  load('server/sim/runner.ts'),
  load('server/eval/artifact.ts'),
  load('server/eval/replay.ts'),
  load('server/eval/architecture-bank.ts'),
])

const fixtures = readDecisionFixtures(
  path.join(root, 'test/fixtures/architecture-decision-views.json'),
)
const digest = (value) => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex')
const jsonBytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

function frozenSnapshot(role, kind) {
  const fixture = fixtures.find(
    (candidate) =>
      candidate.view.role === role
      && candidate.req.kind === kind
      && candidate.view.phase === (kind === 'propose' ? 'proposal' : 'vote'),
  )
  if (!fixture) {
    throw new Error(`missing frozen ${role} ${kind} boundary`)
  }
  return {
    seed: fixture.source.seed,
    req: structuredClone(fixture.req),
    view: structuredClone(fixture.view),
  }
}

const timelineCache = new Map()
async function timelineFor(caseId) {
  let pending = timelineCache.get(caseId)
  if (!pending) {
    pending = (async () => {
      const bankCase = ARCHITECTURE_BANK.find(
        (candidate) => candidate.id === caseId,
      )
      if (!bankCase) throw new Error(`unknown architecture case ${caseId}`)
      const game = createGame({
        id: `phase7r3a-oracle-${caseId}`,
        seed: bankCase.seed,
        playerCount: bankCase.playerCount,
        roles: [...bankCase.roles],
        talk: bankCase.talk,
      })
      const agents = new Map(game.players.map((player) => [
        player.seat,
        createAgent(
          { type: 'heuristic' },
          { seed: bankCase.seed, seat: player.seat },
        ),
      ]))
      const run = await runGame({ game, agents })
      if (run.degraded.length) {
        throw new Error(`${caseId}: heuristic source game degraded`)
      }
      return decisionReplayTimeline(toArtifact(game, {
        agents: game.players.map(() => 'heuristic'),
        degraded: run.degraded,
        steps: run.steps,
      }))
    })()
    timelineCache.set(caseId, pending)
  }
  return pending
}

async function replaySnapshot(caseId, role, kind, predicate = () => true) {
  const timeline = await timelineFor(caseId)
  const snapshot = timeline.snapshots.find(
    (candidate) =>
      candidate.role === role
      && candidate.kind === kind
      && predicate(candidate),
  )
  if (!snapshot) {
    throw new Error(`missing replayed ${caseId} ${role} ${kind} boundary`)
  }
  return {
    seed: snapshot.seed,
    req: structuredClone(snapshot.req),
    view: structuredClone(snapshot.view),
  }
}

function sameTeam(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((seat, index) => seat === right[index])
}

function assertCoherentBoundary(id, req, view) {
  const expectedPhase = req.kind === 'propose'
    ? 'proposal'
    : req.kind === 'vote'
      ? 'vote'
      : undefined
  if (
    expectedPhase === undefined
    || view.phase !== expectedPhase
    || req.seat !== view.seat
    || req.round !== view.round
    || req.proposalNum !== view.proposalNum
  ) throw new Error(`${id}: incoherent request/view decision boundary`)
  for (let index = 1; index < view.events.length; index++) {
    if (view.events[index - 1].seq >= view.events[index].seq) {
      throw new Error(`${id}: visible event cursor is not strictly ordered`)
    }
  }
  const currentProposals = view.proposals.filter(
    (proposal) =>
      proposal.round === req.round
      && proposal.proposalNum === req.proposalNum,
  )
  const currentEvents = view.events.filter(
    (event) =>
      ['proposal', 'proposalLocked', 'proposalRevised'].includes(event.type)
      && event.payload.round === req.round
      && event.payload.proposalNum === req.proposalNum,
  )
  if (req.kind === 'propose') {
    if (
      view.currentTeam !== undefined
      || currentProposals.length !== 0
      || currentEvents.length !== 0
    ) throw new Error(`${id}: proposal snapshot contains its future proposal`)
    return
  }
  if (
    !Array.isArray(view.currentTeam)
    || currentProposals.length !== 1
    || !sameTeam(currentProposals[0].team, view.currentTeam)
  ) throw new Error(`${id}: vote snapshot disagrees with proposal record`)
  if (
    currentEvents.length === 0
    || !sameTeam(
      currentEvents[currentEvents.length - 1].payload.team,
      view.currentTeam,
    )
  ) throw new Error(`${id}: vote snapshot disagrees with proposal event`)
}

const malformed = (source) => Object.freeze({
  ...source,
  score() {
    return []
  },
})

function legacyOptions(configuration, seed) {
  switch (configuration) {
    case 'compatibility':
      return { seed }
    case 'phase4-deterministic':
      return { seed, scorer: score.goodProposalVoteScorer }
    case 'phase4-seeded':
      return { seed, scorer: score.seededGoodProposalVoteScorer }
    case 'c2-deterministic':
      return { seed, scorer: score.roleObjectiveScorer }
    case 'c2-seeded':
      return { seed, scorer: score.seededRoleObjectiveScorer }
    case 'c2-malformed-fallback':
      return { seed, scorer: malformed(score.roleObjectiveScorer) }
    case 'd2-deterministic':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: score.evilRoleObjectiveScorer,
      }
    case 'd2-seeded':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: score.seededEvilRoleObjectiveScorer,
      }
    case 'd2-malformed-fallback':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: malformed(score.seededEvilRoleObjectiveScorer),
      }
    case 'e1-deterministic':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: score.morganaRoleScorer,
      }
    case 'e1-seeded':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: score.seededMorganaRoleScorer,
      }
    case 'e1-malformed-fallback':
      return {
        seed,
        roleObjectiveRouter: true,
        scorer: malformed(score.morganaRoleScorer),
      }
    default:
      throw new Error(`unknown legacy oracle configuration ${configuration}`)
  }
}

function mechanical(decision) {
  const result = structuredClone(decision)
  delete result.thinking
  delete result.notes
  if (result.kind === 'discuss') result.say = ''
  if (result.kind === 'propose') delete result.pitch
  if (result.kind === 'finalize' && !result.stick) delete result.reason
  return result
}

function boundedPlannerInput(input) {
  return {
    context: structuredClone(input.context),
    structuredCandidateId: input.structuredCandidateId,
    renderedContextSha256: digest(input.renderedContext),
    renderedContextBytes: Buffer.byteLength(input.renderedContext, 'utf8'),
  }
}

function boundedVoiceInput(input) {
  return {
    plan: structuredClone(input.plan),
    renderedPlanSha256: digest(input.renderedPlan),
    renderedPlanBytes: Buffer.byteLength(input.renderedPlan, 'utf8'),
  }
}

function causalUse(trace) {
  return {
    configured: structuredClone(trace.components?.configured ?? []),
    entries: (trace.components?.entries ?? []).map((entry) => ({
      component: entry.component,
      kind: entry.kind,
      privacy: entry.privacy,
      status: entry.status,
      verification: entry.verification,
      promotionEligible: entry.promotionEligible,
    })),
    policyUse: structuredClone(trace.components?.policyUse ?? []),
  }
}

function appliedVersions(trace) {
  const versions = trace.componentVersions ?? {}
  return {
    belief: versions.belief,
    factors: versions.factors,
    roleObjective: versions.roleObjective,
    roleObjectiveRouter: versions.roleObjectiveRouter,
    roleUtility: versions.roleUtility,
    evilRoleUtility: versions.evilRoleUtility,
    morganaCounterfeitPublicRead: versions.morganaCounterfeitPublicRead,
    morganaCounterfeitObjective: versions.morganaCounterfeitObjective,
    morganaRoleUtility: versions.morganaRoleUtility,
    configuredScorer: versions.configuredScorer,
    scorer: versions.scorer,
    forcedPolicy: versions.forcedPolicy,
    policy: versions.policy,
    planner: versions.planner,
    communication: versions.communication,
    voice: versions.voice,
  }
}

const merlinProposal = frozenSnapshot('merlin', 'propose')
const servantVote = frozenSnapshot('servant', 'vote')
const mordredVote = frozenSnapshot('mordred', 'vote')
const [
  percivalVote,
  assassinProposal,
  minionVote,
  oberonForcedVote,
  morganaProposal,
  morganaVote,
] = await Promise.all([
  replaySnapshot('5p-percival', 'percival', 'vote'),
  replaySnapshot(
    '5p-assassin',
    'assassin',
    'propose',
    (snapshot) => snapshot.req.round === 4 && snapshot.req.proposalNum === 1,
  ),
  replaySnapshot('8p-minion', 'minion', 'vote'),
  replaySnapshot(
    '7p-oberon',
    'oberon',
    'vote',
    (snapshot) => snapshot.req.round === 3 && snapshot.req.proposalNum === 1,
  ),
  replaySnapshot('5p-servant', 'morgana', 'propose'),
  replaySnapshot('5p-servant', 'morgana', 'vote'),
])
const scenarioInputs = [
  {
    id: 'base:compatibility-proposal',
    coverage: ['base', 'compatibility', 'proposal', 'deterministic'],
    configuration: 'compatibility',
    ...merlinProposal,
  },
  {
    id: 'base:compatibility-vote',
    coverage: ['base', 'compatibility', 'vote', 'deterministic', 'planner'],
    configuration: 'compatibility',
    ...servantVote,
  },
  {
    id: 'phase4:good-proposal-deterministic',
    coverage: ['phase4', 'proposal', 'deterministic', 'planner', 'voice'],
    configuration: 'phase4-deterministic',
    ...merlinProposal,
  },
  {
    id: 'phase4:good-vote-deterministic',
    coverage: ['phase4', 'vote', 'deterministic', 'planner'],
    configuration: 'phase4-deterministic',
    ...servantVote,
  },
  {
    id: 'phase4:good-vote-seeded',
    coverage: ['phase4', 'vote', 'seeded', 'planner'],
    configuration: 'phase4-seeded',
    ...servantVote,
  },
  {
    id: 'c2:merlin-proposal-deterministic',
    coverage: ['c2', 'proposal', 'deterministic', 'planner', 'voice'],
    configuration: 'c2-deterministic',
    ...merlinProposal,
  },
  {
    id: 'c2:percival-vote-seeded',
    coverage: ['c2', 'vote', 'seeded', 'planner'],
    configuration: 'c2-seeded',
    ...percivalVote,
  },
  {
    id: 'c2:malformed-falls-to-phase4',
    coverage: ['c2', 'proposal', 'degradation', 'fallback'],
    configuration: 'c2-malformed-fallback',
    ...merlinProposal,
  },
  {
    id: 'd2:assassin-proposal-forced-filter',
    coverage: [
      'd2',
      'proposal',
      'deterministic',
      'forced-removal',
      'planner',
      'voice',
    ],
    configuration: 'd2-deterministic',
    ...assassinProposal,
  },
  {
    id: 'd2:mordred-vote-seeded',
    coverage: ['d2', 'vote', 'seeded', 'planner'],
    configuration: 'd2-seeded',
    ...mordredVote,
  },
  {
    id: 'd2:minion-vote-deterministic',
    coverage: ['d2', 'minion', 'vote', 'deterministic', 'planner'],
    configuration: 'd2-deterministic',
    ...minionVote,
  },
  {
    id: 'd2:oberon-vote-forced-selection',
    coverage: [
      'd2',
      'oberon',
      'vote',
      'deterministic',
      'forced-selection',
    ],
    configuration: 'd2-deterministic',
    ...oberonForcedVote,
  },
  {
    id: 'd2:malformed-falls-to-phase4',
    coverage: ['d2', 'vote', 'seeded', 'degradation', 'fallback'],
    configuration: 'd2-malformed-fallback',
    ...mordredVote,
  },
  {
    id: 'e1:morgana-proposal-deterministic',
    coverage: ['e1', 'morgana', 'proposal', 'deterministic', 'planner', 'voice'],
    configuration: 'e1-deterministic',
    ...morganaProposal,
  },
  {
    id: 'e1:morgana-vote-seeded',
    coverage: ['e1', 'morgana', 'vote', 'seeded', 'planner'],
    configuration: 'e1-seeded',
    ...morganaVote,
  },
  {
    id: 'e1:malformed-falls-to-d2',
    coverage: ['e1', 'morgana', 'proposal', 'degradation', 'fallback'],
    configuration: 'e1-malformed-fallback',
    ...morganaProposal,
  },
]

const scenarios = []
for (const scenario of scenarioInputs) {
  assertCoherentBoundary(
    scenario.id,
    scenario.req,
    scenario.view,
  )
  let plannerInput = null
  let voiceInput = null
  const options = legacyOptions(scenario.configuration, scenario.seed)
  const result = await createComposedAgent({
    ...options,
    planner: {
      version: 'phase7r3a-oracle-planner-v1',
      async choose(input) {
        plannerInput = boundedPlannerInput(input)
        return { candidateId: input.structuredCandidateId }
      },
    },
    voice: {
      version: 'phase7r3a-oracle-voice-v1',
      async speak(input) {
        voiceInput = boundedVoiceInput(input)
        return {}
      },
    },
  }).decide(scenario.req, scenario.view)
  const trace = result.trace
  if (!trace?.candidateScores || !trace.forcedPolicyResult) {
    throw new Error(`${scenario.id}: missing legacy score trace`)
  }
  scenarios.push({
    id: scenario.id,
    coverage: scenario.coverage,
    input: {
      configuration: scenario.configuration,
      seed: scenario.seed,
      req: scenario.req,
      view: scenario.view,
    },
    expected: {
      mechanicalDecision: mechanical(result.decision),
      candidateScores: trace.candidateScores,
      forcedPolicyResult: trace.forcedPolicyResult,
      structuredCandidateId: trace.structuredCandidateId,
      selectedCandidateId: trace.chosenCandidateId,
      selectedScoreReasonCodes: trace.candidateScores.find(
        (candidate) => candidate.candidateId === trace.chosenCandidateId,
      )?.reasonCodes ?? [],
      communicationStrategicReasonCodes:
        trace.communicationIntent?.strategicReasonCodes ?? [],
      degradation: trace.degradation,
      causalUse: causalUse(trace),
      agentMode: trace.agentMode,
      componentPlan: trace.componentPlan,
      componentVersions: trace.componentVersions,
      appliedVersions: appliedVersions(trace),
      plannerInput,
      voiceInput,
    },
  })
}

const payload = {
  schema: 1,
  capturedFrom,
  sourceDirty,
  capturePolicy: 'archival-pinned-source-only',
  excludedMigrationMetadata: [
    'resolved architecture descriptor scoreLayerOrder',
    'architecture identity digest derived from scoreLayerOrder',
  ],
  bounds: {
    scenarioCount: scenarios.length,
    maxScenarioJsonBytes: Math.max(...scenarios.map(jsonBytes)),
    totalScenarioJsonBytes: jsonBytes(scenarios),
  },
  scenarios,
}
payload.scenarioSha256 = digest(payload.scenarios)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, `${JSON.stringify(payload, null, 2)}\n`)
console.log(
  `${output}: ${scenarios.length} scenarios from ${capturedFrom} `
    + `(${payload.bounds.totalScenarioJsonBytes} bytes)`,
)
