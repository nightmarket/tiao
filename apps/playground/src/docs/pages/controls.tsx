import { Reference, type ReferenceProps } from '../ui'

const wave = {
  get level() {
    return Math.sin(performance.now() / 600) * 0.5 + 0.5
  },
}

const CONTROLS: ReferenceProps[] = [
  {
    name: 'Slider',
    type: 'number',
    code: `const params = { speed: 1, seed: 42 }
pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
pane.addBinding(params, 'seed')`,
    build: (pane) => {
      const params = { speed: 1, seed: 42 }
      pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
      pane.addBinding(params, 'seed')
    },
    about: (
      <>
        A number with a min and max is a slider. Without a range it's a scrubber: drag sideways, or
        click to type. <code>format</code> changes how it reads.
      </>
    ),
  },
  {
    name: 'Toggle',
    type: 'boolean',
    code: `pane.addBinding({ enabled: true }, 'enabled')`,
    build: (pane) => {
      pane.addBinding({ enabled: true }, 'enabled')
    },
    about: 'A boolean becomes a switch.',
  },
  {
    name: 'Text',
    type: 'string',
    code: `pane.addBinding({ label: 'hello tiao' }, 'label')`,
    build: (pane) => {
      pane.addBinding({ label: 'hello tiao' }, 'label')
    },
    about: "Any string that isn't a color. It commits on Enter or blur.",
  },
  {
    name: 'Select',
    type: 'options',
    code: `pane.addBinding({ blend: 'multiply' }, 'blend', {
  options: { Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay' },
})`,
    build: (pane) => {
      pane.addBinding({ blend: 'multiply' }, 'blend', {
        options: { Multiply: 'multiply', Screen: 'screen', Overlay: 'overlay' },
      })
    },
    about: (
      <>
        <code>options</code> maps labels to values, or takes a list of{' '}
        <code>{'{ text, value }'}</code>. Long lists get a search field.
      </>
    ),
  },
  {
    name: 'Color',
    type: 'string | object',
    code: `const params = {
  tint: '#ff8800',
  glow: 'rgba(120, 200, 255, 0.5)',
  accent: 'oklch(0.7 0.15 200)',
}
pane.addBinding(params, 'tint')
pane.addBinding(params, 'glow')
pane.addBinding(params, 'accent')`,
    build: (pane) => {
      const params = {
        tint: '#ff8800',
        glow: 'rgba(120, 200, 255, 0.5)',
        accent: 'oklch(0.7 0.15 200)',
      }
      pane.addBinding(params, 'tint')
      pane.addBinding(params, 'glow')
      pane.addBinding(params, 'accent')
    },
    about: (
      <>
        Hex, rgb, hsl, and <code>{'{ h, s, v }'}</code> objects keep their format. OKLCH and OKLab
        open a gamut-aware picker. <code>{'color: { alpha: true }'}</code> adds alpha to hex.
      </>
    ),
  },
  {
    name: 'Interval',
    type: '{ min, max }',
    code: `pane.addBinding({ clip: { min: 20, max: 80 } }, 'clip', {
  min: 0,
  max: 100,
  step: 1,
})`,
    build: (pane) => {
      pane.addBinding({ clip: { min: 20, max: 80 } }, 'clip', { min: 0, max: 100, step: 1 })
    },
    about: (
      <>
        A <code>{'{ min, max }'}</code> object gets two handles. Drag between them to move both.
      </>
    ),
  },
  {
    name: 'Point',
    type: '{ x, y, z }',
    code: `const params = { offset: { x: 0.2, y: -0.3 }, rotation: { x: 0, y: 15, z: 0 } }
pane.addBinding(params, 'offset', {
  x: { min: -1, max: 1 },
  y: { min: -1, max: 1 },
})
pane.addBinding(params, 'rotation', { step: 1 })`,
    build: (pane) => {
      const params = { offset: { x: 0.2, y: -0.3 }, rotation: { x: 0, y: 15, z: 0 } }
      pane.addBinding(params, 'offset', { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } })
      pane.addBinding(params, 'rotation', { step: 1 })
    },
    about: 'One field per axis. A 2D point with ranges on both axes adds a pad.',
  },
  {
    name: 'Angle',
    type: 'number',
    code: `pane.addBinding({ yaw: 45 }, 'yaw', { view: 'angle' })`,
    build: (pane) => {
      pane.addBinding({ yaw: 45 }, 'yaw', { view: 'angle' })
    },
    about: (
      <>
        A dial in degrees. <code>unit: 'rad'</code> binds radians.
      </>
    ),
  },
  {
    name: 'Button',
    type: 'action',
    code: `pane.addButton({ title: 'Reset' }).on('click', reset)
pane.addButtonGroup({
  label: 'Zoom',
  buttons: { '0.5x': () => zoom(0.5), '1x': () => zoom(1), '2x': () => zoom(2) },
})`,
    build: (pane) => {
      pane.addButton({ title: 'Reset' })
      pane.addButtonGroup({
        label: 'Zoom',
        buttons: { '0.5x': () => {}, '1x': () => {}, '2x': () => {} },
      })
    },
    about: 'A button runs a callback. A group puts several in a row.',
  },
  {
    name: 'Folder',
    type: 'group',
    code: `const look = pane.addFolder({ title: 'Look' })
look.addBinding({ exposure: 0.6 }, 'exposure', { min: 0, max: 1 })

const more = pane.addFolder({ title: 'More', expanded: false, color: '#fb923c' })
more.addBinding({ grain: 0.1 }, 'grain', { min: 0, max: 1 })`,
    build: (pane) => {
      const look = pane.addFolder({ title: 'Look' })
      look.addBinding({ exposure: 0.6 }, 'exposure', { min: 0, max: 1 })
      const more = pane.addFolder({ title: 'More', expanded: false, color: '#fb923c' })
      more.addBinding({ grain: 0.1 }, 'grain', { min: 0, max: 1 })
    },
    about: (
      <>
        Folders collapse and nest. <code>expanded: false</code> starts closed,{' '}
        <code>collapsible: false</code> keeps one open, and <code>color</code> tints the title.
      </>
    ),
  },
  {
    name: 'Tabs',
    type: 'group',
    code: `const tabs = pane.addTab({ pages: [{ title: 'Motion' }, { title: 'Look' }] })
tabs.pages[0].addBinding({ speed: 1 }, 'speed', { min: 0, max: 4 })
tabs.pages[1].addBinding({ tint: '#7dd3fc' }, 'tint')`,
    build: (pane) => {
      const tabs = pane.addTab({ pages: [{ title: 'Motion' }, { title: 'Look' }] })
      tabs.pages[0]!.addBinding({ speed: 1 }, 'speed', { min: 0, max: 4 })
      tabs.pages[1]!.addBinding({ tint: '#7dd3fc' }, 'tint')
    },
    about: 'Pages of rows in one spot.',
  },
  {
    name: 'Monitor',
    type: 'readonly',
    code: `pane.addBinding(stats, 'level', { readonly: true })
pane.addBinding(stats, 'level', { readonly: true, view: 'graph', min: 0, max: 1 })`,
    build: (pane) => {
      pane.addBinding(wave, 'level', { readonly: true })
      pane.addBinding(wave, 'level', { readonly: true, view: 'graph', min: 0, max: 1 })
    },
    about: (
      <>
        <code>readonly</code> shows a value without editing it, read every 66 ms or every{' '}
        <code>interval</code> ms. The graph view plots its history.
      </>
    ),
  },
  {
    name: 'Visibility',
    type: 'showIf',
    code: `const params = { mode: 'orbit', radius: 1, wavelength: 2 }
pane.addBinding(params, 'mode', { options: { Orbit: 'orbit', Wave: 'wave' } })
pane.addBinding(params, 'radius', { showIf: () => params.mode === 'orbit' })
pane.addBinding(params, 'wavelength', { showIf: () => params.mode === 'wave' })`,
    build: (pane) => {
      const params = { mode: 'orbit', radius: 1, wavelength: 2 }
      pane.addBinding(params, 'mode', { options: { Orbit: 'orbit', Wave: 'wave' } })
      pane.addBinding(params, 'radius', { showIf: () => params.mode === 'orbit' })
      pane.addBinding(params, 'wavelength', { showIf: () => params.mode === 'wave' })
    },
    about: (
      <>
        <code>showIf</code> hides the row while it returns false. <code>hidden</code> and{' '}
        <code>disabled</code> work on any row or folder.
      </>
    ),
  },
]

export function Controls() {
  return (
    <>
      <header className="docs-hero">
        <h1>Controls</h1>
        <p>
          <code>pane.addBinding(object, key, options)</code> picks a control for{' '}
          <code>object[key]</code> and writes back as you drag.
        </p>
      </header>
      {CONTROLS.map((control) => (
        <Reference key={control.name} {...control} />
      ))}
    </>
  )
}
