import { draggable, h, redoIcon, rotateCcwIcon, undoIcon, withDocument } from './dom'
import { type NotchHost, syncHistoryButtons } from './notch'
import { jsonStore } from './util'

/** viewport corner the drawer controls rest in */
export type DrawerCorner = `${'top' | 'bottom'}-${'left' | 'right'}`

interface DrawerControlsState {
  corner?: DrawerCorner | undefined
}

const store = jsonStore<DrawerControlsState>('tiao:mobile')

/** finger travel that turns a press into a drag; anything shorter is a tap */
const DRAG_SLOP = 8

/** the glide from where a drag let go into its corner */
const SNAP_MS = 260

/** open UI inside the drawer that takes the first Escape for itself */
const OPEN_OVERLAYS = '.tiao-pane-menu.tiao-open, .tiao-popup.tiao-open'

/**
 * Presses on these buttons are tiao's alone: a page listening on window (a
 * pointerup that picks 3D objects, say) must not act on them too.
 */
const PRESS_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'touchstart',
  'touchend',
  'click',
] as const

export interface DrawerControlsHost extends Pick<NotchHost, 'history' | 'reset'> {
  document: Document
  /** the region the toggle discloses */
  drawer: HTMLElement
  setOpen(open: boolean): void
}

export interface DrawerControls {
  /** every round button, for the host to theme */
  buttons: readonly HTMLButtonElement[]
  /** open or close the drawer; returns whether it is now open */
  toggle(): boolean
  /** re-read the undo/redo state (cheap; runs after value changes) */
  syncValues(): void
  dispose(): void
}

/**
 * A row of round buttons on small screens, where the notch and floating panes
 * are gone. The T toggle opens and closes the drawer; while it is open, undo,
 * redo, and reset join it on the side facing the middle of the screen.
 * Dragging the toggle carries the row to the nearest viewport corner, which is
 * remembered, and a bottom-corner row rides up on the open drawer's top edge so
 * the spot that opened the drawer also closes it.
 */
export function createDrawerControls(host: DrawerControlsHost): DrawerControls {
  const doc = host.document
  const { row, toggleBtn, undoBtn, redoBtn, resetBtn } = withDocument(doc, () => {
    const toggleBtn = roundButton('tiao-drawer-toggle', 'T', 'Debug settings')
    toggleBtn.setAttribute('aria-controls', host.drawer.id)
    toggleBtn.setAttribute('aria-expanded', 'false')
    const undoBtn = roundButton('tiao-drawer-action tiao-drawer-undo', undoIcon(), 'Undo')
    const redoBtn = roundButton('tiao-drawer-action tiao-drawer-redo', redoIcon(), 'Redo')
    const resetBtn = roundButton('tiao-drawer-action tiao-drawer-reset', rotateCcwIcon(), 'Reset')
    const row = h('div', 'tiao-drawer-controls', toggleBtn, undoBtn, redoBtn, resetBtn)
    return { row, toggleBtn, undoBtn, redoBtn, resetBtn }
  })
  row.dataset.tiaoCorner = store.get().corner ?? 'bottom-right'

  let open = false
  const setOpen = (next: boolean) => {
    open = next
    toggleBtn.setAttribute('aria-expanded', String(next))
    row.classList.toggle('tiao-open', next)
    host.setOpen(next)
  }

  let suppressClick = false
  const onToggle = () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    setOpen(!open)
  }
  const onUndo = () => host.history.undo()
  const onRedo = () => host.history.redo()
  const onReset = () => host.reset()
  // bubbling only: the drag reads presses on the toggle itself and from document capture
  const contain = (e: Event) => e.stopPropagation()

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !open || host.drawer.querySelector(OPEN_OVERLAYS)) return
    const hadFocus = host.drawer.contains(doc.activeElement)
    setOpen(false)
    // focus must not stay behind in a drawer that just went inert
    if (hadFocus) toggleBtn.focus()
  }

  // the toggle is what the finger let go of, so the glide follows it even when
  // the new corner puts it at the other end of the row
  const snapTo = (corner: DrawerCorner) => {
    const from = toggleBtn.getBoundingClientRect()
    row.style.removeProperty('transform')
    row.dataset.tiaoCorner = corner
    store.patch({ corner })
    if (doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const to = toggleBtn.getBoundingClientRect()
    row.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` },
        { transform: 'none' },
      ],
      { duration: SNAP_MS, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    )
  }

  let dragging = false
  const stopDrag = draggable(toggleBtn, {
    onMove: (s) => {
      if (!dragging && Math.hypot(s.dx, s.dy) < DRAG_SLOP) return
      dragging = true
      row.style.transform = `translate(${s.dx}px, ${s.dy}px)`
    },
    onEnd: (s) => {
      if (!dragging) return
      dragging = false
      suppressClick = true
      // clear if no click follows (released off the button)
      setTimeout(() => {
        suppressClick = false
      }, 0)
      snapTo(nearestCorner(doc, s.x, s.y))
    },
  })

  const syncValues = () => syncHistoryButtons(host.history, undoBtn, redoBtn)

  toggleBtn.addEventListener('click', onToggle)
  undoBtn.addEventListener('click', onUndo)
  redoBtn.addEventListener('click', onRedo)
  resetBtn.addEventListener('click', onReset)
  for (const type of PRESS_EVENTS) row.addEventListener(type, contain, { passive: true })
  doc.addEventListener('keydown', onKey)
  syncValues()
  doc.body.append(row)

  return {
    buttons: [toggleBtn, undoBtn, redoBtn, resetBtn],
    toggle() {
      setOpen(!open)
      return open
    },
    syncValues,
    dispose() {
      stopDrag()
      toggleBtn.removeEventListener('click', onToggle)
      undoBtn.removeEventListener('click', onUndo)
      redoBtn.removeEventListener('click', onRedo)
      resetBtn.removeEventListener('click', onReset)
      for (const type of PRESS_EVENTS) row.removeEventListener(type, contain)
      doc.removeEventListener('keydown', onKey)
      row.remove()
    },
  }
}

function roundButton(cls: string, content: Node | string, label: string): HTMLButtonElement {
  const btn = h('button', `tiao-drawer-button ${cls}`, content)
  btn.type = 'button'
  btn.setAttribute('aria-label', label)
  return btn
}

/** the corner whose quadrant holds the point is also the closest one */
function nearestCorner(doc: Document, x: number, y: number): DrawerCorner {
  const view = doc.defaultView
  const top = y < (view?.innerHeight ?? 0) / 2
  const left = x < (view?.innerWidth ?? 0) / 2
  return `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}`
}
