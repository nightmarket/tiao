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
  const openPopup = () => {
    open = true
    popup.classList.add('tiao-open')
    reposition()
    doc.addEventListener('pointerdown', onPointerDown, true)
    doc.addEventListener('keydown', onKeyDown)
  }
  const close = () => {
    if (!open) return
    open = false
    popup.classList.remove('tiao-open')
    doc.removeEventListener('pointerdown', onPointerDown, true)
    doc.removeEventListener('keydown', onKeyDown)
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
