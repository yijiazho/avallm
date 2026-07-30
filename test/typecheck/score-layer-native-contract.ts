import type {
  ScoreLayerRowDraft,
  ScoreLayerRunLease,
  ScoreLayerSurface,
  ScoreLayerSurfaceDraft,
  ScoreLayerToken,
  ScoreLayerTransformResult,
} from '../../server/agents/policy/score-layer/types.ts'
import type {
  DecisionLayerToken,
} from '../../server/agents/policy/decision-layer/types.ts'
import type {
  PreparedNativeScoreLayers,
} from '../../server/agents/policy/decision-frame.ts'

const row: ScoreLayerRowDraft = {
  candidateId: 'candidate',
  value: 1,
  viable: true,
  reasonCodes: [],
}

const draft: ScoreLayerSurfaceDraft = {
  scores: [row],
  survivorCandidateIds: ['candidate'],
}

const degraded: ScoreLayerTransformResult = { status: 'degraded' }

declare const lease: ScoreLayerRunLease
declare const admittedSurface: ScoreLayerSurface
lease.requirements
admittedSurface.version

// @ts-expect-error A run lease cannot be structurally forged.
const forgedRunLease: ScoreLayerRunLease = {
  version: 'score-layer-run-lease-v1',
  requirements: [],
}

// Score and strategic layers mint their tokens from one branded implementation.
// Both halves of that brand are contracts: the brand symbol is module-private,
// so a token cannot be assembled from plain coordinates, and the family
// parameter keeps one family's token from satisfying the other's.
// @ts-expect-error A score-layer token cannot be structurally forged.
const forgedScoreLayerToken: ScoreLayerToken = {
  id: 'layer',
  version: 'v1',
}

declare const strategicToken: DecisionLayerToken
// @ts-expect-error A strategic token is not a score-layer token.
const crossFamilyToken: ScoreLayerToken = strategicToken

declare const scoringToken: ScoreLayerToken
// @ts-expect-error A score-layer token is not a strategic token.
const crossFamilyReverse: DecisionLayerToken = scoringToken

// The native preparation record is deliberately plain data, so the brand that
// still matters is the run capability it carries: a preparation cannot be
// assembled around a structurally forged run lease.
declare const brain: PreparedNativeScoreLayers['brain']
declare const request: PreparedNativeScoreLayers['request']
declare const view: PreparedNativeScoreLayers['view']
declare const legalCandidates: PreparedNativeScoreLayers['legalCandidates']
const forgedNativePreparation: PreparedNativeScoreLayers = {
  version: 'native-score-layer-preparation-v1',
  requirements: [],
  brain,
  request,
  view,
  legalCandidates,
  // @ts-expect-error The carried run capability cannot be forged.
  run: { version: 'score-layer-run-lease-v1', requirements: [] },
}

const rowWithProducerVersion: ScoreLayerRowDraft = {
  // @ts-expect-error Producer identity belongs to the layer journal.
  version: 'family-scorer-v1',
  candidateId: 'candidate',
  value: 1,
  viable: true,
  reasonCodes: [],
}

const secondApplicabilityGate: ScoreLayerTransformResult = {
  // @ts-expect-error Transform execute cannot declare inapplicability.
  status: 'inapplicable',
}

// @ts-expect-error The public lease exposes no execution authority.
lease.run(draft)

void degraded
void forgedRunLease
void forgedScoreLayerToken
void crossFamilyToken
void crossFamilyReverse
void forgedNativePreparation
void rowWithProducerVersion
void secondApplicabilityGate
