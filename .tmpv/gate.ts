import { createComposedAgent } from '../server/agents/composed.ts'
import { fullRolePolicyScorer, CANDIDATE_SCORER_VERSION } from '../server/agents/policy/score.ts'
import { questWeightedBeliefModel, QUEST_WEIGHTED_BELIEF_VERSION, QUEST_FACTOR_BUNDLE_VERSION } from '../server/agents/belief/quest-card-factor.ts'
import { voteMatrixWeightedBeliefModel, VOTE_MATRIX_WEIGHTED_BELIEF_VERSION, VOTE_MATRIX_BUNDLE_VERSION } from '../server/agents/belief/vote-matrix-factor.ts'
import { PUBLIC_OBSERVER_MODEL_VERSION } from '../server/agents/analysis/observer-types.ts'
import { EVIL_QUEST_ROBUST_POLICY_VERSION } from '../server/agents/policy/evil-quest-card.ts'
import { runWideGoodGate } from '../server/eval/harness/wide-good-gate.ts'
import { renderArchitectureReport } from '../server/eval/architecture-report.ts'
import type { ArchitectureVariant } from '../server/eval/harness/architecture-bench.ts'
const EVAL = 'vote-matrix-gate-v1'
const base = (belief: string, factors: string, role: string) => ({
  evaluation: EVAL, evaluationRole: role, brain: 'brain-spec-v1', belief, factors,
  policy: 'composed-policy-v1', scorer: fullRolePolicyScorer.version,
  planner: 'planner-off', voice: 'voice-off',
  observerModel: PUBLIC_OBSERVER_MODEL_VERSION,
  evilQuestCardPolicy: EVIL_QUEST_ROBUST_POLICY_VERSION,
  populationAssumption: 'heterogeneous-independent',
})
const arm = (id: string, belief: string, factors: string, role: string, model: any): ArchitectureVariant => ({
  id, paid: false, components: base(belief, factors, role),
  createTargetAgent: (c) => createComposedAgent({
    seed: c.seed, scorer: fullRolePolicyScorer, roleObjectiveRouter: true,
    evilQuestCardPolicy: 'robust-heterogeneous', beliefModel: model, onDecisionTrace: c.onDecisionTrace,
  }),
})
const variants: ArchitectureVariant[] = [
  arm('shipped-quest-weighted', QUEST_WEIGHTED_BELIEF_VERSION, QUEST_FACTOR_BUNDLE_VERSION, 'baseline', questWeightedBeliefModel),
  arm('vote-weighted', VOTE_MATRIX_WEIGHTED_BELIEF_VERSION, VOTE_MATRIX_BUNDLE_VERSION, 'candidate', voteMatrixWeightedBeliefModel),
  {
    id: 'compatibility', paid: false,
    components: { evaluation: EVAL, evaluationRole: 'reference', brain: 'brain-spec-v1',
      belief: 'exact-constraints-v1', factors: 'off', policy: 'composed-policy-v1',
      scorer: CANDIDATE_SCORER_VERSION, planner: 'planner-off', voice: 'voice-off' },
    createTargetAgent: (c) => createComposedAgent({ seed: c.seed, onDecisionTrace: c.onDecisionTrace }),
  },
]
for (const population of ['heuristic', 'random'] as const) {
  const r = await runWideGoodGate({
    targetRole: 'servant', population, variants,
    out: `data/eval/vm-gate-servant-${population}.jsonl`,
    onProgress: (l) => { if (!/^\d/.test(l)) console.log(l) },
  })
  console.log(`\n########## VOTE-MATRIX GATE, servant, ${population}`)
  console.log(renderArchitectureReport(r))
}
