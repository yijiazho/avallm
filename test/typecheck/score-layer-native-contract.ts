import type {
  ScoreLayerRowDraft,
  ScoreLayerRunLease,
  ScoreLayerSurface,
  ScoreLayerSurfaceDraft,
  ScoreLayerTransformResult,
} from '../../server/agents/policy/score-layer/types.ts'
import type {
  NativeScoreLayerLease,
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

// @ts-expect-error A native lease cannot be structurally forged.
const forgedNativeLease: NativeScoreLayerLease = {
  version: 'native-score-layer-lease-v1',
  requirements: [],
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
void forgedNativeLease
void rowWithProducerVersion
void secondApplicabilityGate
