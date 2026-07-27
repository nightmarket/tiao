import { eyeIcon, eyeOffIcon, gearIcon, h, panelLeftIcon, rotateCcwIcon, withDocument } from './dom'
import {
  createPaneMenu,
  type PaneMenuFontSize,
  type PaneMenuHiding,
  type PaneMenuHost,
} from './pane-menu'

/** the notch menu drives one theme, style, and accent for every pane at once */
export interface NotchHost
  extends Omit<
    PaneMenuHost,
    'element' | 'placement' | 'sides' | 'fontSize' | 'hiding' | 'menuBelow' | 'onDispose'
  > {
  /** these two are global, so they live here rather than in a pane's menu */
  fontSize: PaneMenuFontSize
  hiding: PaneMenuHiding
  getHidden(): boolean
  toggleHidden(): void
  getDocked(): boolean
  toggleDocked(): void
  /** restore every bound value to the default the code declared */
  reset(): void
}

export interface Notch {
  element: HTMLElement
  sync(): void
  dispose(): void
}

/**
 * Global control bar pinned to the top edge of the viewport: hide/show every
 * floating pane, dock them into the sidebar, reset every bound value, and open
 * the settings panel that themes every pane at once. Built by the Pane (which
 * owns the pane registry) so this module stays free of pane imports.
 */
export function createNotch(host: NotchHost): Notch {
  const doc = host.document

  const chrome = withDocument(doc, () => {
    const hideBtn = notchButton('tiao-notch-hide', eyeIcon(), 'Hide debug panes')
    const dockBtn = notchButton('tiao-notch-dock', panelLeftIcon(), 'Dock panes to sidebar')
    const gear = notchButton('tiao-notch-gear', gearIcon(), 'Global settings')
    gear.setAttribute('data-tiao-menu-trigger', '')
    const resetBtn = notchButton('tiao-notch-reset', rotateCcwIcon(), 'Reset values to defaults')
    const element = h(
      'div',
      'tiao-notch',
      hideBtn,
      dockBtn,
      gear,
      h('div', 'tiao-notch-sep'),
      resetBtn,
    )
    element.setAttribute('role', 'toolbar')
    element.setAttribute('aria-label', 'Debug panes')
    return { element, hideBtn, dockBtn, gear, resetBtn }
  })
  const { element, hideBtn, dockBtn, gear, resetBtn } = chrome

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
    fontSize: host.fontSize,
    hiding: host.hiding,
    onDispose: (fn) => disposers.push(fn),
  })

  // sync runs per pane on a global toggle, so state changes gate the DOM work
  let lastHidden: boolean | null = null
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
    dockBtn.setAttribute('aria-label', docked ? 'Undock panes' : 'Dock panes to sidebar')
    dockBtn.setAttribute('aria-pressed', String(docked))
    dockBtn.classList.toggle('tiao-notch-on', docked)

    // the retreat itself is CSS, keyed off :hover; this only arms it
    element.classList.toggle('tiao-notch-auto-hide', host.hiding.get())
  }

  const onHide = () => host.toggleHidden()
  const onDock = () => host.toggleDocked()
  const onGear = () => menu.toggle()
  const onReset = () => host.reset()
  hideBtn.addEventListener('click', onHide)
  dockBtn.addEventListener('click', onDock)
  gear.addEventListener('click', onGear)
  resetBtn.addEventListener('click', onReset)

  sync()
  doc.body.append(element)

  return {
    element,
    sync,
    dispose() {
      hideBtn.removeEventListener('click', onHide)
      dockBtn.removeEventListener('click', onDock)
      gear.removeEventListener('click', onGear)
      resetBtn.removeEventListener('click', onReset)
      for (const fn of disposers) fn()
      element.remove()
    },
  }
}

/** icon button whose accessible name is its only label (no hover tooltip) */
function notchButton(cls: string, glyph: SVGSVGElement, label: string): HTMLButtonElement {
  const btn = h('button', `tiao-notch-btn ${cls}`, glyph)
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  return btn
}
