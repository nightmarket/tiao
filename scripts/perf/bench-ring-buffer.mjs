/**
 * Isolates Array#shift vs ring-buffer ingest cost (the graph monitor's sample path).
 * Run: node scripts/perf/bench-ring-buffer.mjs [label]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const artifacts = join(__dirname, 'artifacts')
mkdirSync(artifacts, { recursive: true })

const label = process.argv[2] ?? 'baseline'
const bufferSize = Number(process.env.TIAO_BENCH_BUFFER ?? 128)
const samples = Number(process.env.TIAO_BENCH_SAMPLES ?? 200_000)

function benchShift(n, size) {
  const buffer = []
  let observedMin = Infinity
  let observedMax = -Infinity
  let observedMinCount = 0
  let observedMaxCount = 0
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    const v = (i * 7) % 120
    const removed = buffer.length === size ? buffer.shift() : undefined
    if (removed === observedMin) observedMinCount--
    if (removed === observedMax) observedMaxCount--
    buffer.push(v)
    if (v < observedMin) {
      observedMin = v
      observedMinCount = 1
    } else if (v === observedMin) {
      observedMinCount++
    }
    if (v > observedMax) {
      observedMax = v
      observedMaxCount = 1
    } else if (v === observedMax) {
      observedMaxCount++
    }
    if (observedMinCount === 0 || observedMaxCount === 0) {
      observedMin = buffer[0]
      observedMax = observedMin
      observedMinCount = 0
      observedMaxCount = 0
      for (const sample of buffer) {
        if (sample < observedMin) {
          observedMin = sample
          observedMinCount = 1
        } else if (sample === observedMin) {
          observedMinCount++
        }
        if (sample > observedMax) {
          observedMax = sample
          observedMaxCount = 1
        } else if (sample === observedMax) {
          observedMaxCount++
        }
      }
    }
  }
  return { ms: performance.now() - t0, lastMin: observedMin, lastMax: observedMax, len: buffer.length }
}

function benchRing(n, size) {
  const buffer = new Float64Array(size)
  let count = 0
  let start = 0
  let observedMin = Infinity
  let observedMax = -Infinity
  let observedMinCount = 0
  let observedMaxCount = 0
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    const v = (i * 7) % 120
    let removed
    if (count === size) {
      removed = buffer[start]
      start = (start + 1) % size
    } else {
      count++
    }
    const writeAt = (start + count - 1) % size
    buffer[writeAt] = v
    if (removed === observedMin) observedMinCount--
    if (removed === observedMax) observedMaxCount--
    if (v < observedMin) {
      observedMin = v
      observedMinCount = 1
    } else if (v === observedMin) {
      observedMinCount++
    }
    if (v > observedMax) {
      observedMax = v
      observedMaxCount = 1
    } else if (v === observedMax) {
      observedMaxCount++
    }
    if (observedMinCount === 0 || observedMaxCount === 0) {
      observedMin = buffer[start]
      observedMax = observedMin
      observedMinCount = 0
      observedMaxCount = 0
      for (let j = 0; j < count; j++) {
        const sample = buffer[(start + j) % size]
        if (sample < observedMin) {
          observedMin = sample
          observedMinCount = 1
        } else if (sample === observedMin) {
          observedMinCount++
        }
        if (sample > observedMax) {
          observedMax = sample
          observedMaxCount = 1
        } else if (sample === observedMax) {
          observedMaxCount++
        }
      }
    }
  }
  return { ms: performance.now() - t0, lastMin: observedMin, lastMax: observedMax, len: count }
}

// Warm
benchShift(10_000, bufferSize)
benchRing(10_000, bufferSize)

const shift = benchShift(samples, bufferSize)
const ring = benchRing(samples, bufferSize)
const out = {
  label,
  at: new Date().toISOString(),
  bufferSize,
  samples,
  shiftMs: shift.ms,
  ringMs: ring.ms,
  speedup: shift.ms / ring.ms,
  nsPerShift: (shift.ms * 1e6) / samples,
  nsPerRing: (ring.ms * 1e6) / samples,
  parity: shift.lastMin === ring.lastMin && shift.lastMax === ring.lastMax && shift.len === ring.len,
}
const path = join(artifacts, `ring-buffer-${label}.json`)
writeFileSync(path, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
console.log(`wrote ${path}`)
