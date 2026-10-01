import { useEffect, useRef, useState } from 'react'
import type { Pane, PaneOptions } from '../core'
import { isTiaoEnabled } from './config'
import { DEFAULT_PANE_ID } from './controls'
import { getManager } from './manager'

/**
 * Imperative access to a (lazily created) pane, e.g. for plugins or custom blades.
 * Returns null until the debug UI has loaded; never resolves when disabled.
 */
export function usePane(
  id: string = DEFAULT_PANE_ID,
  options?: PaneOptions & { enabled?: boolean },
): Pane | null {
  const [pane, setPane] = useState<Pane | null>(null)
  const enabled = useRef(isTiaoEnabled(options?.enabled)).current

  // biome-ignore lint/correctness/useExhaustiveDependencies: options are captured on mount
  useEffect(() => {
    if (!enabled) return
    const manager = getManager(id)
    if (options) manager.configure(options)
    return manager.onPane(setPane)
  }, [id, enabled])

  return pane
}
