// test-lane: contract
// ADMIT-001: the host rebuilds the belief a trace says it used.
//
// Admission proves a decision by recomputing it, and the recomputation used to
// name the uniform belief literally. That was the same thing as "the model this
// trace used" only while the uniform model was the only one anything ran. A
// decision made on the quest-weighted belief was recomputed against a uniform
// posterior, disagreed, and was refused as a forgery.
//
// Widening a trust boundary is only safe if the widening is bounded, so these
// tests are mostly about what still gets refused. The closed list is the
// property: a model is reconstructible only if the host can rebuild it from the
// view alone, and a trace cannot talk its way onto that list.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createComposedAgent } from '../../../server/agents/composed.ts'
import { composedBrainOptions } from '../../../server/agents/registry.ts'
import {
  admitDecisionTrace,
} from '../../../server/agents/admission/composed-trace.ts'
import {
  revalidatedArchitectureIdentity,
} from '../../../server/agents/components/resolved-brain.ts'
import {
  questWeightedBeliefModel,
  QUEST_WEIGHTED_BELIEF_VERSION,
  QUEST_FACTOR_BUNDLE_VERSION,
} from '../../../server/agents/belief/quest-card-factor.ts'
import {
  exactWorldBeliefModel,
} from '../../../server/agents/belief/exact.ts'
import {
  voteMatrixWeightedBeliefModel,
} from '../../../server/agents/belief/vote-matrix-factor.ts'
import {
  LANGUAGE_WEIGHTED_BELIEF_VERSION,
} from '../../../server/agents/belief/language-factor.ts'
import {
  hostReconstructibleBeliefModel,
} from '../../../server/agents/belief/host-reconstructible.ts'
import {
  readDecisionFixtures,
} from '../../../server/eval/replay/decision-fixtures.ts'
import { mutableClone } from '../../support/mutable.ts'

const SEED = 'admit-001-contract'

function fixture() {
  const found = readDecisionFixtures().find(
    ({ id }) => id === 'merlin-opening-proposal',
  )
  assert.ok(found, 'the opening-proposal fixture must exist')
  return found
}

async function admitOn(beliefModel?: typeof questWeightedBeliefModel) {
  const target = fixture()
  const agent = createComposedAgent({
    seed: SEED,
    ...composedBrainOptions('full-role'),
    ...(beliefModel ? { beliefModel } : {}),
  })
  const output = await agent.decide(target.req, target.view)
  const identity = revalidatedArchitectureIdentity(
    agent.resolvedBrain().description,
  )
  const admit = (trace: unknown) => admitDecisionTrace({
    kind: 'finalized-artifact',
    trace,
    req: target.req,
    view: target.view,
    authoritativeAction: output.decision,
    selectedDecision: output.decision,
    deterministicSeed: SEED,
    expectedArchitectureIdentity: identity,
  })
  return { output, admit }
}

test('the reconstructible list is derived from the models themselves', () => {
  // Keyed off each model's own reported version, so a model cannot be listed
  // under a version it does not actually report.
  // Every model the host can rebuild from a view alone, seated or not.
  // Membership follows the criterion rather than what production happens to
  // run, so adding a factor cannot silently reproduce ADMIT-001.
  for (const model of [
    exactWorldBeliefModel,
    questWeightedBeliefModel,
    voteMatrixWeightedBeliefModel,
  ]) {
    assert.equal(hostReconstructibleBeliefModel(model.version), model)
  }
  // And the quest model reports the version the rest of the tree names it by,
  // which is what makes the key derivation above meaningful rather than
  // circular.
  assert.equal(questWeightedBeliefModel.version, QUEST_WEIGHTED_BELIEF_VERSION)
  assert.equal(
    questWeightedBeliefModel.factorsVersion,
    QUEST_FACTOR_BUNDLE_VERSION,
  )
})

test('a language-weighted belief is refused, not merely unimplemented', () => {
  // Its version is composed at runtime from whatever mechanical belief sits
  // underneath, and rebuilding it needs interpreted language evidence no host
  // holds. That makes it unreconstructible by definition rather than missing.
  assert.equal(
    hostReconstructibleBeliefModel(LANGUAGE_WEIGHTED_BELIEF_VERSION),
    undefined,
  )
  assert.equal(hostReconstructibleBeliefModel('not-a-model-v1'), undefined)
  assert.equal(hostReconstructibleBeliefModel(''), undefined)
})

// The defect ADMIT-001 exists to fix.
test('a quest-weighted decision admits exactly and is promotable', async () => {
  const { output, admit } = await admitOn(questWeightedBeliefModel)
  assert.equal(output.trace?.beliefModelVersion, QUEST_WEIGHTED_BELIEF_VERSION)
  const admission = admit(output.trace)
  assert.equal(
    admission.kind,
    'trusted-exact',
    'a decision on a host-reconstructible belief must verify exactly',
  )
  assert.equal(admission.promotionEvidenceEligible, true)
})

test('the uniform path is unchanged', async () => {
  const { admit, output } = await admitOn()
  const admission = admit(output.trace)
  assert.equal(admission.kind, 'trusted-exact')
  assert.equal(admission.promotionEvidenceEligible, true)
})

// The widening must not let a trace buy trust by relabelling itself. Each of
// these keeps a genuine decision's content and changes only what it CLAIMS
// about the belief that produced it.
test('a trace cannot claim a belief it did not use', async () => {
  const { output, admit } = await admitOn(questWeightedBeliefModel)

  // Claim the cheaper model while carrying quest-weighted content.
  const downgraded = mutableClone(output.trace!)
  downgraded.beliefModelVersion = exactWorldBeliefModel.version
  assert.equal(admit(downgraded).kind, 'rejected')

  // Keep the belief version but claim the factor bundle was off, which is the
  // pairing the host input gate checks: a model and a factors version that do
  // not belong together must not both be believed.
  const mismatchedFactors = mutableClone(output.trace!)
  mismatchedFactors.componentVersions!.factors = 'off'
  assert.equal(admit(mismatchedFactors).kind, 'rejected')

  // Component graph and trace disagreeing about the belief itself.
  const mismatchedBelief = mutableClone(output.trace!)
  mismatchedBelief.componentVersions!.belief = exactWorldBeliefModel.version
  assert.equal(admit(mismatchedBelief).kind, 'rejected')

  // A quality the host's own rebuild does not produce from this view.
  const forgedQuality = mutableClone(output.trace!)
  forgedQuality.quality = 'weighted'
  assert.equal(admit(forgedQuality).kind, 'rejected')
})

test('an unreconstructible model is still refused a rebuilt belief', async () => {
  const { output, admit } = await admitOn(questWeightedBeliefModel)
  // A model name the host has never heard of cannot be talked onto the list,
  // and naming one does not make the trace admit.
  const invented = mutableClone(output.trace!)
  invented.beliefModelVersion = 'attacker-favourable-v1'
  invented.componentVersions!.belief = 'attacker-favourable-v1'
  invented.componentVersions!.factors = QUEST_FACTOR_BUNDLE_VERSION
  assert.equal(admit(invented).kind, 'rejected')
})
