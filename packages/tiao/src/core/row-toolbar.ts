import { adoptTokens, h, pinIcon, rotateCcwIcon, withDocument } from './dom'
import { tooltip } from './tooltip'
import { clamp } from './util'

/** space between the pane edge and the toolbar */
const GAP = 6
/** how close the toolbar may get to the viewport edges */
const EDGE = 4
/** the pane's theme, copied over because the toolbar lives on <body> */
const THEME_TOKENS = [
  '--tiao-bg-solid',
  '--tiao-fg',
  '--tiao-fg-dim',
  '--tiao-fg-faint',
  '--tiao-hover',
  '--tiao-focus',
  '--tiao-accent',
  '--tiao-radius',
  '--tiao-radius-sm',
  '--tiao-shadow-popup',
  '--tiao-icon-size',
  '--tiao-font',
  '--tiao-font-size',
]

/** what the toolbar acts on: a binding, through its row in a pane or its pinned card */
export interface RowTarget {
  pinned: boolean
  readonly overridden: boolean
  reset(): void
}

/** where the toolbar sits beside the row: level with its middle, or with its top */
export type RowToolbarAlign = 'center' | 'top'

interface RowToolbar {
  open(target: RowTarget, row: HTMLElement, align: RowToolbarAlign): void
  close(): void
}

/** one toolbar per document, moved to whichever row was right-clicked last */
const toolbars = new WeakMap<Document, RowToolbar>()

function createRowToolbar(doc: Document): RowToolbar {
  const { el, pinBtn, resetBtn } = withDocument(doc, () => {
    const pinBtn = h('button', 'tiao-row-toolbar-btn tiao-row-toolbar-pin', pinIcon())
    pinBtn.type = 'button'
    const resetBtn = h('button', 'tiao-row-toolbar-btn tiao-row-toolbar-reset', rotateCcwIcon())
    resetBtn.type = 'button'
    resetBtn.setAttribute('aria-label', 'Reset to default')
    const el = h('div', 'tiao-row-toolbar', pinBtn, resetBtn)
    el.setAttribute('role', 'toolbar')
    el.setAttribute('aria-label', 'Row actions')
    return { el, pinBtn, resetBtn }
  })
  let current: { target: RowTarget; row: HTMLElement } | null = null
  const pinLabel = () => (current?.target.pinned ? 'Unpin' : 'Pin')

  const onOutside = (e: PointerEvent) => {
    if (!el.contains(e.target as Node | null)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  // the row moves out from under it on any scroll or resize
  const onMoved = () => close()

  function close() {
    if (!current) return
    current.row.classList.remove('tiao-row-context')
    current = null
    el.remove()
    doc.removeEventListener('pointerdown', onOutside, true)
    doc.removeEventListener('keydown', onKey)
    doc.removeEventListener('scroll', onMoved, true)
    doc.defaultView?.removeEventListener('resize', onMoved)
  }

  function open(target: RowTarget, row: HTMLElement, align: RowToolbarAlign) {
    if (!current) {
      doc.addEventListener('pointerdown', onOutside, true)
      doc.addEventListener('keydown', onKey)
      doc.addEventListener('scroll', onMoved, true)
      doc.defaultView?.addEventListener('resize', onMoved)
    }
    current?.row.classList.remove('tiao-row-context')
    current = { target, row }
    row.classList.add('tiao-row-context')
    adoptTokens(el, row, THEME_TOKENS)
    pinBtn.setAttribute('aria-pressed', String(target.pinned))
    pinBtn.setAttribute('aria-label', pinLabel())
    resetBtn.disabled = !target.overridden
    if (!el.isConnected) doc.body.append(el)
    place(row, align)
  }

  // beside the pane (or card); flips left when the right has no room
  function place(row: HTMLElement, align: RowToolbarAlign) {
    const rowRect = row.getBoundingClientRect()
    const pane = (row.closest('.tiao-pane') ?? row).getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = el
    const viewW = doc.documentElement.clientWidth
    const viewH = doc.documentElement.clientHeight
    let left = Math.round(pane.right + GAP)
    if (left + width > viewW - EDGE) left = Math.round(pane.left - GAP - width)
    const top = Math.round(
      align === 'top' ? rowRect.top : rowRect.top + rowRect.height / 2 - height / 2,
    )
    el.style.left = `${clamp(left, EDGE, Math.max(EDGE, viewW - EDGE - width))}px`
    el.style.top = `${clamp(top, EDGE, Math.max(EDGE, viewH - EDGE - height))}px`
  }

  pinBtn.addEventListener('click', () => {
    if (current) current.target.pinned = !current.target.pinned
    close()
  })
  tooltip(pinBtn, pinLabel)
  resetBtn.addEventListener('click', () => {
    current?.target.reset()
    close()
  })
  tooltip(resetBtn, () => 'Reset to default')

  return { open, close }
}

/** Show `target`'s actions beside the pane or card holding `row`, reusing the one toolbar. */
export function openRowToolbar(
  target: RowTarget,
  row: HTMLElement,
  align: RowToolbarAlign = 'center',
): void {
  const doc = row.ownerDocument
  let toolbar = toolbars.get(doc)
  if (!toolbar) {
    toolbar = createRowToolbar(doc)
    toolbars.set(doc, toolbar)
  }
  toolbar.open(target, row, align)
}

export function closeRowToolbar(doc: Document): void {
  toolbars.get(doc)?.close()
}
