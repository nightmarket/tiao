import { Code, Section } from '../ui'

const LEVELS: [string, string][] = [
  ['0', 'Off. No UI code loads.'],
  ['1', 'Off unless the URL has ?debug. The pane lazy-loads when it does.'],
  ['2', 'On unless the URL has ?debug=false.'],
]

const VARIABLES: [string, string][] = [
  ['Next.js', 'NEXT_PUBLIC_DEBUG_LEVEL'],
  ['Vite', 'VITE_DEBUG_LEVEL'],
  ['Node, tests', 'DEBUG_LEVEL'],
]

export function Production() {
  return (
    <>
      <header className="docs-hero">
        <h1>Production</h1>
        <p>
          Debug panes shouldn't ship. <code>mountPane</code> and the React hooks load the UI only
          when debugging is on, and production builds leave it out.
        </p>
      </header>

      <Section title="Debug levels">
        <p>
          One variable, <code>DEBUG_LEVEL</code>, with your bundler's public prefix. Unset, it's{' '}
          <code>2</code> in development and <code>0</code> in production.
        </p>
        <dl className="docs-table">
          {LEVELS.map(([level, what]) => (
            <div key={level}>
              <dt>
                <code>{level}</code>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
        <dl className="docs-table">
          {VARIABLES.map(([bundler, variable]) => (
            <div key={bundler}>
              <dt>{bundler}</dt>
              <dd>
                <code>{variable}</code>
              </dd>
            </div>
          ))}
        </dl>
        <p>
          <code>enabled</code> overrides it for one hook and <code>setTiaoEnabled</code> for the
          app.
        </p>
      </Section>

      <Section title="Production builds">
        <p>
          The <code>production</code> export condition swaps the React entry for one with no pane:{' '}
          <code>useControls</code> still returns values, and no UI ships. Vite applies it on{' '}
          <code>vite build</code>; other bundlers may need it in their resolve conditions. For level{' '}
          <code>1</code> on a live site, leave the condition off.
        </p>
        <p>
          A pane that ships, like a settings panel, imports <code>Pane</code> from the core entry.
        </p>
        <Code>{`import { Pane } from '@nightmarket/tiao/core'

const pane = new Pane({ title: 'Settings' })
pane.addBinding(settings, 'volume', { min: 0, max: 1 })`}</Code>
      </Section>
    </>
  )
}
