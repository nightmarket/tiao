import { h, type InputPlugin, injectCss, normalizeOptions, registerPlugin } from '../core'

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
    const columns = Math.max(
      1,
      typeof ctx.options['columns'] === 'number' ? ctx.options['columns'] : items.length,
    )
    const grid = h('div', 'tiao-radiogrid')
    grid.setAttribute('role', 'radiogroup')
    grid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`
    grid.style.setProperty('--tiao-radio-columns', String(columns))
    grid.style.setProperty('--tiao-radio-rows', String(Math.ceil(items.length / columns)))

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
      const index = items.findIndex((entry) => Object.is(entry.value, v))
      grid.style.setProperty('--tiao-radio-column', String(index % columns))
      grid.style.setProperty('--tiao-radio-row', String(Math.floor(index / columns)))
      grid.classList.toggle('tiao-radiogrid-none', index < 0)
      buttons.forEach((btn, i) => {
        btn.classList.toggle('tiao-selected', i === index)
        btn.setAttribute('aria-checked', String(i === index))
      })
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    injectCss(ctx.document, 'data-tiao-radiogrid', CSS)
    return { element: grid }
  },
}

const CSS = `
/* one segmented pill, like a tab strip: cells sit a gutter apart with their
   own small corners, and the group clips its outer ends round, so the first
   cell rounds fully on the left and the last on the right */
.tiao-radiogrid {
  position: relative;
  display: grid;
  gap: var(--tiao-gutter);
  width: 100%;
  overflow: hidden;
  border-radius: calc(var(--tiao-row-height) / 2);
}
/* one highlight slides to the picked cell, like a tab strip's but in two
   directions. Cells share the grid evenly, so its size and place follow from
   the column and row counts and the picked cell's column and row */
.tiao-radiogrid::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: calc(
    (100% - var(--tiao-gutter) * (var(--tiao-radio-columns) - 1)) / var(--tiao-radio-columns)
  );
  height: calc((100% - var(--tiao-gutter) * (var(--tiao-radio-rows) - 1)) / var(--tiao-radio-rows));
  translate: calc(var(--tiao-radio-column) * (100% + var(--tiao-gutter)))
    calc(var(--tiao-radio-row) * (100% + var(--tiao-gutter)));
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-fill);
  transition: translate var(--tiao-spring-select, 0.2s ease);
  pointer-events: none;
}
.tiao-radiogrid.tiao-radiogrid-none::before {
  display: none;
}
/* positioned, so the label paints over the highlight. Ringed inside, so the
   group's clip can't cut a focused cell's ring */
.tiao-radiogrid-cell {
  position: relative;
  height: var(--tiao-row-height);
  border-radius: var(--tiao-radius-sm);
  background: var(--tiao-surface);
  color: var(--tiao-fg-dim);
  transition: color 0.12s ease;
}
.tiao-radiogrid-cell:focus-visible {
  outline-offset: -1.5px;
}
.tiao-radiogrid-cell:hover {
  color: var(--tiao-fg-soft);
}
.tiao-radiogrid-cell.tiao-selected {
  color: var(--tiao-fg);
}
`

let registered = false

export function registerRadioGridPlugin(): void {
  if (registered) return
  registered = true
  registerPlugin(radioGridPlugin)
}
