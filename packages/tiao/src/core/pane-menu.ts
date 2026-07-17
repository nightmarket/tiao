import { h, withDocument } from './dom'
import type { Anchor, Pane, PaneOptions, PaneStyle, PaneTheme } from './pane'

export interface PaneMenuHost {
  element: HTMLElement
  document: Document
  /** factory injected by the Pane to avoid a module cycle */
  createPane(options: PaneOptions): Pane
  getDraggable(): boolean
  setDraggable(v: boolean): void
  getAnchor(): Anchor | null
  setAnchor(anchor: Anchor): void
  getTheme(): PaneTheme
  setTheme(theme: PaneTheme): void
  getStyle(): PaneStyle
  setStyle(style: PaneStyle): void
  getAccent(): string
  setAccent(accent: string): void
  getNumbers(): boolean
  setNumbers(v: boolean): void
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
    built.shell.classList.add('tiao-open')
    // open to whichever side of the pane has room
    const rect = host.element.getBoundingClientRect()
    const menuWidth = built.shell.offsetWidth || 190
    const viewportWidth = doc.defaultView?.innerWidth ?? Infinity
    const fitsRight = rect.right + menuWidth + 12 <= viewportWidth
    built.shell.classList.toggle('tiao-menu-left', !fitsRight)
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
  host.element.append(shell)

  const settings = {
    draggable: host.getDraggable(),
    theme: host.getTheme(),
    style: host.getStyle(),
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

  const dragBinding = menuPane.addBinding(settings, 'draggable', { label: 'Draggable' })
  dragBinding.on('change', (ev) => host.setDraggable(Boolean(ev.value)))

  const numbersBinding = menuPane.addBinding(settings, 'numbers', { label: 'Numbers' })
  numbersBinding.on('change', (ev) => host.setNumbers(Boolean(ev.value)))

  menuPane.addSeparator()

  const themeBinding = menuPane.addBinding(settings, 'theme', {
    label: 'Theme',
    options: {
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

  const styleBinding = menuPane.addBinding(settings, 'style', {
    label: 'Style',
    options: {
      Bouba: 'bouba',
      Kiki: 'kiki',
    },
  })
  styleBinding.on('change', (ev) => {
    host.setStyle(ev.value)
    syncChrome()
  })

  const accentBinding = menuPane.addBinding(settings, 'accent', { label: 'Accent' })
  accentBinding.on('change', (ev) => {
    host.setAccent(String(ev.value))
    syncChrome()
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

  // anchor: 3x3 button grid in a standard row
  const grid = h('div', 'tiao-anchor-grid')
  const anchorButtons = new Map<Anchor, HTMLButtonElement>()
  for (const anchor of ANCHOR_GRID) {
    const btn = h('button', 'tiao-anchor-cell')
    btn.type = 'button'
    btn.title = anchor.replace('-', ' ')
    const onClick = () => {
      host.setAnchor(anchor)
      renderAnchors()
    }
    btn.addEventListener('click', onClick)
    host.onDispose(() => btn.removeEventListener('click', onClick))
    anchorButtons.set(anchor, btn)
    grid.append(btn)
  }
  menuPane.rack.append(
    h('div', 'tiao-row', h('div', 'tiao-label', 'Anchor'), h('div', 'tiao-control', grid)),
  )

  const renderAnchors = () => {
    const current = host.getAnchor()
    for (const [anchor, btn] of anchorButtons) {
      btn.classList.toggle('tiao-selected', anchor === current)
    }
  }

  const refresh = () => {
    settings.draggable = host.getDraggable()
    settings.theme = host.getTheme()
    settings.style = host.getStyle()
    settings.accent = host.getAccent()
    settings.numbers = host.getNumbers()
    dragBinding.refresh()
    themeBinding.refresh()
    styleBinding.refresh()
    accentBinding.refresh()
    numbersBinding.refresh()
    renderAnchors()
    syncChrome()
  }

  return { shell, refresh }
}
