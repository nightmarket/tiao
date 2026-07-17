import { draggable, h } from '../dom'
import { clamp } from '../util'
import {
  formatHasAlpha,
  formatIsString,
  hsvToRgb,
  maxChroma,
  maxChromaP3,
  oklabToRgb,
  oklchToRgb,
  parseColor,
  rgbToHsv,
  rgbToOklch,
  serializeColor,
  toCss,
  toHexText,
  type ColorFormat,
  type Rgba,
} from './color-model'
import { createPopup } from './popup'
import { createSelectMenu } from './select'
import type { InputPlugin, PluginContext } from '../plugin'

/**
 * Color input: swatch + format-aware text field, with a floating picker popup
 * (SV area, hue bar, optional alpha bar) like tweakpane.
 * Accepts '#hex', 'rgb()/rgba()', 'hsl()/hsla()', 'hsv()/hsva()',
 * 'oklch()/oklab()' strings, {r,g,b(,a)} / {h,s,l(,a)} / {h,s,v(,a)} objects
 * and 0xffffff numbers; writes back in the same format. Alpha is enabled via
 * `color: { alpha: true }` or inferred from the initial value's format.
 */
export const colorInputPlugin: InputPlugin<unknown> = {
  id: 'color',
  type: 'input',
  accept(value, options) {
    if (options.view === 'text') return false
    if (options.options) return false
    const parsed = parseColor(value)
    if (!parsed) return false
    // plain numbers are only colors when explicitly asked
    if (parsed.format === 'number' && options.view !== 'color') return false
    return true
  },
  create(ctx) {
    return createColorView(ctx)
  },
}

type DisplayFamily = 'hex' | 'rgb' | 'hsl' | 'hsv' | 'oklch' | 'oklab'

const FAMILIES: Array<{ id: DisplayFamily; label: string }> = [
  { id: 'hex', label: 'Hex' },
  { id: 'rgb', label: 'RGB' },
  { id: 'hsl', label: 'HSL' },
  { id: 'hsv', label: 'HSV' },
  { id: 'oklch', label: 'OKLCH' },
  { id: 'oklab', label: 'OKLAB' },
]

function familyOf(format: ColorFormat): DisplayFamily {
  if (format.includes('oklch')) return 'oklch'
  if (format.includes('oklab')) return 'oklab'
  if (format.includes('hsv')) return 'hsv'
  if (format.includes('hsl')) return 'hsl'
  if (format.startsWith('rgb')) return 'rgb'
  return 'hex'
}

function displayFormat(family: DisplayFamily, alpha: boolean): ColorFormat {
  switch (family) {
    case 'hex':
      return alpha ? 'hex-alpha' : 'hex'
    case 'rgb':
      return alpha ? 'rgba-string' : 'rgb-string'
    case 'hsl':
      return alpha ? 'hsla-string' : 'hsl-string'
    case 'hsv':
      return alpha ? 'hsva-string' : 'hsv-string'
    case 'oklch':
      return alpha ? 'oklch-alpha' : 'oklch'
    case 'oklab':
      return alpha ? 'oklab-alpha' : 'oklab'
    default: {
      const _exhaustive: never = family
      return _exhaustive
    }
  }
}

function createColorView(ctx: PluginContext<unknown>) {
  const parsed = parseColor(ctx.value.get())
  const format: ColorFormat = parsed?.format ?? 'hex'
  const alpha = Boolean((ctx.options['color'] as { alpha?: boolean } | undefined)?.alpha) || formatHasAlpha(format)
  const writeFormat: ColorFormat = alpha && format === 'hex' ? 'hex-alpha' : format
  // string bindings follow the selected color space; object/number bindings keep their shape
  const stringWrite = formatIsString(writeFormat)
  let family = familyOf(writeFormat)

  let rgba: Rgba = parsed?.rgba ?? { r: 255, g: 255, b: 255, a: 1 }
  let hsv = rgbToHsv(rgba.r, rgba.g, rgba.b)
  let ok = rgbToOklch(rgba.r, rgba.g, rgba.b)
  // hue is undefined for achromatic colors; keep the last stable one
  const syncOk = () => {
    const next = rgbToOklch(rgba.r, rgba.g, rgba.b)
    ok = next.C > 1e-4 ? next : { ...next, H: ok.H }
  }

  const swatch = h('button', 'tiao-color-swatch')
  swatch.type = 'button'
  const textInput = h('input', 'tiao-color-text')
  textInput.type = 'text'
  textInput.spellcheck = false

  // --- floating picker ---
  const svThumb = h('div', 'tiao-thumb')
  const svArea = h('div', 'tiao-color-sv', svThumb)
  const hueThumb = h('div', 'tiao-bar-thumb')
  const hueBar = h('div', 'tiao-color-hue', hueThumb)
  const alphaThumb = h('div', 'tiao-bar-thumb')
  const alphaBar = h('div', 'tiao-color-alpha', alphaThumb)

  // --- OKLCH picker: L (y) x C (x) plane at the current hue ---
  // sRGB colors are opaque; P3-only and wider colors render faded so the
  // full hue slice stays readable, with white cutoff curves on top.
  const OK_C_MAX = 0.4
  const okThumb = h('div', 'tiao-thumb')
  const okCanvas = h('canvas', 'tiao-ok-canvas')
  okCanvas.width = 156
  okCanvas.height = 110
  const okArea = h('div', 'tiao-color-ok', okCanvas, okThumb)
  const okHueThumb = h('div', 'tiao-bar-thumb')
  const okHueBar = h('div', 'tiao-color-hue', okHueThumb)
  okHueBar.style.background = `linear-gradient(to right, ${Array.from(
    { length: 13 },
    (_, i) => `oklch(0.7 0.12 ${i * 30})`,
  ).join(', ')})`

  let planeHue = -1
  let planeImg: ImageData | null = null
  let srgbEdge: Float64Array | null = null
  let p3Edge: Float64Array | null = null
  const strokeGamutEdge = (
    c2d: CanvasRenderingContext2D,
    xs: Float64Array,
    style: string,
    dash?: number[],
  ) => {
    c2d.save()
    c2d.strokeStyle = style
    c2d.lineWidth = 1
    c2d.setLineDash(dash ?? [])
    c2d.beginPath()
    for (let y = 0; y < xs.length; y++) {
      const x = xs[y]!
      if (y === 0) c2d.moveTo(x, y)
      else c2d.lineTo(x, y)
    }
    c2d.stroke()
    c2d.restore()
  }
  const drawPlane = () => {
    const c2d = okCanvas.getContext?.('2d')
    if (!c2d) return
    const w = okCanvas.width
    const hgt = okCanvas.height
    // reuse one ImageData across redraws (hue drags redraw per pointermove)
    planeImg ??= c2d.createImageData(w, hgt)
    const data = planeImg.data
    srgbEdge ??= new Float64Array(hgt)
    p3Edge ??= new Float64Array(hgt)
    // hue is constant across the plane; hoist its trig out of the pixel loop
    const hueRad = (ok.H * Math.PI) / 180
    const cosH = Math.cos(hueRad)
    const sinH = Math.sin(hueRad)
    for (let y = 0; y < hgt; y++) {
      const L = 1 - y / (hgt - 1)
      // gamut edges once per row; pixels classify against them instead of
      // re-running the (pow-heavy) in-gamut checks per pixel
      srgbEdge[y] = (maxChroma(L, ok.H, OK_C_MAX) / OK_C_MAX) * (w - 1)
      p3Edge[y] = (maxChromaP3(L, ok.H, OK_C_MAX) / OK_C_MAX) * (w - 1)
      for (let x = 0; x < w; x++) {
        const C = (x / (w - 1)) * OK_C_MAX
        // clipped sRGB preview; alpha encodes accessibility (sRGB / P3 / beyond)
        const { r, g, b } = oklabToRgb(L, C * cosH, C * sinH)
        const i = (y * w + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = x <= srgbEdge[y]! ? 255 : x <= p3Edge[y]! ? 110 : 45
      }
    }
    c2d.putImageData(planeImg, 0, 0)
    // P3 edge first (dashed), then solid white sRGB cutoff on top
    strokeGamutEdge(c2d, p3Edge, 'rgba(255,255,255,0.35)', [2, 2])
    strokeGamutEdge(c2d, srgbEdge, 'rgba(255,255,255,0.9)')
    planeHue = ok.H
  }
  // hue drags can fire several pointermoves per frame; coalesce the O(w*h)
  // plane repaint to one per frame. The very first draw stays synchronous so
  // the plane never flashes blank when the oklch view appears.
  let planeFrame = 0
  const schedulePlaneDraw = () => {
    if (planeHue < 0 || typeof requestAnimationFrame === 'undefined') {
      drawPlane()
      return
    }
    if (planeFrame) return
    planeFrame = requestAnimationFrame(() => {
      planeFrame = 0
      drawPlane()
    })
  }
  ctx.onDispose(() => {
    if (planeFrame) cancelAnimationFrame(planeFrame)
  })

  // format dropdown + matching text field
  // oklab (renders like oklch) and hsv (not a CSS notation) are only offered
  // to bindings that already use them
  const families = FAMILIES.filter(
    (f) => (f.id !== 'oklab' && f.id !== 'hsv') || family === f.id,
  )
  const modeSelect = h('select', 'tiao-select')
  for (const f of families) {
    const opt = ctx.document.createElement('option')
    opt.value = f.id
    opt.textContent = f.label
    modeSelect.append(opt)
  }
  modeSelect.value = family
  const pickerText = h('input', 'tiao-color-text')
  pickerText.type = 'text'
  pickerText.spellcheck = false
  const modeRow = h(
    'div',
    'tiao-color-mode',
    createSelectMenu(modeSelect, ctx.onDispose).wrap,
    pickerText,
  )

  const picker = h(
    'div',
    'tiao-color-picker',
    svArea,
    hueBar,
    okArea,
    okHueBar,
    alpha ? alphaBar : null,
    modeRow,
  )
  const root = h('div', 'tiao-color', swatch, textInput, picker)

  const isOkMode = () => family === 'oklch' || family === 'oklab'
  const applyMode = () => {
    const okMode = isOkMode()
    svArea.classList.toggle('tiao-hidden', okMode)
    hueBar.classList.toggle('tiao-hidden', okMode)
    okArea.classList.toggle('tiao-hidden', !okMode)
    okHueBar.classList.toggle('tiao-hidden', !okMode)
  }

  const popup = createPopup(root, picker, ctx.onDispose)
  const togglePicker = () => {
    const opening = !popup.isOpen()
    popup.toggle()
    if (opening && isOkMode() && ok.H !== planeHue) schedulePlaneDraw()
  }
  swatch.addEventListener('click', togglePicker)
  ctx.onDispose(() => swatch.removeEventListener('click', togglePicker))

  const commit = (last: boolean) => {
    const fmt = stringWrite ? displayFormat(family, alpha) : writeFormat
    ctx.value.set(serializeColor(rgba, fmt), { source: 'ui', last })
  }

  const textValue = (): string =>
    stringWrite ? String(serializeColor(rgba, displayFormat(family, alpha))) : toHexText(rgba, alpha)

  // last written values, so per-move renders skip redundant style writes
  let lastSvHue = -1
  let lastAlphaColor = ''
  const render = () => {
    const css = toCss(rgba)
    swatch.style.background = css
    if (ctx.document.activeElement !== textInput) {
      textInput.value = textValue()
    }
    if (ctx.document.activeElement !== pickerText) {
      pickerText.value = String(serializeColor(rgba, displayFormat(family, alpha)))
    }
    if (isOkMode()) {
      if (popup.isOpen() && ok.H !== planeHue) schedulePlaneDraw()
      okThumb.style.left = `${clamp(ok.C / OK_C_MAX, 0, 1) * 100}%`
      okThumb.style.top = `${clamp(1 - ok.L, 0, 1) * 100}%`
      okThumb.style.background = css
      okHueThumb.style.left = `${(ok.H / 360) * 100}%`
    } else {
      if (hsv.h !== lastSvHue) {
        lastSvHue = hsv.h
        svArea.style.background =
          `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv.h}, 100%, 50%)`
      }
      svThumb.style.left = `${hsv.s * 100}%`
      svThumb.style.top = `${(1 - hsv.v) * 100}%`
      svThumb.style.background = css
      hueThumb.style.left = `${(hsv.h / 360) * 100}%`
    }
    if (alpha) {
      alphaThumb.style.left = `${rgba.a * 100}%`
      const alphaColor = `rgb(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)})`
      if (alphaColor !== lastAlphaColor) {
        lastAlphaColor = alphaColor
        alphaBar.style.setProperty('--tiao-alpha-color', alphaColor)
      }
    }
  }

  const setFromHsv = (last: boolean) => {
    const { r, g, b } = hsvToRgb(hsv.h, hsv.s, hsv.v)
    rgba = { ...rgba, r, g, b }
    syncOk()
    render()
    commit(last)
  }

  // clip chroma to the sRGB gamut so the thumb never leaves the painted area
  const setFromOk = (last: boolean) => {
    ok.C = Math.min(ok.C, maxChroma(ok.L, ok.H, OK_C_MAX))
    const { r, g, b } = oklchToRgb(ok.L, ok.C, ok.H)
    rgba = { ...rgba, r, g, b }
    hsv = rgbToHsv(r, g, b)
    render()
    commit(last)
  }

  // drag helpers; the rect is read once per drag, not per pointermove
  const barDrag = (el: HTMLElement, apply: (t: number, last: boolean) => void) => {
    let rect: DOMRect
    const fromEvent = (clientX: number) => clamp((clientX - rect.left) / rect.width, 0, 1)
    ctx.onDispose(
      draggable(el, {
        onStart: (e) => {
          rect = el.getBoundingClientRect()
          apply(fromEvent(e.clientX), false)
        },
        onMove: (s) => apply(fromEvent(s.x), false),
        onEnd: (s) => apply(fromEvent(s.x), true),
      }),
    )
  }
  const areaDrag = (el: HTMLElement, apply: (tx: number, ty: number, last: boolean) => void) => {
    let rect: DOMRect
    const fromEvent = (clientX: number, clientY: number, last: boolean) =>
      apply(
        clamp((clientX - rect.left) / rect.width, 0, 1),
        clamp((clientY - rect.top) / rect.height, 0, 1),
        last,
      )
    ctx.onDispose(
      draggable(el, {
        onStart: (e) => {
          rect = el.getBoundingClientRect()
          fromEvent(e.clientX, e.clientY, false)
        },
        onMove: (s) => fromEvent(s.x, s.y, false),
        onEnd: (s) => fromEvent(s.x, s.y, true),
      }),
    )
  }

  areaDrag(svArea, (tx, ty, last) => {
    hsv.s = tx
    hsv.v = 1 - ty
    setFromHsv(last)
  })
  barDrag(hueBar, (t, last) => {
    hsv.h = t * 360
    setFromHsv(last)
  })

  areaDrag(okArea, (tx, ty, last) => {
    ok.C = tx * OK_C_MAX
    ok.L = 1 - ty
    setFromOk(last)
  })
  barDrag(okHueBar, (t, last) => {
    ok.H = t * 360
    setFromOk(last)
  })
  if (alpha) {
    barDrag(alphaBar, (t, last) => {
      rgba.a = t
      render()
      commit(last)
    })
  }

  // text entry accepts any supported format
  const bindTextEntry = (input: HTMLInputElement) => {
    const commitText = () => {
      const next = parseColor(input.value)
      if (next) {
        rgba = { ...next.rgba, a: alpha ? next.rgba.a : 1 }
        hsv = rgbToHsv(rgba.r, rgba.g, rgba.b)
        syncOk()
        render()
        commit(true)
      } else {
        render()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') input.blur()
    }
    input.addEventListener('blur', commitText)
    input.addEventListener('keydown', onKey)
    ctx.onDispose(() => {
      input.removeEventListener('blur', commitText)
      input.removeEventListener('keydown', onKey)
    })
  }
  bindTextEntry(textInput)
  bindTextEntry(pickerText)

  const onModeChange = () => {
    family = modeSelect.value as DisplayFamily
    applyMode()
    render()
    // re-serialize string bindings so the bound value matches the new space
    if (stringWrite) commit(true)
  }
  modeSelect.addEventListener('change', onModeChange)
  ctx.onDispose(() => modeSelect.removeEventListener('change', onModeChange))

  // external updates
  ctx.onDispose(
    ctx.value.subscribe((v, meta) => {
      if (meta.source === 'ui') return
      const next = parseColor(v)
      if (!next) return
      rgba = next.rgba
      hsv = rgbToHsv(rgba.r, rgba.g, rgba.b)
      syncOk()
      render()
    }),
  )

  applyMode()
  render()
  return {
    element: root,
    activate: () => {
      if (!popup.isOpen()) togglePicker()
    },
  }
}
