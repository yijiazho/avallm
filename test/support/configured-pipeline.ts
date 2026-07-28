import type {
  ResolvedConfiguredPipeline,
} from '../../server/agents/components/resolved-brain.ts'

/**
 * Explicit graph-test host metadata. Component resolver tests exercise graph
 * behavior outside createComposedAgent, so they must not inherit an implicit
 * production pipeline.
 */
export function testConfiguredPipeline(): ResolvedConfiguredPipeline {
  return {
    belief: {
      model: 'test-belief-v1',
      factors: 'off',
      languageInterpreter: 'off',
      languageFactor: 'test-language-factor-v1',
    },
    analysis: {
      situation: 'test-analysis-v1',
    },
    candidateGeneration: {
      legalCandidates: 'test-candidates-v1',
    },
    forcedPolicy: {
      policy: 'test-forced-policy-v1',
    },
    scoring: {
      configuredScorer: 'test-scorer-v1',
      configuredBaseChain: ['test-fallback-v1'],
      invalidOutputFallback: 'test-hard-fallback-v1',
    },
    planning: {
      protocol: 'test-planner-protocol-v1',
      decisionPlan: 'test-decision-plan-v1',
    },
    prompt: {
      prompt: 'test-prompt-v1',
      renderer: 'test-renderer-v1',
    },
    communication: {
      intent: 'test-intent-v1',
      voiceProtocol: 'test-voice-protocol-v1',
    },
    planCoherence: {
      memory: 'off',
      model: 'off',
      intent: 'maintain',
    },
  }
}
