import { h, injectCss, normalizeOptions, registerPlugin, type InputPlugin } from '../core'

/**
 * Segmented button grid input (the "Line | Scatter" control). Usage:
 *   registerRadioGridPlugin()
 *   pane.addBinding(params, 'chartType', {
 *     view: 'radiogrid',
 *     options: { Line: 'line', Scatter: 'scatter' },
 *     columns: 2,
 *   })
 */
export const radioGridPlugin: InputPlugin<unknown> = {
  id: 'radiogrid',
  type: 'input',
  accept(_value, options) {
    return options.view === 'radiogrid' && options.options !== undefined
  },
  create(ctx) {
    const items = normalizeOptions(ctx.options.options)
    const columns = typeof ctx.options['columns'] === 'number' ? ctx.options['columns'] : items.length
    const grid = h('div', 'tiao-radiogrid')
    grid.setAttribute('role', 'radiogroup')
    grid.style.display = 'grid'
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, 1fr)`

    const buttons = items.map((entry) => {
      const btn = h('button', 'tiao-radiogrid-cell', entry.text)
      btn.type = 'button'
      btn.setAttribute('role', 'radio')
      const onClick = () => ctx.value.set(entry.value, { source: 'ui', last: true })
      btn.addEventListener('click', onClick)
      ctx.onDispose(() => btn.removeEventListener('click', onClick))
      grid.append(btn)
      return btn
    })

    const render = (v: unknown) => {
      items.forEach((entry, i) => {
        const selected = Object.is(entry.value, v)
        buttons[i]?.classList.toggle('tiao-selected', selected)
        buttons[i]?.setAttribute('aria-checked', String(selected))
      })
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    injectCss(ctx.document, 'data-tiao-radiogrid', CSS)
    return { element: grid }
  },
}

const CSS = `
.tiao-radiogrid {
  width: 100%;
  gap: 2px;
  padding: 2px;
  background: var(--tiao-surface);
  border-radius: var(--tiao-radius-sm);
}
.tiao-radiogrid-cell {
  /* 2px frame padding + cell = button height (row-height + 2px) */
  height: calc(var(--tiao-row-height) - 2px);
  border-radius: calc(var(--tiao-radius-sm) - 2px);
  color: var(--tiao-fg-dim);
}
.tiao-radiogrid-cell.tiao-selected {
  background: var(--tiao-bg-solid);
  color: var(--tiao-fg);
  box-shadow: var(--tiao-shadow-raised);
}
`

let registered = false

export function registerRadioGridPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(radioGridPlugin)
}
