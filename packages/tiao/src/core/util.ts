export function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max)
}

export function mapRange(v: number, a0: number, a1: number, b0: number, b1: number): number {
  return b0 + ((v - a0) / (a1 - a0)) * (b1 - b0)
}

export function snap(v: number, step: number | undefined, origin = 0): number {
  if (step === undefined || step === 0) return v
  const snapped = origin + Math.round((v - origin) / step) * step
  // avoid float noise like 0.30000000000000004
  const decimals = decimalCount(step)
  return Number(snapped.toFixed(Math.min(decimals, 12)))
}

/** Number of decimal places in a step like 0.01 (handles 1e-7 notation). */
export function decimalCount(n: number): number {
  const s = String(n)
  const e = s.indexOf('e-')
  if (e >= 0) return Number(s.slice(e + 2))
  const dot = s.indexOf('.')
  return dot >= 0 ? s.length - dot - 1 : 0
}

/**
 * Default number formatting. With a step, keep at least that many decimals so
 * values like 5.0 stay "5.0" next to 4.9 (consistent precision). Finer digits
 * (e.g. Alt nudge at step/10) are still shown when present.
 */
export function formatNumber(v: number, step?: number): string {
  if (!Number.isFinite(v)) return String(v)
  if (step === undefined) {
    // no step: trim trailing zeros — precision isn't meaningful
    return String(Number(v.toFixed(suggestedDecimals(v))))
  }
  const min = decimalCount(step)
  // count significant decimals in the value without float noise
  const trimmed = v.toFixed(12).replace(/\.?0+$/, '')
  const valueDecimals = trimmed.includes('.') ? trimmed.length - trimmed.indexOf('.') - 1 : 0
  return v.toFixed(Math.min(Math.max(min, valueDecimals), 12))
}

function suggestedDecimals(v: number): number {
  const abs = Math.abs(v)
  if (abs === 0 || abs >= 100) return 0
  if (abs >= 1) return 2
  return 3
}

export function parseNumberInput(text: string): number | null {
  const v = Number(text.replace(/[^\d.eE+-]/g, ''))
  return Number.isFinite(v) ? v : null
}

/**
 * Arrow-key nudge for number fields (tweakpane-style):
 * plain = ±step, Shift = ±step×10, Alt = ±step/10. Returns 0 for other keys.
 */
export function arrowKeyStep(e: KeyboardEvent, step: number): number {
  const dir = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0
  if (!dir) return 0
  return dir * step * (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1)
}

/**
 * Apply an arrow-key delta without re-snapping onto the base step, so Alt
 * fractions survive later plain/Shift nudges; finer deltas snap to their own
 * grid only to clean up float noise.
 */
export function nudge(current: number, delta: number, base: number): number {
  return snap(current + delta, Math.abs(delta) < base ? Math.abs(delta) : undefined)
}

export function roundN(n: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

export function round2(n: number): number {
  return roundN(n, 2)
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
