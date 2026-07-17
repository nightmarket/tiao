import { isTiaoEnabled } from '../config'
import type { Pane, PaneOptions } from '../core'

export type PaneSetup = (pane: Pane) => void | (() => void)

/**
 * Lazily mounts a pane in development and does nothing in production.
 *
 * The core module is dynamically imported, so applications can keep debug
 * setup in source without loading tiao's UI in production.
 */
export function mountPane(setup: PaneSetup): () => void
export function mountPane(options: PaneOptions, setup: PaneSetup): () => void
export function mountPane(
  optionsOrSetup: PaneOptions | PaneSetup,
  setupArg?: PaneSetup,
): () => void {
  if (!isTiaoEnabled()) return () => {}

  const options = typeof optionsOrSetup === 'function' ? {} : optionsOrSetup
  const setup = typeof optionsOrSetup === 'function' ? optionsOrSetup : setupArg
  if (!setup) throw new TypeError('mountPane requires a setup callback')
  let disposed = false
  let pane: Pane | null = null
  let cleanup: (() => void) | undefined

  void import('../core').then(({ Pane }) => {
    if (disposed) return
    pane = new Pane(options)
    cleanup = setup(pane) ?? undefined
  })

  return () => {
    disposed = true
    cleanup?.()
    pane?.dispose()
  }
}
