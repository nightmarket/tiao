import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPerfMonitor, type RendererLike } from './monitor'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createPerfMonitor', () => {
  it('derives FPS from display ticks, not nested renderer.render calls', () => {
    let nextFrame: FrameRequestCallback | undefined
    let rafId = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const renderResult = {}
    const originalRender = vi.fn(() => renderResult)
    const renderer: RendererLike = {
      info: { render: {} },
      render: originalRender,
    }
    const beforeCreate = performance.now()
    const monitor = createPerfMonitor({ renderer, interval: 100 })

    const render = renderer.render as unknown as (...args: unknown[]) => unknown
    // Nested post/shadow pipelines fire many render()s per display frame —
    // those must not inflate FPS.
    expect(render('scene', 'camera')).toBe(renderResult)
    renderer.render?.()
    renderer.render?.()
    renderer.render?.()
    nextFrame?.(beforeCreate + 200)

    // One display tick over ~200ms is roughly 5 FPS.
    expect(monitor.stats.fps).toBeGreaterThan(4)
    expect(monitor.stats.fps).toBeLessThan(6)

    nextFrame?.(beforeCreate + 400)
    expect(monitor.stats.fps).toBeGreaterThan(4)
    expect(monitor.stats.fps).toBeLessThan(6)

    monitor.dispose()
    expect(renderer.render).toBe(originalRender)
  })

  it('times the full nested render tree once for CPU', () => {
    let nextFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const monitor = createPerfMonitor({ interval: 50, instrument: false })
    const before = now
    monitor.begin() // outer (post quad)
    now += 1
    monitor.begin() // nested scene pass
    monitor.end()
    now += 1
    monitor.begin() // nested shadow face
    monitor.end()
    now += 1
    monitor.end() // outer
    // Outer tree spanned 3ms; nested begins must not split that into 1ms samples.
    now = before + 100
    nextFrame?.(now)
    expect(monitor.stats.cpu).toBeGreaterThanOrEqual(2.5)
    expect(monitor.stats.cpu).toBeLessThan(4)

    monitor.dispose()
  })

  it('reuses resolved WebGL timer queries', () => {
    let nextFrame: FrameRequestCallback | undefined
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      nextFrame = callback
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const query = {} as WebGLQuery
    const createQuery = vi.fn(() => query)
    const deleteQuery = vi.fn()
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: vi.fn(() => ({ TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 })),
      createQuery,
      deleteQuery,
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      getParameter: vi.fn(() => false),
      getQueryParameter: vi.fn((_query: WebGLQuery, param: number) =>
        param === 1 ? true : 1_000_000,
      ),
    } as unknown as WebGL2RenderingContext

    const beforeCreate = performance.now()
    const monitor = createPerfMonitor({ gl, interval: 1, instrument: false })
    monitor.begin()
    monitor.end()
    nextFrame?.(beforeCreate + 10)
    expect(monitor.stats.gpu).toBe(1)

    monitor.begin()
    monitor.end()
    expect(createQuery).toHaveBeenCalledTimes(1)

    monitor.dispose()
    expect(deleteQuery).toHaveBeenCalledWith(query)
  })

  it.each(['first', 'second'] as const)(
    'shares renderer instrumentation when the %s monitor disposes first',
    (first) => {
      let nextFrame: FrameRequestCallback | undefined
      vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
        nextFrame = callback
        return 1
      }))
      vi.stubGlobal('cancelAnimationFrame', vi.fn())

      const originalRender = vi.fn()
      const reset = vi.fn()
      const renderer: RendererLike = {
        info: { render: {}, reset, autoReset: true },
        render: originalRender,
      }
      const a = createPerfMonitor({ renderer })
      const wrapper = renderer.render
      const b = createPerfMonitor({ renderer })
      expect(renderer.render).toBe(wrapper)
      expect(renderer.info.autoReset).toBe(false)
      nextFrame?.(performance.now() + 300)
      expect(reset).toHaveBeenCalledTimes(1)

      const [early, late] = first === 'first' ? [a, b] : [b, a]
      early.dispose()
      expect(renderer.render).toBe(wrapper)
      expect(renderer.info.autoReset).toBe(false)
      late.dispose()
      expect(renderer.render).toBe(originalRender)
      expect(renderer.info.autoReset).toBe(true)
    },
  )

  it('does not overwrite host render changes and restores absent autoReset state', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())

    const info: RendererLike['info'] = { render: {}, reset: vi.fn() }
    const renderer: RendererLike = { info, render: vi.fn() }
    const monitor = createPerfMonitor({ renderer })
    expect(Object.prototype.hasOwnProperty.call(info, 'autoReset')).toBe(true)

    const replacement = vi.fn()
    renderer.render = replacement
    monitor.dispose()
    monitor.dispose()
    expect(renderer.render).toBe(replacement)
    expect(Object.prototype.hasOwnProperty.call(info, 'autoReset')).toBe(false)
  })
})
