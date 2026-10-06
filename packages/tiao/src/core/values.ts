import { isRecord, jsonStore } from './util'

/**
 * Bound values a pane persists, as a flat `row path -> value` map under
 * `tiao:<pane id>:values`. Panes without an id (or with `storage: false`) get
 * no store, so their bindings always start from the code default.
 */
export interface ValueStore {
  read(path: string): unknown
  write(path: string, value: unknown): void
  clear(): void
}

export function createValueStore(paneKey: string): ValueStore {
  const store = jsonStore<Record<string, unknown>>(`${paneKey}:values`)
  return {
    read: (path) => store.get()[path],
    write: (path, value) => store.patch({ [path]: value }),
    clear: () => store.clear(),
  }
}

/** Structural equality for bound values: primitives, arrays, and plain objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((k) => sameValue(a[k], b[k]))
  }
  return false
}

/**
 * Whether a saved value still fits the shape the code declares. Guards against
 * a binding changing type between sessions — a stale `{ r, g, b }` must not
 * land in a slider that is now a number.
 */
export function sameShape(saved: unknown, fallback: unknown): boolean {
  if (saved === undefined || typeof saved !== typeof fallback) return false
  if (Array.isArray(fallback)) return Array.isArray(saved) && saved.length === fallback.length
  if (isRecord(fallback)) {
    return isRecord(saved) && Object.keys(fallback).every((k) => k in saved)
  }
  return (saved === null) === (fallback === null)
}
