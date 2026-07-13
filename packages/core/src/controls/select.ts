import { h, icon } from '../dom'
import { clamp } from '../util'
import type { BindingOptions, InputPlugin } from '../plugin'
import { createPopup } from './popup'

export interface SelectEntry {
  text: string
  value: unknown
}

export interface SelectMenu {
  /** `.tiao-select-wrap` element containing the select and chevron */
  wrap: HTMLDivElement
  open(): void
  close(): void
}

/**
 * Wrap a `<select>` and replace its native picker with a pane-styled popup.
 * The OS menu ignores the pane's fonts and misaligns its check gutter, so
 * only the closed field stays native; the `<select>` element remains the
 * source of truth (menu clicks set `value` and dispatch `change`).
 */
export function createSelectMenu(
  select: HTMLSelectElement,
  onDispose: (fn: () => void) => void,
): SelectMenu {
  const wrap = h('div', 'tiao-select-wrap', select, icon('chevron'))
  const menu = h('div', 'tiao-select-menu')
  const popup = createPopup(wrap, menu, onDispose)

  let buttons: HTMLButtonElement[] = []
  let highlighted = -1

  const setHighlight = (i: number) => {
    buttons[highlighted]?.classList.remove('tiao-highlight')
    highlighted = i
    const btn = buttons[i]
    if (btn) {
      btn.classList.add('tiao-highlight')
      btn.scrollIntoView?.({ block: 'nearest' })
    }
  }

  const commit = (i: number) => {
    if (i !== select.selectedIndex && select.options[i]) {
      select.selectedIndex = i
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    popup.close()
  }

  // rebuilt on every open so late option changes and the current selection
  // are always reflected; per-button listeners die with the nodes
  const rebuild = () => {
    menu.replaceChildren()
    buttons = Array.from(select.options, (opt, i) => {
      const btn = h('button', 'tiao-select-option', opt.text, icon('check'))
      btn.type = 'button'
      btn.classList.toggle('tiao-selected', i === select.selectedIndex)
      btn.addEventListener('click', () => commit(i))
      btn.addEventListener('pointerenter', () => setHighlight(i))
      menu.append(btn)
      return btn
    })
    setHighlight(select.selectedIndex)
  }

  const open = () => {
    if (popup.isOpen()) return
    rebuild()
    popup.toggle()
  }

  // keep focus on the select while clicking menu rows so keyboard nav holds
  const onMenuMouseDown = (e: MouseEvent) => e.preventDefault()
  menu.addEventListener('mousedown', onMenuMouseDown)

  const onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0) return
    // suppress the native picker; focus manually since preventDefault skips it
    e.preventDefault()
    select.focus({ preventScroll: true })
    if (popup.isOpen()) popup.close()
    else open()
  }
  select.addEventListener('mousedown', onMouseDown)

  const step = (delta: number) => {
    const next = clamp(select.selectedIndex + delta, 0, select.options.length - 1)
    if (next !== select.selectedIndex) {
      select.selectedIndex = next
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!popup.isOpen()) {
      if (e.key === 'Enter' || e.key === ' ' || ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.altKey)) {
        e.preventDefault()
        open()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // step the value directly; preventDefault keeps macOS from opening
        // the native picker on arrow keys
        e.preventDefault()
        step(e.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(clamp(highlighted + (e.key === 'ArrowDown' ? 1 : -1), 0, buttons.length - 1))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      commit(highlighted)
    } else if (e.key === 'Escape') {
      // close only the menu, not a popup hosting the select (color picker)
      e.stopPropagation()
      popup.close()
    } else if (e.key === 'Tab') {
      popup.close()
    }
  }
  select.addEventListener('keydown', onKeyDown)

  onDispose(() => {
    select.removeEventListener('mousedown', onMouseDown)
    select.removeEventListener('keydown', onKeyDown)
    menu.removeEventListener('mousedown', onMenuMouseDown)
  })

  return { wrap, open, close: popup.close }
}

/** Normalize an `options` map or entry array into `{ text, value }` entries. */
export function normalizeOptions(options: BindingOptions['options']): SelectEntry[] {
  if (!options) return []
  if (Array.isArray(options)) return options as SelectEntry[]
  return Object.entries(options).map(([text, value]) => ({ text, value }))
}

/** Dropdown select for any value with an `options` map. */
export const selectInputPlugin: InputPlugin<unknown> = {
  id: 'select',
  type: 'input',
  accept(_value, options) {
    return options.options !== undefined && options.view === undefined
  },
  create(ctx) {
    const entries = normalizeOptions(ctx.options.options)
    const select = h('select', 'tiao-select')
    entries.forEach((entry, i) => {
      const opt = h('option', undefined, entry.text)
      opt.value = String(i)
      select.append(opt)
    })

    const render = (v: unknown) => {
      const i = entries.findIndex((e) => Object.is(e.value, v))
      select.value = i >= 0 ? String(i) : ''
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    const onChange = () => {
      const entry = entries[Number(select.value)]
      if (entry) ctx.value.set(entry.value, { source: 'ui', last: true })
    }
    select.addEventListener('change', onChange)
    ctx.onDispose(() => select.removeEventListener('change', onChange))

    const menu = createSelectMenu(select, ctx.onDispose)
    return {
      element: menu.wrap,
      activate: () => {
        select.focus({ preventScroll: true })
        menu.open()
      },
    }
  },
}
