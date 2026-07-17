import { useEffect, useRef, useState } from 'react'
import { isTiaoEnabled } from './config'
import { DEFAULT_PANE_ID, getManager } from './manager'
import type { Pane, PaneOptions } from '../core'

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

  useEffect(() => {
    if (!enabled) return
    const manager = getManager(id)
    if (options) manager.configure(options)
    return manager.onPane(setPane)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options captured on mount
  }, [id, enabled])

  return pane
}
