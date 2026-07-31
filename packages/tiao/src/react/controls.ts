import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ControlStore } from './store'
import {
  isButton,
  isButtonGroup,
  isMonitor,
  isTabs,
  itemValue,
  type ControlsResult,
  type Schema,
  type TabsItem,
  type UseControlsOptions,
} from './types'

/**
 * The half of `useControls` that needs no pane: argument parsing, store keys,
 * and the snapshot subscription. Shared by the development entry and the
 * production one, which has no manager to register with.
 */

export const DEFAULT_PANE_ID = 'tiao-default'

export function keyFor(folderPath: string[], name: string): string {
  return [...folderPath, name].join('.')
}

export interface ValueKey {
  name: string
  key: string
  initial: unknown
}

export interface ControlsInit<S extends Schema> {
  paneId: string
  folderPath: string[]
  schema: S
  options: UseControlsOptions
  valueKeys: ValueKey[]
  keys: string[]
}

/** Resolve the hook's overloaded arguments into everything keyed off the schema. */
export function initControls<S extends Schema>(
  a: string | S | TabsItem,
  b?: S | TabsItem | UseControlsOptions,
  c?: UseControlsOptions,
): ControlsInit<S> {
  const folder = typeof a === 'string' ? a : undefined
  const raw = (typeof a === 'string' ? b : a) as S | TabsItem
  // a bare tabs(...) schema gets an internal wrapper key; the key never
  // surfaces — tabs values are flattened and the item itself yields none
  const schema = (isTabs(raw) ? { $tabs: raw } : raw) as S
  const options = (typeof a === 'string' ? c : (b as UseControlsOptions | undefined)) ?? {}

  const paneOpt = options.pane
  const paneId = typeof paneOpt === 'string' ? paneOpt : (paneOpt?.id ?? DEFAULT_PANE_ID)
  const folderPath = folder ? folder.split('.').filter(Boolean) : []
  const valueKeys: ValueKey[] = []
  collectValueKeys(schema, folderPath, valueKeys)

  return { paneId, folderPath, schema, options, valueKeys, keys: valueKeys.map((v) => v.key) }
}

function collectValueKeys(schema: Schema, folderPath: string[], out: ValueKey[]): void {
  for (const [name, item] of Object.entries(schema)) {
    if (isButton(item) || isButtonGroup(item) || isMonitor(item)) continue
    if (isTabs(item)) {
      for (const page of Object.values(item.pages)) collectValueKeys(page, folderPath, out)
      continue
    }
    out.push({ name, key: keyFor(folderPath, name), initial: itemValue(item) })
  }
}

/**
 * Subscribe to `store` and expose the schema's values plus `$set`/`$get`.
 * `setValue` is the write path: the manager's in development (store + live
 * binding), a plain store write in production.
 *
 * Every argument is captured on the first render and must be render-stable —
 * both entries hold them in a `useRef` that is filled once.
 */
export function useControlValues<S extends Schema>(
  store: ControlStore,
  { folderPath, valueKeys, keys }: ControlsInit<S>,
  setValue: (key: string, value: unknown) => void,
): ControlsResult<S> {
  const subscribe = useCallback(
    (fn: () => void) => store.subscribe(keys, fn),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable for the hook's lifetime
    [],
  )

  const cache = useRef<{ version: number; values: Record<string, unknown> } | null>(null)
  const getSnapshot = useCallback(() => {
    const version = store.version(keys)
    if (!cache.current || cache.current.version !== version) {
      const values: Record<string, unknown> = {}
      for (const { name, key, initial } of valueKeys) {
        values[name] = store.has(key) ? store.get(key) : initial
      }
      cache.current = { version, values }
    }
    return cache.current.values
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable for the hook's lifetime
  }, [])

  const values = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return useMemo(() => {
    const $set = (patch: Record<string, unknown>) => {
      for (const [name, v] of Object.entries(patch)) setValue(keyFor(folderPath, name), v)
    }
    const $get = (name: string) => {
      const key = keyFor(folderPath, name)
      return store.has(key) ? store.get(key) : valueKeys.find((v) => v.name === name)?.initial
    }
    return { ...values, $set, $get } as ControlsResult<S>
    // eslint-disable-next-line react-hooks/exhaustive-deps -- all captured args are render-stable (see JSDoc)
  }, [values])
}
