import { h } from '../dom'
import type { InputPlugin } from '../plugin'

/** Check toggle: a rounded square inside a rounded square. */
export const booleanInputPlugin: InputPlugin<boolean> = {
  id: 'boolean',
  type: 'input',
  accept(value) {
    return typeof value === 'boolean'
  },
  create(ctx) {
    const btn = h('button', 'tiao-check')
    btn.type = 'button'
    btn.setAttribute('role', 'switch')

    const render = (v: boolean) => {
      btn.classList.toggle('tiao-checked', v)
      btn.setAttribute('aria-checked', String(v))
    }
    render(ctx.value.get())
    ctx.onDispose(ctx.value.subscribe(render))

    const onClick = () => ctx.value.set(!ctx.value.get(), { source: 'ui', last: true })
    btn.addEventListener('click', onClick)
    ctx.onDispose(() => btn.removeEventListener('click', onClick))

    return { element: btn, activate: onClick }
  },
}
