import type { PaneOptions } from '../core'
import type { PaneSetup } from './index'

export function mountPane(_setup: PaneSetup): () => void
export function mountPane(_options: PaneOptions, _setup: PaneSetup): () => void
export function mountPane(
  _optionsOrSetup: PaneOptions | PaneSetup,
  _setup?: PaneSetup,
): () => void {
  return () => {}
}
