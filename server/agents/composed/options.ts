/**
 * The composed agent's construction-time vocabulary: what a caller may ask for
 * and what it gets back.
 *
 * Kept apart from the spine because these three shapes are the only part of
 * composed.ts that other modules legitimately name. The registry and the tests
 * import ComposedAgentOptions to describe an agent they never construct here,
 * and every one of those importers would otherwise pull the whole decide()
 * pipeline into its module graph just to read a field list.
 */
import type {
  Decision,
  DecisionRequest,
  PlayerView,
} from '../../engine/types.ts'
import type { BeliefModel } from '../belief/types.ts'
import type { IdentityProjectionScope } from '../belief/identity.ts'
import type {
  LanguageLikelihoodFactor,
} from '../belief/language-factor.ts'
import type { ComponentRef } from '../components/types.ts'
import type {
  ResolvedComposedBrain,
} from '../components/resolved-brain.ts'
import type { CoherenceIntent } from '../cognition/coherence.ts'
import type { PrivatePlanMemory } from '../cognition/plan-memory.ts'
import type {
  CandidatePlanner,
  PlanVoice,
} from '../communication/planner-voice-adapter.ts'
import type { LanguageInterpreter } from '../record/language-types.ts'
import type {
  EvilQuestCardPolicyMode,
} from '../policy/evil-quest-card.ts'
import type { CandidateScorer } from '../policy/score.ts'
import type { DecisionTrace } from '../trace.ts'
import type { AvalonAgent } from '../types.ts'

export type ComposedStage =
  | 'language'
  | 'cognition'
  | 'identity'
  | 'observer'
  | 'role-objective'
  | 'morgana-counterfeit'
  | 'quest-card-policy'
  | 'analysis'
  | 'candidates'
  | 'forced-policy'
  | 'scoring'
  | 'planner'
  | 'plan-committed'
  | 'voice'

export interface ComposedAgentOptions {
  seed: string
  /**
   * Generic opt-in component roots. Dependencies are resolved by the
   * production registry; no requested component receives policy authority
   * unless it is also registered in a later policy layer.
   */
  decisionComponents?: readonly ComponentRef[]
  beliefModel?: BeliefModel
  /** Opt-in public-language interpretation. Never configured by the registry. */
  languageInterpreter?: LanguageInterpreter
  /** API-free factor injection for contract and failure testing. */
  languageFactor?: LanguageLikelihoodFactor
  planner?: CandidatePlanner
  voice?: PlanVoice
  onDecisionTrace?: (trace: DecisionTrace) => void
  onStage?: (stage: ComposedStage) => void
  scorer?: CandidateScorer
  /** Opt-in exact public observer. It cannot influence Phase 7A policy. */
  publicObserver?: boolean
  /**
   * Opt-in private joint identity projection. It consumes the resolved belief
   * and remains mechanically inert in Phase 7B1.
   */
  privateIdentity?: IdentityProjectionScope
  /**
   * Opt-in Phase 7C substrate. It activates only for actual Merlin/Percival
   * seats and remains mechanically inert until a later policy phase.
   */
  roleObjectives?: boolean
  /**
   * Explicit opt-in Phase 7D router. It resolves the actual seat role to one
   * objective model but grants no scoring or quest-card policy authority.
   */
  roleObjectiveRouter?: boolean
  /**
   * Opt-in servant standing/decoy substrate. It is mechanically inert and
   * resolves only for actual servant seats.
   *
   * Deliberately NOT routed through roleObjectiveRouter. That router answers
   * the good/evil objective question, and its 'off' for a servant is read by
   * joint identity and by eval attribution as "no objective here". Widening it
   * would also refuse every legacy v1 servant trace that omits the
   * declaration, since validRoleObjectiveRoute compares the two for equality.
   * A servant needs none of that: the objective is public-record-only and
   * rides the generic component run.
   */
  servantObjectives?: boolean
  /**
   * Opt-in Phase 7E1A Morgana counterfeit-read substrate. It is mechanically
   * inert and resolves only for Morgana proposal and vote decisions.
   */
  morganaCounterfeitObjectives?: boolean
  /** Opt-in heterogeneous-safe private evil quest-card strategy. */
  evilQuestCardPolicy?: EvilQuestCardPolicyMode
  /** Opt-in Phase 7B2 private selected/applied plan memory. */
  planMemory?: boolean
  /**
   * Opt-in private pin reads (private-pin + evil-exposure) rendered into the
   * planner's private-planning-only context. Resolves the reads only when set,
   * so a mechanical or planner-less agent pays nothing; it grants no scoring
   * authority.
   */
  pinReads?: boolean
  /** Literal conflict classification intent. Defaults to maintain when enabled. */
  coherenceIntent?: CoherenceIntent
  /** Compatibility policy used by the intentionally basic Phase 3 scorer. */
  compatibilityDecision?: (
    req: DecisionRequest,
    view: PlayerView,
    seed: string,
  ) => Decision
}

export interface ComposedAvalonAgent extends AvalonAgent {
  setPlanner(planner: CandidatePlanner | undefined): void
  setVoice(voice: PlanVoice | undefined): void
  cognitionCursor(): number | undefined
  /** Immutable construction-time description; per-decision resolution is B2. */
  resolvedBrain(): ResolvedComposedBrain
  /** Detached private snapshot for tests and offline diagnostics. */
  planMemorySnapshot(): PrivatePlanMemory | undefined
}
