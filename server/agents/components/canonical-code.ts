// The shared canonical-code predicate. Component identifiers, versions,
// degradation codes, suppression reason codes, and policy-use stage names are
// all the same bounded lowercase token, and the admission engine, the host
// input machine, and the run accessors all validate it. It lives in this leaf
// so those three modules can share one rule without importing one another.

const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/

export function canonicalCode(value: unknown): value is string {
  return typeof value === 'string' && CODE_PATTERN.test(value)
}
