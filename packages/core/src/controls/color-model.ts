import { clamp, isRecord } from '../util'

/** Internal color representation: r/g/b 0-255, a 0-1. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

export type ColorFormat =
  | 'hex' // '#rrggbb'
  | 'hex-alpha' // '#rrggbbaa'
  | 'rgb-string' // 'rgb(r, g, b)'
  | 'rgba-string'
  | 'hsl-string' // 'hsl(h, s%, l%)'
  | 'hsla-string'
  | 'hsv-string' // 'hsv(h, s%, v%)' (tweakpane-style, not CSS)
  | 'hsva-string'
  | 'object' // {r,g,b}
  | 'object-alpha' // {r,g,b,a}
  | 'object-hsl' // {h,s,l} with s/l 0-100
  | 'object-hsl-alpha'
  | 'object-hsv' // {h,s,v} with s/v 0-100
  | 'object-hsv-alpha'
  | 'number' // 0xrrggbb
  | 'oklch' // 'oklch(L C H)'
  | 'oklch-alpha' // 'oklch(L C H / a)'
  | 'oklab' // 'oklab(L a b)'
  | 'oklab-alpha' // 'oklab(L a b / a)'

export interface ParsedColor {
  rgba: Rgba
  format: ColorFormat
}

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_RE = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i
const HSL_RE =
  /^(hsla?|hsva?)\(\s*(-?[\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,/]\s*([\d.]+)(%)?\s*)?\)$/i
const OK_RE =
  /^(oklch|oklab)\(\s*(-?[\d.]+)(%)?\s+(-?[\d.]+)%?\s+(-?[\d.]+)(?:deg)?\s*(?:\/\s*(-?[\d.]+)(%)?\s*)?\)$/i

export function parseColor(value: unknown): ParsedColor | null {
  if (typeof value === 'string') return parseColorString(value)
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 0xffffff) {
    return {
      rgba: { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff, a: 1 },
      format: 'number',
    }
  }
  if (isRecord(value) && typeof value['r'] === 'number' && typeof value['g'] === 'number' && typeof value['b'] === 'number') {
    const hasAlpha = typeof value['a'] === 'number'
    return {
      rgba: {
        r: value['r'] as number,
        g: value['g'] as number,
        b: value['b'] as number,
        a: hasAlpha ? (value['a'] as number) : 1,
      },
      format: hasAlpha ? 'object-alpha' : 'object',
    }
  }
  // {h,s,l} / {h,s,v} objects with s/l/v in 0-100 (tweakpane conventions)
  if (isRecord(value) && typeof value['h'] === 'number' && typeof value['s'] === 'number') {
    const hasAlpha = typeof value['a'] === 'number'
    const a = hasAlpha ? (value['a'] as number) : 1
    const hue = value['h'] as number
    const s = (value['s'] as number) / 100
    if (typeof value['l'] === 'number') {
      const { r, g, b } = hslToRgb(hue, s, (value['l'] as number) / 100)
      return { rgba: { r, g, b, a }, format: hasAlpha ? 'object-hsl-alpha' : 'object-hsl' }
    }
    if (typeof value['v'] === 'number') {
      const { r, g, b } = hsvToRgb(hue, s, (value['v'] as number) / 100)
      return { rgba: { r, g, b, a }, format: hasAlpha ? 'object-hsv-alpha' : 'object-hsv' }
    }
  }
  return null
}

function parseColorString(s: string): ParsedColor | null {
  const str = s.trim()
  if (HEX_RE.test(str)) {
    const hex = str.slice(1)
    if (hex.length <= 4) {
      const [r = '0', g = '0', b = '0', a] = hex.split('')
      return {
        rgba: {
          r: parseInt(r + r, 16),
          g: parseInt(g + g, 16),
          b: parseInt(b + b, 16),
          a: a ? parseInt(a + a, 16) / 255 : 1,
        },
        format: a ? 'hex-alpha' : 'hex',
      }
    }
    return {
      rgba: {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      },
      format: hex.length === 8 ? 'hex-alpha' : 'hex',
    }
  }
  const m = RGB_RE.exec(str)
  if (m) {
    const [, r, g, b, a] = m
    return {
      rgba: { r: Number(r), g: Number(g), b: Number(b), a: a !== undefined ? Number(a) : 1 },
      format: a !== undefined ? 'rgba-string' : 'rgb-string',
    }
  }
  const hs = HSL_RE.exec(str)
  if (hs) {
    const [, fn, hRaw, sRaw, thirdRaw, aRaw, aPct] = hs
    const isHsv = (fn as string).toLowerCase().startsWith('hsv')
    const hue = ((Number(hRaw) % 360) + 360) % 360
    const s = clamp(Number(sRaw) / 100, 0, 1)
    const third = clamp(Number(thirdRaw) / 100, 0, 1)
    const a = aRaw !== undefined ? clamp(Number(aRaw) / (aPct ? 100 : 1), 0, 1) : 1
    const { r, g, b } = isHsv ? hsvToRgb(hue, s, third) : hslToRgb(hue, s, third)
    const base: ColorFormat = isHsv
      ? aRaw !== undefined ? 'hsva-string' : 'hsv-string'
      : aRaw !== undefined ? 'hsla-string' : 'hsl-string'
    return { rgba: { r, g, b, a }, format: base }
  }
  const ok = OK_RE.exec(str)
  if (ok) {
    const [, fn, lRaw, lPct, second, third, aRaw, aPct] = ok
    const L = Number(lRaw) / (lPct ? 100 : 1)
    const alpha = aRaw !== undefined ? Number(aRaw) / (aPct ? 100 : 1) : 1
    const isLch = (fn as string).toLowerCase() === 'oklch'
    const [labA, labB] = isLch
      ? [Number(second) * Math.cos((Number(third) * Math.PI) / 180), Number(second) * Math.sin((Number(third) * Math.PI) / 180)]
      : [Number(second), Number(third)]
    const { r, g, b } = oklabToRgb(L, labA, labB)
    const base: ColorFormat = isLch ? 'oklch' : 'oklab'
    return {
      rgba: { r, g, b, a: clamp(alpha, 0, 1) },
      format: aRaw !== undefined ? (`${base}-alpha` as ColorFormat) : base,
    }
  }
  return null
}

export function serializeColor(rgba: Rgba, format: ColorFormat): unknown {
  const r = Math.round(clamp(rgba.r, 0, 255))
  const g = Math.round(clamp(rgba.g, 0, 255))
  const b = Math.round(clamp(rgba.b, 0, 255))
  const a = clamp(rgba.a, 0, 1)
  switch (format) {
    case 'hex':
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`
    case 'hex-alpha':
      return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(Math.round(a * 255))}`
    case 'rgb-string':
      return `rgb(${r}, ${g}, ${b})`
    case 'rgba-string':
      return `rgba(${r}, ${g}, ${b}, ${round2(a)})`
    case 'hsl-string':
    case 'hsla-string': {
      const { h: hh, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
      const body = `${Math.round(hh)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`
      return format === 'hsla-string' ? `hsla(${body}, ${round2(a)})` : `hsl(${body})`
    }
    case 'hsv-string':
    case 'hsva-string': {
      const { h: hh, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b)
      const body = `${Math.round(hh)}, ${Math.round(s * 100)}%, ${Math.round(v * 100)}%`
      return format === 'hsva-string' ? `hsva(${body}, ${round2(a)})` : `hsv(${body})`
    }
    case 'object':
      return { r, g, b }
    case 'object-alpha':
      return { r, g, b, a: round2(a) }
    case 'object-hsl':
    case 'object-hsl-alpha': {
      const { h: hh, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
      const base = { h: Math.round(hh), s: Math.round(s * 100), l: Math.round(l * 100) }
      return format === 'object-hsl-alpha' ? { ...base, a: round2(a) } : base
    }
    case 'object-hsv':
    case 'object-hsv-alpha': {
      const { h: hh, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b)
      const base = { h: Math.round(hh), s: Math.round(s * 100), v: Math.round(v * 100) }
      return format === 'object-hsv-alpha' ? { ...base, a: round2(a) } : base
    }
    case 'number':
      return (r << 16) | (g << 8) | b
    case 'oklch':
    case 'oklch-alpha': {
      const { L, a: labA, b: labB } = rgbToOklab(rgba.r, rgba.g, rgba.b)
      const c = Math.hypot(labA, labB)
      let hue = (Math.atan2(labB, labA) * 180) / Math.PI
      if (hue < 0) hue += 360
      const alpha = format === 'oklch-alpha' ? ` / ${round2(a)}` : ''
      return `oklch(${roundN(L, 4)} ${roundN(c, 4)} ${roundN(hue, 1)}${alpha})`
    }
    case 'oklab':
    case 'oklab-alpha': {
      const { L, a: labA, b: labB } = rgbToOklab(rgba.r, rgba.g, rgba.b)
      const alpha = format === 'oklab-alpha' ? ` / ${round2(a)}` : ''
      return `oklab(${roundN(L, 4)} ${roundN(labA, 4)} ${roundN(labB, 4)}${alpha})`
    }
    default: {
      const _exhaustive: never = format
      return _exhaustive
    }
  }
}

export function formatHasAlpha(format: ColorFormat): boolean {
  return (
    format === 'hex-alpha' ||
    format === 'rgba-string' ||
    format === 'hsla-string' ||
    format === 'hsva-string' ||
    format === 'object-alpha' ||
    format === 'object-hsl-alpha' ||
    format === 'object-hsv-alpha' ||
    format === 'oklch-alpha' ||
    format === 'oklab-alpha'
  )
}

/** true when the format serializes to a string (drives the row text field) */
export function formatIsString(format: ColorFormat): boolean {
  return format !== 'number' && !format.startsWith('object')
}

export function toCss(rgba: Rgba): string {
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${round2(rgba.a)})`
}

export function toHexText(rgba: Rgba, alpha: boolean): string {
  const base = `#${toHex(Math.round(rgba.r))}${toHex(Math.round(rgba.g))}${toHex(Math.round(rgba.b))}`
  return alpha ? base + toHex(Math.round(rgba.a * 255)) : base
}

function toHex(n: number): string {
  return clamp(n, 0, 255).toString(16).padStart(2, '0')
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundN(n: number, decimals: number): number {
  const f = Math.pow(10, decimals)
  return Math.round(n * f) / f
}

/* ---- OKLab / OKLCH (Björn Ottosson's reference conversions) ---- */

function srgbToLinear(c: number): number {
  const n = c / 255
  return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4)
}

function linearToSrgb(c: number): number {
  const n = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
  return clamp(n * 255, 0, 255)
}

export function rgbToOklab(r: number, g: number, b: number): { L: number; a: number; b: number } {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/** unclamped linear-light sRGB (0-1 range when in gamut) */
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3)
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklabToRgb(L: number, a: number, b: number): { r: number; g: number; b: number } {
  const [lr, lg, lb] = oklabToLinear(L, a, b)
  return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb) }
}

/** L 0-1, C >= 0, H in degrees */
export interface Oklch {
  L: number
  C: number
  H: number
}

export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const lab = rgbToOklab(r, g, b)
  let H = (Math.atan2(lab.b, lab.a) * 180) / Math.PI
  if (H < 0) H += 360
  return { L: lab.L, C: Math.hypot(lab.a, lab.b), H }
}

export function oklchToRgb(L: number, C: number, H: number): { r: number; g: number; b: number } {
  const rad = (H * Math.PI) / 180
  return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad))
}

const GAMUT_EPS = 1e-4

export function oklchInGamut(L: number, C: number, H: number): boolean {
  const rad = (H * Math.PI) / 180
  const [r, g, b] = oklabToLinear(L, C * Math.cos(rad), C * Math.sin(rad))
  return (
    r >= -GAMUT_EPS && r <= 1 + GAMUT_EPS &&
    g >= -GAMUT_EPS && g <= 1 + GAMUT_EPS &&
    b >= -GAMUT_EPS && b <= 1 + GAMUT_EPS
  )
}

/** largest sRGB-representable chroma at a given lightness/hue (binary search) */
export function maxChroma(L: number, H: number, limit = 0.4): number {
  if (!oklchInGamut(L, 0, H)) return 0
  if (oklchInGamut(L, limit, H)) return limit
  let lo = 0
  let hi = limit
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2
    if (oklchInGamut(L, mid, H)) lo = mid
    else hi = mid
  }
  return lo
}

/** h 0-360, s/v 0-1 */
export interface Hsv {
  h: number
  s: number
  v: number
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6)
    else if (max === gn) h = 60 * ((bn - rn) / d + 2)
    else h = 60 * ((rn - gn) / d + 4)
  }
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

/** h 0-360, s/l 0-1 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const { h, s: sv, v } = rgbToHsv(r, g, b)
  const l = v * (1 - sv / 2)
  const s = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l)
  return { h, s, l }
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const v = l + s * Math.min(l, 1 - l)
  const sv = v === 0 ? 0 : 2 * (1 - l / v)
  return hsvToRgb(h, sv, v)
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let rn = 0
  let gn = 0
  let bn = 0
  if (h < 60) [rn, gn, bn] = [c, x, 0]
  else if (h < 120) [rn, gn, bn] = [x, c, 0]
  else if (h < 180) [rn, gn, bn] = [0, c, x]
  else if (h < 240) [rn, gn, bn] = [0, x, c]
  else if (h < 300) [rn, gn, bn] = [x, 0, c]
  else [rn, gn, bn] = [c, 0, x]
  return { r: (rn + m) * 255, g: (gn + m) * 255, b: (bn + m) * 255 }
}
