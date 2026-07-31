import type { BindingOptions, PaneOptions } from '../core'

export const BUTTON = Symbol('tiao.button')
export const BUTTON_GROUP = Symbol('tiao.buttonGroup')
export const MONITOR = Symbol('tiao.monitor')
export const TABS = Symbol('tiao.tabs')

/** Read a control value by folder-relative or absolute store key. */
export type ShowIfGet = (key: string) => unknown

export type ShowIf = (get: ShowIfGet) => boolean

export interface ButtonItem {
  [BUTTON]: true
  title: string
  onClick: () => void
  showIf?: ShowIf | undefined
  hidden?: boolean | undefined
  disabled?: boolean | undefined
}

export interface ButtonGroupItem {
  [BUTTON_GROUP]: true
  buttons: Record<string, () => void>
  label?: string | undefined
  showIf?: ShowIf | undefined
  hidden?: boolean | undefined
  disabled?: boolean | undefined
}

export interface MonitorItem {
  [MONITOR]: true
  get: () => unknown
  options: BindingOptions
  showIf?: ShowIf | undefined
  hidden?: boolean | undefined
  disabled?: boolean | undefined
}

export interface TabsItem<P extends Record<string, Schema> = Record<string, Schema>> {
  [TABS]: true
  pages: P
}

export interface InputDef<T = unknown> extends BindingOptions {
  value: T
  showIf?: ShowIf | undefined
  hidden?: boolean | undefined
  disabled?: boolean | undefined
}

export type SchemaItem =
  | ButtonItem
  | ButtonGroupItem
  | MonitorItem
  | TabsItem
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
      : I extends TabsItem
        ? never
        : I extends InputDef<infer T>
          ? T
          : I

type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] }

type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never

type TabsPageValues<P extends Record<string, Schema>> = UnionToIntersection<
  { [K in keyof P]: SchemaValues<P[K]> }[keyof P]
>

type TabsValues<S extends Schema> = UnionToIntersection<
  {
    [K in keyof S]: S[K] extends TabsItem<infer P> ? TabsPageValues<P> : never
  }[keyof S]
>

export type SchemaValues<S extends Schema> = OmitNever<{
  [K in keyof S]: SchemaValue<S[K]>
}> &
  ([TabsValues<S>] extends [never] ? unknown : TabsValues<S>)

export type ControlsResult<S extends Schema> = SchemaValues<S> & {
  /** programmatically update one or more controls */
  $set(patch: Partial<SchemaValues<S>>): void
  /** read the latest value without subscribing */
  $get<K extends keyof SchemaValues<S>>(key: K): SchemaValues<S>[K]
}

export interface UseControlsOptions {
  /** target pane: an id string or pane options (id required for sharing across components) */
  pane?: string | (PaneOptions & { id?: string })
  /** override the global enabled flag for this hook */
  enabled?: boolean
  /** hide this hook's folder (or root rows) when the predicate is false */
  showIf?: ShowIf | undefined
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

/** Schema helper: group controls onto tab pages. Values are flattened into the hook result. */
export function tabs<P extends Record<string, Schema>>(pages: P): TabsItem<P> {
  return { [TABS]: true, pages }
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

export function isTabs(item: SchemaItem): item is TabsItem {
  return typeof item === 'object' && item !== null && TABS in item
}

export function isInputDef(item: SchemaItem): item is InputDef {
  // buttons/monitors/tabs have no `value` property, so this check alone excludes them
  return typeof item === 'object' && item !== null && 'value' in item
}

/** Default value for a schema item ('value' wrapper unwrapped). */
export function itemValue(item: SchemaItem): unknown {
  return isInputDef(item) ? item.value : item
}
