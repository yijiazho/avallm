/**
 * Which admitted components the selected action is attributable to.
 *
 * Selection happens inside the decision frame, but the frame cannot answer this
 * on its own: it knows the chosen candidate, not which components fed the score
 * that made it choosable. The answer is derived here, from the run's own
 * candidate-score policy use, so the action-selection attribution can never name
 * a component the scoring stage did not already credit. It is a callback into
 * selectDecisionCandidate rather than a step after it because attribution has to
 * be written into the same run the selection records.
 */
import {
  attributeComponentPolicyUseBatch,
  type DecisionComponentRun,
} from '../components/kernel.ts'

export function attributeRoleActionSelection(
  run: DecisionComponentRun,
): DecisionComponentRun {
  const selected = new Set(
    run.policyUse
      .filter((entry) =>
        entry.used && entry.stages.includes('candidate-score'))
      .map((entry) =>
        `${entry.component.id}@${entry.component.version}`),
  )
  const tokens = run.entries.flatMap((entry) =>
    entry.status === 'admitted'
    && selected.has(`${entry.component.id}@${entry.component.version}`)
      ? [{
          ...entry.component,
          kind: entry.kind,
          privacy: entry.privacy,
        }]
      : [])
  return attributeComponentPolicyUseBatch(
    run,
    tokens,
    'action-selection',
  ).run
}
