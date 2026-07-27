import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeSituation } from '../server/agents/analysis/situation.ts'
import { reconstructCognition } from '../server/agents/cognition/state.ts'
import { renderBeliefSummary } from '../server/agents/communication/belief-summary.ts'
import { createDecisionTrace } from '../server/agents/trace.ts'
import { readDecisionFixtures } from '../server/eval/decision-fixtures.ts'

test('every frozen Phase 0 decision view deterministically reconstructs Phase 2 state', () => {
  for (const fixture of readDecisionFixtures()) {
    const first = reconstructCognition(fixture.view)
    const second = reconstructCognition(fixture.view)
    assert.deepEqual(second, first, fixture.id)
    const analysis = analyzeSituation(fixture.view, {
      belief: first.belief,
      evidence: first.evidence,
      candidateTeams: fixture.view.currentTeam ? [fixture.view.currentTeam] : [],
    })
    const rendered = renderBeliefSummary(fixture.view, first.belief, analysis)
    const trace = createDecisionTrace(
      fixture.req,
      fixture.view,
      first.belief,
      analysis,
      fixture.baselineDecision,
    )
    assert.equal(
      first.throughSeq,
      fixture.view.events.reduce(
        (cursor, event) => Math.max(cursor, event.seq),
        -1,
      ),
      fixture.id,
    )
    assert.ok(first.throughSeq < fixture.source.seq, fixture.id)
    assert.equal(analysis.throughSeq, first.throughSeq, fixture.id)
    assert.equal(trace.beliefThroughSeq, first.throughSeq, fixture.id)
    assert.match(rendered, new RegExp(`visible event cursor ${first.throughSeq}`), fixture.id)
    assert.deepEqual(
      createDecisionTrace(
        fixture.req,
        fixture.view,
        second.belief,
        analysis,
        fixture.baselineDecision,
      ),
      trace,
      fixture.id,
    )
  }
})
