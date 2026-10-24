import {
  checkIcon,
  copyIcon,
  eyeIcon,
  eyeOffIcon,
  gearIcon,
  h,
  importIcon,
  logoMark,
  moreIcon,
  panelLeftIcon,
  redoIcon,
  rotateCcwIcon,
  searchIcon,
  undoIcon,
  withDocument,
} from './dom'
import {
  createPaneMenu,
  type PaneMenuFont,
  type PaneMenuFontSize,
  type PaneMenuHost,
  type PaneMenuSpacing,
  type PaneMenuToggle,
} from './pane-menu'
import { tooltip } from './tooltip'

/** the notch menu drives one theme, style, and accent for every pane at once */
export interface NotchHost
  extends Omit<
    PaneMenuHost,
    | 'element'
    | 'placement'
    | 'sides'
    | 'fontSize'
    | 'spacing'
    | 'hiding'
    | 'glass'
    | 'font'
    | 'menuBelow'
    | 'onDispose'
  > {
  /** these are global, so they live here rather than in a pane's menu */
  font: PaneMenuFont
  fontSize: PaneMenuFontSize
  spacing: PaneMenuSpacing
  hiding: PaneMenuToggle
  glass: PaneMenuToggle
  getHidden(): boolean
  toggleHidden(): void
  /** whether the panes can dock to the sidebar, which only the window's can */
  dockable: boolean
  getDocked(): boolean
  toggleDocked(): void
  /** restore every bound value and pane position to the default the code declared */
  reset(): void
  /** every persisted bound value, JSON-ready */
  exportValues(): unknown
  /** apply what exportValues produced; returns how many rows took a value */
  importValues(data: unknown): number
  /** how many editable rows differ from their code default */
  countOverrides(): number
  /** value edits across every pane, walked by the undo/redo buttons */
  history: NotchHistory
  /** flash every overridden row, opening what hides it */
  revealOverrides(): void
  /** find any row in any pane by name */
  openSearch(): void
}

export interface NotchHistory {
  canUndo(): boolean
  canRedo(): boolean
  undo(): void
  redo(): void
}

/** how close to the top edge the pointer has to get to reveal a hidden bar */
const REVEAL_BAND = 32

/** how long the copy button shows its check after a successful copy */
const COPIED_MS = 1200

export interface Notch {
  /** the themed bar; chrome tokens land here */
  element: HTMLElement
  sync(): void
  /** re-read the override count and undo/redo state (cheap; runs after value changes) */
  syncValues(): void
  /**
   * Ride the top of `scope` instead of the window (null for the window). There
   * it stays shown, unless `hiding` lets it retreat like the window's until the
   * pointer nears the scope's top edge.
   */
  setScope(scope: HTMLElement | null, hiding: boolean): void
  dispose(): void
}

/**
 * Global control bar pinned to the top edge of the viewport: hide/show every
 * floating pane, dock them into the sidebar, search every row, undo/redo value
 * edits, count and point out the values changed from their defaults, and open
 * the settings panel that themes every pane at once. Copy, import, and reset
 * of every bound value sit in an overflow menu.
 * Built by the Pane (which owns the pane registry) so this module stays free
 * of pane imports.
 *
 * Auto-hide tracks the pointer's distance from the top edge instead of hovering
 * a hit strip: a strip would have to swallow clicks meant for the panes and the
 * sidebar header sitting right under it.
 */
export function createNotch(host: NotchHost): Notch {
  const doc = host.document

  const chrome = withDocument(doc, () => {
    const hideBtn = notchButton('tiao-notch-hide', eyeIcon(), 'Hide debug panes')
    const dockBtn = notchButton('tiao-notch-dock', panelLeftIcon(), 'Dock panes to sidebar')
    const searchBtn = notchButton('tiao-notch-search', searchIcon(), 'Search parameters')
    const gear = notchButton('tiao-notch-gear', gearIcon(), 'Global settings')
    gear.setAttribute('data-tiao-menu-trigger', '')
    const undoBtn = notchButton('tiao-notch-undo', undoIcon(), 'Undo')
    const redoBtn = notchButton('tiao-notch-redo', redoIcon(), 'Redo')
    const changesText = h('span')
    const changesBtn = h(
      'button',
      'tiao-notch-changes',
      h('span', 'tiao-notch-changes-dot'),
      changesText,
    )
    changesBtn.type = 'button'
    const copyBtn = menuItem('tiao-notch-copy', copyIcon(), 'Copy', 'Copy settings')
    const importBtn = menuItem('tiao-notch-import', importIcon(), 'Import', 'Import settings')
    importBtn.setAttribute('aria-haspopup', 'dialog')
    importBtn.setAttribute('aria-expanded', 'false')
    const resetBtn = menuItem(
      'tiao-notch-reset',
      rotateCcwIcon(),
      'Reset to defaults',
      'Reset values and positions to defaults',
    )
    const moreMenu = h('div', 'tiao-notch-menu', copyBtn, importBtn, resetBtn)
    moreMenu.setAttribute('role', 'menu')
    const moreBtn = notchButton('tiao-notch-more', moreIcon(), 'More actions')
    moreBtn.setAttribute('aria-haspopup', 'menu')
    moreBtn.setAttribute('aria-expanded', 'false')
    const more = h('div', 'tiao-notch-more-wrap', moreBtn, moreMenu)
    const element = h(
      'div',
      'tiao-notch',
      h('span', 'tiao-notch-logo', logoMark()),
      h('div', 'tiao-notch-sep'),
      hideBtn,
      dockBtn,
      searchBtn,
      h('div', 'tiao-notch-sep'),
      undoBtn,
      redoBtn,
      h('div', 'tiao-notch-sep'),
      changesBtn,
      h('div', 'tiao-notch-sep'),
      more,
      gear,
    )
    element.setAttribute('role', 'toolbar')
    element.setAttribute('aria-label', 'Debug panes')
    return {
      element,
      hideBtn,
      dockBtn,
      searchBtn,
      gear,
      undoBtn,
      redoBtn,
      changesBtn,
      changesText,
      copyBtn,
      importBtn,
      resetBtn,
      more,
      moreBtn,
      moreMenu,
    }
  })
  const {
    element,
    hideBtn,
    dockBtn,
    searchBtn,
    gear,
    undoBtn,
    redoBtn,
    changesBtn,
    changesText,
    copyBtn,
    importBtn,
    resetBtn,
    more,
    moreBtn,
    moreMenu,
  } = chrome
  if (!host.dockable) dockBtn.remove()

  const disposers: (() => void)[] = []

  // one settings panel for every pane, floating or docked
  const menu = createPaneMenu({
    element,
    document: doc,
    menuBelow: true,
    createPane: host.createPane,
    getTheme: host.getTheme,
    setTheme: host.setTheme,
    getStyle: host.getStyle,
    setStyle: host.setStyle,
    getAccent: host.getAccent,
    setAccent: host.setAccent,
    getNumbers: host.getNumbers,
    setNumbers: host.setNumbers,
    hoverControls: host.hoverControls,
    font: host.font,
    fontSize: host.fontSize,
    spacing: host.spacing,
    hiding: host.hiding,
    glass: host.glass,
    iconThemes: true,
    onDispose: (fn) => disposers.push(fn),
  })

  const importPanel = createImportPanel(host, element, importBtn)
  disposers.push(importPanel.dispose)

  let near = false
  const setNear = (next: boolean) => {
    if (next === near) return
    near = next
    element.classList.toggle('tiao-notch-near', next)
  }
  let scope: HTMLElement | null = null
  let scopeHides = false
  const onMove = (e: PointerEvent) => {
    if (!scope) {
      setNear(e.clientY <= REVEAL_BAND)
      return
    }
    // the band straddles the scope's top edge, over its width
    const rect = scope.getBoundingClientRect()
    setNear(
      e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        Math.abs(e.clientY - rect.top) <= REVEAL_BAND,
    )
  }
  // pointer left the window entirely, so no further move will retract the bar
  const onLeave = () => setNear(false)
  const stopWatching = () => {
    doc.removeEventListener('pointermove', onMove)
    doc.documentElement.removeEventListener('mouseleave', onLeave)
    setNear(false)
  }

  let overrides = -1
  const syncValues = () => {
    syncHistoryButtons(host.history, undoBtn, redoBtn)
    const n = host.countOverrides()
    if (n === overrides) return
    overrides = n
    changesText.textContent = `${n} changed`
    changesBtn.disabled = n === 0
    changesBtn.setAttribute('aria-label', `Show ${n} changed parameters`)
  }

  let menuOpen = false
  const onMenuOutside = (e: PointerEvent) => {
    if (!more.contains(e.target as Node | null)) setMenuOpen(false)
  }
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setMenuOpen(false)
  }
  function setMenuOpen(open: boolean) {
    if (open === menuOpen) return
    menuOpen = open
    moreMenu.classList.toggle('tiao-open', open)
    moreBtn.setAttribute('aria-expanded', String(open))
    if (open) {
      doc.addEventListener('pointerdown', onMenuOutside, true)
      doc.addEventListener('keydown', onMenuKey)
    } else {
      doc.removeEventListener('pointerdown', onMenuOutside, true)
      doc.removeEventListener('keydown', onMenuKey)
    }
  }

  // sync runs per pane mount and global toggle, so state changes gate the DOM
  // work; the override count follows values instead (syncValues)
  let lastHidden: boolean | null = null
  let lastDocked: boolean | null = null
  let lastHiding: boolean | null = null
  const sync = () => {
    const hidden = host.getHidden()
    if (hidden !== lastHidden) {
      lastHidden = hidden
      hideBtn.replaceChildren(withDocument(doc, () => (hidden ? eyeOffIcon() : eyeIcon())))
      hideBtn.setAttribute('aria-label', hidden ? 'Show debug panes' : 'Hide debug panes')
      hideBtn.setAttribute('aria-pressed', String(hidden))
      element.classList.toggle('tiao-notch-hidden-panes', hidden)
    }

    const docked = host.getDocked()
    if (docked !== lastDocked) {
      lastDocked = docked
      dockBtn.setAttribute('aria-label', docked ? 'Undock panes' : 'Dock panes to sidebar')
      dockBtn.setAttribute('aria-pressed', String(docked))
      dockBtn.classList.toggle('tiao-notch-on', docked)
    }

    // the retreat itself is CSS; this arms it and only then watches the pointer.
    // It keeps the window's edge clear, so a notch on a scope element stays put unless it opted in
    const hiding = host.hiding.get() && (!scope || scopeHides)
    if (hiding !== lastHiding) {
      lastHiding = hiding
      element.classList.toggle('tiao-notch-auto-hide', hiding)
      if (hiding) {
        doc.addEventListener('pointermove', onMove, { passive: true })
        doc.documentElement.addEventListener('mouseleave', onLeave)
      } else {
        stopWatching()
      }
    }
  }

  // the menu stays open on a copy, so the item itself can confirm it
  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  const setCopyItem = (copied: boolean) => {
    copyBtn.replaceChildren(
      withDocument(doc, copied ? checkIcon : copyIcon),
      copied ? 'Copied' : 'Copy',
    )
    copyBtn.setAttribute('aria-label', copied ? 'Copied settings' : 'Copy settings')
    copyBtn.classList.toggle('tiao-notch-on', copied)
  }
  const showCopied = () => {
    clearTimeout(copiedTimer)
    setCopyItem(true)
    copiedTimer = setTimeout(() => setCopyItem(false), COPIED_MS)
  }

  const onHide = () => host.toggleHidden()
  const onDock = () => host.toggleDocked()
  const onSearch = () => host.openSearch()
  const onGear = () => menu.toggle()
  const onMore = () => setMenuOpen(!menuOpen)
  const onCopy = () => {
    const text = JSON.stringify(host.exportValues(), null, 2)
    // without clipboard access, hand the text over in the paste box instead
    const fallback = () => {
      setMenuOpen(false)
      importPanel.open(text, 'Clipboard unavailable, copy the text above')
    }
    const clipboard = doc.defaultView?.navigator.clipboard
    if (!clipboard) fallback()
    else clipboard.writeText(text).then(showCopied, fallback)
  }
  const onImport = () => {
    setMenuOpen(false)
    importPanel.toggle()
  }
  const onReset = () => {
    setMenuOpen(false)
    host.reset()
  }
  const onChanges = () => host.revealOverrides()
  const onUndo = () => host.history.undo()
  const onRedo = () => host.history.redo()
  hideBtn.addEventListener('click', onHide)
  dockBtn.addEventListener('click', onDock)
  searchBtn.addEventListener('click', onSearch)
  gear.addEventListener('click', onGear)
  moreBtn.addEventListener('click', onMore)
  undoBtn.addEventListener('click', onUndo)
  redoBtn.addEventListener('click', onRedo)
  changesBtn.addEventListener('click', onChanges)
  copyBtn.addEventListener('click', onCopy)
  importBtn.addEventListener('click', onImport)
  resetBtn.addEventListener('click', onReset)

  disposers.push(
    tooltip(hideBtn, () => (host.getHidden() ? 'Show panes (H)' : 'Hide panes (H)')),
    tooltip(dockBtn, () => (host.getDocked() ? 'Undock' : 'Dock to sidebar')),
    tooltip(searchBtn, () => 'Search (TT)'),
    tooltip(gear, () => 'Settings'),
    tooltip(moreBtn, () => 'More'),
    tooltip(undoBtn, () => 'Undo'),
    tooltip(redoBtn, () => 'Redo'),
    tooltip(changesBtn, () => 'Show changed'),
  )

  sync()
  syncValues()
  doc.body.append(element)

  return {
    element,
    sync,
    syncValues,
    setScope(next, hiding) {
      scope = next
      scopeHides = hiding
      setNear(false)
      element.classList.toggle('tiao-notch-scoped', next !== null)
      ;(next ?? doc.body).append(element)
      sync()
    },
    dispose() {
      hideBtn.removeEventListener('click', onHide)
      dockBtn.removeEventListener('click', onDock)
      searchBtn.removeEventListener('click', onSearch)
      gear.removeEventListener('click', onGear)
      moreBtn.removeEventListener('click', onMore)
      undoBtn.removeEventListener('click', onUndo)
      redoBtn.removeEventListener('click', onRedo)
      changesBtn.removeEventListener('click', onChanges)
      copyBtn.removeEventListener('click', onCopy)
      importBtn.removeEventListener('click', onImport)
      resetBtn.removeEventListener('click', onReset)
      setMenuOpen(false)
      clearTimeout(copiedTimer)
      stopWatching()
      for (const fn of disposers) fn()
      element.remove()
    },
  }
}

interface ImportPanel {
  /** show the box holding `text`, with `status` under it */
  open(text?: string, status?: string): void
  toggle(): void
  dispose(): void
}

/**
 * Paste box dropped under the notch: takes JSON from the copy button (from
 * this page or another browser) and hands it to the host.
 */
function createImportPanel(
  host: NotchHost,
  notch: HTMLElement,
  trigger: HTMLButtonElement,
): ImportPanel {
  const doc = host.document
  const { element, input, status, cancelBtn, applyBtn } = withDocument(doc, () => {
    const input = h('textarea', 'tiao-import-input')
    input.placeholder = 'Paste settings JSON'
    input.spellcheck = false
    input.setAttribute('aria-label', 'Settings JSON')
    const status = h('div', 'tiao-import-status')
    status.setAttribute('role', 'status')
    const cancelBtn = h('button', 'tiao-button', 'Cancel')
    cancelBtn.type = 'button'
    const applyBtn = h('button', 'tiao-button tiao-import-apply', 'Import')
    applyBtn.type = 'button'
    const element = h(
      'div',
      'tiao-import',
      input,
      status,
      h('div', 'tiao-btngroup', cancelBtn, applyBtn),
    )
    element.setAttribute('role', 'dialog')
    element.setAttribute('aria-label', 'Import settings')
    return { element, input, status, cancelBtn, applyBtn }
  })
  notch.append(element)

  let isOpen = false
  const onOutside = (e: PointerEvent) => {
    const target = e.target as Node | null
    if (target && (element.contains(target) || trigger.contains(target))) return
    close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      submit()
    }
  }

  function open(text = '', message = '') {
    input.value = text
    status.textContent = message
    if (!isOpen) {
      isOpen = true
      element.classList.add('tiao-open')
      trigger.setAttribute('aria-expanded', 'true')
      doc.addEventListener('pointerdown', onOutside, true)
      element.addEventListener('keydown', onKey)
    }
    input.focus()
    if (text) input.select()
  }
  function close() {
    if (!isOpen) return
    isOpen = false
    element.classList.remove('tiao-open')
    trigger.setAttribute('aria-expanded', 'false')
    doc.removeEventListener('pointerdown', onOutside, true)
    element.removeEventListener('keydown', onKey)
  }
  function submit() {
    let data: unknown
    try {
      data = JSON.parse(input.value)
    } catch {
      status.textContent = 'Not valid JSON'
      return
    }
    if (host.importValues(data) === 0) {
      status.textContent = 'No matching settings found'
      return
    }
    close()
  }

  const onInput = () => {
    status.textContent = ''
  }
  input.addEventListener('input', onInput)
  cancelBtn.addEventListener('click', close)
  applyBtn.addEventListener('click', submit)

  return {
    open,
    toggle: () => (isOpen ? close() : open()),
    dispose() {
      close()
      input.removeEventListener('input', onInput)
      cancelBtn.removeEventListener('click', close)
      applyBtn.removeEventListener('click', submit)
    },
  }
}

/** undo and redo grey out when there is nothing to step over */
export function syncHistoryButtons(
  history: NotchHistory,
  undo: HTMLButtonElement,
  redo: HTMLButtonElement,
): void {
  const canUndo = history.canUndo()
  const canRedo = history.canRedo()
  if (undo.disabled === canUndo) undo.disabled = !canUndo
  if (redo.disabled === canRedo) redo.disabled = !canRedo
}

/** icon button named by aria-label; its visible tooltip is a shorter form */
function notchButton(cls: string, glyph: SVGSVGElement, label: string): HTMLButtonElement {
  const btn = h('button', `tiao-notch-btn ${cls}`, glyph)
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  return btn
}

/** an icon and a short visible name, with a fuller accessible one */
function menuItem(
  cls: string,
  glyph: SVGSVGElement,
  text: string,
  label: string,
): HTMLButtonElement {
  const btn = h('button', `tiao-notch-menu-item ${cls}`, glyph, text)
  btn.type = 'button'
  btn.setAttribute('role', 'menuitem')
  btn.setAttribute('aria-label', label)
  return btn
}
