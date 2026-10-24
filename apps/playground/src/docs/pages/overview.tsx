import type { Pane } from '@nightmarket/tiao/core'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { Link } from '../../router'
import { ShaderWindow } from '../shader-window'
import { ShowcaseWindow } from '../showcase-window'
import {
  ArrowUpRight,
  type CodeFile,
  CodeTabs,
  CopyButton,
  DemoWindow,
  Highlight,
  Logo,
  Section,
  TAB_SPRING,
  Tabs,
} from '../ui'

const PACKAGE = '@nightmarket/tiao'
/** yarn, pnpm, and bun all install from the npm registry, so one publish covers every tab */
const COMMANDS = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' } as const
const PROMPT = `Add ${PACKAGE} to this project and wire up a debug pane for the values I tune by eye.`
type Installer = keyof typeof COMMANDS | 'Agent'
const INSTALLERS: Installer[] = [...(Object.keys(COMMANDS) as (keyof typeof COMMANDS)[]), 'Agent']

/** The install command for each package manager, plus a prompt to hand a coding agent. */
function Install() {
  const [current, setCurrent] = useState<Installer>('npm')
  const command = current === 'Agent' ? PROMPT : `${COMMANDS[current]} ${PACKAGE}`
  return (
    <div className="docs-install">
      <Tabs tabs={INSTALLERS} current={current} onSelect={setCurrent} label="Install with" />
      {/* the box springs to each command's size; its children opt into layout so they don't stretch */}
      <motion.div
        layout
        className="docs-install-command"
        role="tabpanel"
        style={{ borderRadius: 8 }}
        transition={TAB_SPRING}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.code
            key={current}
            layout="position"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2, delay: 0.05 } }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
          >
            {current === 'Agent' ? (
              PROMPT
            ) : (
              <>
                <Highlight code={COMMANDS[current]} lang="shellscript" /> {PACKAGE}
              </>
            )}
          </motion.code>
        </AnimatePresence>
        <motion.span layout="position" transition={TAB_SPRING}>
          <CopyButton text={command} label={`Copy ${current} command`} />
        </motion.span>
      </motion.div>
    </div>
  )
}

const QUICK_START: CodeFile[] = [
  {
    name: 'JavaScript',
    lang: 'tsx',
    code: `import { mountPane } from '@nightmarket/tiao'

const params = { speed: 1, enabled: true, tint: '#ff8800' }

const dispose = mountPane({ title: 'Scene' }, (pane) => {
  pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
  pane.addBinding(params, 'enabled')
  pane.addBinding(params, 'tint')
})`,
  },
  {
    name: 'React',
    lang: 'tsx',
    code: `import { useControls } from '@nightmarket/tiao/react'

export function Scene() {
  const { speed, enabled, tint } = useControls({
    speed: { value: 1, min: 0, max: 4, step: 0.01 },
    enabled: true,
    tint: '#ff8800',
  })
  return <Orb speed={speed} visible={enabled} color={tint} />
}`,
  },
  {
    name: 'Svelte',
    lang: 'svelte',
    code: `<script>
  import { onMount } from 'svelte'
  import { mountPane } from '@nightmarket/tiao'

  const params = $state({ speed: 1, enabled: true, tint: '#ff8800' })

  onMount(() =>
    mountPane({ title: 'Scene' }, (pane) => {
      pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
      pane.addBinding(params, 'enabled')
      pane.addBinding(params, 'tint')
    }),
  )
</script>`,
  },
  {
    name: 'Vue',
    lang: 'vue',
    code: `<script setup>
import { onMounted, onUnmounted, reactive } from 'vue'
import { mountPane } from '@nightmarket/tiao'

const params = reactive({ speed: 1, enabled: true, tint: '#ff8800' })
let dispose

onMounted(() => {
  dispose = mountPane({ title: 'Scene' }, (pane) => {
    pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
    pane.addBinding(params, 'enabled')
    pane.addBinding(params, 'tint')
  })
})
onUnmounted(() => dispose())
</script>`,
  },
]

const buildQuickStart = (pane: Pane) => {
  const params = { speed: 1, enabled: true, tint: '#ff8800' }
  pane.addBinding(params, 'speed', { min: 0, max: 4, step: 0.01 })
  pane.addBinding(params, 'enabled')
  pane.addBinding(params, 'tint')
}

const IMPORTS: [string, string][] = [
  ['@nightmarket/tiao', 'mountPane: lazy in development, a no-op in production'],
  ['@nightmarket/tiao/core', 'The Pane API, for panes that ship to production'],
  ['@nightmarket/tiao/react', 'useControls hooks, stripped from production'],
  ['@nightmarket/tiao/plugin-*', 'Bezier, radio grid, thumbnails, media, camera, and FPS'],
  ['@nightmarket/tiao/perf-pane', 'fps, CPU and GPU time, draw calls, and memory for three.js'],
  ['@nightmarket/tiao/export-pane', 'PNG, WebM, and MP4 export of a canvas'],
]

/** The landing screen: what tiao is, the demo, and how to install it. */
export function OverviewStage() {
  return (
    <>
      <header className="docs-stage-header">
        <Logo version={false} />
        <p>Minimally designed, feature-packed debug panes for your web app.</p>
      </header>
      <ShaderWindow />
      <Install />
    </>
  )
}

export function Overview() {
  return (
    <>
      <Section title="Quick start">
        <p>
          Bind a plain object, and tiao picks a control for each value. Svelte and Vue use the same
          API inside their mount hooks.
        </p>
        <DemoWindow namespace="docs-quick-start" title="Scene" build={buildQuickStart} />
        <CodeTabs files={QUICK_START} label="Framework" />
      </Section>

      <Section title="Try it">
        <p>Every pane on these pages is live.</p>
        <ul className="docs-list">
          <li>
            Tap <kbd>T</kbd> twice to search every control
          </li>
          <li>
            Press <kbd>H</kbd> over a window to hide its panes
          </li>
          <li>Right-click a row to pin or reset it</li>
          <li>Undo a drag from the notch</li>
        </ul>
      </Section>

      <Section title="Imports">
        <p>One package, split so unused plugins stay out of your bundle.</p>
        <dl className="docs-table">
          {IMPORTS.map(([path, what]) => (
            <div key={path}>
              <dt>
                <code>{path}</code>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Showcase">
        <p>
          One of each control and plugin.{' '}
          <Link href="/examples/showcase">
            See them full screen
            <ArrowUpRight />
          </Link>
        </p>
        <ShowcaseWindow />
      </Section>
    </>
  )
}
