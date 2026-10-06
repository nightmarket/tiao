import {
  checkIcon,
  copyIcon,
  eyeIcon,
  eyeOffIcon,
  focusIcon,
  gearIcon,
  h,
  importIcon,
  panelLeftIcon,
  redoIcon,
  rotateCcwIcon,
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
  dispose(): void
}

/**
 * Global control bar pinned to the top edge of the viewport: hide/show every
 * floating pane, dock them into the sidebar, undo/redo value edits, count and point out the values
 * changed from their defaults, copy, import, or reset every bound value, and
 * open the settings panel that themes every pane at once.
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
    const gear = notchButton('tiao-notch-gear', gearIcon(), 'Global settings')
    gear.setAttribute('data-tiao-menu-trigger', '')
    const undoBtn = notchButton('tiao-notch-undo', undoIcon(), 'Undo')
    const redoBtn = notchButton('tiao-notch-redo', redoIcon(), 'Redo')
    const count = h('span', 'tiao-notch-count')
    const revealBtn = notchButton('tiao-notch-reveal', focusIcon(), 'Show changed parameters')
    const copyBtn = notchButton('tiao-notch-copy', copyIcon(), 'Copy settings')
    const importBtn = notchButton('tiao-notch-import', importIcon(), 'Import settings')
    importBtn.setAttribute('aria-haspopup', 'dialog')
    importBtn.setAttribute('aria-expanded', 'false')
    const resetBtn = notchButton(
      'tiao-notch-reset',
      rotateCcwIcon(),
      'Reset values and positions to defaults',
    )
    const element = h(
      'div',
      'tiao-notch',
      hideBtn,
      dockBtn,
      gear,
      h('div', 'tiao-notch-sep'),
      undoBtn,
      redoBtn,
      h('div', 'tiao-notch-sep'),
      count,
      revealBtn,
      copyBtn,
      importBtn,
      resetBtn,
    )
    element.setAttribute('role', 'toolbar')
    element.setAttribute('aria-label', 'Debug panes')
    return {
      element,
      hideBtn,
      dockBtn,
      gear,
      undoBtn,
      redoBtn,
      count,
      revealBtn,
      copyBtn,
      importBtn,
      resetBtn,
    }
  })
  const {
    element,
    hideBtn,
    dockBtn,
    gear,
    undoBtn,
    redoBtn,
    count,
    revealBtn,
    copyBtn,
    importBtn,
    resetBtn,
  } = chrome

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
  const onMove = (e: PointerEvent) => setNear(e.clientY <= REVEAL_BAND)
  // pointer left the window entirely, so no further move will retract the bar
  const onLeave = () => setNear(false)
  const stopWatching = () => {
    doc.removeEventListener('pointermove', onMove)
    doc.documentElement.removeEventListener('mouseleave', onLeave)
    setNear(false)
  }

  let overrides = -1
  const syncValues = () => {
    undoBtn.disabled = !host.history.canUndo()
    redoBtn.disabled = !host.history.canRedo()
    const n = host.countOverrides()
    if (n === overrides) return
    overrides = n
    count.textContent = `${n} set`
    count.classList.toggle('tiao-notch-count-zero', n === 0)
    revealBtn.disabled = n === 0
  }

  // sync runs per pane on a global toggle, so state changes gate the DOM work
  let lastHidden: boolean | null = null
  let lastHiding: boolean | null = null
  const sync = () => {
    syncValues()
    const hidden = host.getHidden()
    if (hidden !== lastHidden) {
      lastHidden = hidden
      hideBtn.replaceChildren(withDocument(doc, () => (hidden ? eyeOffIcon() : eyeIcon())))
      hideBtn.setAttribute('aria-label', hidden ? 'Show debug panes' : 'Hide debug panes')
      hideBtn.setAttribute('aria-pressed', String(hidden))
      element.classList.toggle('tiao-notch-hidden-panes', hidden)
    }

    const docked = host.getDocked()
    dockBtn.setAttribute('aria-label', docked ? 'Undock panes' : 'Dock panes to sidebar')
    dockBtn.setAttribute('aria-pressed', String(docked))
    dockBtn.classList.toggle('tiao-notch-on', docked)

    // the retreat itself is CSS; this arms it and only then watches the pointer
    const hiding = host.hiding.get()
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

  let copiedTimer: ReturnType<typeof setTimeout> | undefined
  const showCopied = () => {
    clearTimeout(copiedTimer)
    copyBtn.replaceChildren(withDocument(doc, checkIcon))
    copyBtn.setAttribute('aria-label', 'Copied settings')
    copyBtn.classList.add('tiao-notch-on')
    copiedTimer = setTimeout(() => {
      copyBtn.replaceChildren(withDocument(doc, copyIcon))
      copyBtn.setAttribute('aria-label', 'Copy settings')
      copyBtn.classList.remove('tiao-notch-on')
    }, COPIED_MS)
  }

  const onHide = () => host.toggleHidden()
  const onDock = () => host.toggleDocked()
  const onGear = () => menu.toggle()
  const onCopy = () => {
    const text = JSON.stringify(host.exportValues(), null, 2)
    // without clipboard access, hand the text over in the paste box instead
    const fallback = () => importPanel.open(text, 'Clipboard unavailable, copy the text above')
    const clipboard = doc.defaultView?.navigator.clipboard
    if (!clipboard) fallback()
    else clipboard.writeText(text).then(showCopied, fallback)
  }
  const onImport = () => importPanel.toggle()
  const onReset = () => host.reset()
  const onReveal = () => host.revealOverrides()
  const onUndo = () => host.history.undo()
  const onRedo = () => host.history.redo()
  hideBtn.addEventListener('click', onHide)
  dockBtn.addEventListener('click', onDock)
  gear.addEventListener('click', onGear)
  undoBtn.addEventListener('click', onUndo)
  redoBtn.addEventListener('click', onRedo)
  revealBtn.addEventListener('click', onReveal)
  copyBtn.addEventListener('click', onCopy)
  importBtn.addEventListener('click', onImport)
  resetBtn.addEventListener('click', onReset)

  disposers.push(
    tooltip(hideBtn, () => (host.getHidden() ? 'Show panes' : 'Hide panes')),
    tooltip(dockBtn, () => (host.getDocked() ? 'Undock' : 'Dock to sidebar')),
    tooltip(gear, () => 'Settings'),
    tooltip(undoBtn, () => 'Undo'),
    tooltip(redoBtn, () => 'Redo'),
    tooltip(count, () => `${overrides} changed from defaults`),
    tooltip(revealBtn, () => 'Show changed'),
    tooltip(copyBtn, () => 'Copy settings'),
    tooltip(importBtn, () => 'Import settings'),
    tooltip(resetBtn, () => 'Reset to defaults'),
  )

  sync()
  doc.body.append(element)

  return {
    element,
    sync,
    syncValues,
    dispose() {
      hideBtn.removeEventListener('click', onHide)
      dockBtn.removeEventListener('click', onDock)
      gear.removeEventListener('click', onGear)
      undoBtn.removeEventListener('click', onUndo)
      redoBtn.removeEventListener('click', onRedo)
      revealBtn.removeEventListener('click', onReveal)
      copyBtn.removeEventListener('click', onCopy)
      importBtn.removeEventListener('click', onImport)
      resetBtn.removeEventListener('click', onReset)
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

/** icon button named by aria-label; its visible tooltip is a shorter form */
function notchButton(cls: string, glyph: SVGSVGElement, label: string): HTMLButtonElement {
  const btn = h('button', `tiao-notch-btn ${cls}`, glyph)
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  return btn
}
