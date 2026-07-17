declare const process: { env: Record<string, string | undefined> } | undefined

let enabledOverride: boolean | null = null

/** Globally enable/disable tiao (primarily useful for tests and custom tooling). */
export function setTiaoEnabled(enabled: boolean): void {
  enabledOverride = enabled
}

export function isTiaoEnabled(local?: boolean): boolean {
  if (local !== undefined) return local
  if (enabledOverride !== null) return enabledOverride
  return typeof process === 'undefined' || process.env['NODE_ENV'] !== 'production'
}
