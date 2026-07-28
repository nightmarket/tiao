import { useEffect, useRef } from 'react'
import { isTiaoEnabled } from './config'
import { initControls, useControlValues, type ControlsInit } from './controls'
import { getManager, type ManagerApi } from './manager'
import type { ControlsResult, Schema, UseControlsOptions } from './types'

export function useControls<S extends Schema>(schema: S, options?: UseControlsOptions): ControlsResult<S>
export function useControls<S extends Schema>(
  folder: string,
  schema: S,
  options?: UseControlsOptions,
): ControlsResult<S>
export function useControls<S extends Schema>(
  a: string | S,
  b?: S | UseControlsOptions,
  c?: UseControlsOptions,
): ControlsResult<S> {
  // schema and pane target are intentionally captured on first render (like leva)
  const stable = useRef<{
    manager: ManagerApi
    init: ControlsInit<S>
    enabled: boolean
    setValue: (key: string, value: unknown) => void
  } | null>(null)

  if (stable.current === null) {
    const init = initControls(a, b, c)
    const manager = getManager(init.paneId)
    stable.current = {
      manager,
      init,
      enabled: isTiaoEnabled(init.options.enabled),
      setValue: (key, value) => manager.setValue(key, value),
    }
  }
  const { manager, init, enabled, setValue } = stable.current

  useEffect(() => {
    const paneOpt = init.options.pane
    if (typeof paneOpt === 'object') manager.configure(paneOpt)
    if (!enabled) return
    return manager.register(init.folderPath, init.schema)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captured on first render
  }, [])

  return useControlValues(manager.store, init, setValue)
}
