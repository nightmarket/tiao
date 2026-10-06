import type { BindingApi } from './blade'
import { adoptTokens, h, rotateCcwIcon, withDocument } from './dom'
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
  '--tiao-radius',
  '--tiao-radius-sm',
  '--tiao-shadow-popup',
  '--tiao-icon-size',
  '--tiao-font',
  '--tiao-font-size',
]

interface RowToolbar {
  open(binding: BindingApi<unknown>): void
  close(): void
}

/** one toolbar per document, moved to whichever row was right-clicked last */
const toolbars = new WeakMap<Document, RowToolbar>()

function createRowToolbar(doc: Document): RowToolbar {
  const { el, resetBtn } = withDocument(doc, () => {
    const resetBtn = h('button', 'tiao-row-toolbar-btn tiao-row-toolbar-reset', rotateCcwIcon())
    resetBtn.type = 'button'
    resetBtn.setAttribute('aria-label', 'Reset to default')
    const el = h('div', 'tiao-row-toolbar', resetBtn)
    el.setAttribute('role', 'toolbar')
    el.setAttribute('aria-label', 'Row actions')
    return { el, resetBtn }
  })
  let current: BindingApi<unknown> | null = null

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
    current.element.classList.remove('tiao-row-context')
    current = null
    el.remove()
    doc.removeEventListener('pointerdown', onOutside, true)
    doc.removeEventListener('keydown', onKey)
    doc.removeEventListener('scroll', onMoved, true)
    doc.defaultView?.removeEventListener('resize', onMoved)
  }

  function open(binding: BindingApi<unknown>) {
    if (!current) {
      doc.addEventListener('pointerdown', onOutside, true)
      doc.addEventListener('keydown', onKey)
      doc.addEventListener('scroll', onMoved, true)
      doc.defaultView?.addEventListener('resize', onMoved)
    }
    current?.element.classList.remove('tiao-row-context')
    current = binding
    binding.element.classList.add('tiao-row-context')
    adoptTokens(el, binding.element, THEME_TOKENS)
    resetBtn.disabled = !binding.overridden
    if (!el.isConnected) doc.body.append(el)
    place(binding)
  }

  // beside the pane, centered on the row; flips left when the right has no room
  function place(binding: BindingApi<unknown>) {
    const row = binding.element.getBoundingClientRect()
    const pane = (binding.element.closest('.tiao-pane') ?? binding.element).getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = el
    const viewW = doc.documentElement.clientWidth
    const viewH = doc.documentElement.clientHeight
    let left = Math.round(pane.right + GAP)
    if (left + width > viewW - EDGE) left = Math.round(pane.left - GAP - width)
    const top = Math.round(row.top + row.height / 2 - height / 2)
    el.style.left = `${clamp(left, EDGE, Math.max(EDGE, viewW - EDGE - width))}px`
    el.style.top = `${clamp(top, EDGE, Math.max(EDGE, viewH - EDGE - height))}px`
  }

  resetBtn.addEventListener('click', () => {
    current?.reset()
    close()
  })
  tooltip(resetBtn, () => 'Reset to default')

  return { open, close }
}

/** Show the row actions beside `binding`'s pane, reusing the one toolbar. */
export function openRowToolbar(binding: BindingApi<unknown>): void {
  const doc = binding.element.ownerDocument
  let toolbar = toolbars.get(doc)
  if (!toolbar) {
    toolbar = createRowToolbar(doc)
    toolbars.set(doc, toolbar)
  }
  toolbar.open(binding)
}

export function closeRowToolbar(doc: Document): void {
  toolbars.get(doc)?.close()
}
