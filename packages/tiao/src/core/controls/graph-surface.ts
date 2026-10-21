/** Everything one draw of a graph needs: its samples oldest first, the range they plot against, and
 * the resolved paint. */
export interface GraphFrame {
  samples: Float64Array
  count: number
  bufferSize: number
  min: number
  max: number
  /** the line, and the area under it at `alpha` */
  color: string
  alpha: number
  /** the newest sample's dot */
  dot: string
  width: number
  height: number
  dpr: number
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * A line through the samples against `min`..`max`, newest at the right edge
 * and marked with a dot, over the area beneath it fading toward the baseline.
 * Must stay self-contained, with no reference to anything outside its own body:
 * the graph worker's source is this function's text.
 */
export function paintGraph(c: Context2D, f: GraphFrame): void {
  c.clearRect(0, 0, f.width, f.height)
  const lineWidth = 1.25 * f.dpr
  const dotRadius = 2 * f.dpr
  // room for the line and the dot along the top and right edges, and the line along the bottom
  const inset = dotRadius + lineWidth / 2
  const right = f.width - inset
  const plotHeight = f.height - lineWidth / 2 - inset
  const step = right / (f.bufferSize - 1)
  const range = f.max - f.min
  const yAt = (v: number) =>
    inset + (1 - Math.min(1, Math.max(0, (v - f.min) / range))) * plotHeight
  // a lone sample draws a short level line, at least a pixel wide
  const left =
    f.count === 1 ? Math.max(0, right - Math.max(step, f.dpr)) : right - (f.count - 1) * step
  const trace = () => {
    c.beginPath()
    if (f.count === 1) {
      const y = yAt(f.samples[0]!)
      c.moveTo(left, y)
      c.lineTo(right, y)
      return
    }
    for (let i = 0; i < f.count; i++) {
      const x = left + i * step
      const y = yAt(f.samples[i]!)
      if (i === 0) c.moveTo(x, y)
      else c.lineTo(x, y)
    }
  }

  trace()
  c.lineTo(right, f.height)
  c.lineTo(left, f.height)
  c.closePath()
  c.fillStyle = f.color
  c.globalAlpha = f.alpha
  c.fill()
  // destination-in keeps only the gradient's alpha, so the fade can't tint the area
  const fade = c.createLinearGradient(0, inset, 0, f.height)
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)')
  fade.addColorStop(1, 'rgba(0, 0, 0, 0.1)')
  c.globalAlpha = 1
  c.globalCompositeOperation = 'destination-in'
  c.fillStyle = fade
  c.fillRect(0, 0, f.width, f.height)
  c.globalCompositeOperation = 'source-over'

  trace()
  c.strokeStyle = f.color
  c.lineWidth = lineWidth
  c.lineJoin = 'round'
  c.lineCap = 'round'
  c.stroke()
  c.beginPath()
  c.arc(right, yAt(f.samples[f.count - 1]!), dotRadius, 0, 2 * Math.PI)
  c.fillStyle = f.dot
  c.fill()
}

type GraphMessage =
  | { type: 'add'; id: number; canvas: OffscreenCanvas }
  | { type: 'size'; id: number; width: number; height: number }
  | { type: 'draw'; id: number; frame: GraphFrame }
  | { type: 'remove'; id: number }

interface WorkerScope {
  onmessage: ((event: MessageEvent<GraphMessage>) => void) | null
}

/**
 * The worker's whole program: keeps each graph's transferred canvas and paints frames into it.
 * Self-contained like `paintGraph`, which it receives as an argument.
 */
function graphWorkerMain(scope: WorkerScope, paint: typeof paintGraph): void {
  const contexts = new Map<number, OffscreenCanvasRenderingContext2D>()
  scope.onmessage = (event) => {
    const message = event.data
    switch (message.type) {
      case 'add': {
        const context = message.canvas.getContext('2d')
        if (context) contexts.set(message.id, context)
        break
      }
      case 'size': {
        const canvas = contexts.get(message.id)?.canvas
        if (!canvas) break
        if (canvas.width !== message.width) canvas.width = message.width
        if (canvas.height !== message.height) canvas.height = message.height
        break
      }
      case 'draw': {
        const context = contexts.get(message.id)
        if (context) paint(context, message.frame)
        break
      }
      case 'remove':
        contexts.delete(message.id)
        break
      default: {
        const unhandled: never = message
        return unhandled
      }
    }
  }
}

/** Where a graph's frames end up: painted on the main thread, or posted to the shared worker. */
export interface GraphSurface {
  resize(width: number, height: number): void
  draw(frame: GraphFrame): void
  dispose(): void
}

/** Paints into `canvas` on the main thread. */
function mainSurface(canvas: HTMLCanvasElement): GraphSurface {
  let context: CanvasRenderingContext2D | null = null
  return {
    resize(width, height) {
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
    },
    draw(frame) {
      context ??= canvas.getContext('2d')
      if (context) paintGraph(context, frame)
    },
    dispose() {},
  }
}

interface SharedWorker {
  worker: Worker
  url: string
  graphs: number
  /** Graphs that fall back to the main thread if the worker fails to start (say, a CSP without blob:). */
  onFail: Set<() => void>
}

let shared: SharedWorker | null = null
let workerFailed = false
let nextGraphId = 0

function canUseWorker(): boolean {
  return (
    !workerFailed &&
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof Blob === 'function' &&
    typeof URL.createObjectURL === 'function' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
  )
}

function acquireWorker(): SharedWorker | null {
  if (shared) {
    shared.graphs++
    return shared
  }
  try {
    const source = `(${graphWorkerMain.toString()})(self, ${paintGraph.toString()})`
    const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
    const worker = new Worker(url)
    const next: SharedWorker = { worker, url, graphs: 1, onFail: new Set() }
    worker.addEventListener('error', () => {
      workerFailed = true
      if (shared === next) shared = null
      worker.terminate()
      URL.revokeObjectURL(url)
      for (const fail of next.onFail) fail()
    })
    shared = next
    return next
  } catch {
    workerFailed = true
    return null
  }
}

function releaseWorker(entry: SharedWorker): void {
  entry.graphs--
  if (entry.graphs > 0 || shared !== entry) return
  shared = null
  entry.worker.terminate()
  URL.revokeObjectURL(entry.url)
}

/**
 * Draws off the main thread where the browser can: the canvas hands its drawing to one worker
 * shared by every graph on the page, so plotting never competes with the page's own frames.
 * Should the worker fail to start, `onFallback` gets a fresh canvas to paint on the main thread.
 */
export function createGraphSurface(
  canvas: HTMLCanvasElement,
  onFallback: (surface: GraphSurface) => void,
): GraphSurface {
  const entry = canUseWorker() ? acquireWorker() : null
  if (!entry) return mainSurface(canvas)

  const id = nextGraphId++
  const offscreen = canvas.transferControlToOffscreen()
  entry.worker.postMessage({ type: 'add', id, canvas: offscreen } satisfies GraphMessage, [
    offscreen,
  ])

  let width = 0
  let height = 0
  let active = true
  const fail = () => {
    if (!active) return
    // a transferred canvas can't draw on this thread again: swap in a new one
    const replacement = canvas.ownerDocument.createElement('canvas')
    replacement.className = canvas.className
    canvas.replaceWith(replacement)
    const fallback = mainSurface(replacement)
    if (width > 0) fallback.resize(width, height)
    onFallback(fallback)
  }
  entry.onFail.add(fail)

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth
      height = nextHeight
      entry.worker.postMessage({ type: 'size', id, width, height } satisfies GraphMessage)
    },
    draw(frame) {
      entry.worker.postMessage({ type: 'draw', id, frame } satisfies GraphMessage, [
        frame.samples.buffer,
      ])
    },
    dispose() {
      if (!active) return
      active = false
      entry.onFail.delete(fail)
      entry.worker.postMessage({ type: 'remove', id } satisfies GraphMessage)
      releaseWorker(entry)
    },
  }
}
