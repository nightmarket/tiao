export class Emitter<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Set<(ev: never) => void>>()

  on<K extends keyof M>(name: K, fn: (ev: M[K]) => void): () => void {
    let set = this.map.get(name)
    if (!set) {
      set = new Set()
      this.map.set(name, set)
    }
    set.add(fn as (ev: never) => void)
    return () => this.off(name, fn)
  }

  off<K extends keyof M>(name: K, fn: (ev: M[K]) => void): void {
    this.map.get(name)?.delete(fn as (ev: never) => void)
  }

  emit<K extends keyof M>(name: K, ev: M[K]): void {
    const set = this.map.get(name)
    if (!set) return
    // Sets tolerate delete-during-iteration, so no defensive copy per event
    for (const fn of set) (fn as (e: M[K]) => void)(ev)
  }

  clear(): void {
    this.map.clear()
  }
}
