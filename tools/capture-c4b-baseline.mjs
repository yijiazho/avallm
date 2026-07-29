import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Usage: node tools/capture-c4b-baseline.mjs <source-worktree> <output>
// The source commit and dirty state are recorded so a fixture cannot claim
// independent provenance when it was captured from the runner under edit.
const root = path.resolve(process.argv[2] ?? '.')
const output = path.resolve(
  process.argv[3] ?? 'test/fixtures/phase7r2c4b-baseline.json',
)
const capturedFrom = execFileSync(
  'git',
  ['-c', `safe.directory=${root}`, '-C', root, 'rev-parse', 'HEAD'],
  { encoding: 'utf8' },
).trim()
const sourceDirty = execFileSync(
  'git',
  [
    '-c',
    `safe.directory=${root}`,
    '-C',
    root,
    '-c',
    'core.symlinks=false',
    'status',
    '--porcelain',
  ],
  { encoding: 'utf8' },
).trim().length > 0
const load = (relative) => import(pathToFileURL(path.join(root, relative)))
const [{ createComposedAgent }, { readDecisionFixtures }, score] =
  await Promise.all([
    load('server/agents/composed.ts'),
    load('server/eval/decision-fixtures.ts'),
    load('server/agents/policy/score.ts'),
  ])
const fixtures = readDecisionFixtures()
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(value))
  .digest('hex')
const rows = []

async function capture(id, req, view, options) {
  const stages = []
  let plannerInput
  let voiceInput
  const planner = options.planner
    ? {
        version: options.planner.version,
        async choose(input) {
          plannerInput = input
          return options.planner.choose(input)
        },
      }
    : undefined
  const voice = options.voice
    ? {
        version: options.voice.version,
        async speak(input) {
          voiceInput = input
          return options.voice.speak(input)
        },
      }
    : undefined
  const result = await createComposedAgent({
    ...options,
    ...(options.scorer ? { scorer: options.scorer } : {}),
    ...(planner ? { planner } : {}),
    ...(voice ? { voice } : {}),
    onStage: (stage) => stages.push(stage),
  }).decide(req, view)
  rows.push({
    id,
    decision: result.decision,
    traceHash: digest(result.trace),
    stages,
    plannerInputHash: plannerInput ? digest(plannerInput) : null,
    voiceInputHash: voiceInput ? digest(voiceInput) : null,
  })
}

for (const fixture of fixtures) {
  await capture(
    `default:${fixture.id}`,
    fixture.req,
    fixture.view,
    { seed: fixture.source.seed },
  )
}

const proposal = fixtures.find(
  (fixture) => fixture.id === 'merlin-opening-proposal',
)
const malformed = (source) => ({ ...source, score: () => [] })
await capture('fallback:matching-base', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  roleObjectives: true,
  scorer: malformed(score.roleObjectiveScorer),
})
await capture('fallback:hard-double', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  roleObjectives: true,
  scorer: malformed({
    ...score.roleObjectiveScorer,
    baseScorer: malformed(score.roleObjectiveScorer.baseScorer),
  }),
})

const quest = fixtures.find(
  (fixture) => fixture.id === 'oberon-two-fail-quest',
)
const d3View = structuredClone(quest.view)
d3View.seat = 4
d3View.name = d3View.players.find((player) => player.seat === 4).name
d3View.role = 'assassin'
d3View.alignment = 'evil'
d3View.privateInfo = { evilPartners: [5] }
d3View.quests[0] = { ...d3View.quests[0], result: 'success', failCount: 0 }
d3View.quests[1] = { ...d3View.quests[1], result: 'fail', failCount: 1 }
d3View.quests[2] = {
  ...d3View.quests[2],
  result: undefined,
  failCount: undefined,
}
await capture(
  'd3:robust',
  {
    kind: 'quest',
    seat: d3View.seat,
    round: d3View.round,
    proposalNum: d3View.proposalNum,
  },
  d3View,
  { seed: 'decision-frame-real-d3', evilQuestCardPolicy: 'robust-heterogeneous' },
)

await capture('planner-voice:accepted', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  planner: {
    version: 'c4b-baseline-planner-v1',
    choose: (input) => ({ candidateId: input.structuredCandidateId }),
  },
  voice: {
    version: 'c4b-baseline-voice-v1',
    speak: () => ({ text: 'I support this team.', thinking: 'Keep it concise.' }),
  },
})
await capture('planner:invalid-candidate', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  planner: {
    version: 'c4b-baseline-planner-v1',
    choose: () => ({ candidateId: 'missing-candidate' }),
  },
})
await capture('voice:no-output', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  voice: {
    version: 'c4b-baseline-voice-v1',
    speak: () => undefined,
  },
})
await capture('voice:failure', proposal.req, proposal.view, {
  seed: proposal.source.seed,
  voice: {
    version: 'c4b-baseline-voice-v1',
    speak: () => {
      throw new Error('baseline voice failure')
    },
  },
})

fs.writeFileSync(output, `${JSON.stringify({
  schema: 1,
  capturedFrom,
  sourceDirty,
  scenarios: rows,
}, null, 2)}\n`)
