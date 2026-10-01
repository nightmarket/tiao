/**
 * Diff two graph-bench JSON artifacts.
 * Run: node scripts/perf/compare-graph-bench.mjs baseline after-ring
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const a = process.argv[2] ?? 'baseline'
const b = process.argv[3] ?? 'after'
const dir = join(__dirname, 'artifacts')

function load(label) {
  return JSON.parse(readFileSync(join(dir, `graph-bench-${label}.json`), 'utf8'))
}

const before = load(a)
const after = load(b)
const deltaNs = after.nsPerUpdate - before.nsPerUpdate
const pct = (deltaNs / before.nsPerUpdate) * 100
const out = {
  before: {
    label: before.label,
    nsPerUpdate: before.nsPerUpdate,
    elapsedMs: before.elapsedMs,
    canvasW: before.canvasW,
  },
  after: {
    label: after.label,
    nsPerUpdate: after.nsPerUpdate,
    elapsedMs: after.elapsedMs,
    canvasW: after.canvasW,
  },
  deltaNsPerUpdate: deltaNs,
  pctChange: pct,
  faster: deltaNs < 0,
}
console.log(JSON.stringify(out, null, 2))
