import { h } from '../dom'
import type { InputPlugin } from '../plugin'

export const stringInputPlugin: InputPlugin<string> = {
  id: 'string',
  type: 'input',
  accept(value, options) {
    // color-like strings are claimed by the color plugin (registered later in scan order)
    return typeof value === 'string' && options.view !== 'color'
  },
  create(ctx) {
    const input = h('input', 'tiao-text-input')
    input.type = 'text'
    input.value = ctx.value.get()

    const commit = () => ctx.value.set(input.value, { source: 'ui', last: true })
    const onInput = () => ctx.value.set(input.value, { source: 'ui', last: false })
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') input.blur()
    }
    input.addEventListener('input', onInput)
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', onKeyDown)
    ctx.onDispose(() => {
      input.removeEventListener('input', onInput)
      input.removeEventListener('blur', commit)
      input.removeEventListener('keydown', onKeyDown)
    })

    ctx.onDispose(
      ctx.value.subscribe((v) => {
        if (ctx.document.activeElement !== input) input.value = v
      }),
    )

    return {
      element: input,
      activate: () => {
        input.focus()
        input.select()
      },
    }
  },
}
