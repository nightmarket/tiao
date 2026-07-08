import { onTick } from '@tiao/core'

/** Live sample values. Poll with readonly bindings or read directly. */
export interface PerfStats {
  fps: number
  /** JS time spent inside render calls, ms per frame */
  cpu: number
  /** GPU time per frame, ms */
  gpu: number
  calls: number
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
  render?: {
    calls?: number
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

/**
 * Headless perf sampler: fps from the shared ticker, cpu/gpu ms from
 * begin/end brackets (auto-installed around `renderer.render`), and draw-call/
 * memory counts read straight from the renderer's `.info`.
 */
export function createPerfMonitor(options: PerfMonitorOptions = {}): PerfMonitor {
  const stats: PerfStats = {
    fps: 0,
    cpu: 0,
    gpu: 0,
    calls: 0,
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
  const webgpuTimestamps =
    !options.gpuTime &&
    !timer &&
    renderer?.trackTimestamp === true &&
    typeof renderer.resolveTimestampsAsync === 'function'

  const capabilities: PerfCapabilities = {
    gpu: Boolean(options.gpuTime || timer || webgpuTimestamps),
    counts: Boolean(renderer?.info),
    shaders: Array.isArray(renderer?.info.programs),
    jsHeap: readHeap() !== null,
    gpuMemory: Boolean(options.gpuMemory),
  }

  // --- cpu/gpu brackets ---
  let cpuStart = -1
  let cpuSum = 0
  let cpuCount = 0

  const begin = () => {
    if (cpuStart >= 0) return // ignore nested begins
    cpuStart = performance.now()
    timer?.begin()
  }
  const end = () => {
    if (cpuStart < 0) return
    cpuSum += performance.now() - cpuStart
    cpuCount++
    cpuStart = -1
    timer?.end()
  }

  let restoreRender: (() => void) | null = null
  if (renderer && options.instrument !== false && typeof renderer.render === 'function') {
    const original = renderer.render
    renderer.render = function (this: unknown, ...args: never[]) {
      begin()
      try {
        return original.apply(this, args)
      } finally {
        end()
      }
    }
    restoreRender = () => {
      renderer.render = original
    }
  }

  // --- sampling loop ---
  let frames = 0
  let windowStart = typeof performance !== 'undefined' ? performance.now() : 0
  const stopTick = onTick((t) => {
    frames++
    readCounts()
    const elapsed = t - windowStart
    if (elapsed < sampleMs) return
    stats.fps = (frames * 1000) / elapsed
    stats.cpu = cpuCount > 0 ? cpuSum / cpuCount : 0
    frames = 0
    cpuSum = 0
    cpuCount = 0
    windowStart = t

    if (options.gpuTime) {
      stats.gpu = options.gpuTime()
    } else if (timer) {
      const ms = timer.poll()
      if (ms >= 0) stats.gpu = ms
    } else if (webgpuTimestamps) {
      const ts = renderer?.info.render?.timestamp
      if (typeof ts === 'number') stats.gpu = ts
      // kick the next resolve; the value lands in info.render.timestamp
      void renderer?.resolveTimestampsAsync?.().catch(() => {})
    }

    const heap = readHeap()
    if (heap !== null) stats.jsHeap = heap
    if (options.gpuMemory) stats.gpuMemory = options.gpuMemory() / MB
  })

  const readCounts = () => {
    const info = renderer?.info
    if (!info) return
    const r = info.render
    if (r) {
      stats.calls = r.calls ?? 0
      stats.triangles = r.triangles ?? 0
      stats.lines = r.lines ?? 0
      stats.points = r.points ?? 0
    }
    const m = info.memory
    if (m) {
      stats.geometries = m.geometries ?? 0
      stats.textures = m.textures ?? 0
    }
    if (Array.isArray(info.programs)) stats.shaders = info.programs.length
  }

  return {
    stats,
    capabilities,
    interval: sampleMs,
    begin,
    end,
    dispose() {
      stopTick()
      restoreRender?.()
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
  let active: WebGLQuery | null = null

  return {
    begin() {
      if (active) return
      const query = gl.createQuery()
      if (!query) return
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query)
      active = query
    },
    end() {
      if (!active) return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      pending.push(active)
      active = null
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
        gl.deleteQuery(query)
        pending.shift()
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
    },
  }
}
