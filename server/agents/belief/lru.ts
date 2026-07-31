// A minimal insertion-ordered LRU map. Both belief caches (enumerated
// assignments in worlds.ts, feasible deal worlds in exact.ts) had open-coded
// the same touch-on-read and evict-oldest-on-write dance over a plain Map; this
// owns it once.
//
// It leans on the Map contract that iteration follows insertion order: get()
// deletes and re-inserts a hit so it becomes the most recent, and set() drops
// keys from the front until the size is within the limit. Values are never
// stored as undefined, so a `get` returning undefined unambiguously means miss.
export class LruMap<K, V> {
  readonly #entries = new Map<K, V>()
  readonly #limit: number

  constructor(limit: number) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`LruMap limit must be a positive integer, got ${limit}`)
    }
    this.#limit = limit
  }

  get(key: K): V | undefined {
    const found = this.#entries.get(key)
    if (found === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, found)
    return found
  }

  set(key: K, value: V): void {
    this.#entries.set(key, value)
    while (this.#entries.size > this.#limit) {
      const oldest = this.#entries.keys().next().value
      if (oldest !== undefined) this.#entries.delete(oldest)
    }
  }
}
