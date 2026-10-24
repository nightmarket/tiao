import { Link } from '../../router'
import { Code, Section } from '../ui'

export function ReactPage() {
  return (
    <>
      <header className="docs-hero">
        <h1>React</h1>
        <p>
          <code>useControls</code> declares controls in the component that reads them and returns
          their values. Production builds leave the UI out, and the hooks return defaults.
        </p>
      </header>

      <Section title="useControls">
        <p>
          Each key becomes a row, inferred from its value like <code>addBinding</code>. An object
          with <code>value</code> takes the same options. Only components that read a changed value
          re-render.
        </p>
        <Code>{`import { useControls } from '@nightmarket/tiao/react'

function Orb() {
  const { speed, color, mode } = useControls({
    speed: { value: 1, min: 0, max: 2 },
    color: '#f00',
    mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } },
  })
}`}</Code>
      </Section>

      <Section title="Folders and panes">
        <p>
          A path as the first argument puts the rows in a folder. Any number of components can add
          to the same folder, and it stays until the last one unmounts. <code>pane</code> sends them
          to a separate pane.
        </p>
        <Code>{`useControls('Physics.Collisions', { bounce: 0.4 })

useControls('Capture', { scale: 2 }, { pane: { id: 'export', anchor: 'bottom-right' } })`}</Code>
      </Section>

      <Section title="Conditions">
        <p>
          <code>showIf</code> gets a reader for other values: <code>get('mode')</code> resolves in
          the same folder and <code>get('Motion.mode')</code> from the root. On hook options it
          hides the whole folder. Hidden values stay in the result.
        </p>
        <Code>{`useControls({
  mode: { value: 'orbit', options: { Orbit: 'orbit', Wave: 'wave' } },
  wavelength: { value: 1, showIf: (get) => get('mode') === 'wave' },
})

useControls('Wave', { amplitude: 0.5 }, { showIf: (get) => get('Motion.mode') === 'wave' })`}</Code>
      </Section>

      <Section title="Buttons, monitors, and tabs">
        <p>
          Helpers mark the keys that aren't plain values. Tab pages flatten into the result like any
          other rows.
        </p>
        <Code>{`import { button, buttonGroup, monitor, tabs, useControls } from '@nightmarket/tiao/react'

const controls = useControls(
  tabs({
    Motion: {
      speed: { value: 1, min: 0, max: 4 },
      presets: buttonGroup({ Slow: () => controls.$set({ speed: 0.5 }) }),
    },
    Monitor: {
      fps: monitor(() => stats.fps, { view: 'graph' }),
      reset: button(() => reset()),
    },
  }),
)`}</Code>
        <p>
          <code>$set</code> and <code>$get</code> on the result write and read values from code.{' '}
          <code>usePane(id)</code> returns the live <code>Pane</code> for plugins and custom blades,
          or <code>null</code> before it loads. The{' '}
          <Link href="/examples/particles">Particles</Link> example builds one pane from two
          components.
        </p>
      </Section>
    </>
  )
}
