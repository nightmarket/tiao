import { h, icon } from '../dom'
import type { BindingOptions, InputPlugin } from '../plugin'

export interface SelectEntry {
  text: string
  value: unknown
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

    const wrap = h('div', 'tiao-select-wrap', select, icon('chevron'))
    return {
      element: wrap,
      activate: () => {
        try {
          select.showPicker()
        } catch {
          select.focus()
        }
      },
    }
  },
}
