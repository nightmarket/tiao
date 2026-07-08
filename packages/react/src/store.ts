/** Framework-agnostic value store; the only thing that ships in prod bundles. */
export class ControlStore {
  private values = new Map<string, unknown>()
  private versions = new Map<string, number>()
  private listeners = new Map<string, Set<() => void>>()

  has(key: string): boolean {
    return this.values.has(key)
  }

  get(key: string): unknown {
    return this.values.get(key)
  }

  set(key: string, value: unknown): void {
    if (Object.is(this.values.get(key), value)) return
    this.values.set(key, value)
    this.versions.set(key, (this.versions.get(key) ?? 0) + 1)
    const set = this.listeners.get(key)
    if (set) for (const fn of [...set]) fn()
  }

  delete(key: string): void {
    this.values.delete(key)
  }

  /** monotonically increasing across a set of keys; cheap change detection for snapshots */
  version(keys: readonly string[]): number {
    let sum = 0
    for (const k of keys) sum += this.versions.get(k) ?? 0
    return sum
  }

  subscribe(keys: readonly string[], fn: () => void): () => void {
    for (const k of keys) {
      let set = this.listeners.get(k)
      if (!set) {
        set = new Set()
        this.listeners.set(k, set)
      }
      set.add(fn)
    }
    return () => {
      for (const k of keys) this.listeners.get(k)?.delete(fn)
    }
  }
}
