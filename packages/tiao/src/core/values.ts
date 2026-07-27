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
  return saved === null === (fallback === null)
}
