// Which safety reader an artifact gets, and the guarantee that it gets exactly
// one.
//
// The dispatch is three lines, and it is a module rather than a line inside
// either reader because that is what makes the exclusivity structural: a
// descriptor-admitted artifact is read by safety-current.ts and by nothing
// else, and no failure inside that reader can quietly retry through the legacy
// path. Both readers are imported here and neither imports the other, so the
// fallback is not spellable.

import type {
  ArchitectureRunMetadata,
  GameArtifact,
} from '../core/artifact.ts'
import type {
  DecisionTraceSnapshotResult,
} from '../../agents/admission/composed-trace.ts'
import type {
  ArchitectureSafetyAdmission,
  ArtifactArchitectureAdmission,
} from './types.ts'
import {
  currentArchitectureSafety,
} from './safety-current.ts'
import {
  legacyArchitectureSafety,
} from './safety-legacy.ts'

export function architectureSafety(
  artifact: GameArtifact,
  meta: ArchitectureRunMetadata,
  admission: ArtifactArchitectureAdmission,
  traceCandidates: readonly DecisionTraceSnapshotResult[],
): ArchitectureSafetyAdmission {
  return admission.provenance === 'descriptor-host-manifest-admitted'
    ? currentArchitectureSafety(artifact, meta, admission, traceCandidates)
    : legacyArchitectureSafety(
        artifact,
        meta,
        admission,
        traceCandidates,
      )
}
