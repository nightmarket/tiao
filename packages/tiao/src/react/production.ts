import { useRef } from 'react'
import { initControls, useControlValues, type ControlsInit } from './controls'
import { ControlStore } from './store'
import type { ControlsResult, Schema, UseControlsOptions } from './types'
import type { ManagerApi } from './manager'
import type { Pane, PaneOptions } from '../core'

/**
 * Production build of `@nightmarket/tiao/react`, picked up through the
 * `production` export condition. Values still flow — `useControls` returns the
 * schema defaults and `$set` still re-renders — but the pane, the manager, and
 * the dynamic `import('../core')` are all absent, so no debug UI reaches the
 * bundle. Bundlers that ignore the condition fall back to the development
 * entry, which is what shipped before this file existed.
 */

export { setTiaoEnabled } from './config'
export { ControlStore } from './store'
export { DEFAULT_PANE_ID } from './controls'
export { button, buttonGroup, monitor, tabs } from './types'
export type {
  ButtonGroupItem,
  ButtonItem,
  ControlsResult,
  InputDef,
  MonitorItem,
  Schema,
  SchemaItem,
  SchemaValues,
  ShowIf,
  ShowIfGet,
  TabsItem,
  UseControlsOptions,
} from './types'

/** Values without a pane: the store is real, everything pane-shaped is inert. */
class ProductionManager implements ManagerApi {
  readonly store = new ControlStore()

  constructor(readonly id: string) {}

  configure(_options: PaneOptions): void {}

  onPane(_fn: (pane: Pane) => void): () => void {
    return () => {}
  }

  getPane(): Pane | null {
    return null
  }

  setValue(key: string, value: unknown): void {
    this.store.set(key, value)
  }

  register(_folderPath: string[], _schema: Schema, _options?: UseControlsOptions): () => void {
    return () => {}
  }
}

// mirrors getManager in manager.ts; importing the real one would pull
// PaneManager (and its core import) into the production bundle
const managers = new Map<string, ProductionManager>()

export function getManager(id: string): ManagerApi {
  let m = managers.get(id)
  if (!m) {
    m = new ProductionManager(id)
    managers.set(id, m)
  }
  return m
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
  // schema and pane target are captured on first render, as in the dev entry
  const stable = useRef<{
    manager: ManagerApi
    init: ControlsInit<S>
    setValue: (key: string, value: unknown) => void
  } | null>(null)
  if (stable.current === null) {
    const init = initControls(a, b, c)
    const manager = getManager(init.paneId)
    stable.current = { manager, init, setValue: (key, value) => manager.setValue(key, value) }
  }
  const { manager, init, setValue } = stable.current

  return useControlValues(manager.store, init, setValue)
}

/** No pane is ever created, so this stays null (as it does when disabled). */
export function usePane(_id?: string, _options?: PaneOptions & { enabled?: boolean }): Pane | null {
  return null
}

/**
 * The core module is not part of this build. Matching `usePane`'s documented
 * behaviour when disabled, this never resolves rather than rejecting.
 */
const coreNever = new Promise<never>(() => {})

export function loadCore(): Promise<never> {
  return coreNever
}
