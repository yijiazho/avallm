/**
 * Detaching the caller-supplied plugins from the caller, and reading what a
 * detached scorer still declares.
 *
 * Every value in ComposedAgentOptions arrives from outside the agent and stays
 * live for the agent's whole lifetime, so a caller that keeps its reference can
 * swap a version string or a score function between two decisions and make the
 * trace describe a pipeline that never ran. Each snapshot here copies the fields
 * it needs, rebinds the methods, and freezes the result, so the agent's answer
 * to "what is configured" is fixed at construction.
 *
 * The chain readers live here rather than beside their call sites because they
 * only make sense over a snapshotted scorer: snapshotScorer is what guarantees
 * the baseScorer chain they walk cannot grow a new link underneath them.
 */
import type { PlayerView } from '../../engine/types.ts'
import type { BeliefModel } from '../belief/types.ts'
import type {
  LanguageLikelihoodFactor,
} from '../belief/language-factor.ts'
import type {
  CandidatePlanner,
  PlanVoice,
  PlannerInput,
  VoiceInput,
} from '../communication/planner-voice-adapter.ts'
import type {
  LanguageInterpreter,
  LanguageInterpreterInput,
} from '../record/language-types.ts'
import type {
  CandidateScorer,
  CandidateScoringContext,
} from '../policy/score.ts'

export function snapshotPlanner(
  source: CandidatePlanner | undefined,
): CandidatePlanner | undefined {
  if (!source) return undefined
  const version = source.version
  const choose = source.choose.bind(source)
  const snapshot: CandidatePlanner = {
    version,
    choose(input: PlannerInput) {
      return choose(input)
    },
  }
  return Object.freeze(snapshot)
}

export function snapshotVoice(
  source: PlanVoice | undefined,
): PlanVoice | undefined {
  if (!source) return undefined
  const version = source.version
  const speak = source.speak.bind(source)
  const snapshot: PlanVoice = {
    version,
    speak(input: VoiceInput) {
      return speak(input)
    },
  }
  return Object.freeze(snapshot)
}

export function snapshotBeliefModel(source: BeliefModel): BeliefModel {
  const version = source.version
  const factorsVersion = source.factorsVersion
  const infer = source.infer.bind(source)
  const snapshot: BeliefModel = {
    version,
    factorsVersion,
    infer(view: PlayerView) {
      return infer(view)
    },
  }
  return Object.freeze(snapshot)
}

export function snapshotLanguageInterpreter(
  source: LanguageInterpreter | undefined,
): LanguageInterpreter | undefined {
  if (!source) return undefined
  const interpret = source.interpret.bind(source)
  const snapshot: LanguageInterpreter = {
    get interpreterVersion() {
      return source.interpreterVersion
    },
    interpret(input: LanguageInterpreterInput) {
      return interpret(input)
    },
  }
  return Object.freeze(snapshot)
}

export function snapshotLanguageFactor(
  source: LanguageLikelihoodFactor,
): LanguageLikelihoodFactor {
  const id = source.id
  const version = source.version
  const logLikelihood = source.logLikelihood.bind(source)
  const snapshot: LanguageLikelihoodFactor = {
    id,
    version,
    logLikelihood(world, evidence) {
      return logLikelihood(world, evidence)
    },
  }
  return Object.freeze(snapshot)
}

export function snapshotScorer(
  source: CandidateScorer,
  seen = new Map<CandidateScorer, CandidateScorer>(),
): CandidateScorer {
  const existing = seen.get(source)
  if (existing) return existing
  const score = source.score?.bind(source)
  const snapshot: CandidateScorer = {
    version: source.version,
    ...(source.analysisRequirement
      ? { analysisRequirement: source.analysisRequirement }
      : {}),
    ...(source.roleUtilityRequirement
      ? { roleUtilityRequirement: source.roleUtilityRequirement }
      : {}),
    ...(source.evilRoleUtilityRequirement
      ? { evilRoleUtilityRequirement: source.evilRoleUtilityRequirement }
      : {}),
    ...(source.morganaRoleUtilityRequirement
      ? { morganaRoleUtilityRequirement: source.morganaRoleUtilityRequirement }
      : {}),
    ...(score
      ? {
          score(context: CandidateScoringContext) {
            return score(context)
          },
        }
      : {}),
  }
  seen.set(source, snapshot)
  if (source.baseScorer) {
    snapshot.baseScorer = snapshotScorer(source.baseScorer, seen)
  }
  return Object.freeze(snapshot)
}

export function scorerVersions(source: CandidateScorer): readonly string[] {
  const versions: string[] = []
  const seen = new Set<CandidateScorer>()
  let current: CandidateScorer | undefined = source
  while (current && !seen.has(current)) {
    seen.add(current)
    versions.push(current.version)
    current = current.baseScorer
  }
  return Object.freeze(versions)
}

export function scorerRequires(
  source: CandidateScorer,
  requirement:
    | 'roleUtilityRequirement'
    | 'evilRoleUtilityRequirement'
    | 'morganaRoleUtilityRequirement',
): boolean {
  const seen = new Set<CandidateScorer>()
  let current: CandidateScorer | undefined = source
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current[requirement] !== undefined) return true
    current = current.baseScorer
  }
  return false
}

/**
 * Whether a plugin's declared version is usable as trace attribution.
 *
 * The runtime half of the same distrust the snapshots encode: a planner or
 * voice may be swapped in through setPlanner/setVoice at any point, and one
 * carrying a blank version would be recorded under a name no reader can match
 * back to an implementation. A decision degrades past such a plugin instead.
 */
export function validComponentVersion(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
