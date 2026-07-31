// Joint private-identity projection, split across two files by job and
// re-exported here so the many call sites keep one import path.
//
//   identity-project.ts  turns a resolved belief snapshot into a bounded
//                        private-identity projection (the production engine),
//                        and owns the small kernel both halves share.
//   identity-validate.ts is the transport and artifact admission boundary that
//                        accepts or rejects such a projection arriving from
//                        `unknown`.
//
// The two are genuinely separate concerns, but several consumers pull a shared
// constant (JOINT_IDENTITY_MODEL_VERSION) or hiddenTeamEvilMarginals alongside a
// validator in one import, so this barrel keeps that ergonomic while the code
// lives apart.

export {
  hiddenTeamEvilMarginals,
  JOINT_IDENTITY_MODEL_VERSION,
  MAX_IDENTITY_HYPOTHESES_PER_POSTERIOR,
  MAX_IDENTITY_ROLE_QUERIES,
  projectJointIdentity,
  type CanonicalRoleAssignment,
  type HiddenTeamHypothesis,
  type HiddenTeamPosterior,
  type IdentityProjectionScope,
  type PrivateIdentitySnapshot,
  type RoleIdentityHypothesis,
  type RoleIdentityPosterior,
  type RoleIdentityQuery,
} from './identity-project.ts'

export {
  validatePrivateIdentityHostJoin,
  validatePrivateIdentitySnapshot,
} from './identity-validate.ts'
