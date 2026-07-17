import { describe, expect, it, vi } from 'vitest'
import { setTiaoEnabled } from '../config'
import type { Pane } from '../core'
import { mountPane } from './index'

setTiaoEnabled(true)

describe('mountPane', () => {
  it('mounts with default options and owns cleanup', async () => {
    const cleanup = vi.fn()
    const setup = vi.fn((_pane: Pane) => cleanup)
    const dispose = mountPane(setup)

    await vi.waitFor(() => expect(setup).toHaveBeenCalledOnce())
    const pane = setup.mock.calls.at(0)?.[0]
    if (!pane) throw new Error('Expected pane to mount')
    const disposePane = vi.spyOn(pane, 'dispose')

    dispose()

    expect(cleanup).toHaveBeenCalledOnce()
    expect(disposePane).toHaveBeenCalledOnce()
  })

  it('does not mount after being disposed while loading', async () => {
    const setup = vi.fn()
    const dispose = mountPane({ title: 'Debug' }, setup)

    dispose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(setup).not.toHaveBeenCalled()
  })
})
