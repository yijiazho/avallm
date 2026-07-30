import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const LANES = Object.freeze({
  fast: Object.freeze([
    'agent-defs.test.ts',
    'architecture-fitness.test.ts',
    'belief-fixtures.test.ts',
    'belief-foundations.test.ts',
    'belief-rendering.test.ts',
    'belief.test.ts',
    'brain.test.ts',
    'cognition-reconstruction.test.ts',
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
    'intent-planner.test.ts',
    'language-contract.test.ts',
    'language-factor.test.ts',
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
    'admission-boundary.test.ts',
    'admission-results.test.ts',
    'architecture-descriptor.test.ts',
    'artifact-manifest.test.ts',
    'assassin-policy.test.ts',
    'assassin-posterior.test.ts',
    'component-conformance.test.ts',
    'component-kernel.test.ts',
    'component-registry.test.ts',
    'configured-score-layers.test.ts',
    'decision-frame-oracle.test.ts',
    'decision-frame.test.ts',
    'decision-layer.test.ts',
    'decision-scenario.test.ts',
    'decision-trace.test.ts',
    'evil-objectives.test.ts',
    'evil-policy.test.ts',
    'full-role-brain.test.ts',
    'hostile-artifact.test.ts',
    'joint-identity.test.ts',
    'knowledge.test.ts',
    'language-orchestration.test.ts',
    'mordred-hostile.test.ts',
    'mordred-native.test.ts',
    'mordred-policy.test.ts',
    'morgana-counterfeit.test.ts',
    'morgana-policy.test.ts',
    'morgana-quest-adapters.test.ts',
    'native-score-diagnostics.test.ts',
    'plan-coherence.test.ts',
    'public-observer.test.ts',
    'quest-coordination.test.ts',
    'robust-evil-quest-cutover.test.ts',
    'role-adapters.test.ts',
    'role-objectives.test.ts',
    'role-policy.test.ts',
    'score-authority.test.ts',
    'score-layer.test.ts',
    'scorer-situation-surface.test.ts',
  ]),
  eval: Object.freeze([
    'active-language-eval.test.ts',
    'architecture-bank.test.ts',
    'architecture-baselines.test.ts',
    'architecture-eval.test.ts',
    'composed-agent-spec.test.ts',
    'decision-fixtures.test.ts',
    'eval.test.ts',
    'good-policy-bench.test.ts',
    'good-policy-diagnosis.test.ts',
    'quest-factor.test.ts',
    'replay-timeline.test.ts',
    'replay.test.ts',
    'role-eval.test.ts',
    'role-report.test.ts',
    'seat-view-inspector-ui.test.ts',
    'seat-view-inspector.test.ts',
    'vote-conversion.test.ts',
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
