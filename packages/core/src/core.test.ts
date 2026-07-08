import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Pane } from './pane'
import { registerPlugin } from './plugin'
import { maxChroma, oklchInGamut, parseColor, serializeColor } from './controls/color-model'
import { snap, formatNumber } from './util'

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('Pane bindings', () => {
  it('writes slider changes back to the target object and emits change events', () => {
    const params = { speed: 0.5 }
    const pane = new Pane({ title: 'test' })
    const binding = pane.addBinding(params, 'speed', { min: 0, max: 1 })

    const onBinding = vi.fn()
    const onPane = vi.fn()
    binding.on('change', onBinding)
    pane.on('change', onPane)

    binding.value.set(0.75, { source: 'ui', last: true })

    expect(params.speed).toBe(0.75)
    expect(onBinding).toHaveBeenCalledWith(
      expect.objectContaining({ value: 0.75, last: true, key: 'speed' }),
    )
    expect(onPane).toHaveBeenCalledTimes(1)
    pane.dispose()
  })

  it('refresh() re-reads from the target without writing back', () => {
    const params = { label: 'a' }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'label')
    params.label = 'b'
    binding.refresh()
    expect(binding.value.get()).toBe('b')
    pane.dispose()
  })

  it('bubbles changes through nested folders', () => {
    const params = { x: 1 }
    const pane = new Pane()
    const folder = pane.addFolder({ title: 'outer' })
    const inner = folder.addFolder({ title: 'inner' })
    const binding = inner.addBinding(params, 'x')

    const onPane = vi.fn()
    const onFolder = vi.fn()
    pane.on('change', onPane)
    folder.on('change', onFolder)

    binding.value.set(2, { source: 'ui', last: true })
    expect(onFolder).toHaveBeenCalledTimes(1)
    expect(onPane).toHaveBeenCalledTimes(1)
    pane.dispose()
  })

  it('throws for values no plugin accepts', () => {
    const pane = new Pane()
    expect(() => pane.addBinding({ fn: () => {} }, 'fn')).toThrow(/no input plugin/)
    pane.dispose()
  })

  it('dispose removes elements and stops writeback', () => {
    const params = { n: 1 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'n')
    const el = binding.element
    expect(el.isConnected).toBe(true)
    binding.dispose()
    expect(el.isConnected).toBe(false)
    expect(pane.children).toHaveLength(0)
    pane.dispose()
  })

  it('select maps option labels to values', () => {
    const params = { mode: 'line' }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'mode', {
      options: { Line: 'line', Scatter: 'scatter' },
    })
    const select = binding.element.querySelector('select') as HTMLSelectElement
    select.value = '1'
    select.dispatchEvent(new Event('change'))
    expect(params.mode).toBe('scatter')
    pane.dispose()
  })

  it('point bindings write a new object per axis change', () => {
    const params = { pos: { x: 1, y: 2 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'pos')
    binding.value.set({ x: 5, y: 2 }, { source: 'ui', last: true })
    expect(params.pos).toEqual({ x: 5, y: 2 })
    pane.dispose()
  })

  it('point2d renders two fields and an XY pad popup that opens into the pane root', () => {
    const pane = new Pane()
    const binding = pane.addBinding({ pos: { x: 0, y: 0 } }, 'pos')
    expect(binding.element.querySelectorAll('.tiao-num-input')).toHaveLength(2)
    const toggle = binding.element.querySelector('.tiao-point-pad-toggle') as HTMLButtonElement
    toggle.click()
    const popup = pane.element.querySelector(':scope > .tiao-popup.tiao-open')
    expect(popup).not.toBeNull()
    expect(popup!.querySelector('.tiao-point-pad')).not.toBeNull()
    pane.dispose()
  })

  it('binds oklch strings as colors and shows the oklch text in the field', () => {
    const params = { c: 'oklch(0.7 0.15 200)' }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'c')
    const text = binding.element.querySelector('.tiao-color-text') as HTMLInputElement
    expect(text.value).toMatch(/^oklch\(/)
    const swatch = binding.element.querySelector('.tiao-color-swatch') as HTMLButtonElement
    swatch.click()
    expect(pane.element.querySelector('.tiao-color-picker.tiao-open')).not.toBeNull()
    pane.dispose()
  })
})

describe('Pane registry and chrome', () => {
  it('registers panes by id and clears on dispose', () => {
    const pane = new Pane({ id: 'main' })
    expect(Pane.get('main')).toBe(pane)
    pane.dispose()
    expect(Pane.get('main')).toBeUndefined()
  })

  it('persists expanded state per id', () => {
    const pane = new Pane({ id: 'p1' })
    pane.expanded = false
    pane.dispose()
    const revived = new Pane({ id: 'p1' })
    expect(revived.expanded).toBe(false)
    revived.dispose()
  })

  it('injects styles exactly once per document', () => {
    const a = new Pane()
    const b = new Pane()
    expect(document.querySelectorAll('style[data-tiao]')).toHaveLength(1)
    a.dispose()
    b.dispose()
  })

  it('applies theme variables', () => {
    const pane = new Pane({ theme: { accent: 'red', '--tiao-bg': 'blue' } })
    expect(pane.element.style.getPropertyValue('--tiao-accent')).toBe('red')
    expect(pane.element.style.getPropertyValue('--tiao-bg')).toBe('blue')
    pane.dispose()
  })

  it('brings a floating pane to the front on pointerdown', () => {
    const a = new Pane()
    const b = new Pane()
    const zb = Number(b.element.style.zIndex)
    expect(zb).toBeGreaterThan(Number(a.element.style.zIndex))
    a.element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(Number(a.element.style.zIndex)).toBeGreaterThan(zb)
    // already on top: no bump
    const za = Number(a.element.style.zIndex)
    a.element.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(Number(a.element.style.zIndex)).toBe(za)
    a.dispose()
    b.dispose()
  })

  it('applies a custom maxHeight as a CSS variable', () => {
    const pane = new Pane({ maxHeight: 320 })
    expect(pane.element.style.getPropertyValue('--tiao-max-height')).toBe('320px')
    pane.dispose()
  })

  it('oklch bindings open the OKLCH gamut picker; hex bindings the HSV picker', () => {
    const params = { a: 'oklch(0.7 0.12 200)', b: '#ff8800' }
    const pane = new Pane()
    pane.addBinding(params, 'a')
    pane.addBinding(params, 'b')
    const pickers = pane.element.querySelectorAll('.tiao-color-picker')
    expect(pickers[0]?.querySelector('.tiao-color-ok')?.classList.contains('tiao-hidden')).toBe(false)
    expect(pickers[0]?.querySelector('.tiao-color-sv')?.classList.contains('tiao-hidden')).toBe(true)
    expect(pickers[1]?.querySelector('.tiao-color-ok')?.classList.contains('tiao-hidden')).toBe(true)
    expect(pickers[1]?.querySelector('.tiao-color-sv')?.classList.contains('tiao-hidden')).toBe(false)

    // switching the format dropdown swaps the picker mode
    const select = pickers[1]?.querySelector('.tiao-select') as HTMLSelectElement
    select.value = 'oklch'
    select.dispatchEvent(new Event('change'))
    expect(pickers[1]?.querySelector('.tiao-color-ok')?.classList.contains('tiao-hidden')).toBe(false)
    pane.dispose()
  })

  it('collapsible: false folders stay expanded and ignore header clicks', () => {
    const pane = new Pane()
    const folder = pane.addFolder({ title: 'Fixed', collapsible: false })
    expect(folder.element.classList.contains('tiao-folder-static')).toBe(true)
    expect(folder.expanded).toBe(true)
    folder.element.querySelector<HTMLButtonElement>('.tiao-folder-header')?.click()
    folder.expanded = false
    expect(folder.expanded).toBe(true)
    pane.dispose()
  })

  it('clicking a row label activates its control', () => {
    const params = { label: 'hi', tint: '#ff8800', on: false }
    const pane = new Pane()
    pane.addBinding(params, 'label')
    pane.addBinding(params, 'tint')
    pane.addBinding(params, 'on')
    const rows = pane.element.querySelectorAll('.tiao-row')

    rows[0]?.querySelector('.tiao-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(pane.element.querySelector('.tiao-text-input'))

    rows[1]?.querySelector('.tiao-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pane.element.querySelector('.tiao-color-picker')?.classList.contains('tiao-open')).toBe(true)

    rows[2]?.querySelector('.tiao-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(params.on).toBe(true)
    pane.dispose()
  })

  it('only oklab bindings get the OKLAB dropdown entry', () => {
    const params = { a: '#ff8800', b: 'oklab(0.7 0.05 -0.05)' }
    const pane = new Pane()
    pane.addBinding(params, 'a')
    pane.addBinding(params, 'b')
    const selects = pane.element.querySelectorAll('.tiao-color-mode .tiao-select')
    const values = (s: Element) => [...s.querySelectorAll('option')].map((o) => o.value)
    expect(values(selects[0]!)).toEqual(['hex', 'rgb', 'oklch'])
    expect(values(selects[1]!)).toEqual(['hex', 'rgb', 'oklch', 'oklab'])
    pane.dispose()
  })

  it('color picker popup has a format dropdown that switches the text field', () => {
    const params = { tint: '#ff8800' }
    const pane = new Pane()
    pane.addBinding(params, 'tint')
    const select = pane.element.querySelector('.tiao-color-mode .tiao-select') as HTMLSelectElement
    const text = pane.element.querySelector('.tiao-color-mode .tiao-color-text') as HTMLInputElement
    expect(select.value).toBe('hex')
    expect(text.value).toBe('#ff8800')
    select.value = 'rgb'
    select.dispatchEvent(new Event('change'))
    expect(text.value).toBe('rgb(255, 136, 0)')
    pane.dispose()
  })

  it('clicking anywhere on the titlebar collapses, except the gear', () => {
    const pane = new Pane()
    const titlebar = pane.element.querySelector('.tiao-titlebar') as HTMLElement
    expect(pane.expanded).toBe(true)
    titlebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pane.expanded).toBe(false)

    const gear = pane.element.querySelector('.tiao-pane-gear') as HTMLButtonElement
    gear.click()
    // gear toggles the menu, not the collapse state
    expect(pane.expanded).toBe(false)
    expect(pane.element.querySelector('.tiao-pane-menu.tiao-open')).not.toBeNull()
    pane.dispose()
  })

  it('gear opens the settings menu with a draggable toggle and 8 anchor cells', () => {
    const pane = new Pane()
    const gear = pane.element.querySelector('.tiao-pane-gear') as HTMLButtonElement
    gear.click()
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    expect(menu).not.toBeNull()
    expect(menu.querySelectorAll('.tiao-anchor-cell')).toHaveLength(8)

    const dragToggle = menu.querySelector('.tiao-check') as HTMLButtonElement
    expect(pane.draggable).toBe(true)
    dragToggle.click()
    expect(pane.draggable).toBe(false)
    pane.dispose()
  })

  it('right-click opens the menu; anchor buttons re-anchor the pane', () => {
    const pane = new Pane({ id: 'anchored' })
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    expect(menu).not.toBeNull()

    const bottomCenter = menu.querySelectorAll('.tiao-anchor-cell')[6] as HTMLButtonElement
    expect(bottomCenter.title).toBe('bottom center')
    bottomCenter.click()
    expect(pane.anchor).toBe('bottom-center')
    expect(pane.element.style.left).toBe('50%')
    expect(pane.element.style.transform).toBe('translateX(-50%)')
    pane.dispose()

    // anchor persists per pane id
    const revived = new Pane({ id: 'anchored' })
    expect(revived.anchor).toBe('bottom-center')
    revived.dispose()
  })

  it('moveTo clears the anchor', () => {
    const pane = new Pane({ anchor: 'top-right' })
    expect(pane.anchor).toBe('top-right')
    pane.moveTo(10, 20)
    expect(pane.anchor).toBeNull()
    expect(pane.element.style.left).toBe('10px')
    pane.dispose()
  })
})

describe('plugin registry', () => {
  it('lets custom global plugins claim values before builtins', () => {
    registerPlugin({
      id: 'stars',
      type: 'input',
      accept: (v, o) => typeof v === 'number' && o.view === 'stars',
      create: (ctx) => {
        const el = document.createElement('div')
        el.className = 'stars'
        el.textContent = '★'.repeat(ctx.value.get() as number)
        return { element: el }
      },
    })
    const pane = new Pane()
    const binding = pane.addBinding({ rating: 3 }, 'rating', { view: 'stars' })
    expect(binding.element.querySelector('.stars')?.textContent).toBe('★★★')
    pane.dispose()
  })

  it('supports per-pane plugins that do not leak to other panes', () => {
    const paneA = new Pane()
    const paneB = new Pane()
    paneA.registerPlugin({
      id: 'local',
      type: 'blade',
      accept: (p) => p['view'] === 'local',
      create: () => ({ element: document.createElement('div') }),
    })
    expect(() => paneA.addBlade({ view: 'local' })).not.toThrow()
    expect(() => paneB.addBlade({ view: 'local' })).toThrow(/no blade plugin/)
    paneA.dispose()
    paneB.dispose()
  })
})

describe('color model', () => {
  it('reports sRGB gamut limits in oklch', () => {
    // pure sRGB red is on the gamut boundary
    expect(oklchInGamut(0.6279, 0.2576, 29.23)).toBe(true)
    expect(oklchInGamut(0.6279, 0.3, 29.23)).toBe(false)
    // near-white can carry almost no chroma
    expect(maxChroma(0.99, 200)).toBeLessThan(0.02)
    const m = maxChroma(0.6279, 29.23)
    expect(m).toBeGreaterThan(0.25)
    expect(oklchInGamut(0.6279, m, 29.23)).toBe(true)
  })

  it('round-trips formats', () => {
    const hex = parseColor('#ff8800')
    expect(hex?.format).toBe('hex')
    expect(serializeColor(hex!.rgba, hex!.format)).toBe('#ff8800')

    const rgba = parseColor('rgba(10, 20, 30, 0.5)')
    expect(rgba?.format).toBe('rgba-string')
    expect(serializeColor(rgba!.rgba, rgba!.format)).toBe('rgba(10, 20, 30, 0.5)')

    const obj = parseColor({ r: 1, g: 2, b: 3 })
    expect(obj?.format).toBe('object')
    expect(serializeColor(obj!.rgba, obj!.format)).toEqual({ r: 1, g: 2, b: 3 })

    const short = parseColor('#f80')
    expect(short?.rgba).toEqual({ r: 255, g: 136, b: 0, a: 1 })
  })

  it('parses and round-trips oklch/oklab', () => {
    const lch = parseColor('oklch(0.7 0.15 200)')
    expect(lch?.format).toBe('oklch')
    // teal-ish: green/blue dominant
    expect(lch!.rgba.g).toBeGreaterThan(lch!.rgba.r)
    const out = serializeColor(lch!.rgba, 'oklch') as string
    const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(out)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBeCloseTo(0.7, 1)
    expect(Number(m![2])).toBeCloseTo(0.15, 1)
    // slight hue drift is expected: the color is gamut-clipped into sRGB
    expect(Number(m![3])).toBeCloseTo(200, -1)

    const lab = parseColor('oklab(62.8% -0.1 0.1 / 50%)')
    expect(lab?.format).toBe('oklab-alpha')
    expect(lab!.rgba.a).toBeCloseTo(0.5)
    expect(serializeColor(lab!.rgba, 'oklab-alpha')).toMatch(/^oklab\(0\.62\d* -0\.\d+ 0\.\d+ \/ 0\.5\)$/)

    // white round-trips losslessly enough
    const white = parseColor('oklch(1 0 0)')
    expect(white!.rgba.r).toBeGreaterThan(254)
    expect(white!.rgba.g).toBeGreaterThan(254)
    expect(white!.rgba.b).toBeGreaterThan(254)
  })
})

describe('number utils', () => {
  it('snaps without float noise', () => {
    expect(snap(0.30000000000000004, 0.1)).toBe(0.3)
    expect(snap(7, 5)).toBe(5)
  })
  it('formats according to step', () => {
    expect(formatNumber(0.5, 0.01)).toBe('0.5')
    expect(formatNumber(3, 1)).toBe('3')
  })
})
