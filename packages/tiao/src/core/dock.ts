import { draggable, gearIcon, h, searchIcon, withDocument } from './dom'
import { createPaneMenu, type PaneMenuHost } from './pane-menu'
import type { PaneStyle, PaneTheme } from './pane'
import { clamp, jsonStore } from './util'

/** page edge the sidebar sits against */
export type DockSide = 'left' | 'right'

/** the sidebar menu drives the same settings a pane menu does, for every pane */
export interface DockHost extends Omit<PaneMenuHost, 'element' | 'placement' | 'sides' | 'onDispose'> {
  /** filter every docked pane at once */
  filter(query: string): void
}

/** sidebar-wide state: placement plus the one theme every docked pane shares */
export interface DockState {
  /** whether panes were left in the sidebar, reopened on the next load */
  docked?: boolean | undefined
  width?: number | undefined
  side?: DockSide | undefined
  theme?: PaneTheme | undefined
  style?: PaneStyle | undefined
  accent?: string | undefined
  numbers?: boolean | undefined
}

const MIN_WIDTH = 180
const MAX_WIDTH = 640
const DEFAULT_WIDTH = 300

const store = jsonStore<DockState>('tiao:dock')

export function readDockState(): DockState {
  return store.get()
}

export function writeDockState(patch: DockState): void {
  store.patch(patch)
}

interface DockEntry {
  root: HTMLElement
  body: HTMLElement
  /** the page's own inline padding, restored verbatim on close */
  priorPadding: { start: string; end: string }
  visible: boolean
  disposers: (() => void)[]
}

const docks = new WeakMap<Document, DockEntry>()

/** sidebar shell for this document, or null while panes are floating */
export function dockRoot(doc: Document): HTMLElement | null {
  return docks.get(doc)?.root ?? null
}

/** element docked panes are stacked into */
export function dockBody(doc: Document): HTMLElement | null {
  return docks.get(doc)?.body ?? null
}

/** Create the sidebar (once per document) and reflow the page beside it. */
export function ensureDock(host: DockHost): HTMLElement {
  const doc = host.document
  const existing = docks.get(doc)
  if (existing) return existing.body

  const chrome = withDocument(doc, () => {
    const searchBtn = h('button', 'tiao-titlebar-btn tiao-dock-search', searchIcon())
    searchBtn.type = 'button'
    searchBtn.title = 'Search'
    const gear = h('button', 'tiao-titlebar-btn tiao-dock-gear', gearIcon())
    gear.type = 'button'
    gear.title = 'Sidebar settings'
    gear.setAttribute('data-tiao-menu-trigger', '')
    const header = h('div', 'tiao-dock-header', h('div', 'tiao-titlebar-actions', searchBtn, gear))
    const searchInput = h('input', 'tiao-search-input')
    searchInput.type = 'search'
    searchInput.placeholder = 'Search'
    const searchbar = h('div', 'tiao-searchbar tiao-dock-searchbar', searchInput)
    const body = h('div', 'tiao-dock-body')
    const handle = h('div', 'tiao-resize tiao-dock-resize')
    const root = h('div', 'tiao-dock', header, searchbar, body, handle)
    return { root, body, searchBtn, searchInput, searchbar, gear, handle }
  })

  const entry: DockEntry = {
    root: chrome.root,
    body: chrome.body,
    priorPadding: {
      start: doc.body.style.getPropertyValue('padding-inline-start'),
      end: doc.body.style.getPropertyValue('padding-inline-end'),
    },
    visible: true,
    disposers: [],
  }
  docks.set(doc, entry)

  const { searchBtn, searchInput, searchbar, gear, handle } = chrome
  const setSearchOpen = (open: boolean) => {
    searchbar.classList.toggle('tiao-open', open)
    entry.root.classList.toggle('tiao-search-on', open)
    if (open) {
      searchInput.focus()
    } else {
      searchInput.value = ''
      searchInput.blur()
      host.filter('')
    }
  }
  const onSearchToggle = () => setSearchOpen(!searchbar.classList.contains('tiao-open'))
  const onSearchInput = () => host.filter(searchInput.value)
  const onSearchKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setSearchOpen(false)
    }
  }
  searchBtn.addEventListener('click', onSearchToggle)
  searchInput.addEventListener('input', onSearchInput)
  searchInput.addEventListener('keydown', onSearchKey)
  entry.disposers.push(() => {
    searchBtn.removeEventListener('click', onSearchToggle)
    searchInput.removeEventListener('input', onSearchInput)
    searchInput.removeEventListener('keydown', onSearchKey)
  })

  // one settings menu for the whole sidebar, standing in for every pane's own
  const menu = createPaneMenu({
    element: entry.root,
    document: doc,
    createPane: host.createPane,
    getTheme: host.getTheme,
    setTheme: host.setTheme,
    getStyle: host.getStyle,
    setStyle: host.setStyle,
    getAccent: host.getAccent,
    setAccent: host.setAccent,
    getNumbers: host.getNumbers,
    setNumbers: host.setNumbers,
    sides: {
      getSide: () => dockSide(),
      setSide: (side) => {
        writeDockState({ side })
        applySide(doc, entry)
      },
    },
    onDispose: (fn) => entry.disposers.push(fn),
  })
  const onGearClick = () => menu.toggle()
  gear.addEventListener('click', onGearClick)
  entry.disposers.push(() => gear.removeEventListener('click', onGearClick))

  installResize(doc, entry, handle)

  applyWidth(doc, readDockState().width)
  doc.body.prepend(entry.root)
  applySide(doc, entry)
  return entry.body
}

/** Remove the sidebar and restore the page's original padding. */
export function closeDock(doc: Document): void {
  const entry = docks.get(doc)
  if (!entry) return
  docks.delete(doc)
  for (const fn of entry.disposers) fn()
  entry.root.remove()
  doc.documentElement.style.removeProperty('--tiao-dock-width')
  restorePadding(doc, entry)
}

/** Hide the sidebar (and its page offset) without losing the docked state. */
export function setDockVisible(doc: Document, visible: boolean): void {
  const entry = docks.get(doc)
  if (!entry || entry.visible === visible) return
  entry.visible = visible
  entry.root.classList.toggle('tiao-hidden', !visible)
  if (visible) applyPadding(doc, entry)
  else restorePadding(doc, entry)
}

function dockSide(): DockSide {
  return readDockState().side ?? 'left'
}

/** Move the sidebar to its page edge and offset the page from that side. */
function applySide(doc: Document, entry: DockEntry): void {
  entry.root.classList.toggle('tiao-dock-end', dockSide() === 'right')
  if (entry.visible) applyPadding(doc, entry)
}

/** Drag the sidebar's outer edge to resize it; the page padding tracks along. */
function installResize(doc: Document, entry: DockEntry, handle: HTMLElement): void {
  let baseW = 0
  // the handle is on the page-facing edge, so a right-side dock grows leftward
  let grow = 1
  const apply = (dx: number, last: boolean) => {
    const width = clamp(baseW + dx * grow, MIN_WIDTH, MAX_WIDTH)
    applyWidth(doc, width)
    if (last) writeDockState({ width })
  }
  entry.disposers.push(
    draggable(handle, {
      onStart: () => {
        baseW = entry.root.getBoundingClientRect().width
        grow = dockSide() === 'right' ? -1 : 1
      },
      onMove: (s) => {
        if (s.moved) apply(s.dx, false)
      },
      onEnd: (s) => {
        if (s.moved) apply(s.dx, true)
      },
    }),
  )
}

function applyWidth(doc: Document, width: number | undefined): void {
  const w = clamp(width ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH)
  doc.documentElement.style.setProperty('--tiao-dock-width', `${w}px`)
}

function applyPadding(doc: Document, entry: DockEntry): void {
  restorePadding(doc, entry)
  const edge = dockSide() === 'right' ? 'padding-inline-end' : 'padding-inline-start'
  doc.body.style.setProperty(edge, 'var(--tiao-dock-width, 300px)')
}

function restorePadding(doc: Document, entry: DockEntry): void {
  setPadding(doc, 'padding-inline-start', entry.priorPadding.start)
  setPadding(doc, 'padding-inline-end', entry.priorPadding.end)
}

function setPadding(doc: Document, edge: string, value: string): void {
  if (value) doc.body.style.setProperty(edge, value)
  else doc.body.style.removeProperty(edge)
}
