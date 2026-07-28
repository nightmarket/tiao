// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Pane } from '../core'
import { setTiaoEnabled } from './config'
import { button, monitor } from './types'
import * as devEntry from './index'
import * as prodEntry from './production'
import { getManager, useControls, usePane, type ControlsResult } from './production'

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
  // enabled-true is the adversarial case: even with tiao switched on, this
  // entry must stay inert and never reach for the UI
  setTiaoEnabled(true)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => root.unmount())
})

describe('production entry', () => {
  it('exports everything the development entry does', () => {
    // the two are interchangeable by export condition, so a name added to one
    // and forgotten in the other is a runtime error only production sees
    expect(Object.keys(prodEntry).sort()).toEqual(Object.keys(devEntry).sort())
  })

  it('returns schema defaults and never builds a pane', async () => {
    let api: ControlsResult<{ speed: { value: number; min: number; max: number }; on: boolean }> | null =
      null
    function App() {
      api = useControls({ speed: { value: 0.5, min: 0, max: 1 }, on: true }, { pane: 'prod-a' })
      return null
    }
    await act(async () => root.render(<App />))
    // give any stray async work the chance the dev entry would have taken
    await act(async () => {
      await Promise.resolve()
    })

    expect(api!.speed).toBe(0.5)
    expect(api!.on).toBe(true)
    expect(Pane.get('prod-a')).toBeUndefined()
    expect(document.querySelector('.tiao-row')).toBeNull()
  })

  it('$set re-renders and $get reads back', async () => {
    const renders: number[] = []
    let api: ControlsResult<{ n: number }> | null = null
    function App() {
      api = useControls({ n: 1 }, { pane: 'prod-b' })
      renders.push(api.n)
      return null
    }
    await act(async () => root.render(<App />))
    await act(async () => {
      api!.$set({ n: 9 })
    })
    expect(renders.at(-1)).toBe(9)
    expect(api!.$get('n')).toBe(9)
  })

  it('drops buttons and monitors from the returned values', async () => {
    let clicks = 0
    let api: ControlsResult<{ n: number }> | null = null
    function App() {
      api = useControls(
        {
          n: 2,
          reset: button(() => {
            clicks++
          }),
          fps: monitor(() => 60),
        },
        { pane: 'prod-c' },
      ) as ControlsResult<{ n: number }>
      return null
    }
    await act(async () => root.render(<App />))
    expect(Object.keys(api!).sort()).toEqual(['$get', '$set', 'n'])
    expect(clicks).toBe(0)
  })

  it('shares values between components on the same pane and folder', async () => {
    let a: ControlsResult<{ gravity: number }> | null = null
    let b: ControlsResult<{ gravity: number }> | null = null
    function A() {
      a = useControls('Physics', { gravity: 9.8 }, { pane: 'prod-d' })
      return null
    }
    function B() {
      b = useControls('Physics', { gravity: 9.8 }, { pane: 'prod-d' })
      return null
    }
    await act(async () =>
      root.render(
        <>
          <A />
          <B />
        </>,
      ),
    )
    await act(async () => {
      a!.$set({ gravity: 1.6 })
    })
    expect(b!.gravity).toBe(1.6)
    expect(getManager('prod-d').store.get('Physics.gravity')).toBe(1.6)
  })

  it('usePane stays null and the inert manager exposes no pane', async () => {
    let pane: unknown = 'unset'
    function App() {
      pane = usePane('prod-e')
      return null
    }
    await act(async () => root.render(<App />))
    expect(pane).toBeNull()
    expect(getManager('prod-e').getPane()).toBeNull()
  })
})
