// test-lane: contract
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  communicationDirectionFailure,
  directionChannelFor,
  validCommunicationDirection,
  type CommunicationDirectionContext,
} from '../server/agents/communication/direction-contract.ts'
import {
  validStrategicIntent,
} from '../server/agents/communication/strategic-intent-contract.ts'
import {
  COMMUNICATION_INTENT_VERSION,
  STRATEGIC_INTENT_VERSION,
} from '../server/agents/policy/plan.ts'
import {
  CompositionInvariantError,
  roleAdapterAttributions,
} from '../server/agents/policy/role-adapter-attribution.ts'
import {
  MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT,
  MORGANA_ROLE_UTILITY_COMPONENT,
} from '../server/agents/components/native-score-components.ts'
import {
  ROLE_UTILITY_PROJECTION_VERSION,
} from '../server/agents/analysis/role-utility.ts'
import {
  MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
} from '../server/agents/analysis/morgana-role-utility.ts'
import type {
  CandidateScore,
  CandidateScorer,
} from '../server/agents/policy/score.ts'

/*
 * The direction contract is the one place three boundaries agree on what a
 * planner may say: the reply parser, the in-process planner seam, and trace
 * admission. These tests pin the two things that made three copies dangerous,
 * namely that the capability a caller omits is the only check it loses, and
 * that a malformed value produces a verdict rather than an exception.
 */

function direction(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: COMMUNICATION_INTENT_VERSION,
    channel: 'discussion',
    targetSeats: [],
    actCodes: ['ADVOCATE_SELECTED_ACTION'],
    evidenceRefs: [],
    tone: 'natural',
    ...overrides,
  }
}

const KNOWS_NOTHING: CommunicationDirectionContext = {
  allowedChannels: ['discussion', 'proposal-pitch', 'revision-reason'],
}

const KNOWS_EVERYTHING: CommunicationDirectionContext = {
  allowedChannels: ['discussion'],
  seatExists: (seat) => seat >= 0 && seat < 5,
  rolesInPlay: ['merlin', 'percival', 'servant', 'morgana', 'assassin'],
  evidenceExists: (reference) =>
    reference.kind === 'quest' && reference.questNum === 1,
}

test('a well-formed direction passes at every level of knowledge', () => {
  assert.equal(communicationDirectionFailure(direction(), KNOWS_NOTHING), undefined)
  assert.equal(
    communicationDirectionFailure(direction(), KNOWS_EVERYTHING),
    undefined,
  )
  assert.ok(validCommunicationDirection(direction(), KNOWS_EVERYTHING))
})

test('a malformed act list is a verdict, never an exception', () => {
  // The in-process copy of this validator derived "does this act set need
  // targets" before proving actCodes was an array, so a string here threw a
  // TypeError out of the validator and the planner's whole choice was
  // discarded as a planner fault. Every shape check now precedes every
  // question asked of the shape.
  for (const actCodes of ['PASS', 42, null, {}, [], ['PASS', 'PASS']]) {
    assert.equal(
      communicationDirectionFailure(direction({ actCodes }), KNOWS_NOTHING),
      'act-codes',
      `actCodes ${JSON.stringify(actCodes)}`,
    )
  }
  for (const targetSeats of ['0', 7.5, null, [0, 0], [-1]]) {
    assert.equal(
      communicationDirectionFailure(
        direction({ targetSeats, actCodes: ['EXPRESS_TRUST'] }),
        KNOWS_NOTHING,
      ),
      'target-seats',
      `targetSeats ${JSON.stringify(targetSeats)}`,
    )
  }
  assert.equal(
    communicationDirectionFailure('not a record', KNOWS_NOTHING),
    'not-a-record',
  )
  assert.equal(
    communicationDirectionFailure(direction({ extra: 1 }), KNOWS_NOTHING),
    'unknown-key',
  )
})

test('an omitted capability is the only check a caller loses', () => {
  const unknownSeat = direction({
    actCodes: ['EXPRESS_SUSPICION'],
    targetSeats: [9],
  })
  assert.equal(communicationDirectionFailure(unknownSeat, KNOWS_NOTHING), undefined)
  assert.equal(
    communicationDirectionFailure(unknownSeat, KNOWS_EVERYTHING),
    'unknown-seat',
  )

  const undealtRole = direction({
    actCodes: ['CLAIM_ROLE'],
    claimedRole: 'oberon',
  })
  assert.equal(communicationDirectionFailure(undealtRole, KNOWS_NOTHING), undefined)
  assert.equal(
    communicationDirectionFailure(undealtRole, KNOWS_EVERYTHING),
    'claimed-role',
  )

  const uncheckableFact = direction({
    evidenceRefs: [{ kind: 'quest', questNum: 3 }],
  })
  assert.equal(
    communicationDirectionFailure(uncheckableFact, KNOWS_NOTHING),
    undefined,
  )
  assert.equal(
    communicationDirectionFailure(uncheckableFact, KNOWS_EVERYTHING),
    'evidence-unknown',
  )
})

test('evidence coordinates are bounded by the rules for every caller', () => {
  const cases: Array<[string, unknown]> = [
    ['round below the first quest', { kind: 'proposal', round: 0, proposalNum: 1 }],
    ['proposal past the hammer', { kind: 'proposal', round: 1, proposalNum: 6 }],
    ['quest past the board', { kind: 'quest', questNum: 6 }],
    ['negative source', { kind: 'utterance', sourceSeq: -1 }],
    ['absent coordinate', { kind: 'quest' }],
    ['unknown kind', { kind: 'whisper', sourceSeq: 1 }],
    ['extra key', { kind: 'quest', questNum: 1, seat: 0 }],
  ]
  for (const [label, reference] of cases) {
    assert.equal(
      communicationDirectionFailure(
        direction({ evidenceRefs: [reference] }),
        KNOWS_NOTHING,
      ),
      'evidence-malformed',
      label,
    )
  }
  assert.equal(
    communicationDirectionFailure(
      direction({
        evidenceRefs: [
          { kind: 'quest', questNum: 1 },
          { kind: 'quest', questNum: 1 },
        ],
      }),
      KNOWS_NOTHING,
    ),
    'evidence-refs',
    'a fact cited twice',
  )
  assert.equal(
    communicationDirectionFailure(
      direction({
        evidenceRefs: [
          { kind: 'proposal', round: 1, proposalNum: 2 },
          { proposalNum: 2, kind: 'proposal', round: 1 },
        ],
      }),
      KNOWS_NOTHING,
    ),
    'evidence-refs',
    'the same fact with its keys in a different order is still one fact',
  )
  assert.equal(
    communicationDirectionFailure(
      direction({
        evidenceRefs: Array.from(
          { length: 9 },
          (_, index) => ({ kind: 'utterance', sourceSeq: index }),
        ),
      }),
      KNOWS_NOTHING,
    ),
    'evidence-refs',
    'more citations than the bound',
  )
})

test('the act set commits the speaker to the rest of the direction', () => {
  assert.equal(
    communicationDirectionFailure(
      direction({ actCodes: ['PASS'], targetSeats: [1] }),
      KNOWS_NOTHING,
    ),
    'pass-not-exclusive',
  )
  assert.equal(
    communicationDirectionFailure(
      direction({ actCodes: ['EXPRESS_SUSPICION'] }),
      KNOWS_NOTHING,
    ),
    'missing-targets',
  )
  assert.equal(
    communicationDirectionFailure(
      direction({ actCodes: ['ADVOCATE_SELECTED_ACTION'], claimedRole: 'merlin' }),
      KNOWS_NOTHING,
    ),
    'claimed-role',
    'a role claimed by no act',
  )
  assert.equal(
    communicationDirectionFailure(
      direction({
        actCodes: ['WARN_ROLE_EXPOSURE'],
        roleTopic: 'percival',
      }),
      KNOWS_NOTHING,
    ),
    'role-exposure-topic',
    'the exposure warning is about Merlin or it is not that act',
  )
})

test('a channel admits only its own acts, and only when the action speaks', () => {
  assert.equal(
    communicationDirectionFailure(
      direction({ channel: 'proposal-pitch', actCodes: ['EXPRESS_SUSPICION'], targetSeats: [1] }),
      KNOWS_NOTHING,
    ),
    'act-not-on-channel',
  )
  // A finalize that sticks says nothing, so it allows no channel at all.
  assert.equal(directionChannelFor('finalize', true), undefined)
  assert.equal(directionChannelFor('finalize', false), 'revision-reason')
  assert.equal(directionChannelFor('vote', undefined), undefined)
  assert.equal(
    communicationDirectionFailure(direction(), { allowedChannels: [] }),
    'channel',
  )
})

test('the trace boundary admits its own keys and no others', () => {
  const intent = direction({
    safeFactCodes: [],
    conceal: [],
    strategicReasonCodes: [],
  })
  assert.equal(
    communicationDirectionFailure(intent, KNOWS_NOTHING),
    'unknown-key',
  )
  assert.equal(
    communicationDirectionFailure(intent, {
      ...KNOWS_NOTHING,
      additionalKeys: [
        'safeFactCodes',
        'conceal',
        'strategicReasonCodes',
        'uncertainty',
      ],
    }),
    undefined,
  )
})

test('strategic intent shares bounded evidence and optional host joins', () => {
  const intent = {
    version: STRATEGIC_INTENT_VERSION,
    objective: 'TEST_PLAYER',
    targetSeats: [1],
    horizon: 'CURRENT_PROPOSAL',
    evidenceRefs: [{ kind: 'quest', questNum: 1 }],
  }
  assert.ok(validStrategicIntent(intent))
  assert.ok(validStrategicIntent(intent, KNOWS_EVERYTHING))
  assert.equal(validStrategicIntent({ ...intent, targetSeats: [9] }, {
    seatExists: KNOWS_EVERYTHING.seatExists,
  }), false)
  assert.equal(validStrategicIntent({
    ...intent,
    evidenceRefs: [{ kind: 'quest', questNum: 3 }],
  }, KNOWS_EVERYTHING), false)
  assert.equal(validStrategicIntent({
    ...intent,
    evidenceRefs: [
      { kind: 'proposal', round: 1, proposalNum: 2 },
      { proposalNum: 2, kind: 'proposal', round: 1 },
    ],
  }), false)
})

/*
 * The role adapter table. The defect it closes is that the attribution list and
 * the list the attribution was checked against were written separately and had
 * drifted by one component, so the Morgana public read was attributed and never
 * verified.
 */

function scorerRequiring(
  requirements: Partial<CandidateScorer>,
): CandidateScorer {
  return {
    version: 'test-scorer',
    score: () => [],
    ...requirements,
  } as unknown as CandidateScorer
}

function scoreWith(features: Record<string, unknown>): CandidateScore {
  return {
    candidateId: 'candidate',
    value: 0,
    viable: true,
    ...features,
  } as unknown as CandidateScore
}

test('every attributed component is also verified', () => {
  const rows = roleAdapterAttributions(
    scorerRequiring({
      roleUtilityRequirement: ROLE_UTILITY_PROJECTION_VERSION,
      morganaRoleUtilityRequirement: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
    }),
    [scoreWith({
      roleObjectiveFeatures: {},
      morganaRoleObjectiveFeatures: {},
    })],
    MORGANA_ROLE_UTILITY_COMPONENT,
  )
  for (const row of rows) {
    for (const token of row.attribute) {
      assert.ok(
        row.verify.includes(token),
        `${token.id} is attributed but never checked`,
      )
    }
  }
  const morgana = rows.find((row) => row.used
    && row.attribute.includes(MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT))
  assert.ok(morgana, 'the Morgana row reports its projection as used')
  assert.ok(
    morgana.verify.includes(MORGANA_COUNTERFEIT_PUBLIC_READ_COMPONENT),
    'the public read is the component the two lists disagreed about',
  )
})

test('a used Morgana projection with no configured token is our own fault', () => {
  assert.throws(
    () => roleAdapterAttributions(
      scorerRequiring({
        morganaRoleUtilityRequirement: MORGANA_ROLE_UTILITY_PROJECTION_VERSION,
      }),
      [scoreWith({ morganaRoleObjectiveFeatures: {} })],
      undefined,
    ),
    CompositionInvariantError,
    'the non-null assertion this replaced dereferenced the absent token',
  )
})

test('an unused family attributes nothing and still gets checked', () => {
  const rows = roleAdapterAttributions(
    scorerRequiring({}),
    [scoreWith({})],
    undefined,
  )
  assert.ok(rows.every((row) => !row.used))
  assert.ok(rows.every((row) => row.verify.length > 0))
})
