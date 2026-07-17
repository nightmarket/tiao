import { onTick } from '../core'

/** Live sample values. Poll with readonly bindings or read directly. */
export interface PerfStats {
  fps: number
  /** JS time spent inside the top-level render tree, ms per display frame */
  cpu: number
  /** GPU time per frame, ms */
  gpu: number
  calls: number
  /** Public renderer.render() invocations this frame (scene + shadows + passes) */
  frameCalls: number
  triangles: number
  lines: number
  points: number
  geometries: number
  textures: number
  shaders: number
  /** used JS heap, MB (Chromium only) */
  jsHeap: number
  /** custom GPU memory estimate, MB */
  gpuMemory: number
}

/** Structural subset of THREE.WebGLRenderer / WebGPURenderer `.info`. */
export interface RendererInfoLike {
  autoReset?: boolean
  reset?: () => void
  render?: {
    /**
     * WebGLInfo: per-frame draw calls (reset each render).
     * WebGPU/common Info: lifetime render() count — use `drawCalls` instead.
     */
    calls?: number
    /** WebGPU/common Info: per-frame draw calls */
    drawCalls?: number
    /** WebGPU/common Info: public renderer.render() invocations this frame */
    frameCalls?: number
    triangles?: number
    points?: number
    lines?: number
    /** three WebGPURenderer: GPU ms when created with `trackTimestamp: true` */
    timestamp?: number
  }
  memory?: { geometries?: number; textures?: number }
  programs?: readonly unknown[] | null
}

/** Structural subset of a three.js renderer — no dependency on three itself. */
export interface RendererLike {
  info: RendererInfoLike
  render?: (...args: never[]) => unknown
  /** WebGLRenderer: returns the raw GL context (used for GPU timer queries) */
  getContext?: () => unknown
  /** WebGPURenderer: whether timestamp queries were enabled at construction */
  trackTimestamp?: boolean
  /** WebGPURenderer: resolves pending timestamps into info.render.timestamp */
  resolveTimestampsAsync?: () => Promise<unknown>
}

export interface PerfMonitorOptions {
  /** three.js WebGLRenderer / WebGPURenderer (or anything with a matching `.info`) */
  renderer?: RendererLike
  /** WebGL2 context for GPU timing; auto-detected from `renderer` when omitted */
  gl?: WebGL2RenderingContext
  /** wrap `renderer.render` with begin/end automatically (default true) */
  instrument?: boolean
  /** custom GPU frame-time getter in ms (overrides built-in timers) */
  gpuTime?: () => number
  /** custom GPU memory getter in bytes (e.g. your own texture/buffer accounting) */
  gpuMemory?: () => number
  /** ms per fps/cpu/gpu sampling window (default 250) */
  interval?: number
}

export interface PerfCapabilities {
  gpu: boolean
  counts: boolean
  shaders: boolean
  jsHeap: boolean
  gpuMemory: boolean
}

export interface PerfMonitor {
  readonly stats: PerfStats
  readonly capabilities: PerfCapabilities
  /** sampling window in ms (useful as a binding poll interval) */
  readonly interval: number
  /** bracket your render manually when auto-instrumentation is off/unavailable */
  begin(): void
  end(): void
  dispose(): void
}

const MB = 1024 * 1024

type RenderMethod = NonNullable<RendererLike['render']>
type InfoTick = (time: number) => void

interface RenderHook {
  begin(): void
  end(): void
}

interface RenderInstrumentation {
  original: RenderMethod
  wrapper: RenderMethod
  hooks: Set<RenderHook>
}

interface InfoTicker {
  ticks: Set<InfoTick>
  stop(): void
  reset: (() => void) | null
  autoResetDescriptor: PropertyDescriptor | undefined
}

const renderInstrumentations = new WeakMap<RendererLike, RenderInstrumentation>()
const infoTickers = new WeakMap<RendererInfoLike, InfoTicker>()

function instrumentRenderer(renderer: RendererLike, hook: RenderHook): () => void {
  const current = renderer.render
  if (typeof current !== 'function') return () => {}

  let instrumentation = renderInstrumentations.get(renderer)
  // A host replacement detaches the prior wrapper. Preserve it and instrument
  // the new method without letting an older monitor restore over the host.
  if (!instrumentation || current !== instrumentation.wrapper) {
    const hooks = new Set<RenderHook>()
    const original = current
    const wrapper: RenderMethod = function (this: unknown) {
      try {
        for (const entry of hooks) entry.begin()
        return Reflect.apply(original, this, arguments)
      } finally {
        for (const entry of hooks) entry.end()
      }
    }
    instrumentation = { original, wrapper, hooks }
    renderInstrumentations.set(renderer, instrumentation)
    renderer.render = wrapper
  }

  instrumentation.hooks.add(hook)
  let active = true
  return () => {
    if (!active) return
    active = false
    instrumentation.hooks.delete(hook)
    if (instrumentation.hooks.size > 0) return
    if (renderInstrumentations.get(renderer) !== instrumentation) return
    if (renderer.render === instrumentation.wrapper) renderer.render = instrumentation.original
    renderInstrumentations.delete(renderer)
  }
}

function onInfoTick(info: RendererInfoLike, tick: InfoTick): () => void {
  let ticker = infoTickers.get(info)
  if (!ticker) {
    const ticks = new Set<InfoTick>()
    const reset = typeof info.reset === 'function' ? info.reset : null
    const autoResetDescriptor = Object.getOwnPropertyDescriptor(info, 'autoReset')
    if (reset) info.autoReset = false
    ticker = {
      ticks,
      reset,
      autoResetDescriptor,
      stop: onTick((time) => {
        for (const fn of ticks) fn(time)
        reset?.call(info)
      }),
    }
    infoTickers.set(info, ticker)
  }

  ticker.ticks.add(tick)
  let active = true
  return () => {
    if (!active) return
    active = false
    ticker.ticks.delete(tick)
    if (ticker.ticks.size > 0) return
    ticker.stop()
    if (ticker.reset && info.autoReset === false) {
      if (ticker.autoResetDescriptor) {
        Object.defineProperty(info, 'autoReset', ticker.autoResetDescriptor)
      } else delete info.autoReset
    }
    infoTickers.delete(info)
  }
}

/**
 * Headless perf sampler: display FPS from rAF ticks, cpu/gpu ms from begin/end
 * brackets around `renderer.render` (including nested passes), and draw-call /
 * memory counts from the renderer's `.info`.
 */
export function createPerfMonitor(options: PerfMonitorOptions = {}): PerfMonitor {
  const stats: PerfStats = {
    fps: 0,
    cpu: 0,
    gpu: 0,
    calls: 0,
    frameCalls: 0,
    triangles: 0,
    lines: 0,
    points: 0,
    geometries: 0,
    textures: 0,
    shaders: 0,
    jsHeap: 0,
    gpuMemory: 0,
  }

  const sampleMs = options.interval ?? 250
  const renderer = options.renderer
  const gl = options.gl ?? detectGl(renderer)
  const timer = !options.gpuTime && gl ? createGlTimer(gl) : null
  const resolveTimestamps =
    !options.gpuTime && !timer && renderer?.trackTimestamp === true &&
    typeof renderer.resolveTimestampsAsync === 'function'
      ? renderer.resolveTimestampsAsync.bind(renderer)
      : null

  const capabilities: PerfCapabilities = {
    gpu: Boolean(options.gpuTime || timer || resolveTimestamps),
    counts: Boolean(renderer?.info),
    shaders: Array.isArray(renderer?.info.programs),
    jsHeap: readHeap() !== null,
    gpuMemory: Boolean(options.gpuMemory),
  }

  // --- cpu/gpu brackets ---
  // WebGPU post/shadow pipelines nest renderer.render() (scene pass, cube
  // shadow faces, fullscreen quad). Depth-track so CPU covers the whole tree
  // once, and FPS is NOT derived from these brackets (that would report
  // hundreds/thousands of "FPS").
  let renderDepth = 0
  let cpuStart = -1
  let cpuSum = 0
  let displayFrames = 0

  const begin = () => {
    if (renderDepth === 0) {
      cpuStart = performance.now()
      timer?.begin()
    }
    renderDepth++
  }
  const end = () => {
    if (renderDepth === 0) return
    renderDepth--
    if (renderDepth === 0 && cpuStart >= 0) {
      cpuSum += performance.now() - cpuStart
      cpuStart = -1
      timer?.end()
    }
  }

  const stopInstrumentation =
    renderer && options.instrument !== false
      ? instrumentRenderer(renderer, { begin, end })
      : null

  // WebGPU/common Info only auto-resets inside setAnimationLoop. Apps that drive
  // their own rAF (r3f, sanwei RAF, etc.) never hit that path, so per-frame
  // counters accumulate forever unless we own the reset. Take over whenever a
  // reset() exists — also gives correct multi-pass totals on WebGL.
  const info = renderer?.info
  const readCounts = () => {
    const current = renderer?.info
    if (!current) return
    const r = current.render
    if (r) {
      // WebGPU/common: drawCalls is per-frame; calls is lifetime render() count.
      // WebGLInfo: calls is the per-frame draw counter (no drawCalls field).
      stats.calls = r.drawCalls ?? r.calls ?? 0
      stats.frameCalls = r.frameCalls ?? 0
      stats.triangles = r.triangles ?? 0
      stats.lines = r.lines ?? 0
      stats.points = r.points ?? 0
    }
    const m = current.memory
    if (m) {
      stats.geometries = m.geometries ?? 0
      stats.textures = m.textures ?? 0
    }
    if (Array.isArray(current.programs)) stats.shaders = current.programs.length
  }

  // Snapshot + reset every display frame; report fps/cpu/gpu on the sampling window.
  let windowStart = typeof performance !== 'undefined' ? performance.now() : 0
  const tick = (t: number) => {
    displayFrames++
    readCounts()

    const elapsed = t - windowStart
    if (elapsed < sampleMs) return

    stats.fps = (displayFrames * 1000) / elapsed
    // cpuSum is total JS time in top-level render trees over the window
    stats.cpu = displayFrames > 0 ? cpuSum / displayFrames : 0
    cpuSum = 0
    displayFrames = 0
    windowStart = t

    if (options.gpuTime) {
      stats.gpu = options.gpuTime()
    } else if (timer) {
      const ms = timer.poll()
      if (ms >= 0) stats.gpu = ms
    } else if (resolveTimestamps) {
      const ts = renderer?.info.render?.timestamp
      if (typeof ts === 'number') stats.gpu = ts
      // kick the next resolve; the value lands in info.render.timestamp
      void resolveTimestamps().catch(() => {})
    }

    const heap = readHeap()
    if (heap !== null) stats.jsHeap = heap
    if (options.gpuMemory) stats.gpuMemory = options.gpuMemory() / MB
  }
  const stopTick = info ? onInfoTick(info, tick) : onTick(tick)

  let disposed = false
  return {
    stats,
    capabilities,
    interval: sampleMs,
    begin,
    end,
    dispose() {
      if (disposed) return
      disposed = true
      stopTick()
      stopInstrumentation?.()
      timer?.dispose()
    },
  }
}

function detectGl(renderer: RendererLike | undefined): WebGL2RenderingContext | undefined {
  const ctx = renderer?.getContext?.()
  return typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext
    ? ctx
    : undefined
}

function readHeap(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory
  return typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize / MB : null
}

interface GlTimer {
  begin(): void
  end(): void
  /** avg ms across queries resolved since last poll, or -1 when none resolved yet */
  poll(): number
  dispose(): void
}

interface DisjointTimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

/**
 * GPU frame timing via EXT_disjoint_timer_query_webgl2. One query brackets
 * each begin/end pair; results resolve a few frames later so poll() reports
 * the average of whatever completed since the previous window.
 */
function createGlTimer(gl: WebGL2RenderingContext): GlTimer | null {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as DisjointTimerExt | null
  if (!ext) return null

  const pending: WebGLQuery[] = []
  // Resolved query objects are reusable; pooling avoids per-render WebGL object churn.
  const available: WebGLQuery[] = []
  let active: WebGLQuery | null = null
  const MAX_PENDING = 8

  return {
    begin() {
      if (active) return
      const query = available.pop() ?? gl.createQuery()
      if (!query) return
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      active = query
    },
    end() {
      if (!active) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      pending.push(active)
      active = null
      // Drop unresolved queries if the GPU falls behind — prevents unbounded growth.
      while (pending.length > MAX_PENDING) {
        const q = pending.shift()
        if (q) gl.deleteQuery(q)
      }
    },
    poll() {
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const q of pending.splice(0)) gl.deleteQuery(q)
        return -1
      }
      let sum = 0
      let count = 0
      // results arrive in order; stop at the first unresolved query
      while (pending.length > 0) {
        const query = pending[0]!
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break
        sum += (gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6
        count++
        pending.shift()
        available.push(query)
      }
      return count > 0 ? sum / count : -1
    },
    dispose() {
      if (active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT)
        gl.deleteQuery(active)
        active = null
      }
      for (const q of pending.splice(0)) gl.deleteQuery(q)
      for (const q of available.splice(0)) gl.deleteQuery(q)
    },
  }
}
