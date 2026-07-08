export interface SceneParams {
  speed: number
  count: number
  size: number
  color: string
  trail: number
  center: { x: number; y: number }
  mode: 'orbit' | 'wave'
  running: boolean
}

export interface SceneHandle {
  stop(): void
  fps(): number
}

export function startScene(canvas: HTMLCanvasElement, getParams: () => SceneParams): SceneHandle {
  const ctx = canvas.getContext('2d')!
  let raf = 0
  let t = 0
  let lastTime = performance.now()
  let fps = 60

  const resize = () => {
    const dpr = devicePixelRatio
    const { clientWidth, clientHeight } = canvas
    canvas.width = clientWidth * dpr
    canvas.height = clientHeight * dpr
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min((now - lastTime) / 1000, 0.1)
    lastTime = now
    fps = fps * 0.9 + (dt > 0 ? 1 / dt : 60) * 0.1

    const p = getParams()
    if (p.running) t += dt * p.speed

    const { width: w, height: h } = canvas
    ctx.fillStyle = `rgba(16, 16, 20, ${p.trail})`
    ctx.fillRect(0, 0, w, h)

    const cx = w / 2 + p.center.x * w * 0.4
    const cy = h / 2 + p.center.y * h * 0.4
    ctx.fillStyle = p.color

    for (let i = 0; i < p.count; i++) {
      const a = (i / p.count) * Math.PI * 2
      let x: number
      let y: number
      if (p.mode === 'orbit') {
        const r = (0.12 + 0.28 * Math.sin(t * 0.7 + i * 0.37)) * Math.min(w, h)
        x = cx + Math.cos(a + t) * r
        y = cy + Math.sin(a * 2 + t * 1.3) * r
      } else {
        x = (i / p.count) * w
        y = cy + Math.sin(a * 3 + t * 2) * h * 0.2 * Math.sin(t * 0.5 + i * 0.05)
      }
      ctx.beginPath()
      ctx.arc(x, y, p.size * devicePixelRatio, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  raf = requestAnimationFrame(frame)

  return {
    stop() {
      cancelAnimationFrame(raf)
      ro.disconnect()
    },
    fps: () => fps,
  }
}
