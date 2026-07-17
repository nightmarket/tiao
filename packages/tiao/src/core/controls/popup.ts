import { longPress, setRowActive } from '../dom'
import { applyOverlayTheme } from './scrubber'

/**
 * Floating popup anchored below an element (flips above when the viewport
 * lacks room). The popup node is re-parented to the pane root so it escapes
 * the collapse clip while staying inside the theme scope (CSS variables live
 * on .tiao-pane).
 */
export function createPopup(
  anchor: HTMLElement,
  popup: HTMLElement,
  onDispose: (fn: () => void) => void,
): { toggle: () => void; close: () => void; isOpen: () => boolean } {
  let open = false
  popup.classList.add('tiao-popup')
  const doc = anchor.ownerDocument

  const reposition = () => {
    const pane = anchor.closest('.tiao-pane') as HTMLElement | null
    if (!pane) return
    if (popup.parentElement !== pane) pane.append(popup)
    const paneRect = pane.getBoundingClientRect()
    const rect = anchor.getBoundingClientRect()
    const gap = 4
    popup.style.minWidth = `${rect.width}px`
    // measure while open (display:flex) so height/width are real
    const height = popup.offsetHeight
    const width = popup.offsetWidth || rect.width
    const viewportHeight = doc.defaultView?.innerHeight ?? Infinity
    const spaceBelow = viewportHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const openAbove = height > spaceBelow && spaceAbove > spaceBelow
    popup.style.top = openAbove
      ? `${rect.top - paneRect.top - height - gap}px`
      : `${rect.bottom - paneRect.top + gap}px`
    // right-align to the anchor
    popup.style.left = `${Math.max(4, rect.right - paneRect.left - width)}px`
  }

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as Node
    // select menus portal to the pane root, so a click on one lands outside
    // the popup that hosts the select; it must not dismiss that popup
    if (t instanceof Element && t.closest('.tiao-select-menu')) return
    if (!popup.contains(t) && !anchor.contains(t)) close()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }

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
export interface StickyOverlayOptions {
  document: Document
  /** trigger button: clicks toggle the overlay, long-press runs `onLongPress` */
  trigger: HTMLElement
  /** row root that receives `dragClass` + active-row state while open */
  root: HTMLElement
  overlay: HTMLElement
  dragClass: string
  /** (re)position the overlay around the trigger, rebuilding any mapping state */
  center(): void
  /** apply a pointer position to the value */
  apply(clientX: number, clientY: number, last: boolean): void
  /** custom long-press gesture (e.g. a free drag); clicks always toggle sticky */
  onLongPress?(ev: PointerEvent): void
  onOpen?(): void
  onClose?(): void
  /** sync visuals after open/center */
  render?(): void
  onDispose(fn: () => void): void
}

export interface StickyOverlayHandle {
  isOpen(): boolean
  isSticky(): boolean
  open(mode: { sticky: boolean; follow: boolean }): void
  close(): void
  /** click behavior: open sticky, or close when already sticky-open */
  toggleSticky(): void
  setHoverFollow(on: boolean): void
}

/**
 * Shared controller for body-portaled overlay editors (angle dial, XY pad):
 * sticky mode follows pointer hovers until a press commits and closes; the
 * pane chrome underneath is guarded, scrolling the pane closes the overlay,
 * and Escape dismisses it.
 */
export function createStickyOverlay(opts: StickyOverlayOptions): StickyOverlayHandle {
  const { document: doc, trigger, root, overlay } = opts
  let open = false
  let sticky = false
  let hovering = false
  let stopScrollWatch: (() => void) | null = null
  let stopPointerGuard: (() => void) | null = null

  const onHoverMove = (e: PointerEvent) => {
    if (!sticky || !hovering) return
    opts.apply(e.clientX, e.clientY, false)
  }
  const stopHoverFollow = () => {
    if (!hovering) return
    hovering = false
    doc.removeEventListener('pointermove', onHoverMove, true)
  }
  const startHoverFollow = () => {
    stopHoverFollow()
    hovering = true
    doc.addEventListener('pointermove', onHoverMove, true)
  }

  const close = () => {
    if (!open) return
    open = false
    sticky = false
    stopHoverFollow()
    stopScrollWatch?.()
    stopScrollWatch = null
    stopPointerGuard?.()
    stopPointerGuard = null
    overlay.remove()
    root.classList.remove(opts.dragClass)
    setRowActive(root, false)
    opts.onClose?.()
  }

  const openOverlay = (mode: { sticky: boolean; follow: boolean }) => {
    // theme must be copied when mounted — root/trigger aren't styled at create time
    applyOverlayTheme(overlay, trigger)
    if (!open) {
      doc.body.append(overlay)
      root.classList.add(opts.dragClass)
      setRowActive(root, true)
      open = true
      opts.onOpen?.()
      stopScrollWatch?.()
      stopScrollWatch = onPaneScroll(trigger, close)
      stopPointerGuard?.()
      stopPointerGuard = bindOverlayPointerGuard(doc, {
        isOpen: () => open,
        allow: (t) => trigger.contains(t),
        onPointerDown: (e) => {
          if (!sticky) return
          opts.center()
          opts.apply(e.clientX, e.clientY, true)
          close()
        },
        onKeyDown: (e) => {
          if (e.key === 'Escape') close()
        },
      })
    }
    sticky = mode.sticky
    // always center on the trigger, regardless of where the press started
    opts.center()
    if (mode.follow) startHoverFollow()
    else stopHoverFollow()
    opts.render?.()
  }

  const toggleSticky = () => {
    if (open && sticky) {
      close()
      return
    }
    openOverlay({ sticky: true, follow: true })
  }

  // click → sticky overlay that follows the pointer; long-press → custom gesture
  let suppressClick = false
  if (opts.onLongPress) {
    opts.onDispose(
      longPress(trigger, {
        onLongPress: (e) => {
          suppressClick = true
          e.preventDefault()
          opts.onLongPress?.(e)
        },
      }),
    )
  }
  const onTriggerClick = () => {
    if (suppressClick) {
      suppressClick = false
      return
    }
    toggleSticky()
  }
  trigger.addEventListener('click', onTriggerClick)
  opts.onDispose(() => trigger.removeEventListener('click', onTriggerClick))
  opts.onDispose(close)

  return {
    isOpen: () => open,
    isSticky: () => sticky,
    open: openOverlay,
    close,
    toggleSticky,
    setHoverFollow: (on) => (on ? startHoverFollow() : stopHoverFollow()),
  }
}

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
