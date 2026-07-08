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

function decimalCount(n: number): number {
  const s = String(n)
  const e = s.indexOf('e-')
  if (e >= 0) return Number(s.slice(e + 2))
  const dot = s.indexOf('.')
  return dot >= 0 ? s.length - dot - 1 : 0
}

/** Default number formatting: enough decimals for the step, trimmed. */
export function formatNumber(v: number, step?: number): string {
  if (!Number.isFinite(v)) return String(v)
  const decimals = step !== undefined ? decimalCount(step) : suggestedDecimals(v)
  // Number() round-trip trims trailing zeros without eating integer digits
  return String(Number(v.toFixed(decimals)))
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

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
