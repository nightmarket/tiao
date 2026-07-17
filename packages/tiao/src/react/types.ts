import type { BindingOptions, PaneOptions } from '../core'

export const BUTTON = Symbol('tiao.button')
export const BUTTON_GROUP = Symbol('tiao.buttonGroup')
export const MONITOR = Symbol('tiao.monitor')

export interface ButtonItem {
  [BUTTON]: true
  title: string
  onClick: () => void
}

export interface ButtonGroupItem {
  [BUTTON_GROUP]: true
  buttons: Record<string, () => void>
  label?: string | undefined
}

export interface MonitorItem {
  [MONITOR]: true
  get: () => unknown
  options: BindingOptions
}

export interface InputDef<T = unknown> extends BindingOptions {
  value: T
}

export type SchemaItem =
  | ButtonItem
  | ButtonGroupItem
  | MonitorItem
  | InputDef
  | number
  | string
  | boolean
  | object

export type Schema = Record<string, SchemaItem>

/** Extract the runtime value type of a schema item. */
export type SchemaValue<I> = I extends ButtonItem
  ? never
  : I extends ButtonGroupItem
    ? never
    : I extends MonitorItem
      ? never
      : I extends InputDef<infer T>
        ? T
        : I

export type SchemaValues<S extends Schema> = {
  [K in keyof S as SchemaValue<S[K]> extends never ? never : K]: SchemaValue<S[K]>
}

export interface UseControlsOptions {
  /** target pane: an id string or pane options (id required for sharing across components) */
  pane?: string | (PaneOptions & { id?: string })
  /** override the global enabled flag for this hook */
  enabled?: boolean
}

/** Schema helper: a clickable button row. */
export function button(onClick: () => void, title?: string): ButtonItem {
  return { [BUTTON]: true, onClick, title: title ?? '' }
}

/** Schema helper: a row of equally-styled buttons, each with its own callback. */
export function buttonGroup(
  buttons: Record<string, () => void>,
  label?: string,
): ButtonGroupItem {
  return { [BUTTON_GROUP]: true, buttons, label }
}

/** Schema helper: a readonly monitor polling `get` (use view: 'graph' for a chart). */
export function monitor(get: () => unknown, options: BindingOptions = {}): MonitorItem {
  return { [MONITOR]: true, get, options: { ...options, readonly: true } }
}

export function isButton(item: SchemaItem): item is ButtonItem {
  return typeof item === 'object' && item !== null && BUTTON in item
}

export function isButtonGroup(item: SchemaItem): item is ButtonGroupItem {
  return typeof item === 'object' && item !== null && BUTTON_GROUP in item
}

export function isMonitor(item: SchemaItem): item is MonitorItem {
  return typeof item === 'object' && item !== null && MONITOR in item
}

export function isInputDef(item: SchemaItem): item is InputDef {
  // buttons/monitors have no `value` property, so this check alone excludes them
  return typeof item === 'object' && item !== null && 'value' in item
}

/** Default value for a schema item ('value' wrapper unwrapped). */
export function itemValue(item: SchemaItem): unknown {
  return isInputDef(item) ? item.value : item
}
