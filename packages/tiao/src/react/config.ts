declare const process: { env: Record<string, string | undefined> } | undefined

let enabledOverride: boolean | null = null

/** Globally enable/disable all tiao hooks (e.g. behind your own debug flag). */
export function setTiaoEnabled(enabled: boolean): void {
  enabledOverride = enabled
}

export function isTiaoEnabled(local?: boolean): boolean {
  if (local !== undefined) return local
  if (enabledOverride !== null) return enabledOverride
  // bundlers statically replace NODE_ENV, so the UI branch is dead code in prod
  return typeof process === 'undefined' || process.env['NODE_ENV'] !== 'production'
}
