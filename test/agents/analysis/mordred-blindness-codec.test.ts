// test-lane: contract

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalizeJson,
  DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES,
} from '../../../server/agents/canonical/canonical-json.ts'
import {
  canonicalCombinations,
} from '../../../server/agents/canonical/canonical-shape.ts'
import {
  decodeCanonicalPrivateMordredBlindnessObjective,
} from '../../../server/agents/analysis/mordred-blindness.ts'
import {
  ACTOR_TARGET_TREATMENT_READ_VERSION,
} from '../../../server/agents/analysis/actor-target-treatment-types.ts'
import {
  MORDRED_BLINDNESS_OBJECTIVE_VERSION,
} from '../../../server/agents/analysis/mordred-blindness-types.ts'
import {
  PUBLIC_OBSERVER_MODEL_VERSION,
} from '../../../server/agents/analysis/observer-types.ts'

function canonicalPayload() {
  const assessments = canonicalCombinations(5, 2).map((seats) => ({
    team: {
      teamId: `team:${seats.join(',')}`,
      requestContext: 'propose' as const,
      seats,
    },
    probabilitySemantics: 'resolved-complete-world-joint-sums' as const,
    jointSemantics: 'direct-joint-world-sums-no-marginal-products' as const,
    visibleEvilCountDistribution: [1, 0, 0],
    totalEvilCountDistribution: [1, 0, 0],
    merlinBlindWindowProbability: 0,
    hiddenThresholdCrossingProbability: 0,
    treatmentObservationAvailable: false,
    anomalousBlindWindowMass: 0,
    observationSemantics:
      'no-public-observation-is-zero-signal-not-innocence' as const,
    policySemantics: 'team-opportunity-not-action-utility' as const,
    opportunityValueSemantics:
      'bounded-heuristic-nonprobability-three-quarters-hidden-crossing-one-quarter-anomalous-window' as const,
    opportunityValue: 0,
  }))
  return canonicalizeJson({
    version: MORDRED_BLINDNESS_OBJECTIVE_VERSION,
    role: 'mordred',
    source: {
      beliefModelVersion: 'test-belief-v1',
      beliefThroughSeq: -1,
      beliefQuality: 'constraints-only',
      playerCount: 5,
      rolesInPlay: ['assassin', 'merlin', 'mordred', 'servant', 'servant'],
      treatmentReadVersion: ACTOR_TARGET_TREATMENT_READ_VERSION,
      observerModelVersion: PUBLIC_OBSERVER_MODEL_VERSION,
      observerFeasibleWorldCount: 1,
      worldSemantics: 'resolved-weighted-complete-worlds',
      promotionSemantics: 'constraints-only-exact-weighted-structural',
    },
    request: {
      seat: 4,
      kind: 'propose',
      round: 1,
      proposalNum: 1,
      failsRequired: 1,
    },
    merlinHypotheses: [0, 1, 2, 3].map((seat) => ({
      seat,
      hypothesisSemantics:
        'legal-world-merlin-coordinate-not-privileged-identity',
      worldMass: 0.25,
      observationCoverageMass: 0,
      anomalousTreatmentMass: 0,
      conditionalAnomalousTreatmentIndex: null,
    })),
    assessments,
  }, DEFAULT_COMPONENT_PAYLOAD_JSON_BYTES)
}

test('canonical Mordred decoding accepts valid semantics and rejects forgery', () => {
  const canonical = canonicalPayload()
  assert.ok(canonical.ok)
  if (!canonical.ok) return
  assert.ok(decodeCanonicalPrivateMordredBlindnessObjective(canonical.payload))

  const forged = structuredClone(canonical.payload)
  const assessments = (forged as unknown as {
    assessments: Array<Record<string, unknown>>
  }).assessments
  assessments[0]!.opportunityValue = 0.5
  assert.equal(
    decodeCanonicalPrivateMordredBlindnessObjective(forged),
    undefined,
  )
})
