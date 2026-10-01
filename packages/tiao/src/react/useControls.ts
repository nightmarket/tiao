import { useEffect, useRef } from 'react'
import { isTiaoEnabled } from './config'
import { type ControlsInit, initControls, useControlValues } from './controls'
import { getManager, type ManagerApi } from './manager'
import type { ControlsResult, Schema, TabsItem, UseControlsOptions } from './types'

export function useControls<P extends Record<string, Schema>>(
  schema: TabsItem<P>,
  options?: UseControlsOptions,
): ControlsResult<{ $tabs: TabsItem<P> }>
export function useControls<P extends Record<string, Schema>>(
  folder: string,
  schema: TabsItem<P>,
  options?: UseControlsOptions,
): ControlsResult<{ $tabs: TabsItem<P> }>
export function useControls<S extends Schema>(
  schema: S,
  options?: UseControlsOptions,
): ControlsResult<S>
export function useControls<S extends Schema>(
  folder: string,
  schema: S,
  options?: UseControlsOptions,
): ControlsResult<S>
export function useControls<S extends Schema>(
  a: string | S | TabsItem,
  b?: S | TabsItem | UseControlsOptions,
  c?: UseControlsOptions,
): ControlsResult<S> {
  // schema and pane target are intentionally captured on first render (like leva)
  const stable = useRef<{
    manager: ManagerApi
    init: ControlsInit<S>
    enabled: boolean
  } | null>(null)

  if (stable.current === null) {
    const init = initControls(a, b, c)
    const manager = getManager(init.paneId)
    stable.current = {
      manager,
      init,
      enabled: isTiaoEnabled(init.options.enabled),
    }
  }
  const { manager, init, enabled } = stable.current

  // biome-ignore lint/correctness/useExhaustiveDependencies: schema and pane target are captured on first render
  useEffect(() => {
    const paneOpt = init.options.pane
    if (typeof paneOpt === 'object') manager.configure(paneOpt)
    if (!enabled) return
    return manager.register(init.folderPath, init.schema, init.options)
  }, [])

  return useControlValues(manager.store, init, (key, value) => manager.setValue(key, value))
}
