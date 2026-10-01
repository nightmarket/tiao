declare const process: { env: Record<string, string | undefined> }

let enabledOverride: boolean | null = null

/** Globally enable/disable tiao (primarily useful for tests and custom tooling). */
export function setTiaoEnabled(enabled: boolean): void {
  enabledOverride = enabled
}

/**
 * Debug level, resolved from one canonical env variable — `DEBUG_LEVEL` — read
 * through each bundler's client-exposure prefix. Reads are exact dot-access
 * expressions so define-replacement can inline them at application build time.
 *
 * - `0` — off: every gate returns false and no UI code loads.
 * - `1` — armed: off unless the URL has `?debug` (and not `?debug=false`).
 * - `2` — on: on unless the URL has `?debug=false`.
 *
 * Unset or unrecognized falls back to `NODE_ENV`: a defined non-production
 * value is 2, production is 0. Missing `process` / `NODE_ENV` is 0 so a
 * production bundle that never inlined env stays off.
 */
function debugLevel(): 0 | 1 | 2 {
  const value =
    readEnv(() => process.env.NEXT_PUBLIC_DEBUG_LEVEL) ??
    readEnv(() => process.env.DEBUG_LEVEL) ??
    (import.meta as ImportMeta & { env?: { VITE_DEBUG_LEVEL?: string } }).env?.VITE_DEBUG_LEVEL

  if (value === '0') return 0
  if (value === '1') return 1
  if (value === '2') return 2

  const nodeEnv = readEnv(() => process.env.NODE_ENV)
  return nodeEnv && nodeEnv !== 'production' ? 2 : 0
}

/**
 * Bundlers inline `process.env.X` textually (Vite does so without defining a
 * `process` global), so the read must not be gated on `typeof process`. With
 * no replacement and no global it throws, which reads as unset.
 */
function readEnv(read: () => string | undefined): string | undefined {
  try {
    return read()
  } catch {
    return undefined
  }
}

let cachedSearch: string | null = null
let cachedDebugParam: boolean | null = null

/** `?debug` state: true (present, not false-y), false (`?debug=false`/`?debug=0`), or null (absent). */
function debugQueryParam(): boolean | null {
  if (typeof window === 'undefined') return null
  const search = window.location.search
  if (search !== cachedSearch) {
    cachedSearch = search
    const value = new URLSearchParams(search).get('debug')
    cachedDebugParam = value === null ? null : value !== 'false' && value !== '0'
  }
  return cachedDebugParam
}

export function isTiaoEnabled(local?: boolean): boolean {
  if (local !== undefined) return local
  if (enabledOverride !== null) return enabledOverride
  const level = debugLevel()
  if (level === 0) return false
  const param = debugQueryParam()
  if (level === 1) return param === true
  return param !== false
}
