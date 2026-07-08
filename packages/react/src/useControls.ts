import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { isTiaoEnabled } from './config'
import { DEFAULT_PANE_ID, getManager, keyFor, type PaneManager } from './manager'
import {
  isButton,
  isButtonGroup,
  isMonitor,
  itemValue,
  type Schema,
  type SchemaValues,
  type UseControlsOptions,
} from './types'

export type ControlsResult<S extends Schema> = SchemaValues<S> & {
  /** programmatically update one or more controls */
  $set(patch: Partial<SchemaValues<S>>): void
  /** read the latest value without subscribing */
  $get<K extends keyof SchemaValues<S>>(key: K): SchemaValues<S>[K]
}

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
  const folder = typeof a === 'string' ? a : undefined
  const schema = (typeof a === 'string' ? b : a) as S
  const options = (typeof a === 'string' ? c : (b as UseControlsOptions | undefined)) ?? {}

  // schema and pane target are intentionally captured on first render (like leva)
  const stable = useRef<{
    manager: PaneManager
    folderPath: string[]
    schema: S
    valueKeys: { name: string; key: string; initial: unknown }[]
    keys: string[]
    enabled: boolean
  } | null>(null)

  if (stable.current === null) {
    const paneOpt = options.pane
    const paneId =
      typeof paneOpt === 'string' ? paneOpt : (paneOpt?.id ?? DEFAULT_PANE_ID)
    const manager = getManager(paneId)
    if (typeof paneOpt === 'object') manager.configure(paneOpt)

    const folderPath = folder ? folder.split('.').filter(Boolean) : []
    const valueKeys = Object.entries(schema)
      .filter(([, item]) => !isButton(item) && !isButtonGroup(item) && !isMonitor(item))
      .map(([name, item]) => ({ name, key: keyFor(folderPath, name), initial: itemValue(item) }))

    stable.current = {
      manager,
      folderPath,
      schema,
      valueKeys,
      keys: valueKeys.map((v) => v.key),
      enabled: isTiaoEnabled(options.enabled),
    }
  }
  const { manager, folderPath, schema: stableSchema, valueKeys, keys, enabled } = stable.current

  useEffect(() => {
    if (!enabled) return
    const reg = manager.register(folderPath, stableSchema)
    return () => manager.unregister(reg)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- captured on first render
  }, [])

  const subscribe = useCallback(
    (fn: () => void) => manager.store.subscribe(keys, fn),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable for the hook's lifetime
    [],
  )

  const cache = useRef<{ version: number; values: Record<string, unknown> } | null>(null)
  const getSnapshot = useCallback(() => {
    const version = manager.store.version(keys)
    if (!cache.current || cache.current.version !== version) {
      const values: Record<string, unknown> = {}
      for (const { name, key, initial } of valueKeys) {
        values[name] = manager.store.has(key) ? manager.store.get(key) : initial
      }
      cache.current = { version, values }
    }
    return cache.current.values
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable for the hook's lifetime
  }, [])

  const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return useMemo(() => {
    const $set = (patch: Record<string, unknown>) => {
      for (const [name, v] of Object.entries(patch)) {
        manager.setValue(keyFor(folderPath, name), v)
      }
    }
    const $get = (name: string) => {
      const key = keyFor(folderPath, name)
      return manager.store.has(key)
        ? manager.store.get(key)
        : valueKeys.find((v) => v.name === name)?.initial
    }
    return { ...values, $set, $get } as ControlsResult<S>
    // eslint-disable-next-line react-hooks/exhaustive-deps -- manager/folderPath are stable
  }, [values])
}
