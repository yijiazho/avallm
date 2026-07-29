import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const LANES = Object.freeze({
  fast: Object.freeze([
    'agent-defs.test.ts',
    'architecture-fitness.test.ts',
    'belief-fixtures.test.ts',
    'belief-rendering.test.ts',
    'belief.test.ts',
    'brain.test.ts',
    'cognition.test.ts',
    'composed-agent.test.ts',
    'discuss-nudge.test.ts',
    'discuss-stakes.test.ts',
    'endgame-norm.test.ts',
    'evil-fold.test.ts',
    'facts.test.ts',
    'flow.test.ts',
    'forced-play.test.ts',
    'forced-policy.test.ts',
    'good-proposal-scorer.test.ts',
    'good-vote-scorer.test.ts',
    'heuristic-forced.test.ts',
    'llm-agent.test.ts',
    'llm-policies.test.ts',
    'match-point.test.ts',
    'name-policy.test.ts',
    'norms.test.ts',
    'openrouter-ceiling.test.ts',
    'openrouter-timeout.test.ts',
    'packs.test.ts',
    'parse.test.ts',
    'percival.test.ts',
    'phase2-fixtures.test.ts',
    'phase4c-intent-planner.test.ts',
    'phase5a-foundations.test.ts',
    'phase6a-language-contract.test.ts',
    'phase6b-language-factor.test.ts',
    'prompts.test.ts',
    'public-record.test.ts',
    'reasoning-probe.test.ts',
    'record-line.test.ts',
    'reflect-side.test.ts',
    'rename.test.ts',
    'rules.test.ts',
    'screens.test.ts',
    'self-check.test.ts',
    'server-http.test.ts',
    'setup-lattice.test.ts',
    'situation-analysis.test.ts',
    'speech-cap.test.ts',
    'stdio.test.ts',
    'strict-test-ratchet.test.ts',
    'styles-tokens.test.ts',
    'talk-default.test.ts',
    'talk-norms.test.ts',
    'transcript.test.ts',
    'user-copy.test.ts',
    'verify-funnel.test.ts',
    'vote-lean.test.ts',
  ]),
  contract: Object.freeze([
    'configured-score-layers.test.ts',
    'decision-scenario.test.ts',
    'decision-frame.test.ts',
    'decision-trace.test.ts',
    'knowledge.test.ts',
    'phase7r2c4b-baseline.test.ts',
    'phase6c-language-orchestration.test.ts',
    'phase7a-public-observer.test.ts',
    'phase7b1-joint-identity.test.ts',
    'phase7b2-plan-coherence.test.ts',
    'phase7c1-role-objectives.test.ts',
    'phase7c2-role-policy.test.ts',
    'phase7d1-evil-objectives.test.ts',
    'phase7d2-evil-policy.test.ts',
    'phase7d3-quest-coordination.test.ts',
    'phase7e1a-morgana-counterfeit.test.ts',
    'phase7e1b-morgana-policy.test.ts',
    'phase7e2a-mordred-hostile.test.ts',
    'phase7e2a-mordred-native.test.ts',
    'phase7r2a-admission-boundary.test.ts',
    'phase7r2b1-component-registry.test.ts',
    'phase7r2b2-component-kernel.test.ts',
    'phase7r2b3a-role-adapters.test.ts',
    'phase7r2b3b-morgana-quest-adapters.test.ts',
    'phase7r2b4-artifact-manifest.test.ts',
    'phase7r2b4-hostile-artifact.test.ts',
    'phase7r2c2-component-conformance.test.ts',
    'phase7r2c3-architecture-descriptor.test.ts',
    'phase7r3a1-score-layer.test.ts',
    'phase7r3a4b-score-authority.test.ts',
    'phase7r3b1b-admission-results.test.ts',
    'phase7r3b2a-decision-layer.test.ts',
    'phase7r3b2b-robust-cutover.test.ts',
    'scorer-situation-surface.test.ts',
  ]),
  eval: Object.freeze([
    'architecture-bank.test.ts',
    'architecture-eval.test.ts',
    'decision-fixtures.test.ts',
    'eval.test.ts',
    'phase0-baselines.test.ts',
    'phase4d-evaluation.test.ts',
    'phase5b-quest-factor.test.ts',
    'phase5c-vote-conversion.test.ts',
    'phase6d-active-language-eval.test.ts',
    'phase7r2c3-replay-timeline.test.ts',
    'replay.test.ts',
    'seat-view-inspector-ui.test.ts',
    'seat-view-inspector.test.ts',
  ]),
  exhaustive: Object.freeze([
    'certainties.test.ts',
    'compat-certainties.test.ts',
    'fuzz.test.ts',
    'heuristic-equivalence.test.ts',
    'leaks.test.ts',
    'phantom-roles.test.ts',
    'policy-candidates.test.ts',
    'prompt-coherence.test.ts',
    'slot-overlap.test.ts',
  ]),
  perf: Object.freeze([
    'architecture-performance.test.ts',
    'belief-performance.test.ts',
  ]),
})

function classifiedTests() {
  const membership = new Map()
  for (const [lane, files] of Object.entries(LANES)) {
    for (const file of files) {
      const prior = membership.get(file)
      if (prior) {
        throw new Error(`${file} is classified in both ${prior} and ${lane}`)
      }
      membership.set(file, lane)
    }
  }
  const actual = readdirSync('test')
    .filter((file) => file.endsWith('.test.ts'))
    .sort()
  const missing = actual.filter((file) => !membership.has(file))
  const stale = [...membership.keys()].filter((file) => !actual.includes(file))
  if (missing.length || stale.length) {
    const details = [
      missing.length ? `unclassified: ${missing.join(', ')}` : '',
      stale.length ? `missing files: ${stale.join(', ')}` : '',
    ].filter(Boolean).join('; ')
    throw new Error(`test lane classification is stale (${details})`)
  }
  return actual
}

let allTests
try {
  allTests = classifiedTests()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}

const requested = process.argv[2] ?? 'full'
if (requested === '--check') {
  console.log(
    `${allTests.length} test files classified across `
      + `${Object.keys(LANES).length} lanes`,
  )
  process.exit(0)
}

if (requested !== 'full' && !LANES[requested]) {
  console.error(
    `unknown test lane "${requested}"; expected `
      + `${[...Object.keys(LANES), 'full'].join(', ')}`,
  )
  process.exit(1)
}

function run(label, files) {
  console.log(`[test:${label}] ${files.length} files`)
  const result = spawnSync(
    process.execPath,
    ['--test', ...files.map((file) => `test/${file}`)],
    { stdio: 'inherit' },
  )
  if (result.error) {
    console.error(result.error.message)
    return 1
  }
  return result.status ?? 1
}

if (requested === 'full') {
  const perfFiles = new Set(LANES.perf)
  const correctness = allTests.filter((file) => !perfFiles.has(file))
  const correctnessStatus = run('full:correctness', correctness)
  if (correctnessStatus !== 0) process.exit(correctnessStatus)
  process.exit(run('full:perf', LANES.perf))
}

process.exit(run(requested, LANES[requested]))
