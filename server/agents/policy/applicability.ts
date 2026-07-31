import type { Alignment, DecisionKind, Role } from '../../engine/types.ts'

/**
 * When a role's specialized policy applies, declared once as data.
 *
 * Each special role's refinement is produced by an analysis component and then
 * consumed by a score layer. Both stages must agree on exactly when the
 * refinement is in scope, or a decision reaches the score layer with no
 * component to score from. Declaring the claim here, and deriving both the
 * component `applies` and the score layer `applies` from it, makes that
 * agreement structural instead of two hand-written predicates that can drift.
 *
 * The base and its specializations are deliberately different shapes:
 * - `alignment` is the shared base. It co-applies with every role it hosts and
 *   is exempt from the partition, because a Morgana seat proposing runs both
 *   the evil base and the Morgana refinement on top of it. That is the intended
 *   layering, not an overlap the check should reject.
 * - `role` is a specialization. Role claims must partition: a seat has exactly
 *   one role, so distinct roles are disjoint by construction, and the check
 *   enforces that no two specializations name the same role.
 *
 * A claim gates on role or alignment and decision kind only. Game facts that
 * would further restrict when a role acts (for example that Mordred and the
 * Assassin are only ever seated alongside Merlin) are owned and enforced once,
 * by the engine's validateRoles; a claim never restates them.
 */
export type Applicability =
  | {
    readonly by: 'alignment'
    readonly alignment: Alignment
    readonly kinds: readonly DecisionKind[]
  }
  | {
    readonly by: 'role'
    readonly role: Role
    readonly kinds: readonly DecisionKind[]
  }

/**
 * The minimal context a claim inspects. Both the score-layer applicability
 * context and the component applicability context satisfy it structurally,
 * which is why one `appliesFrom` can serve both stages.
 */
export interface RoleApplicabilityContext {
  readonly view: {
    readonly role: Role
    readonly alignment: Alignment
  }
  readonly request: {
    readonly kind: DecisionKind
  }
}

/** Derive an `applies` predicate from a declared claim. */
export function appliesFrom(
  claim: Applicability,
): (context: RoleApplicabilityContext) => boolean {
  const kinds = new Set(claim.kinds)
  if (claim.by === 'alignment') {
    return (context) =>
      context.view.alignment === claim.alignment
      && kinds.has(context.request.kind)
  }
  return (context) =>
    context.view.role === claim.role
    && kinds.has(context.request.kind)
}

/**
 * Reject a role tree whose specializations do not partition the role space.
 *
 * Alignment claims are the shared base and are skipped; only role claims have
 * to be disjoint. Two specializations naming the same role would both run for
 * that seat, compounding instead of passing through, which is the exact failure
 * the composed score-layer chain cannot survive.
 */
export function assertRoleClaimsPartition(
  claims: readonly Applicability[],
): void {
  const seen = new Set<Role>()
  for (const claim of claims) {
    if (claim.by !== 'role') continue
    if (seen.has(claim.role)) {
      throw new Error(
        `two score layers both claim role ${claim.role}; role `
        + 'specializations have to partition the role space so the composed '
        + 'chain can pass each seat through the siblings it does not claim',
      )
    }
    seen.add(claim.role)
  }
}

/**
 * The shared evil base claims every evil seat on propose and vote. It co-applies
 * with the role specializations it hosts, so it is an alignment claim, exempt
 * from the role partition.
 */
export const EVIL_CLAIM: Applicability = {
  by: 'alignment',
  alignment: 'evil',
  kinds: ['propose', 'vote'],
}

/** Morgana counterfeits Merlin on propose and vote. */
export const MORGANA_CLAIM: Applicability = {
  by: 'role',
  role: 'morgana',
  kinds: ['propose', 'vote'],
}

/**
 * Mordred exploits Merlin's blindness on propose and vote. No Merlin check:
 * validateRoles enforces that Mordred requires Merlin, so a Mordred seat
 * guarantees it; a view that violated it would be corrupt upstream state.
 */
export const MORDRED_CLAIM: Applicability = {
  by: 'role',
  role: 'mordred',
  kinds: ['propose', 'vote'],
}

/**
 * The Merlin shot is the only assassinate-kind role layer. No Merlin check:
 * validateRoles adds Merlin and the Assassin together, and the engine only
 * issues an assassinate decision with Merlin seated.
 */
export const ASSASSIN_CLAIM: Applicability = {
  by: 'role',
  role: 'assassin',
  kinds: ['assassinate'],
}
