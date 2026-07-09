import { setRowActive } from '../dom'

/**
 * Floating popup anchored below an element. The popup node is re-parented to
 * the pane root so it escapes the collapse clip while staying inside the
 * theme scope (CSS variables live on .tiao-pane).
 */
export function createPopup(
  anchor: HTMLElement,
  popup: HTMLElement,
  onDispose: (fn: () => void) => void,
): { toggle: () => void; close: () => void; isOpen: () => boolean } {
  let open = false
  popup.classList.add('tiao-popup')

  const reposition = () => {
    const pane = anchor.closest('.tiao-pane') as HTMLElement | null
    if (!pane) return
    if (popup.parentElement !== pane) pane.append(popup)
    const paneRect = pane.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    popup.style.minWidth = `${rect.width}px`
    popup.style.top = `${rect.bottom - paneRect.top + 4}px`
    // right-align to the anchor (measured while open)
    const width = popup.offsetWidth || rect.width
    popup.style.left = `${Math.max(4, rect.right - paneRect.left - width)}px`
  }

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as Node
    if (!popup.contains(t) && !anchor.contains(t)) close()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

  const doc = anchor.ownerDocument
  let stopScrollWatch: (() => void) | null = null

  const openPopup = () => {
    open = true
    popup.classList.add('tiao-open')
    setRowActive(anchor, true)
    reposition()
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.addEventListener('keydown', onKeyDown)
    stopScrollWatch?.()
    stopScrollWatch = onPaneScroll(anchor, close)
  }
  const close = () => {
    if (!open) return
    open = false
    popup.classList.remove('tiao-open')
    setRowActive(anchor, false)
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('keydown', onKeyDown)
    stopScrollWatch?.()
    stopScrollWatch = null
  }

  onDispose(() => {
    close()
    popup.remove()
  })
  return {
    toggle: () => (open ? close() : openPopup()),
    close,
    isOpen: () => open,
  }
}

/**
 * Close floating UI when the pane content scrolls — absolute/fixed anchors go
 * stale relative to their controls.
 */
export function onPaneScroll(from: Element, onScroll: () => void): () => void {
  const pane = from.closest('.tiao-pane')
  const clip = pane?.querySelector(':scope > .tiao-pane-body > .tiao-pane-clip')
  if (!clip) return () => {}
  const handler = () => onScroll()
  clip.addEventListener('scroll', handler, { passive: true })
  return () => clip.removeEventListener('scroll', handler)
}

/**
 * While an overlay is open, swallow pointer/click bubbling so pane chrome
 * (folder collapse, row activate, etc.) doesn't react underneath. `allow`
 * targets (e.g. the toggle icon) still receive events. After close, the
 * trailing click from the dismiss press is also swallowed.
 */
export function bindOverlayPointerGuard(
  doc: Document,
  opts: {
    isOpen: () => boolean
    allow: (target: Node) => boolean
    onPointerDown: (e: PointerEvent) => void
    onKeyDown?: (e: KeyboardEvent) => void
  },
): () => void {
  let swallowClick = false
  const onPointerDown = (e: PointerEvent) => {
    if (!opts.isOpen() || e.button !== 0) return
    const t = e.target as Node
    if (opts.allow(t)) return
    e.preventDefault()
    e.stopPropagation()
    swallowClick = true
    opts.onPointerDown(e)
  }
  const onClick = (e: MouseEvent) => {
    if (!opts.isOpen() && !swallowClick) return
    const t = e.target as Node
    if (opts.isOpen() && opts.allow(t)) return
    e.preventDefault()
    e.stopPropagation()
    swallowClick = false
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!opts.isOpen()) return
    opts.onKeyDown?.(e)
  }
  doc.addEventListener('pointerdown', onPointerDown, true)
  doc.addEventListener('click', onClick, true)
  if (opts.onKeyDown) doc.addEventListener('keydown', onKeyDown)
  return () => {
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('click', onClick, true)
    if (opts.onKeyDown) doc.removeEventListener('keydown', onKeyDown)
  }
}
