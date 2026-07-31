// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Pane } from '../core'
import { setTiaoEnabled } from './config'
import { loadCore } from './manager'
import { button, monitor, tabs } from './types'
import type { ControlsResult } from './types'
import { useControls } from './useControls'

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLElement
let root: Root

beforeEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
  setTiaoEnabled(true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
})

async function flushCore() {
  await act(async () => {
    await loadCore()
    await Promise.resolve()
  })
}

describe('useControls', () => {
  it('returns defaults immediately and creates the pane after core loads', async () => {
    let result: ControlsResult<{ speed: { value: number; min: number; max: number } }> | null = null
    function App() {
      result = useControls({ speed: { value: 0.5, min: 0, max: 1 } }, { pane: 'main' })
      return null
    }
    await act(async () => root.render(<App />))
    expect(result!.speed).toBe(0.5)

    await flushCore()
    const pane = Pane.get('main')
    expect(pane).toBeDefined()
    expect(pane!.element.querySelector('.tiao-slider')).not.toBeNull()
  })

  it('re-renders when the pane UI changes a value', async () => {
    const renders: number[] = []
    function App() {
      const { n } = useControls({ n: 1 }, { pane: 'ui' })
      renders.push(n)
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()

    const pane = Pane.get('ui')!
    const binding = pane.children.find((c) => 'value' in c) as { value: { set: (v: number, m: object) => void } }
    await act(async () => {
      binding.value.set(42, { source: 'ui', last: true })
    })
    expect(renders.at(-1)).toBe(42)
  })

  it('$set updates the store and the live binding', async () => {
    let api: ControlsResult<{ n: number }> | null = null
    function App() {
      api = useControls({ n: 1 }, { pane: 'setter' })
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()
    await act(async () => {
      api!.$set({ n: 9 })
    })
    expect(api!.n).toBe(9)
    expect(api!.$get('n')).toBe(9)
  })

  it('adopts persisted values once core restores them', async () => {
    localStorage.setItem('tiao:dot:values', JSON.stringify({ 'Footer/variant': 'wallpaper' }))
    let api: ControlsResult<{ variant: { value: string; options: Record<string, string> } }> | null =
      null
    function App() {
      api = useControls(
        'Footer',
        { variant: { value: 'wordmark', options: { Wordmark: 'wordmark', Wallpaper: 'wallpaper' } } },
        { pane: { id: 'dot' } },
      )
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()
    expect(api!.variant).toBe('wallpaper')
    expect(api!.$get('variant')).toBe('wallpaper')
  })

  it('merges folders across components and ref-counts on unmount', async () => {
    function A() {
      useControls('Physics', { gravity: 9.8 }, { pane: 'shared' })
      return null
    }
    function B() {
      useControls('Physics', { friction: 0.5 }, { pane: 'shared' })
      return null
    }
    function App({ showB }: { showB: boolean }) {
      return (
        <>
          <A />
          {showB && <B />}
        </>
      )
    }
    await act(async () => root.render(<App showB />))
    await flushCore()

    const pane = Pane.get('shared')!
    const folders = pane.element.querySelectorAll('.tiao-folder')
    expect(folders).toHaveLength(1)
    expect(pane.element.querySelectorAll('.tiao-row')).toHaveLength(2)

    await act(async () => root.render(<App showB={false} />))
    // folder survives with one row left
    expect(pane.element.querySelectorAll('.tiao-folder')).toHaveLength(1)
    expect(pane.element.querySelectorAll('.tiao-row')).toHaveLength(1)
  })

  it('disposes the pane when the last registration unmounts', async () => {
    function App() {
      useControls({ x: 1 }, { pane: 'temp' })
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()
    expect(Pane.get('temp')).toBeDefined()
    await act(async () => root.render(<div />))
    expect(Pane.get('temp')).toBeUndefined()
  })

  it('supports buttons and monitors in the schema', async () => {
    let clicks = 0
    let fps = 60
    function App() {
      useControls(
        {
          reset: button(() => {
            clicks++
          }, 'Reset'),
          fps: monitor(() => fps),
        },
        { pane: 'extras' },
      )
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()

    const pane = Pane.get('extras')!
    const btn = pane.element.querySelector('.tiao-button') as HTMLButtonElement
    expect(btn.textContent).toBe('Reset')
    btn.click()
    expect(clicks).toBe(1)
    expect(pane.element.querySelector('.tiao-monitor-text')).not.toBeNull()
  })

  it('hides a row via showIf and keeps returning its value', async () => {
    let api: {
      mode: string
      wavelength: number
      $set: (patch: { mode?: string; wavelength?: number }) => void
      $get: (key: 'mode' | 'wavelength') => unknown
    } | null = null
    function App() {
      api = useControls(
        'Motion',
        {
          mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } },
          wavelength: { value: 1, showIf: (get) => get('mode') === 'wave' },
        },
        { pane: 'showif' },
      )
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()

    const pane = Pane.get('showif')!
    const rows = [...pane.element.querySelectorAll('.tiao-folder .tiao-row')]
    const wavelength = rows[1]!
    expect(wavelength.classList.contains('tiao-hidden')).toBe(true)
    expect(api!.wavelength).toBe(1)

    await act(async () => {
      api!.$set({ mode: 'wave' })
    })
    expect(wavelength.classList.contains('tiao-hidden')).toBe(false)
    expect(api!.wavelength).toBe(1)

    await act(async () => {
      api!.$set({ wavelength: 3 })
    })
    expect(api!.wavelength).toBe(3)
    expect(api!.$get('wavelength')).toBe(3)
  })

  it('resolves cross-folder showIf keys and folder-level showIf', async () => {
    let motion: { $set: (patch: { mode: string }) => void } | null = null
    function Motion() {
      motion = useControls(
        'Motion',
        { mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } } },
        { pane: 'cross' },
      )
      return null
    }
    function Wave() {
      useControls(
        'Wave',
        { wavelength: 2 },
        { pane: 'cross', showIf: (get) => get('Motion.mode') === 'wave' },
      )
      return null
    }
    function App() {
      return (
        <>
          <Motion />
          <Wave />
        </>
      )
    }
    await act(async () => root.render(<App />))
    await flushCore()

    const pane = Pane.get('cross')!
    const folders = [...pane.element.querySelectorAll('.tiao-folder')]
    const wave = folders.find((f) => f.querySelector('.tiao-folder-title')?.textContent === 'Wave')!
    expect(wave.classList.contains('tiao-hidden')).toBe(true)

    await act(async () => {
      motion!.$set({ mode: 'wave' })
    })
    expect(wave.classList.contains('tiao-hidden')).toBe(false)
  })

  it('materializes tabs() pages and flattens values into the hook result', async () => {
    let api: {
      shared: boolean
      color: string
      size: number
      note: string
    } | null = null
    function App() {
      api = useControls(
        {
          shared: true,
          panel: tabs({
            Look: { color: '#fff', size: 2 },
            Monitor: { note: 'hi' },
          }),
        },
        { pane: 'tabs' },
      )
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()

    expect(api!.shared).toBe(true)
    expect(api!.color).toBe('#fff')
    expect(api!.size).toBe(2)
    expect(api!.note).toBe('hi')

    const pane = Pane.get('tabs')!
    expect(pane.element.querySelectorAll('.tiao-tab-button')).toHaveLength(2)
    expect(pane.element.querySelectorAll('.tiao-tab-page')).toHaveLength(2)
  })

  it('accepts tabs() directly as the schema, no wrapper key', async () => {
    let api: { color: string; size: number } | null = null
    function App() {
      api = useControls(
        'Look',
        tabs({
          Sprite: { color: '#abc', size: 4 },
          Info: { note: 'hello' },
        }),
        { pane: 'tabs-direct' },
      )
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()

    expect(api!.color).toBe('#abc')
    expect(api!.size).toBe(4)

    const pane = Pane.get('tabs-direct')!
    expect(pane.element.querySelectorAll('.tiao-tab-button')).toHaveLength(2)
  })

  it('folder showIf is owned by its first registration and cleared on unmount', async () => {
    let motion: { $set: (patch: { mode: string }) => void } | null = null
    function Motion() {
      motion = useControls(
        'Motion',
        { mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } } },
        { pane: 'owner' },
      )
      return null
    }
    function GatedShared() {
      useControls('Shared', { a: 1 }, { pane: 'owner', showIf: (get) => get('Motion.mode') === 'wave' })
      return null
    }
    function PlainShared() {
      useControls('Shared', { b: 2 }, { pane: 'owner' })
      return null
    }
    function App({ gated }: { gated: boolean }) {
      return (
        <>
          <Motion />
          {gated && <GatedShared />}
          <PlainShared />
        </>
      )
    }
    await act(async () => root.render(<App gated />))
    await flushCore()

    const pane = Pane.get('owner')!
    const shared = [...pane.element.querySelectorAll('.tiao-folder')].find(
      (f) => f.querySelector('.tiao-folder-title')?.textContent === 'Shared',
    )!
    expect(shared.classList.contains('tiao-hidden')).toBe(true)

    // the owning registration unmounts; its stale predicate must not keep
    // hiding the folder the surviving registration still uses
    await act(async () => root.render(<App gated={false} />))
    expect(shared.classList.contains('tiao-hidden')).toBe(false)

    await act(async () => {
      motion!.$set({ mode: 'wave' })
    })
    expect(shared.classList.contains('tiao-hidden')).toBe(false)
  })

  it('skips all UI when disabled but still returns working values', async () => {
    setTiaoEnabled(false)
    let api: ControlsResult<{ n: number }> | null = null
    function App() {
      api = useControls({ n: 3 }, { pane: 'prod' })
      return null
    }
    await act(async () => root.render(<App />))
    await flushCore()
    expect(api!.n).toBe(3)
    expect(Pane.get('prod')).toBeUndefined()
    await act(async () => {
      api!.$set({ n: 5 })
    })
    expect(api!.n).toBe(5)
  })
})
