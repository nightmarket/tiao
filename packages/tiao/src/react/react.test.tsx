// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Pane } from '../core'
import { setTiaoEnabled } from './config'
import { loadCore } from './manager'
import { button, monitor } from './types'
import { useControls, type ControlsResult } from './useControls'

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
