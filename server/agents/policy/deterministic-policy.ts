/** Stable two-bucket policy variation shared by deterministic score families. */
export function stablePolicyBucket(value: string): 0 | 1 {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) % 2 as 0 | 1
}
