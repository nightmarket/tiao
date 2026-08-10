import '@nightmarket/tiao/styles.css'
import { createGraph, Value } from '@nightmarket/tiao/core'

const params = new URLSearchParams(location.search)
const samples = Number(params.get('samples') ?? 5000)
const graphs = Number(params.get('graphs') ?? 8)
const bufferSize = Number(params.get('buffer') ?? 128)

const host = document.createElement('div')
host.style.cssText = 'position:fixed;left:0;top:0;width:240px'
document.body.append(host)

const values: Value<number>[] = []
for (let i = 0; i < graphs; i++) {
  const value = new Value(0)
  const el = createGraph({
    value,
    options: { min: 0, max: 120, bufferSize, unit: 'FPS', label: `g${i}` },
    onDispose() {},
  })
  host.append(el)
  values.push(value)
}

await new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
})

for (let i = 0; i < 64; i++) {
  for (const v of values) v.set(i % 120, { source: 'monitor', sample: true })
}

const t0 = performance.now()
for (let i = 0; i < samples; i++) {
  const sample = (i * 7) % 120
  for (const v of values) v.set(sample, { source: 'monitor', sample: true })
}
const elapsedMs = performance.now() - t0
const updates = samples * graphs
const result = {
  samples,
  graphs,
  bufferSize,
  updates,
  elapsedMs,
  nsPerUpdate: (elapsedMs * 1e6) / updates,
  updatesPerSec: updates / (elapsedMs / 1000),
  canvasW: (host.querySelector('canvas') as HTMLCanvasElement | null)?.width ?? 0,
}

declare global {
  interface Window {
    __TIAO_GRAPH_BENCH__?: typeof result
  }
}

window.__TIAO_GRAPH_BENCH__ = result
const out = document.getElementById('out')
if (out) out.textContent = JSON.stringify(result, null, 2)
