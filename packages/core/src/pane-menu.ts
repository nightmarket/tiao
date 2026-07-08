import { h } from './dom'
import type { Anchor } from './pane'

export interface PaneMenuHost {
  element: HTMLElement
  document: Document
  getDraggable(): boolean
  setDraggable(v: boolean): void
  getAnchor(): Anchor | null
  setAnchor(anchor: Anchor): void
  onDispose(fn: () => void): void
}

/** 3x3 layout: corners + side centers, empty middle. */
const ANCHOR_GRID: (Anchor | null)[] = [
  'top-left',
  'top-center',
  'top-right',
  'left-center',
  null,
  'right-center',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

/**
 * Pane settings menu: draggable toggle + anchor grid.
 * Opens beside the pane (gear click or right-click).
 */
export function createPaneMenu(host: PaneMenuHost): { toggle(): void; close(): void } {
  const doc = host.document

  const dragCheck = h('button', 'tiao-check')
  dragCheck.type = 'button'
  dragCheck.setAttribute('role', 'switch')
  const dragRow = h('div', 'tiao-pane-menu-row', h('span', 'tiao-label', 'Draggable'), dragCheck)

  const grid = h('div', 'tiao-anchor-grid')
  const anchorButtons = new Map<Anchor, HTMLButtonElement>()
  for (const anchor of ANCHOR_GRID) {
    if (!anchor) {
      grid.append(h('span', 'tiao-anchor-spacer'))
      continue
    }
    const btn = h('button', 'tiao-anchor-cell')
    btn.type = 'button'
    btn.title = anchor.replace('-', ' ')
    const onClick = () => {
      host.setAnchor(anchor)
      render()
    }
    btn.addEventListener('click', onClick)
    host.onDispose(() => btn.removeEventListener('click', onClick))
    anchorButtons.set(anchor, btn)
    grid.append(btn)
  }

  const menu = h(
    'div',
    'tiao-pane-menu',
    dragRow,
    h('div', 'tiao-pane-menu-label', 'Anchor'),
    grid,
  )
  host.element.append(menu)

  const render = () => {
    const draggable = host.getDraggable()
    dragCheck.classList.toggle('tiao-checked', draggable)
    dragCheck.setAttribute('aria-checked', String(draggable))
    const current = host.getAnchor()
    for (const [anchor, btn] of anchorButtons) {
      btn.classList.toggle('tiao-selected', anchor === current)
    }
  }

  const onDragToggle = () => {
    host.setDraggable(!host.getDraggable())
    render()
  }
  dragCheck.addEventListener('click', onDragToggle)
  host.onDispose(() => dragCheck.removeEventListener('click', onDragToggle))

  let open = false
  const onOutside = (e: PointerEvent) => {
    const target = e.target as Element | null
    // the trigger's own click handler toggles; closing here would re-open
    if (target?.closest?.('[data-tiao-menu-trigger]')) return
    if (!menu.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  const openMenu = () => {
    open = true
    render()
    menu.classList.add('tiao-open')
    // open to whichever side of the pane has room
    const rect = host.element.getBoundingClientRect()
    const menuWidth = menu.offsetWidth || 140
    const viewportWidth = doc.defaultView?.innerWidth ?? Infinity
    const fitsRight = rect.right + menuWidth + 12 <= viewportWidth
    menu.classList.toggle('tiao-menu-left', !fitsRight)
    // capture phase so clicks inside other panes still close it
    doc.addEventListener('pointerdown', onOutside, true)
    doc.addEventListener('keydown', onKey)
  }
  const close = () => {
    if (!open) return
    open = false
    menu.classList.remove('tiao-open')
    doc.removeEventListener('pointerdown', onOutside, true)
    doc.removeEventListener('keydown', onKey)
  }

  host.onDispose(close)
  return {
    toggle: () => (open ? close() : openMenu()),
    close,
  }
}
