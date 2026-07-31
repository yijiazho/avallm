/**
 * The three private reads a decision performs before any candidate is scored:
 * advancing cognition, projecting identity, and observing the public record.
 *
 * They belong together because each is a place where a failure must not become
 * the decision's failure, and each expresses that the same way: return the state
 * to continue from instead of mutating one. Written inline in decide() they were
 * branches assigning shared mutable locals, which is exactly the shape that lets
 * a half-applied projection survive a catch. Returning the next state makes the
 * "a failed read leaves cognition exactly as it was" invariant readable at the
 * call site rather than inferable from the order of assignments.
 */
import type { PlayerView } from '../../engine/types.ts'
import { observePublicRecord } from '../analysis/observer.ts'
import type {
  PublicObserverSnapshot,
} from '../analysis/observer-types.ts'
import {
  JOINT_IDENTITY_MODEL_VERSION,
  projectJointIdentity,
  type IdentityProjectionScope,
  type PrivateIdentitySnapshot,
} from '../belief/identity.ts'
import {
  applyBoundedLanguageEvidence,
  languageBeliefPipelineVersion,
  type LanguageLikelihoodFactor,
} from '../belief/language-factor.ts'
import type { BeliefModel } from '../belief/types.ts'
import {
  advanceCognition,
  advanceCognitionFromBelief,
} from '../cognition/state.ts'
import type { CognitionState } from '../cognition/types.ts'
import {
  orchestrateLanguageEvidence,
  type LanguageTraceAttribution,
} from '../communication/language-orchestration.ts'
import type {
  LanguageInterpreter,
  LanguageInterpreterInput,
} from '../record/language-types.ts'
import { projectPublicRecord } from '../record/public-record.ts'

/**
 * Project the acting seat's private identity posterior for one decision.
 *
 * Returns the cognition state to continue from instead of mutating one. A failed
 * projection has to leave cognition exactly as it was, carrying only a
 * degradation code, and that invariant is easy to misread when the success path
 * assigns a shared local from inside a try block.
 */
export function projectDecisionIdentity(
  cognition: CognitionState,
  scope: IdentityProjectionScope,
): Readonly<{
  cognition: CognitionState
  identity?: PrivateIdentitySnapshot
  degradation: readonly string[]
}> {
  try {
    const identity = projectJointIdentity(cognition.belief, scope)
    return {
      cognition: {
        ...cognition,
        identity,
        versions: {
          ...cognition.versions,
          identityModel: JOINT_IDENTITY_MODEL_VERSION,
        },
      },
      identity,
      degradation: [],
    }
  } catch {
    return { cognition, degradation: ['identity-projection-failed'] }
  }
}

/**
 * The seat's public-observer projection, observed at most once and only when
 * something actually asks for it.
 *
 * Laziness is not an optimization here. Whether this seat observed the public
 * record at all is private evidence that the trace reports, and `onFirstUse`
 * marks the moment it became true, so the observation and the signal that it
 * happened have to stay welded together. Component host inputs pull `provide`
 * on demand, which is why the memo cannot be replaced by an eager value.
 */
export function lazyPublicObserver(
  view: PlayerView,
  onFirstUse: () => void,
): Readonly<{
  provide: () => PublicObserverSnapshot
  observed: () => PublicObserverSnapshot | undefined
}> {
  let snapshot: PublicObserverSnapshot | undefined
  return {
    provide(): PublicObserverSnapshot {
      if (!snapshot) {
        snapshot = observePublicRecord(projectPublicRecord(view))
        onFirstUse()
      }
      return snapshot
    },
    observed: () => snapshot,
  }
}

/**
 * Advance typed cognition for one decision, through bounded language evidence
 * when an interpreter is configured and mechanically otherwise.
 *
 * Both arms end in the same place, a cognition state whose belief is the one
 * every later phase reads, which is why they belong in one owner rather than as
 * a branch in the middle of decide(). Only the language arm can degrade or
 * produce interpreter attribution, so those are optional in the result instead
 * of being threaded back as mutable locals.
 */
export async function advanceDecisionCognition(input: {
  cognition: CognitionState | undefined
  view: PlayerView
  beliefModel: BeliefModel
  languageFactor: LanguageLikelihoodFactor
  interpreter: LanguageInterpreter | undefined
  configuredLanguageVersion: string | undefined
  onLanguageEvidence: () => void
}): Promise<Readonly<{
  cognition: CognitionState
  languageTrace?: LanguageTraceAttribution
  degradation: readonly string[]
}>> {
  const { cognition, view, beliefModel, interpreter } = input
  if (!interpreter) {
    return {
      cognition: advanceCognition(cognition, view, beliefModel),
      degradation: [],
    }
  }
  const interpret = interpreter.interpret.bind(interpreter)
  const language = await orchestrateLanguageEvidence(
    view,
    cognition,
    {
      interpreterVersion: interpreter.interpreterVersion,
      interpret(request: LanguageInterpreterInput) {
        return interpret(request)
      },
    },
    input.configuredLanguageVersion,
  )
  input.onLanguageEvidence()
  const mechanicalBelief = beliefModel.infer(view)
  if (mechanicalBelief.modelVersion !== beliefModel.version) {
    throw new Error(
      `belief model ${beliefModel.version} returned snapshot ${mechanicalBelief.modelVersion}`,
    )
  }
  const resolvedBelief = language.applyLanguageWeighting && language.inferenceContext
    ? applyBoundedLanguageEvidence(
        view,
        mechanicalBelief,
        language.inferenceContext,
        { evidence: language.reads, cursor: language.cursor },
        input.languageFactor,
      )
    : mechanicalBelief
  return {
    cognition: advanceCognitionFromBelief(cognition, view, {
      belief: resolvedBelief,
      mechanicalBelief: beliefModel.version,
      beliefPipeline: languageBeliefPipelineVersion(beliefModel.version),
      languageEvidence: language.trace.interpreterVersion,
      languageReads: language.reads,
      languageCursor: language.cursor,
    }),
    languageTrace: language.trace,
    degradation: language.degradation,
  }
}
