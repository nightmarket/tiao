export interface ValueMeta {
  /** true for the final event of an interaction (e.g. pointer release) */
  last?: boolean
  /** where the change originated */
  source?: 'api' | 'ui' | 'refresh' | 'monitor'
  /** notify view subscribers even when the value is unchanged */
  sample?: boolean
}

export type ValueListener<T> = (value: T, meta: ValueMeta) => void
export type Equals<T> = (a: T, b: T) => boolean

/** Minimal reactive container. The single source of truth for every control. */
export class Value<T> {
  private listeners = new Set<ValueListener<T>>()

  constructor(
    private raw: T,
    readonly equals: Equals<T> = Object.is,
  ) {}

  get(): T {
    return this.raw
  }

  set(next: T, meta: ValueMeta = {}): void {
    // re-emit unchanged values when `last` is set so drag-end events fire
    if (this.equals(this.raw, next) && !meta.last && !meta.sample) return
    this.raw = next
    for (const fn of this.listeners) fn(next, meta)
  }

  subscribe(fn: ValueListener<T>): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}
