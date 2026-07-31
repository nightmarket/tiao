import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Pane } from './pane'
import { registerPlugin } from './plugin'
import { maxChroma, maxChromaP3, oklchInGamut, oklchInP3Gamut, parseColor, serializeColor } from './controls/color-model'
import { jsonStore, snap, formatNumber, withoutPersisting } from './util'

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

/** open the notch's global settings panel, or return the one already open */
function openNotchMenu(): HTMLElement {
  if (!document.querySelector('.tiao-notch .tiao-pane-menu.tiao-open')) {
    ;(document.querySelector('.tiao-notch-gear') as HTMLButtonElement).click()
  }
  return document.querySelector('.tiao-notch .tiao-pane-menu') as HTMLElement
}

/** the notch settings row with this label */
function notchMenuRow(label: string): HTMLElement {
  const rows = [...openNotchMenu().querySelectorAll('.tiao-row')]
  return rows.find((r) => r.querySelector('.tiao-label')?.textContent === label) as HTMLElement
}

function notchMenuCheck(label: string): HTMLElement {
  return notchMenuRow(label).querySelector('.tiao-check') as HTMLElement
}

function notchMenuSelect(label: string): HTMLSelectElement {
  return notchMenuRow(label).querySelector('.tiao-select') as HTMLSelectElement
}

/** pick an option by its visible label, the way a user would */
function selectOption(select: HTMLSelectElement, label: string): void {
  const option = [...select.options].find((o) => o.textContent === label)
  select.value = option!.value
  select.dispatchEvent(new Event('change'))
}

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
    // min/max numbers overlay the value on a full-width track (fill-edge is the handlebar)
    expect(binding.element.querySelector('.tiao-slider')).not.toBeNull()
    expect(binding.element.querySelector('.tiao-slider-num')).not.toBeNull()
    pane.dispose()
  })

  it('binds {min,max} objects as interval sliders with from/to fields', () => {
    const params = { range: { min: 20, max: 80 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'range', { min: 0, max: 100, step: 1 })

    expect(binding.element.querySelector('.tiao-interval')).not.toBeNull()
    expect(binding.element.querySelector('.tiao-interval-min')).not.toBeNull()
    expect(binding.element.querySelector('.tiao-interval-max')).not.toBeNull()
    const inputs = binding.element.querySelectorAll('.tiao-num-input')
    expect(inputs).toHaveLength(2)
    expect((inputs[0] as HTMLInputElement).value).toBe('20')
    expect((inputs[1] as HTMLInputElement).value).toBe('80')

    binding.value.set({ min: 30, max: 70 }, { source: 'ui', last: true })
    expect(params.range).toEqual({ min: 30, max: 70 })
    expect((inputs[0] as HTMLInputElement).value).toBe('30')
    expect((inputs[1] as HTMLInputElement).value).toBe('70')

    // row activate focuses "from"; DOM order lets Tab reach "to"
    const label = binding.element.querySelector('.tiao-label') as HTMLElement
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(inputs[0])
    pane.dispose()
  })

  it('interval track drag moves the nearer endpoint without crossing', () => {
    const params = { range: { min: 20, max: 80 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'range', { min: 0, max: 100 })
    const track = binding.element.querySelector('.tiao-slider') as HTMLElement

    // jsdom has no layout; stub the track rect so pointer→value mapping works
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 20,
      width: 100,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }))
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 25, clientY: 10, bubbles: true, buttons: 1 }))
    track.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(params.range.min).toBe(25)
    expect(params.range.max).toBe(80)

    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 90, clientY: 10, bubbles: true }))
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 60, clientY: 10, bubbles: true, buttons: 1 }))
    track.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 60, clientY: 10, bubbles: true }))
    expect(params.range.min).toBe(25)
    expect(params.range.max).toBe(60)

    // left of the band always grabs from; right of the band always grabs to
    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 10, bubbles: true }))
    track.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 5, clientY: 10, bubbles: true }))
    expect(params.range.min).toBe(5)
    expect(params.range.max).toBe(60)
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

  it('readonly bindings emit change events when the monitored value changes', () => {
    const params = { fps: 60 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'fps', { readonly: true })
    const seen: number[] = []
    binding.on('change', (ev) => seen.push(ev.value))
    const bubbled: number[] = []
    pane.on('change', (ev) => bubbled.push(ev.value as number))
    params.fps = 30
    binding.refresh()
    binding.refresh() // unchanged value: no duplicate event
    expect(seen).toEqual([30])
    expect(bubbled).toEqual([30])
    expect(params.fps).toBe(30)
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

  it('point2d renders two fields and an XY pad overlay centered on the plus icon', () => {
    const pane = new Pane()
    const binding = pane.addBinding({ pos: { x: 0, y: 0 } }, 'pos')
    expect(binding.element.querySelectorAll('.tiao-num-input')).toHaveLength(2)
    const toggle = binding.element.querySelector('.tiao-point-pad-toggle') as HTMLButtonElement
    vi.spyOn(toggle, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      right: 60,
      top: 10,
      bottom: 30,
      width: 20,
      height: 20,
      x: 40,
      y: 10,
      toJSON: () => ({}),
    })
    toggle.click()
    const overlay = document.querySelector('.tiao-point-overlay') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.querySelector('.tiao-point-pad')).not.toBeNull()
    expect(overlay.querySelector('.tiao-point-pad-ray')).not.toBeNull()
    expect(overlay.style.left).toBe('50px')
    expect(overlay.style.top).toBe('20px')
    pane.dispose()
  })

  it('angle view renders a dial knob and opens a sticky overlay centered on the icon', () => {
    const params = { yaw: 45 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'yaw', { view: 'angle' })
    const knob = binding.element.querySelector('.tiao-angle-knob') as HTMLButtonElement
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement
    expect(knob).not.toBeNull()
    expect(input.value).toContain('°')

    vi.spyOn(knob, 'getBoundingClientRect').mockReturnValue({
      left: 40,
      right: 60,
      top: 10,
      bottom: 30,
      width: 20,
      height: 20,
      x: 40,
      y: 10,
      toJSON: () => ({}),
    })
    knob.click()
    const overlay = document.querySelector('.tiao-angle-overlay') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.querySelector('.tiao-angle-dial')).not.toBeNull()
    // centered on the knob (50, 20) whether opened by click or long-press
    expect(overlay.style.left).toBe('50px')
    expect(overlay.style.top).toBe('20px')
    expect(document.querySelector('.tiao-angle-overlay')).not.toBeNull()
    pane.dispose()
  })

  it('angle sticky overlay follows the pointer and commits on mousedown', () => {
    const params = { yaw: 0 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'yaw', { view: 'angle' })
    const knob = binding.element.querySelector('.tiao-angle-knob') as HTMLButtonElement
    vi.spyOn(knob, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 0,
      bottom: 100,
      width: 100,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    knob.click()
    expect(document.querySelector('.tiao-angle-overlay')).not.toBeNull()
    // hover-follow: origin is knob center (50,50) → (100, 50) is right = 90°
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 50, bubbles: true }))
    expect(params.yaw).toBe(90)
    expect(document.querySelector('.tiao-scrub-tooltip')?.textContent).toBe('90°')
    // mousedown commits and closes
    document.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 50, clientY: 100, bubbles: true }),
    )
    expect(params.yaw).toBe(180)
    expect(document.querySelector('.tiao-angle-overlay')).toBeNull()
    pane.dispose()
  })

  it('point2d sticky overlay shows a value tooltip while adjusting', () => {
    const params = { pos: { x: 0, y: 0 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'pos', {
      x: { min: -1, max: 1 },
      y: { min: -1, max: 1 },
    })
    const toggle = binding.element.querySelector('.tiao-point-pad-toggle') as HTMLButtonElement
    vi.spyOn(toggle, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 20,
      top: 0,
      bottom: 20,
      width: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    toggle.click()
    // pad centered at (10,10), size 136 → right edge ≈ (10+68, 10) = x max
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 78, clientY: 10, bubbles: true }))
    expect(params.pos.x).toBeCloseTo(1, 5)
    expect(params.pos.y).toBeCloseTo(0, 5)
    expect(document.querySelector('.tiao-scrub-tooltip')?.textContent).toBe('1.00, 0.00')
    pane.dispose()
  })

  it('point2d long-press drag commits and closes on pointerup', () => {
    vi.useFakeTimers()
    const params = { pos: { x: 0, y: 0 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'pos', {
      x: { min: -1, max: 1 },
      y: { min: -1, max: 1 },
    })
    const toggle = binding.element.querySelector('.tiao-point-pad-toggle') as HTMLButtonElement
    vi.spyOn(toggle, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 20,
      top: 0,
      bottom: 20,
      width: 20,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    toggle.dispatchEvent(
      new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }),
    )
    vi.advanceTimersByTime(200)
    expect(document.querySelector('.tiao-point-overlay')).not.toBeNull()
    // drag past move threshold toward pad right edge
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: 78, clientY: 10, bubbles: true, buttons: 1 }),
    )
    expect(params.pos.x).toBeCloseTo(1, 5)
    expect(document.querySelector('.tiao-scrub-tooltip')?.textContent).toBe('1.00, 0.00')
    // release commits — no second click needed
    document.dispatchEvent(
      new MouseEvent('pointerup', { button: 0, clientX: 78, clientY: 10, bubbles: true }),
    )
    expect(params.pos.x).toBeCloseTo(1, 5)
    expect(document.querySelector('.tiao-point-overlay')).toBeNull()
    vi.useRealTimers()
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

  it('H toggles all floating panes but leaves inline ones alone', () => {
    const a = new Pane({ title: 'A' })
    const b = new Pane({ title: 'B' })
    const inline = new Pane({ title: 'Inline', container: document.body.appendChild(document.createElement('div')) })

    expect(Pane.toggleAll()).toBe(true)
    expect(a.hidden).toBe(true)
    expect(b.hidden).toBe(true)
    expect(inline.hidden).toBe(false)

    expect(Pane.toggleAll()).toBe(false)
    expect(a.hidden).toBe(false)
    expect(b.hidden).toBe(false)

    a.dispose()
    b.dispose()
    inline.dispose()
  })

  it('H keydown hides floating panes unless focus is in an input', () => {
    const pane = new Pane()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    expect(pane.hidden).toBe(true)

    pane.hidden = false
    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }))
    expect(pane.hidden).toBe(false)

    input.remove()
    pane.dispose()
  })

  it('mounts one notch with the first floating pane and drops it with the last', () => {
    expect(document.querySelector('.tiao-notch')).toBeNull()
    const a = new Pane()
    const b = new Pane()
    expect(document.querySelectorAll('.tiao-notch')).toHaveLength(1)

    a.dispose()
    expect(document.querySelector('.tiao-notch')).not.toBeNull()
    b.dispose()
    expect(document.querySelector('.tiao-notch')).toBeNull()
  })

  it('notch hide button toggles all panes and swaps the eye icon', () => {
    const pane = new Pane()
    const hide = document.querySelector('.tiao-notch-hide') as HTMLButtonElement

    hide.click()
    expect(pane.hidden).toBe(true)
    expect(hide.querySelector('.tiao-icon-eye-off')).not.toBeNull()

    hide.click()
    expect(pane.hidden).toBe(false)
    expect(hide.querySelector('.tiao-icon-eye')).not.toBeNull()
    pane.dispose()
  })

  it('notch buttons carry an accessible name that follows their state', () => {
    const pane = new Pane()
    const label = (cls: string) =>
      (document.querySelector(cls) as HTMLElement).getAttribute('aria-label')

    expect(label('.tiao-notch-hide')).toBe('Hide debug panes')
    expect(label('.tiao-notch-dock')).toBe('Dock panes to sidebar')
    expect(label('.tiao-notch-gear')).toBe('Global settings')
    expect(label('.tiao-notch-reset')).toBe('Reset values to defaults')

    ;(document.querySelector('.tiao-notch-hide') as HTMLButtonElement).click()
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    expect(label('.tiao-notch-hide')).toBe('Show debug panes')
    expect(label('.tiao-notch-dock')).toBe('Undock panes')

    Pane.toggleDock()
    pane.dispose()
  })

  it('notch font size draws every floating pane larger and persists', () => {
    const pane = new Pane({ size: 's' })
    const inline = new Pane({ container: document.body.appendChild(document.createElement('div')) })
    expect(pane.size).toBe('s')

    const fontSize = notchMenuSelect('Font Size')
    expect(fontSize.selectedOptions[0]?.textContent).toBe('Small')

    selectOption(fontSize, 'Normal')
    expect(pane.size).toBe('l')
    // the global size covers floating panes; inline ones keep their own
    expect(inline.size).toBe('m')
    expect(JSON.parse(localStorage.getItem('tiao:notch')!).fontSize).toBe('normal')

    // panes created at Normal match, and fall back to their declared size after
    const later = new Pane()
    expect(later.size).toBe('l')

    selectOption(fontSize, 'Small')
    expect(pane.size).toBe('s')
    expect(later.size).toBe('m')
    expect(JSON.parse(localStorage.getItem('tiao:notch')!).fontSize).toBe('small')

    pane.dispose()
    inline.dispose()
    later.dispose()
  })

  it('the notch arms itself to hide by default and the toggle disarms it', () => {
    const pane = new Pane()
    const notch = document.querySelector('.tiao-notch') as HTMLElement
    expect(notch.classList.contains('tiao-notch-auto-hide')).toBe(true)

    notchMenuCheck('Hiding').click()
    expect(notch.classList.contains('tiao-notch-auto-hide')).toBe(false)
    expect(JSON.parse(localStorage.getItem('tiao:notch')!).hiding).toBe(false)

    pane.dispose()
  })

  it('an armed notch reveals itself from the pointer nearing the top edge', () => {
    const pane = new Pane()
    const notch = document.querySelector('.tiao-notch') as HTMLElement
    const move = (clientY: number) =>
      document.dispatchEvent(new MouseEvent('pointermove', { clientY, bubbles: true }))

    move(4)
    expect(notch.classList.contains('tiao-notch-near')).toBe(true)
    move(200)
    expect(notch.classList.contains('tiao-notch-near')).toBe(false)

    // disarmed, the bar always shows, so the pointer is nobody's business
    move(4)
    notchMenuCheck('Hiding').click()
    expect(notch.classList.contains('tiao-notch-near')).toBe(false)
    move(4)
    expect(notch.classList.contains('tiao-notch-near')).toBe(false)

    pane.dispose()
  })

  it('notch settings theme every pane in both views and seed later panes', () => {
    const a = new Pane({ id: 'globe-a' })
    const b = new Pane({ id: 'globe-b' })
    b.theme = 'nord'

    selectOption(notchMenuSelect('Theme'), 'Catppuccin')

    // every live pane takes it and saves it as its own
    expect(a.theme).toBe('catppuccin')
    expect(b.theme).toBe('catppuccin')
    expect(JSON.parse(localStorage.getItem('tiao:globe-b')!).theme).toBe('catppuccin')
    // both views: the sidebar shares the same setting
    expect(JSON.parse(localStorage.getItem('tiao:dock')!).theme).toBe('catppuccin')
    expect(JSON.parse(localStorage.getItem('tiao:notch')!).theme).toBe('catppuccin')

    // a pane with no saved chrome of its own inherits the global one
    const later = new Pane()
    expect(later.theme).toBe('catppuccin')

    // and a per-pane tweak afterwards still sticks
    b.theme = 'solarized'
    expect(b.theme).toBe('solarized')
    expect(a.theme).toBe('catppuccin')

    a.dispose()
    b.dispose()
    later.dispose()
  })

  it('notch settings survive docking, so panes undock with the global look', () => {
    const pane = new Pane()
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()

    selectOption(notchMenuSelect('Theme'), 'Nord')
    expect(pane.element.classList.contains('tiao-theme-nord')).toBe(true)

    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    expect(pane.theme).toBe('nord')
    pane.dispose()
  })

  it('docks panes into the sidebar and restores the page layout on undock', () => {
    document.body.style.setProperty('padding-inline-start', '10px')
    const pane = new Pane({ anchor: 'top-right' })
    const dockBtn = document.querySelector('.tiao-notch-dock') as HTMLButtonElement

    dockBtn.click()
    const dock = document.querySelector('.tiao-dock-body')
    expect(dock).not.toBeNull()
    expect(pane.element.parentElement).toBe(dock)
    expect(pane.docked).toBe(true)
    expect(pane.element.classList.contains('tiao-floating')).toBe(false)
    expect(document.body.style.getPropertyValue('padding-inline-start')).toBe(
      'var(--tiao-dock-inset-start)',
    )
    // panes created while docked join the sidebar
    const later = new Pane()
    expect(later.element.parentElement).toBe(dock)

    dockBtn.click()
    expect(document.querySelector('.tiao-dock')).toBeNull()
    expect(pane.element.parentElement).toBe(document.body)
    expect(pane.docked).toBe(false)
    expect(pane.element.classList.contains('tiao-floating')).toBe(true)
    expect(pane.element.style.right).toBe('8px')
    expect(document.body.style.getPropertyValue('padding-inline-start')).toBe('10px')

    pane.dispose()
    later.dispose()
    document.body.style.removeProperty('padding-inline-start')
  })

  it('moves search and settings to the sidebar header while docked', () => {
    const params = { speed: 1, gamma: 2 }
    const pane = new Pane()
    pane.addBinding(params, 'speed')
    const gamma = pane.addBinding(params, 'gamma')
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()

    // the pane's own chrome steps aside for one sidebar-wide set
    expect(pane.element.querySelector('.tiao-pane-search')).not.toBeNull()
    expect(document.querySelectorAll('.tiao-dock-search')).toHaveLength(1)
    expect(document.querySelectorAll('.tiao-dock-gear')).toHaveLength(1)
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    expect(pane.element.querySelector('.tiao-pane-menu.tiao-open')).toBeNull()

    const search = document.querySelector('.tiao-dock-search') as HTMLButtonElement
    search.click()
    const input = document.querySelector('.tiao-dock-searchbar .tiao-search-input') as HTMLInputElement
    input.value = 'gamma'
    input.dispatchEvent(new Event('input'))
    expect(gamma.element.classList.contains('tiao-search-miss')).toBe(false)
    expect(pane.element.querySelector('.tiao-row')?.classList.contains('tiao-search-miss')).toBe(
      true,
    )

    search.click()
    expect(pane.element.querySelector('.tiao-row')?.classList.contains('tiao-search-miss')).toBe(
      false,
    )
    pane.dispose()
  })

  it('themes docked panes as one group and hands each pane back its own theme', () => {
    const a = new Pane()
    const b = new Pane()
    a.theme = 'nord'
    b.theme = 'solarized'
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()

    // seeded from the first pane, then shared by every pane in the sidebar
    expect(b.element.classList.contains('tiao-theme-nord')).toBe(true)
    const gear = document.querySelector('.tiao-dock-gear') as HTMLButtonElement
    gear.click()
    const select = document.querySelector('.tiao-dock .tiao-pane-menu .tiao-select') as HTMLSelectElement
    selectOption(select, 'Catppuccin')
    expect(a.element.classList.contains('tiao-theme-catppuccin')).toBe(true)
    expect(b.element.classList.contains('tiao-theme-catppuccin')).toBe(true)
    expect(JSON.parse(localStorage.getItem('tiao:dock')!).theme).toBe('catppuccin')

    // floating theme is a separate state and comes back on undock
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    expect(a.theme).toBe('nord')
    expect(b.theme).toBe('solarized')

    a.dispose()
    b.dispose()
  })

  it('numbers every docked pane at once and anchors the sidebar to either edge', () => {
    const a = new Pane()
    a.addFolder({ title: 'Motion' })
    const b = new Pane()
    b.addFolder({ title: 'Look' })
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    ;(document.querySelector('.tiao-dock-gear') as HTMLButtonElement).click()
    const menu = document.querySelector('.tiao-dock .tiao-pane-menu')!

    // numbers is one switch for the whole sidebar
    const numbers = menu.querySelector('.tiao-check') as HTMLElement
    numbers.click()
    expect(a.element.querySelector('.tiao-folder-index')?.textContent).toBe('1')
    expect(b.element.querySelector('.tiao-folder-index')?.textContent).toBe('1')
    expect(JSON.parse(localStorage.getItem('tiao:dock')!).numbers).toBe(true)

    // anchor is left/right only, and moves the page offset to that edge
    const cells = menu.querySelectorAll('.tiao-anchor-sides .tiao-anchor-cell')
    expect(cells).toHaveLength(2)
    expect(cells[0]!.classList.contains('tiao-selected')).toBe(true)
    ;(cells[1] as HTMLButtonElement).click()
    const dock = document.querySelector('.tiao-dock')!
    expect(dock.classList.contains('tiao-dock-end')).toBe(true)
    expect(document.body.style.paddingInlineStart).toBe('')
    expect(document.body.style.paddingInlineEnd).toBe('var(--tiao-dock-inset-end)')

    // both are sidebar state: panes come back unnumbered
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    expect(a.numbers).toBe(false)
    expect(a.element.querySelector('.tiao-folder-index')).toBeNull()
    expect(document.body.style.paddingInlineEnd).toBe('')

    a.dispose()
    b.dispose()
  })

  it('resizes the sidebar by dragging its outer edge and persists the width', () => {
    const pane = new Pane()
    ;(document.querySelector('.tiao-notch-dock') as HTMLButtonElement).click()
    const dock = document.querySelector('.tiao-dock') as HTMLElement
    dock.getBoundingClientRect = () => ({ width: 300, height: 800 }) as DOMRect

    const handle = dock.querySelector('.tiao-dock-resize') as HTMLElement
    const drag = (dx: number) => {
      handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }))
      handle.dispatchEvent(new MouseEvent('pointermove', { clientX: dx, clientY: 0, buttons: 1 }))
      handle.dispatchEvent(new MouseEvent('pointerup', { clientX: dx, clientY: 0 }))
    }

    drag(90)
    expect(document.documentElement.style.getPropertyValue('--tiao-dock-width')).toBe('390px')
    expect(JSON.parse(localStorage.getItem('tiao:dock')!).width).toBe(390)

    drag(5000)
    expect(document.documentElement.style.getPropertyValue('--tiao-dock-width')).toBe('640px')

    pane.dispose()
    expect(document.documentElement.style.getPropertyValue('--tiao-dock-width')).toBe('')
  })

  it('publishes the sidebar footprint so fixed page chrome can inset itself', () => {
    const pane = new Pane()
    const inset = (edge: 'start' | 'end') =>
      document.documentElement.style.getPropertyValue(`--tiao-dock-inset-${edge}`)
    const docked = () => document.documentElement.classList.contains('tiao-docked')
    expect(docked()).toBe(false)

    const dock = document.querySelector('.tiao-notch-dock') as HTMLButtonElement
    dock.click()
    // the width var keeps it live, so a resize drag needs no extra bookkeeping
    expect(inset('start')).toBe('var(--tiao-dock-width, 300px)')
    expect(inset('end')).toBe('0px')
    expect(docked()).toBe(true)

    // the inset follows the anchor, and folding the sidebar away zeroes it
    ;(document.querySelector('.tiao-dock-gear') as HTMLButtonElement).click()
    const cells = document.querySelectorAll('.tiao-dock .tiao-anchor-sides .tiao-anchor-cell')
    ;(cells[1] as HTMLButtonElement).click()
    expect(inset('start')).toBe('0px')
    expect(inset('end')).toBe('var(--tiao-dock-width, 300px)')

    Pane.toggleAll()
    expect(inset('end')).toBe('0px')
    expect(docked()).toBe(false)
    Pane.toggleAll()
    expect(inset('end')).toBe('var(--tiao-dock-width, 300px)')

    dock.click()
    expect(inset('start')).toBe('')
    expect(inset('end')).toBe('')
    expect(docked()).toBe(false)

    pane.dispose()
  })

  it('insets the page fixed chrome while docked and leaves floating UI alone', async () => {
    const fixed = (css: string) => {
      const el = document.createElement('div')
      el.style.cssText = `position:fixed;${css}`
      document.body.appendChild(el)
      return el
    }
    const navbar = fixed('top:0;left:0;right:0;height:48px')
    const toast = fixed('bottom:16px;right:16px;width:200px')
    const optedOut = fixed('top:0;left:0;right:0')
    optedOut.setAttribute('data-tiao-no-inset', '')
    const inFlow = document.createElement('div')
    document.body.appendChild(inFlow)

    const pane = new Pane()
    const dock = document.querySelector('.tiao-notch-dock') as HTMLButtonElement
    dock.click()
    expect(navbar.hasAttribute('data-tiao-inset')).toBe(true)
    // a corner toast is not what the sidebar covers, and neither is normal flow
    expect(toast.hasAttribute('data-tiao-inset')).toBe(false)
    expect(optedOut.hasAttribute('data-tiao-inset')).toBe(false)
    expect(inFlow.hasAttribute('data-tiao-inset')).toBe(false)
    // tiao's own chrome is positioned against the sidebar, not inset by it
    expect(pane.element.hasAttribute('data-tiao-inset')).toBe(false)

    // chrome the page mounts later still gets picked up, one microtask behind
    const footer = fixed('bottom:0;left:0;right:0;height:32px')
    await Promise.resolve()
    expect(footer.hasAttribute('data-tiao-inset')).toBe(true)

    dock.click()
    expect(navbar.hasAttribute('data-tiao-inset')).toBe(false)
    expect(footer.hasAttribute('data-tiao-inset')).toBe(false)

    pane.dispose()
    for (const el of [navbar, toast, optedOut, inFlow, footer]) el.remove()
  })

  it('hiding all panes also folds the dock away without losing dock state', () => {
    const pane = new Pane()
    const dock = document.querySelector('.tiao-notch-dock') as HTMLButtonElement
    dock.click()

    Pane.toggleAll()
    expect(document.querySelector('.tiao-dock')?.classList.contains('tiao-hidden')).toBe(true)
    expect(document.body.style.getPropertyValue('padding-inline-start')).toBe('')

    Pane.toggleAll()
    expect(document.querySelector('.tiao-dock')?.classList.contains('tiao-hidden')).toBe(false)
    expect(pane.docked).toBe(true)

    pane.dispose()
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

  it('does not inject styles when the stylesheet was imported manually', () => {
    document.querySelectorAll('style[data-tiao]').forEach((style) => style.remove())
    const stylesheet = document.createElement('style')
    stylesheet.textContent = ':root { --tiao-styles-loaded: 1; }'
    document.head.append(stylesheet)

    const pane = new Pane()
    expect(document.querySelector('style[data-tiao]')).toBeNull()

    pane.dispose()
    stylesheet.remove()
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

  it('defers the OKLCH gamut canvas until its picker opens', () => {
    let planeContexts = 0
    const contextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockImplementation(function (this: HTMLCanvasElement) {
        if (this.classList.contains('tiao-ok-canvas')) planeContexts++
        return null
      } as typeof HTMLCanvasElement.prototype.getContext)
    try {
      const pane = new Pane()
      const binding = pane.addBinding({ color: 'oklch(0.7 0.12 200)' }, 'color')
      expect(planeContexts).toBe(0)
      binding.element.querySelector<HTMLButtonElement>('.tiao-color-swatch')?.click()
      expect(planeContexts).toBe(1)
      pane.dispose()
    } finally {
      contextSpy.mockRestore()
    }
  })

  it('clamps free positions and re-clamps on window resize', () => {
    const pane = new Pane()
    Object.defineProperty(pane.element, 'offsetWidth', { value: 300, configurable: true })
    Object.defineProperty(pane.element, 'offsetHeight', { value: 200, configurable: true })

    // jsdom viewport defaults to 1024x768
    pane.moveTo(5000, -50)
    expect(pane.element.style.left).toBe('724px')
    expect(pane.element.style.top).toBe('0px')

    // shrink the window; the free-positioned pane must move back inside
    pane.element.getBoundingClientRect = () =>
      ({ left: 724, top: 0, width: 300, height: 200 } as DOMRect)
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true })
    window.dispatchEvent(new Event('resize'))
    expect(pane.element.style.left).toBe('300px')
    Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true })
    pane.dispose()
  })

  it('resizes via edge handles, clamps, and persists the result', () => {
    const pane = new Pane({ id: 'rsz' })
    pane.element.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width: 280, height: 400 } as DOMRect)

    const drag = (edge: string, dx: number, dy: number) => {
      const handle = pane.element.querySelector(`.tiao-resize-${edge}`) as HTMLElement
      handle.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0 }))
      handle.dispatchEvent(new MouseEvent('pointermove', { clientX: dx, clientY: dy, buttons: 1 }))
      handle.dispatchEvent(new MouseEvent('pointerup', { clientX: dx, clientY: dy }))
    }

    drag('right', 60, 0)
    expect(pane.element.style.width).toBe('340px')

    // dragging the left edge keeps the right edge pinned for free-positioned panes
    pane.moveTo(100, 0)
    drag('left', -40, 0)
    expect(pane.element.style.width).toBe('320px')
    expect(pane.element.style.left).toBe('60px')

    drag('bottom', 0, 100)
    expect(pane.element.style.getPropertyValue('--tiao-max-height')).toBe('500px')

    // width clamps to its maximum
    drag('right', 5000, 0)
    expect(pane.element.style.width).toBe('640px')

    const saved = JSON.parse(localStorage.getItem('tiao:rsz')!)
    expect(saved.w).toBe(640)
    expect(saved.hMax).toBe(500)
    pane.dispose()
  })

  it('restores persisted width and max-height', () => {
    localStorage.setItem('tiao:rsz2', JSON.stringify({ w: 350, hMax: 480 }))
    const pane = new Pane({ id: 'rsz2' })
    expect(pane.element.style.width).toBe('350px')
    expect(pane.element.style.getPropertyValue('--tiao-max-height')).toBe('480px')
    pane.dispose()
  })

  it('exposes folder nesting depth to CSS for column alignment', () => {
    const pane = new Pane()
    const outer = pane.addFolder({ title: 'outer' })
    const inner = outer.addFolder({ title: 'inner' })
    const rackDepth = (el: Element) =>
      (el.querySelector(':scope > .tiao-folder-body > .tiao-folder-clip > .tiao-rack') as HTMLElement)
        .style.getPropertyValue('--tiao-depth')
    expect(rackDepth(outer.element)).toBe('1')
    expect(rackDepth(inner.element)).toBe('2')
    pane.dispose()
  })

  it('renders a subtle unit label next to graph readouts', () => {
    const params = { time: 1.5 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'time', { readonly: true, view: 'graph', unit: 's' })
    const unit = binding.element.querySelector('.tiao-graph-unit')
    expect(unit?.textContent).toBe('s')
    pane.dispose()
  })

  it('renders graphs full-width with an optional bottom-left label', () => {
    const params = { fps: 60, cpu: 4.2 }
    const pane = new Pane()
    const labeled = pane.addBinding(params, 'fps', {
      readonly: true,
      view: 'graph',
      label: 'FPS',
      unit: 'FPS',
    })
    const plain = pane.addBinding(params, 'cpu', { readonly: true, view: 'graph', unit: 'ms' })
    expect(labeled.element.classList.contains('tiao-row-full')).toBe(true)
    expect(labeled.element.querySelector('.tiao-label')).toBeNull()
    expect(labeled.element.querySelector('.tiao-graph-label')?.textContent).toBe('FPS')
    expect(plain.element.classList.contains('tiao-row-full')).toBe(true)
    expect(plain.element.querySelector('.tiao-graph-label')).toBeNull()
    pane.dispose()
  })

  it('appends the observed value range to graph labels', () => {
    const params = { fps: 120 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'fps', {
      readonly: true,
      view: 'graph',
      label: 'FPS',
      format: (v: number) => String(Math.round(v)),
    })
    const labelEl = binding.element.querySelector('.tiao-graph-label')!
    params.fps = 80
    binding.refresh()
    // flat window: no variance across the buffer
    expect(labelEl.textContent).toBe('FPS (No Change)')
    params.fps = 140
    binding.refresh()
    expect(labelEl.textContent).toBe('FPS (80-140)')
    pane.dispose()
  })

  it('plots finite samples against zero and keeps the newest sample at the right edge', () => {
    const rect = {
      left: 0,
      right: 100,
      top: 0,
      bottom: 40,
      width: 100,
      height: 40,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    const moveTo = vi.fn()
    const fillAlphas: number[] = []
    const context = {
      fillStyle: '',
      globalAlpha: 1,
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(() => fillAlphas.push(context.globalAlpha)),
    }
    const contextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D)
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: ResizeObserverCallback) {}
        observe(target: Element) {
          this.callback(
            [{ target, contentRect: rect } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          )
        }
        disconnect() {}
        unobserve() {}
      },
    )

    const params = { fps: 0 }
    const pane = new Pane({ theme: { '--tiao-graph-accent': '#123456' } })
    const binding = pane.addBinding(params, 'fps', {
      readonly: true,
      view: 'graph',
      max: 100,
      bufferSize: 4,
    })
    params.fps = 25
    binding.refresh()
    params.fps = 50
    binding.refresh()

    // Four samples span 100px, so two samples occupy the rightmost third.
    expect(moveTo).toHaveBeenLastCalledWith(100 - 100 / 3, 30)
    expect(context.fill).toHaveBeenCalledTimes(2)

    const onChange = vi.fn()
    binding.on('change', onChange)
    binding.value.set(50, { source: 'monitor', sample: true })
    expect(moveTo).toHaveBeenLastCalledWith(100 - (2 * 100) / 3, 30)
    expect(context.fill).toHaveBeenCalledTimes(3)
    expect(fillAlphas).toEqual([0.28, 0.28, 0.28])
    expect(onChange).not.toHaveBeenCalled()

    pane.dispose()
    contextSpy.mockRestore()
    vi.unstubAllGlobals()
  })

  it('renders button groups as equal siblings with independent callbacks', () => {
    const pane = new Pane()
    const onHalf = vi.fn()
    const onFull = vi.fn()
    const group = pane.addButtonGroup({
      label: 'zoom',
      buttons: { '0.5x': onHalf, '1x': onFull },
    })
    const buttons = group.element.querySelectorAll<HTMLButtonElement>('.tiao-btngroup .tiao-button')
    expect(buttons).toHaveLength(2)
    expect(group.element.querySelector('.tiao-label')?.textContent).toBe('zoom')
    buttons[0]!.click()
    expect(onHalf).toHaveBeenCalledTimes(1)
    expect(onFull).not.toHaveBeenCalled()

    group.disabled = true
    buttons[1]!.click()
    expect(onFull).not.toHaveBeenCalled()
    pane.dispose()
  })

  it('unlabeled button groups take the full row', () => {
    const pane = new Pane()
    const group = pane.addButtonGroup({ buttons: { a: () => {}, b: () => {} } })
    expect(group.element.classList.contains('tiao-row-full')).toBe(true)
    pane.dispose()
  })

  it('search icon toggles the filter row and filters bindings by label', () => {
    const params = { speed: 1, color: '#fff', gravity: 9.8 }
    const pane = new Pane()
    const speed = pane.addBinding(params, 'speed')
    const color = pane.addBinding(params, 'color')
    const folder = pane.addFolder({ title: 'Physics', expanded: false })
    const gravity = folder.addBinding(params, 'gravity')

    const searchBtn = pane.element.querySelector('.tiao-pane-search') as HTMLButtonElement
    searchBtn.click()
    expect(pane.searchOpen).toBe(true)
    const input = pane.element.querySelector('.tiao-search-input') as HTMLInputElement

    input.value = 'grav'
    input.dispatchEvent(new Event('input'))
    expect(speed.element.classList.contains('tiao-search-miss')).toBe(true)
    expect(color.element.classList.contains('tiao-search-miss')).toBe(true)
    expect(gravity.element.classList.contains('tiao-search-miss')).toBe(false)
    // the collapsed folder holding the match is forced open
    expect(folder.element.classList.contains('tiao-search-miss')).toBe(false)
    expect(folder.element.classList.contains('tiao-search-open')).toBe(true)

    // a folder title match keeps its whole subtree visible
    input.value = 'physics'
    input.dispatchEvent(new Event('input'))
    expect(folder.element.classList.contains('tiao-search-miss')).toBe(false)
    expect(gravity.element.classList.contains('tiao-search-miss')).toBe(false)
    expect(speed.element.classList.contains('tiao-search-miss')).toBe(true)

    // closing the search clears the filter
    pane.searchOpen = false
    expect(speed.element.classList.contains('tiao-search-miss')).toBe(false)
    expect(folder.element.classList.contains('tiao-search-open')).toBe(false)
    expect(input.value).toBe('')
    pane.dispose()
  })

  it('folder headers lead with the caret and have no index counter', () => {
    const pane = new Pane()
    const folder = pane.addFolder({ title: 'Section' })
    const header = folder.element.querySelector('.tiao-folder-header')!
    expect(header.firstElementChild?.classList.contains('tiao-icon-triangle')).toBe(true)
    expect(header.querySelector('.tiao-folder-index')).toBeNull()
    pane.dispose()
  })

  it('folders accept a color that tints title, caret, and depth line', () => {
    const pane = new Pane()
    const folder = pane.addFolder({ title: 'Tinted', color: '#fb923c' })
    expect(folder.element.classList.contains('tiao-folder-colored')).toBe(true)
    expect(folder.element.style.getPropertyValue('--tiao-folder-color')).toBe('#fb923c')
    const plain = pane.addFolder({ title: 'Plain' })
    expect(plain.element.classList.contains('tiao-folder-colored')).toBe(false)
    pane.dispose()
  })

  it('clicking the depth line collapses the folder; static folders ignore it', () => {
    const pane = new Pane()
    const folder = pane.addFolder({ title: 'Collapsible' })
    const line = folder.element.querySelector('.tiao-folder-line') as HTMLButtonElement
    expect(folder.expanded).toBe(true)
    line.click()
    expect(folder.expanded).toBe(false)

    const fixed = pane.addFolder({ title: 'Fixed', collapsible: false })
    const fixedLine = fixed.element.querySelector('.tiao-folder-line') as HTMLButtonElement
    fixedLine.click()
    expect(fixed.expanded).toBe(true)
    // the caret stays visible on static folders
    expect(fixed.element.querySelector('.tiao-folder-header .tiao-icon-triangle')).not.toBeNull()
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
    expect(pane.element.querySelector('.tiao-color-picker.tiao-open')).not.toBeNull()

    rows[2]?.querySelector('.tiao-label')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(params.on).toBe(true)
    pane.dispose()
  })

  it('clicking the empty control column activates short controls once', () => {
    const params = { on: false }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'on')
    const control = binding.element.querySelector('.tiao-control') as HTMLElement
    const button = binding.element.querySelector('.tiao-check') as HTMLButtonElement

    control.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(params.on).toBe(true)

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(params.on).toBe(false)
    pane.dispose()
  })

  it('arrow keys nudge number inputs by step, with shift×10 and alt÷10', () => {
    const params = { seed: 10 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed', { step: 1 })
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement

    // highlighted (edit) mode
    input.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    input.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    expect(input.readOnly).toBe(false)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(params.seed).toBe(11)
    expect(input.value).toBe('11')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }))
    expect(params.seed).toBe(1)

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }))
    expect(params.seed).toBe(1.1)

    // read-only scrub mode still nudges
    input.dispatchEvent(new FocusEvent('blur'))
    expect(input.readOnly).toBe(true)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(params.seed).toBe(2.1)
    pane.dispose()
  })

  it('outside pointerdown blurs and deselects number inputs without typing', () => {
    const params = { seed: 12 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed')
    const label = binding.element.querySelector('.tiao-label') as HTMLElement
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement

    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(input)
    expect(input.readOnly).toBe(false)

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(document.activeElement).not.toBe(input)
    expect(input.readOnly).toBe(true)
    expect(input.selectionStart).toBe(input.value.length)
    expect(input.selectionEnd).toBe(input.value.length)
    pane.dispose()
  })

  it('outside pointerdown blurs and deselects number inputs after clicking the value', () => {
    const params = { seed: 42 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed')
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement

    input.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    input.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    expect(document.activeElement).toBe(input)
    expect(input.readOnly).toBe(false)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)

    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    expect(document.activeElement).not.toBe(input)
    expect(input.readOnly).toBe(true)
    expect(input.selectionStart).toBe(input.value.length)
    expect(input.selectionEnd).toBe(input.value.length)
    pane.dispose()
  })

  it('shows a scrubber guide and tooltip while dragging, without selecting the input', () => {
    const params = { seed: 42 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed')
    const scrub = binding.element.querySelector('.tiao-scrub') as HTMLElement
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement
    const grip = binding.element.querySelector('.tiao-scrub-grip') as HTMLElement

    grip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }))
    grip.dispatchEvent(new MouseEvent('pointermove', { clientX: 12, clientY: 0, bubbles: true, buttons: 1 }))
    expect(scrub.classList.contains('tiao-scrub-dragging')).toBe(true)
    const overlay = document.querySelector('.tiao-scrub-overlay') as HTMLElement
    expect(overlay).not.toBeNull()
    expect(overlay.querySelector('.tiao-scrub-tooltip')?.textContent).toBe(String(params.seed))
    expect(input.readOnly).toBe(true)
    expect(input.selectionStart).toBe(input.selectionEnd)
    expect(document.activeElement).not.toBe(input)

    grip.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 12, clientY: 0, bubbles: true }))
    expect(document.querySelector('.tiao-scrub-overlay')).toBeNull()
    expect(scrub.classList.contains('tiao-scrub-dragging')).toBe(false)
    pane.dispose()
  })

  it('starting a scrub on another binding finishes the previous drag overlay', () => {
    const params = { a: 1, b: 2 }
    const pane = new Pane()
    const a = pane.addBinding(params, 'a')
    const b = pane.addBinding(params, 'b')
    const gripA = a.element.querySelector('.tiao-scrub-grip') as HTMLElement
    const gripB = b.element.querySelector('.tiao-scrub-grip') as HTMLElement
    const scrubA = a.element.querySelector('.tiao-scrub') as HTMLElement

    gripA.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }))
    gripA.dispatchEvent(new MouseEvent('pointermove', { clientX: 16, clientY: 0, bubbles: true, buttons: 1 }))
    expect(scrubA.classList.contains('tiao-scrub-dragging')).toBe(true)
    expect(document.querySelectorAll('.tiao-scrub-overlay')).toHaveLength(1)

    // click another scrubber without pointerup on the first — must not leave a stuck overlay
    gripB.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }))
    expect(scrubA.classList.contains('tiao-scrub-dragging')).toBe(false)
    expect(document.querySelectorAll('.tiao-scrub-overlay')).toHaveLength(0)

    gripB.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 0, bubbles: true, buttons: 1 }))
    expect(document.querySelectorAll('.tiao-scrub-overlay')).toHaveLength(1)
    gripB.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 20, clientY: 0, bubbles: true }))
    expect(document.querySelector('.tiao-scrub-overlay')).toBeNull()
    pane.dispose()
  })

  it('switching number slider tracks without pointerup drives the second binding', () => {
    const params = { gain: 0.2, threshold: 0.8 }
    const pane = new Pane()
    const gain = pane.addBinding(params, 'gain', { min: 0, max: 1, step: 0.01 })
    const threshold = pane.addBinding(params, 'threshold', { min: 0, max: 1, step: 0.01 })
    const trackA = gain.element.querySelector('.tiao-slider') as HTMLElement
    const trackB = threshold.element.querySelector('.tiao-slider') as HTMLElement
    const rect = {
      left: 0,
      right: 100,
      top: 0,
      bottom: 20,
      width: 100,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    vi.spyOn(trackA, 'getBoundingClientRect').mockReturnValue(rect)
    vi.spyOn(trackB, 'getBoundingClientRect').mockReturnValue(rect)

    trackA.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 20, clientY: 10, bubbles: true }))
    trackA.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.gain).toBe(0.4)

    // no pointerup — click/drag the other track; prior drag must end first
    trackB.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }))
    expect(params.threshold).toBe(0.1)
    trackB.dispatchEvent(new MouseEvent('pointermove', { clientX: 70, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.threshold).toBe(0.7)
    expect(params.gain).toBe(0.4)
    trackB.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 70, clientY: 10, bubbles: true }))

    // after a completed drag, clicking the filled track of another slider still works
    trackA.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 30, clientY: 10, bubbles: true }))
    expect(params.gain).toBe(0.3)
    trackA.dispatchEvent(new MouseEvent('pointermove', { clientX: 55, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.gain).toBe(0.55)
    trackA.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 55, clientY: 10, bubbles: true }))
    pane.dispose()
  })

  it('button click then slider drag continues to move', () => {
    const params = { speed: 1 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
    pane.addButtonGroup({
      label: 'presets',
      buttons: {
        '0.5x': () => {
          params.speed = 0.5
          binding.refresh()
        },
      },
    })
    const btn = pane.element.querySelector('.tiao-button') as HTMLButtonElement
    const track = binding.element.querySelector('.tiao-slider') as HTMLElement
    const rect = {
      left: 0,
      right: 100,
      top: 0,
      bottom: 20,
      width: 100,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(rect)

    btn.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 5, clientY: 5, bubbles: true }))
    btn.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 5, clientY: 5, bubbles: true }))
    btn.click()
    expect(params.speed).toBe(0.5)

    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(params.speed).toBe(1)
    // a buttons:0 move before any pressed move must not kill the drag
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 26, clientY: 10, bubbles: true, buttons: 0 }))
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.speed).toBe(2)
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 75, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.speed).toBe(3)
    track.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 75, clientY: 10, bubbles: true }))
    pane.dispose()
  })

  it('an element blur during a drag does not end it, a window blur does', () => {
    const params = { speed: 1 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
    const track = binding.element.querySelector('.tiao-slider') as HTMLElement
    const rect = {
      left: 0,
      right: 100,
      top: 0,
      bottom: 20,
      width: 100,
      height: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(rect)

    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(params.speed).toBe(1)
    // focus moving off another control fires blur on that element; the event
    // passes window in the capture phase and must not kill the fresh drag
    // (this is what froze "drag count, then drag size" and pane→pane drags)
    track.dispatchEvent(new FocusEvent('blur'))
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 50, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.speed).toBe(2)

    // an actual window blur (target = window) still finishes the drag
    window.dispatchEvent(new FocusEvent('blur'))
    track.dispatchEvent(new MouseEvent('pointermove', { clientX: 75, clientY: 10, bubbles: true, buttons: 1 }))
    expect(params.speed).toBe(2)
    pane.dispose()
  })

  it('holds the ew-resize cursor page-wide during track drags and row long-press scrubs', () => {
    vi.useFakeTimers()
    const params = { speed: 1 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
    const track = binding.element.querySelector('.tiao-slider') as HTMLElement
    const label = binding.element.querySelector('.tiao-label') as HTMLElement
    const root = document.documentElement

    track.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(root.classList.contains('tiao-cursor-ew')).toBe(true)
    track.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(root.classList.contains('tiao-cursor-ew')).toBe(false)

    // long-press on the label: cursor engages when the hold fires, before any move
    label.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(root.classList.contains('tiao-cursor-ew')).toBe(false)
    vi.advanceTimersByTime(200)
    expect(root.classList.contains('tiao-cursor-ew')).toBe(true)
    label.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 25, clientY: 10, bubbles: true }))
    expect(root.classList.contains('tiao-cursor-ew')).toBe(false)
    pane.dispose()
    vi.useRealTimers()
  })

  it('point axis grips scrub without selecting neighboring fields', () => {
    const params = { pos: { x: 1, y: 2, z: 3 } }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'pos')
    const grips = binding.element.querySelectorAll('.tiao-scrub-grip')
    const inputs = binding.element.querySelectorAll('.tiao-num-input')
    expect(grips).toHaveLength(3)

    const grip = grips[1] as HTMLElement
    const input = inputs[1] as HTMLInputElement
    grip.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 0, clientY: 0, bubbles: true }))
    grip.dispatchEvent(new MouseEvent('pointermove', { clientX: 20, clientY: 0, bubbles: true, buttons: 1 }))
    expect((grip.parentElement as HTMLElement).classList.contains('tiao-scrub-dragging')).toBe(true)
    expect(document.querySelector('.tiao-scrub-overlay')).not.toBeNull()
    expect(input.readOnly).toBe(true)
    expect(document.activeElement).not.toBe(input)
    expect(params.pos.y).not.toBe(2)

    grip.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 20, clientY: 0, bubbles: true }))
    expect(document.querySelector('.tiao-scrub-overlay')).toBeNull()
    pane.dispose()
  })

  it('number input blur collapses the highlighted value selection', () => {
    const params = { seed: 42 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed')
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement

    input.dispatchEvent(new MouseEvent('pointerdown', { button: 0, bubbles: true }))
    input.dispatchEvent(new MouseEvent('pointerup', { button: 0, bubbles: true }))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(input.value.length)

    input.dispatchEvent(new FocusEvent('blur'))
    expect(input.readOnly).toBe(true)
    expect(input.selectionStart).toBe(input.value.length)
    expect(input.selectionEnd).toBe(input.value.length)
    pane.dispose()
  })

  it('clicking another row in the same pane blurs the active input and activates that row', () => {
    const params = { seed: 12, on: false }
    const pane = new Pane()
    const seed = pane.addBinding(params, 'seed')
    const on = pane.addBinding(params, 'on')
    const seedLabel = seed.element.querySelector('.tiao-label') as HTMLElement
    const seedInput = seed.element.querySelector('.tiao-num-input') as HTMLInputElement
    const onLabel = on.element.querySelector('.tiao-label') as HTMLElement

    seedLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(seedInput)

    onLabel.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    onLabel.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).not.toBe(seedInput)
    expect(seedInput.readOnly).toBe(true)
    expect(params.on).toBe(true)
    pane.dispose()
  })

  it('clicking the active input row outside the input deselects without reactivating it', () => {
    const params = { seed: 12 }
    const pane = new Pane()
    const binding = pane.addBinding(params, 'seed')
    const label = binding.element.querySelector('.tiao-label') as HTMLElement
    const input = binding.element.querySelector('.tiao-num-input') as HTMLInputElement

    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).toBe(input)

    label.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    label.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(document.activeElement).not.toBe(input)
    expect(input.readOnly).toBe(true)
    pane.dispose()
  })

  it('only oklab bindings get the OKLAB dropdown entry', () => {
    const params = { a: '#ff8800', b: 'oklab(0.7 0.05 -0.05)' }
    const pane = new Pane()
    pane.addBinding(params, 'a')
    pane.addBinding(params, 'b')
    const selects = pane.element.querySelectorAll('.tiao-color-mode .tiao-select')
    const values = (s: Element) => [...s.querySelectorAll('option')].map((o) => o.value)
    expect(values(selects[0]!)).toEqual(['hex', 'rgb', 'hsl', 'oklch'])
    expect(values(selects[1]!)).toEqual(['hex', 'rgb', 'hsl', 'oklch', 'oklab'])
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

  it('dragging the titlebar does not toggle expanded', () => {
    const pane = new Pane()
    const titlebar = pane.element.querySelector('.tiao-titlebar') as HTMLElement
    expect(pane.expanded).toBe(true)

    titlebar.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10, bubbles: true }))
    // move past the drag threshold, then release — browsers still fire click after this
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 40, clientY: 10, bubbles: true, buttons: 1 }))
    document.dispatchEvent(new MouseEvent('pointerup', { button: 0, clientX: 40, clientY: 10, bubbles: true }))
    titlebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(pane.expanded).toBe(true)

    // a subsequent plain click still collapses
    titlebar.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(pane.expanded).toBe(false)
    pane.dispose()
  })

  it('gear opens the settings menu with a draggable toggle and 9 anchor cells', () => {
    const pane = new Pane()
    const gear = pane.element.querySelector('.tiao-pane-gear') as HTMLButtonElement
    gear.click()
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    expect(menu).not.toBeNull()
    // no title bar on the settings menu
    expect(menu.querySelector('.tiao-pane-menu-title')).toBeNull()
    expect(menu.querySelectorAll('.tiao-anchor-cell')).toHaveLength(9)

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

    const bottomCenter = menu.querySelectorAll('.tiao-anchor-cell')[7] as HTMLButtonElement
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

  it('supports the center anchor from the middle grid cell', () => {
    const pane = new Pane()
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    const center = menu.querySelectorAll('.tiao-anchor-cell')[4] as HTMLButtonElement
    expect(center.title).toBe('center')
    center.click()
    expect(pane.anchor).toBe('center')
    expect(pane.element.style.left).toBe('50%')
    expect(pane.element.style.top).toBe('50%')
    expect(pane.element.style.transform).toBe('translate(-50%, -50%)')
    pane.dispose()
  })

  it('menu theme select switches themes and persists per pane id', () => {
    const pane = new Pane({ id: 'themed' })
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    // the settings menu is a real embedded pane, so theme is a select binding
    const select = menu.querySelector('.tiao-select') as HTMLSelectElement
    expect(pane.theme).toBe('dark')
    expect(pane.element.classList.contains('tiao-theme-dark')).toBe(true)
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'System',
      'Dark',
      'Light',
      'Solarized',
      'Nord',
      'Catppuccin',
    ])

    selectOption(select, 'Light')
    expect(pane.theme).toBe('light')
    expect(pane.element.classList.contains('tiao-theme-dark')).toBe(false)

    selectOption(select, 'Solarized')
    expect(pane.theme).toBe('solarized')
    expect(pane.element.classList.contains('tiao-theme-solarized')).toBe(true)

    selectOption(select, 'Nord')
    expect(pane.theme).toBe('nord')
    expect(pane.element.classList.contains('tiao-theme-nord')).toBe(true)

    selectOption(select, 'Catppuccin')
    expect(pane.theme).toBe('catppuccin')
    expect(pane.element.classList.contains('tiao-theme-catppuccin')).toBe(true)
    pane.dispose()

    const revived = new Pane({ id: 'themed' })
    expect(revived.theme).toBe('catppuccin')
    revived.dispose()
  })

  it('system theme follows prefers-color-scheme and updates when it changes', () => {
    const listeners = new Set<(ev: { matches: boolean }) => void>()
    let dark = true
    window.matchMedia = ((query: string) => {
      if (!query.includes('prefers-color-scheme')) {
        return {
          matches: false,
          media: query,
          addEventListener() {},
          removeEventListener() {},
        } as unknown as MediaQueryList
      }
      return {
        get matches() {
          return dark
        },
        media: query,
        addEventListener(_type: string, fn: (ev: { matches: boolean }) => void) {
          listeners.add(fn)
        },
        removeEventListener(_type: string, fn: (ev: { matches: boolean }) => void) {
          listeners.delete(fn)
        },
      } as unknown as MediaQueryList
    }) as typeof window.matchMedia

    const pane = new Pane({ id: 'sys-theme' })
    pane.theme = 'system'
    expect(pane.theme).toBe('system')
    expect(pane.element.dataset.tiaoTheme).toBe('system')
    expect(pane.element.classList.contains('tiao-theme-dark')).toBe(true)

    dark = false
    for (const fn of listeners) fn({ matches: false })
    expect(pane.theme).toBe('system')
    expect(pane.element.classList.contains('tiao-theme-dark')).toBe(false)

    dark = true
    for (const fn of listeners) fn({ matches: true })
    expect(pane.element.classList.contains('tiao-theme-dark')).toBe(true)

    // preference persists as system, not the resolved light/dark
    pane.dispose()
    const revived = new Pane({ id: 'sys-theme' })
    expect(revived.theme).toBe('system')
    expect(JSON.parse(localStorage.getItem('tiao:sys-theme')!).theme).toBe('system')
    revived.dispose()
  })

  it('menu style select switches kiki style and persists per pane id', () => {
    const pane = new Pane({ id: 'styled' })
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    const selects = menu.querySelectorAll('.tiao-select')
    // theme is first select; style is second
    const styleSelect = selects[1] as HTMLSelectElement
    expect(pane.style).toBe('bouba')
    expect(pane.element.classList.contains('tiao-style-kiki')).toBe(false)

    styleSelect.value = '1'
    styleSelect.dispatchEvent(new Event('change'))
    expect(pane.style).toBe('kiki')
    expect(pane.element.classList.contains('tiao-style-kiki')).toBe(true)
    pane.dispose()

    const revived = new Pane({ id: 'styled' })
    expect(revived.style).toBe('kiki')
    expect(revived.element.classList.contains('tiao-style-kiki')).toBe(true)
    revived.dispose()
  })

  it('migrates legacy arena/default style ids to kiki/bouba', () => {
    localStorage.setItem('tiao:legacy-style', JSON.stringify({ style: 'arena' }))
    const a = new Pane({ id: 'legacy-style' })
    expect(a.style).toBe('kiki')
    a.dispose()

    localStorage.setItem('tiao:legacy-style2', JSON.stringify({ style: 'default' }))
    const b = new Pane({ id: 'legacy-style2' })
    expect(b.style).toBe('bouba')
    b.dispose()
  })

  it('menu "Numbers" toggle prepends nesting-aware section indexes to folder titles', () => {
    const pane = new Pane({ id: 'numbered' })
    const a = pane.addFolder({ title: 'Alpha' })
    const a1 = a.addFolder({ title: 'Inner' })
    const b = pane.addFolder({ title: 'Beta' })

    pane.numbers = true
    const indexOf = (f: { element: Element }) =>
      f.element.querySelector('.tiao-folder-index')?.textContent
    expect(indexOf(a)).toBe('1')
    expect(indexOf(a1)).toBe('1.1')
    expect(indexOf(b)).toBe('2')

    // late additions are renumbered automatically
    const a2 = a.addFolder({ title: 'Later' })
    expect(indexOf(a2)).toBe('1.2')

    pane.numbers = false
    expect(indexOf(a)).toBeUndefined()
    pane.dispose()

    // persists per pane id
    localStorage.setItem('tiao:numbered2', JSON.stringify({ numbers: true }))
    const revived = new Pane({ id: 'numbered2' })
    const f = revived.addFolder({ title: 'Only' })
    expect(indexOf(f)).toBe('1')
    revived.dispose()
  })

  it('menu accent color writes --tiao-accent and persists per pane id', () => {
    const pane = new Pane({ id: 'accented' })
    pane.element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    const menu = pane.element.querySelector('.tiao-pane-menu.tiao-open')!
    const text = menu.querySelector('.tiao-color-text') as HTMLInputElement
    text.value = '#ff0080'
    text.dispatchEvent(new Event('blur'))
    expect(pane.element.style.getPropertyValue('--tiao-accent')).toBe('#ff0080')
    expect(pane.element.style.getPropertyValue('--tiao-graph-accent')).toBe('')
    expect(pane.accent).toBe('#ff0080')
    pane.dispose()

    const revived = new Pane({ id: 'accented' })
    expect(revived.element.style.getPropertyValue('--tiao-accent')).toBe('#ff0080')
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

  it('bound values persist per pane id and come back on the next mount', () => {
    const params = { speed: 1, tint: { r: 255, g: 0, b: 0 }, fps: 60 }
    const pane = new Pane({ id: 'valued' })
    const speed = pane.addBinding(params, 'speed')
    const tint = pane.addFolder({ title: 'Render' }).addBinding(params, 'tint')
    pane.addBinding(params, 'fps', { readonly: true })

    speed.value.set(4)
    tint.value.set({ r: 0, g: 0, b: 255 })
    expect(params.speed).toBe(4)

    const saved = JSON.parse(localStorage.getItem('tiao:valued:values')!)
    expect(saved.speed).toBe(4)
    expect(saved['Render/tint']).toEqual({ r: 0, g: 0, b: 255 })
    // monitors read from the app; they never write back
    expect(saved.fps).toBeUndefined()
    pane.dispose()

    const next = { speed: 1, tint: { r: 255, g: 0, b: 0 } }
    const revived = new Pane({ id: 'valued' })
    revived.addBinding(next, 'speed')
    revived.addFolder({ title: 'Render' }).addBinding(next, 'tint')
    expect(next.speed).toBe(4)
    expect(next.tint).toEqual({ r: 0, g: 0, b: 255 })
    revived.dispose()
  })

  it('skips saved values that no longer fit and honors persist: false', () => {
    localStorage.setItem(
      'tiao:mismatch:values',
      JSON.stringify({ speed: { r: 1, g: 2, b: 3 }, seed: 9 }),
    )
    const params = { speed: 1, seed: 1 }
    const pane = new Pane({ id: 'mismatch' })
    pane.addBinding(params, 'speed')
    const seed = pane.addBinding(params, 'seed', { persist: false })
    expect(params.speed).toBe(1)
    expect(params.seed).toBe(1)

    seed.value.set(5)
    expect(JSON.parse(localStorage.getItem('tiao:mismatch:values')!).seed).toBe(9)
    pane.dispose()
  })

  it('notch reset restores code defaults and clears the saved values', () => {
    const params = { speed: 1 }
    const pane = new Pane({ id: 'resettable' })
    const binding = pane.addBinding(params, 'speed')
    binding.value.set(7)
    expect(localStorage.getItem('tiao:resettable:values')).not.toBeNull()

    ;(document.querySelector('.tiao-notch-reset') as HTMLButtonElement).click()
    expect(params.speed).toBe(1)
    expect(binding.value.get()).toBe(1)
    expect(localStorage.getItem('tiao:resettable:values')).toBeNull()
    pane.dispose()
  })

  it('keeps previewed values out of storage until the change settles', () => {
    const store = jsonStore<{ accent: string }>('tiao:preview')

    // a drag: every frame updates what the UI reads, none of them write
    for (const accent of ['#111111', '#222222', '#333333']) {
      withoutPersisting(() => store.patch({ accent }))
      expect(store.get().accent).toBe(accent)
    }
    expect(localStorage.getItem('tiao:preview')).toBeNull()

    // the settled change repeats the last previewed value and still writes it
    store.patch({ accent: '#333333' })
    expect(JSON.parse(localStorage.getItem('tiao:preview')!).accent).toBe('#333333')
  })

  it('does not resurrect state a page cleared behind the store', () => {
    const store = jsonStore<{ theme: string; width: number }>('tiao:cleared')
    store.patch({ theme: 'nord', width: 300 })

    localStorage.clear()
    store.patch({ width: 320 })

    expect(store.get()).toEqual({ width: 320 })
    expect(JSON.parse(localStorage.getItem('tiao:cleared')!)).toEqual({ width: 320 })
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

  it('Display-P3 extends past sRGB for saturated oklch hues', () => {
    // same red hue: P3 can hold more chroma than sRGB
    expect(oklchInGamut(0.6279, 0.28, 29.23)).toBe(false)
    expect(oklchInP3Gamut(0.6279, 0.28, 29.23)).toBe(true)
    expect(maxChromaP3(0.6279, 29.23)).toBeGreaterThan(maxChroma(0.6279, 29.23))
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

describe('showIf and construction-time visibility', () => {
  it('applies static hidden and disabled at construction', () => {
    const pane = new Pane()
    const binding = pane.addBinding({ n: 1 }, 'n', { hidden: true, disabled: true })
    expect(binding.hidden).toBe(true)
    expect(binding.disabled).toBe(true)
    expect(binding.element.classList.contains('tiao-hidden')).toBe(true)
    expect(binding.element.classList.contains('tiao-disabled')).toBe(true)
    pane.dispose()
  })

  it('hides a binding when showIf is false and re-shows after a dropdown change', () => {
    const params = { mode: 'orbit', wavelength: 1 }
    const pane = new Pane()
    pane.addBinding(params, 'mode', { options: { Orbit: 'orbit', Wave: 'wave' } })
    const wavelength = pane.addBinding(params, 'wavelength', {
      showIf: () => params.mode === 'wave',
    })
    expect(wavelength.hidden).toBe(true)

    const mode = pane.children[0] as unknown as { value: { set: (v: string, m: object) => void } }
    mode.value.set('wave', { source: 'ui', last: true })
    expect(params.mode).toBe('wave')
    expect(wavelength.hidden).toBe(false)

    mode.value.set('orbit', { source: 'ui', last: true })
    expect(wavelength.hidden).toBe(true)
    pane.dispose()
  })

  it('hides a folder when showIf is false', () => {
    const params = { mode: 'a', extra: 1 }
    const pane = new Pane()
    pane.addBinding(params, 'mode', { options: { A: 'a', B: 'b' } })
    const folder = pane.addFolder({ title: 'Extra', showIf: () => params.mode === 'b' })
    folder.addBinding(params, 'extra')
    expect(folder.hidden).toBe(true)

    const mode = pane.children[0] as unknown as { value: { set: (v: string, m: object) => void } }
    mode.value.set('b', { source: 'ui', last: true })
    expect(folder.hidden).toBe(false)
    pane.dispose()
  })

  it('skips mid-drag updates when re-evaluating showIf', () => {
    const params = { gain: 0, n: 1 }
    const pane = new Pane()
    const gain = pane.addBinding(params, 'gain', { min: 0, max: 1 })
    const row = pane.addBinding(params, 'n', { showIf: () => params.gain > 0.5 })
    expect(row.hidden).toBe(true)
    gain.value.set(0.9, { source: 'ui', last: false })
    expect(row.hidden).toBe(true)
    gain.value.set(0.9, { source: 'ui', last: true })
    expect(row.hidden).toBe(false)
    pane.dispose()
  })
})

describe('number utils', () => {
  it('snaps without float noise', () => {
    expect(snap(0.30000000000000004, 0.1)).toBe(0.3)
    expect(snap(7, 5)).toBe(5)
  })
  it('formats according to step', () => {
    // keep step precision so 5.0 stays "5.0" next to 4.9
    expect(formatNumber(5, 0.1)).toBe('5.0')
    expect(formatNumber(4.9, 0.1)).toBe('4.9')
    expect(formatNumber(0.5, 0.01)).toBe('0.50')
    expect(formatNumber(3, 1)).toBe('3')
    // finer Alt-nudge digits still show when present
    expect(formatNumber(5.01, 0.1)).toBe('5.01')
  })
})
