import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPerfMonitor, type RendererLike } from './monitor'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createPerfMonitor', () => {
  it('derives FPS from completed render brackets instead of display ticks', () => {
    let nextFrame: FrameRequestCallback | undefined
    let rafId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const originalRender = vi.fn()
    const renderer: RendererLike = {
      info: { render: {} },
      render: originalRender,
    }
    const beforeCreate = performance.now()
    const monitor = createPerfMonitor({ renderer, interval: 100 })

    renderer.render?.()
    renderer.render?.()
    nextFrame?.(beforeCreate + 200)

    // Two completed renders over roughly 200ms is roughly 10 rendered FPS.
    expect(monitor.stats.fps).toBeGreaterThan(9)
    expect(monitor.stats.fps).toBeLessThan(11)

    // A display tick without an application render must report zero FPS.
    nextFrame?.(beforeCreate + 400)
    expect(monitor.stats.fps).toBe(0)

    monitor.dispose()
    expect(renderer.render).toBe(originalRender)
  })
})
