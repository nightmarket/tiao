import type { DockSide } from './dock'
import { h, withDocument } from './dom'
import type {
  Anchor,
  Pane,
  PaneFontSize,
  PaneOptions,
  PaneSpacing,
  PaneStyle,
  PaneTheme,
} from './pane'
import { withoutPersisting } from './util'

/** rows that only make sense for a single floating pane */
export interface PaneMenuPlacement {
  getDraggable(): boolean
  setDraggable(v: boolean): void
  getAnchor(): Anchor | null
  setAnchor(anchor: Anchor): void
}

/** the sidebar anchors to one of two page edges instead of nine spots */
export interface PaneMenuSides {
  getSide(): DockSide
  setSide(side: DockSide): void
}

/** how big every pane draws; only the notch offers it */
export interface PaneMenuFontSize {
  get(): PaneFontSize
  set(v: PaneFontSize): void
}

/** how much padding every pane draws; only the notch offers it */
export interface PaneMenuSpacing {
  get(): PaneSpacing
  set(v: PaneSpacing): void
}

/** whether the notch vanishes until the pointer comes near the top edge */
export interface PaneMenuHiding {
  get(): boolean
  set(v: boolean): void
}

export interface PaneMenuHost {
  element: HTMLElement
  document: Document
  /** factory injected by the Pane to avoid a module cycle */
  createPane(options: PaneOptions): Pane
  getTheme(): PaneTheme
  setTheme(theme: PaneTheme): void
  getStyle(): PaneStyle
  setStyle(style: PaneStyle): void
  getAccent(): string
  setAccent(accent: string): void
  getNumbers(): boolean
  setNumbers(v: boolean): void
  /** omitted for menus that control a group of panes, e.g. the dock sidebar */
  placement?: PaneMenuPlacement
  /** the dock's stand-in for the pane anchor grid */
  sides?: PaneMenuSides
  fontSize?: PaneMenuFontSize
  spacing?: PaneMenuSpacing
  hiding?: PaneMenuHiding
  /** drop below the host instead of beside it (the notch bar is too narrow) */
  menuBelow?: boolean
  onDispose(fn: () => void): void
}

/** 3x3 layout mirroring the window: corners, side centers, and center. */
const ANCHOR_GRID: Anchor[] = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  'center',
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

/** the sidebar only has two homes: the start or the end edge of the page */
const DOCK_SIDES: DockSide[] = ['left', 'right']

/** quick accent swatches, loosely based on syntax-highlighting palettes */
const ACCENT_PALETTE = [
  '#f87171',
  '#fb923c',
  '#facc15',
  '#65a30d',
  '#22d3ee',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
]

/**
 * Pane settings menu: a real embedded Pane, so every row is a regular binding
 * with the standard components and row behaviors (label click toggles/opens).
 * Opens beside the pane (gear or right-click); built lazily on first open.
 */
export function createPaneMenu(host: PaneMenuHost): { toggle(): void; close(): void } {
  const doc = host.document
  let built: { shell: HTMLElement; refresh: () => void } | null = null

  let open = false
  const onOutside = (e: PointerEvent) => {
    const target = e.target as Element | null
    // the trigger's own click handler toggles; closing here would re-open
    if (target?.closest?.('[data-tiao-menu-trigger]')) return
    // picker popups may render outside the menu node
    if (target?.closest?.('.tiao-popup')) return
    if (built && !built.shell.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  const openMenu = () => {
    open = true
    // built lazily on first open, so scope the document here too
    built ??= withDocument(doc, () => buildMenu(host))
    built.refresh()
    if (!host.menuBelow) {
      const rect = host.element.getBoundingClientRect()
      const menuWidth = built.shell.offsetWidth || 190
      const viewportWidth = doc.defaultView?.innerWidth ?? Infinity
      const fitsRight = rect.right + menuWidth + 12 <= viewportWidth
      built.shell.classList.toggle('tiao-menu-left', !fitsRight)
    }
    built.shell.classList.add('tiao-open')
    // capture phase so clicks inside other panes still close it
    doc.addEventListener('pointerdown', onOutside, true)
    doc.addEventListener('keydown', onKey)
  }
  const close = () => {
    if (!open) return
    open = false
    built?.shell.classList.remove('tiao-open')
    doc.removeEventListener('pointerdown', onOutside, true)
    doc.removeEventListener('keydown', onKey)
  }

  host.onDispose(close)
  return {
    toggle: () => (open ? close() : openMenu()),
    close,
  }
}

function buildMenu(host: PaneMenuHost): { shell: HTMLElement; refresh: () => void } {
  const shell = h('div', 'tiao-pane-menu')
  if (host.menuBelow) shell.classList.add('tiao-menu-below')
  host.element.append(shell)

  const placement = host.placement
  const { fontSize, spacing, hiding } = host
  const settings = {
    draggable: placement?.getDraggable() ?? false,
    hiding: hiding?.get() ?? false,
    theme: host.getTheme(),
    accent: host.getAccent(),
    numbers: host.getNumbers(),
  }
  const menuPane = host.createPane({ container: shell, menu: false, storage: false, size: 's' })
  host.onDispose(() => menuPane.dispose())

  // the embedded pane re-declares the theme variables, so its chrome has to
  // track the host's theme, style, and accent explicitly
  const syncChrome = () => {
    menuPane.theme = host.getTheme()
    menuPane.style = host.getStyle()
    menuPane.applyTheme({ accent: host.getAccent() })
  }

  /** re-reads for the rows that only some hosts have */
  const refreshers: (() => void)[] = []
  if (placement) {
    const drag = menuPane.addBinding(settings, 'draggable', { label: 'Draggable' })
    drag.on('change', (ev) => placement.setDraggable(Boolean(ev.value)))
    refreshers.push(() => {
      settings.draggable = placement.getDraggable()
      drag.refresh()
    })
  }
  if (hiding) {
    const binding = menuPane.addBinding(settings, 'hiding', { label: 'Hiding' })
    binding.on('change', (ev) => hiding.set(Boolean(ev.value)))
    refreshers.push(() => {
      settings.hiding = hiding.get()
      binding.refresh()
    })
  }
  const numbersBinding = menuPane.addBinding(settings, 'numbers', { label: 'Numbers' })
  numbersBinding.on('change', (ev) => host.setNumbers(Boolean(ev.value)))
  menuPane.addSeparator()

  if (fontSize) {
    const row = segmentedRow(host, 'Font Size', [
      { label: 'S', value: 'small', title: 'Small' },
      { label: 'M', value: 'normal', title: 'Normal' },
      { label: 'L', value: 'large', title: 'Large' },
    ], {
      get: () => fontSize.get(),
      set: (v) => fontSize.set(v),
    })
    menuPane.rack.append(row.row)
    refreshers.push(row.render)
  }
  if (spacing) {
    const row = segmentedRow(host, 'Spacing', [
      { label: 'S', value: 's', title: 'Small' },
      { label: 'M', value: 'm', title: 'Medium' },
      { label: 'L', value: 'l', title: 'Large' },
    ], {
      get: () => spacing.get(),
      set: (v) => spacing.set(v),
    })
    menuPane.rack.append(row.row)
    refreshers.push(row.render)
  }

  const themeBinding = menuPane.addBinding(settings, 'theme', {
    label: 'Theme',
    options: {
      System: 'system',
      Dark: 'dark',
      Light: 'light',
      Solarized: 'solarized',
      Nord: 'nord',
      Catppuccin: 'catppuccin',
    },
  })
  themeBinding.on('change', (ev) => {
    host.setTheme(ev.value)
    syncChrome()
  })

  const styleRow = segmentedRow(host, 'Style', [
    { label: 'Bouba', value: 'bouba' },
    { label: 'Kiki', value: 'kiki' },
  ], {
    get: () => host.getStyle(),
    set: (v) => {
      host.setStyle(v)
      syncChrome()
    },
  })
  menuPane.rack.append(styleRow.row)
  refreshers.push(styleRow.render)

  const accentBinding = menuPane.addBinding(settings, 'accent', { label: 'Accent' })
  accentBinding.on('change', (ev) => {
    // the picker fires per frame while dragging; preview those, save the last
    const apply = () => {
      host.setAccent(String(ev.value))
      syncChrome()
    }
    if (ev.last) apply()
    else withoutPersisting(apply)
  })

  // accent palette: blank-labeled row so swatches sit in the control column
  const palette = h('div', 'tiao-btngroup tiao-accent-palette')
  for (const color of ACCENT_PALETTE) {
    const btn = h('button', 'tiao-accent-swatch')
    btn.type = 'button'
    btn.title = color
    btn.style.background = color
    const onClick = () => {
      host.setAccent(color)
      settings.accent = color
      accentBinding.refresh()
      syncChrome()
    }
    btn.addEventListener('click', onClick)
    host.onDispose(() => btn.removeEventListener('click', onClick))
    palette.append(btn)
  }
  menuPane.rack.append(
    h('div', 'tiao-row', h('div', 'tiao-label'), h('div', 'tiao-control', palette)),
  )

  // anchor: a grid laid out like the region it picks (3x3 for panes, 1x2 for the dock)
  let anchors: { row: HTMLElement; render: () => void } | null = null
  if (placement) {
    anchors = anchorRow(host, 'tiao-anchor-grid', ANCHOR_GRID, {
      get: () => placement.getAnchor(),
      set: (anchor) => placement.setAnchor(anchor),
    })
  } else if (host.sides) {
    const sides = host.sides
    anchors = anchorRow(host, 'tiao-anchor-grid tiao-anchor-sides', DOCK_SIDES, {
      get: () => sides.getSide(),
      set: (side) => sides.setSide(side),
    })
  }
  if (anchors) {
    menuPane.rack.append(anchors.row)
    refreshers.push(anchors.render)
  }

  const refresh = () => {
    settings.theme = host.getTheme()
    settings.accent = host.getAccent()
    settings.numbers = host.getNumbers()
    themeBinding.refresh()
    accentBinding.refresh()
    numbersBinding.refresh()
    for (const fn of refreshers) fn()
    syncChrome()
  }

  return { shell, refresh }
}

/** label + segmented tabs; the selected tab is the current value */
function segmentedRow<T extends string>(
  host: PaneMenuHost,
  label: string,
  options: readonly { label: string; value: T; title?: string }[],
  value: { get(): T; set(v: T): void },
): { row: HTMLElement; render: () => void } {
  const nav = h('div', 'tiao-tab-nav')
  nav.setAttribute('role', 'tablist')
  const buttons = new Map<T, HTMLButtonElement>()
  const render = () => {
    const current = value.get()
    for (const [v, btn] of buttons) {
      const on = v === current
      btn.classList.toggle('tiao-selected', on)
      btn.setAttribute('aria-selected', String(on))
    }
  }
  for (const opt of options) {
    const btn = h('button', 'tiao-tab-button', opt.label)
    btn.type = 'button'
    btn.setAttribute('role', 'tab')
    if (opt.title) btn.title = opt.title
    const onClick = () => {
      value.set(opt.value)
      render()
    }
    btn.addEventListener('click', onClick)
    host.onDispose(() => btn.removeEventListener('click', onClick))
    buttons.set(opt.value, btn)
    nav.append(btn)
  }
  const row = h('div', 'tiao-row', h('div', 'tiao-label', label), h('div', 'tiao-control', nav))
  render()
  return { row, render }
}

/** one selectable cell per position, in a row labeled "Anchor" */
function anchorRow<T extends string>(
  host: PaneMenuHost,
  gridClass: string,
  values: readonly T[],
  value: { get(): T | null; set(v: T): void },
): { row: HTMLElement; render: () => void } {
  const grid = h('div', gridClass)
  const cells = new Map<T, HTMLButtonElement>()
  const render = () => {
    const current = value.get()
    for (const [v, btn] of cells) btn.classList.toggle('tiao-selected', v === current)
  }
  for (const v of values) {
    const btn = h('button', 'tiao-anchor-cell')
    btn.type = 'button'
    btn.title = v.replace('-', ' ')
    const onClick = () => {
      value.set(v)
      render()
    }
    btn.addEventListener('click', onClick)
    host.onDispose(() => btn.removeEventListener('click', onClick))
    cells.set(v, btn)
    grid.append(btn)
  }
  const row = h('div', 'tiao-row', h('div', 'tiao-label', 'Anchor'), h('div', 'tiao-control', grid))
  return { row, render }
}
