import { type BindingApi, onInterval, Pane } from '@nightmarket/tiao/core'
import { addFpsGraph } from '@nightmarket/tiao/plugin-fps'
import type { ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import earthThumb from './hero/earth.webp'
import mesaThumb from './hero/mesa.webp'
import { type HeroParams, startHero } from './hero/scene'
import { ALTITUDE } from './hero/sky'
import { startSunriseTour } from './hero/tour'
import { CursorIcon, WindowLights } from './ui'

/** the code defaults, fresh for each mount, since the pane and the tour write into the object it binds */
const heroParams = (): HeroParams => ({
  scene: 'mesa',
  seed: 7,
  mesa: {
    speed: 1.8,
    altitude: 340,
    tilt: 15,
    fov: 86,
    time: 7,
    azimuth: 0,
    play: false,
    day: 120,
    coverage: 0.45,
    clouds: 1,
    wind: 1,
    density: 1,
    haze: 1,
    mesas: 0.5,
    dunes: 1,
    sand: '#f2b45f',
    rock: '#d9837a',
    flare: 1,
    drift: 1,
    bloom: 0.5,
    exposure: 0.95,
    grain: 0.05,
  },
  earth: {
    speed: 6,
    morph: 0.01,
    wobble: 0.35,
    altitude: 0.12,
    tilt: 20,
    fov: 100,
    azimuth: 0,
    elevation: 9,
    lift: 38,
    density: 1,
    haze: 1,
    sea: 0.47,
    land: 2.4,
    relief: 0.025,
    clouds: 1,
    water: '#94adc7',
    ground: '#292626',
    flare: 1,
    drift: 1,
    bloom: 0.6,
    exposure: 0.75,
    grain: 0.07,
  },
})

/** an hour as a clock reads it */
const clock = (hour: number) => {
  const minutes = Math.floor(hour * 60) % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** frames of each scene, captured from this window */
const SCENES: ThumbEntry[] = [
  { text: 'Mesa', value: 'mesa', thumb: mesaThumb },
  { text: 'Earth', value: 'earth', thumb: earthThumb },
]

/** the hours the time row spans */
const DAY = { min: 0, max: 24 }

/** below zero the sun is behind the planet */
const ELEVATION = { min: -5, max: 30 }

/** the hour the landing tour starts from, before dawn, so the drag brings the sun up over the limb */
const TOUR_DAWN = 5.5
/** where the tour turns the sun to, degrees clockwise from straight ahead */
const TOUR_AZIMUTH = 20

/** what the landing tour reaches for */
interface HeroPane {
  pane: Pane
  /** disposes the pane and the clock that keeps its time row current */
  dispose(): void
  sunTab: HTMLElement
  time: BindingApi<number>
  azimuth: BindingApi<number>
}

/**
 * A tour of the controls: thumbnails, tabs, folders nested in folders,
 * sliders, dials, switches, colors, and a graph.
 */
function mountHeroPane(params: HeroParams): HeroPane {
  const pane = new Pane({
    id: 'docs-hero',
    title: 'Shader',
    namespace: 'hero',
    anchor: 'top-right',
  })
  pane.addBinding(params, 'scene', {
    view: 'thumbnails',
    label: '',
    columns: 2,
    aspect: 16 / 9,
    options: SCENES,
  })
  addFpsGraph(pane)

  const { mesa, earth } = params
  const mesaTabs = pane.addTab({
    pages: [
      { title: 'Flight' },
      { title: 'Sun' },
      { title: 'Sky' },
      { title: 'Land' },
      { title: 'Lens' },
    ],
    showIf: () => params.scene === 'mesa',
  })
  const flight = mesaTabs.pages[0]!
  flight.addBinding(mesa, 'speed', { min: 0, max: 6, step: 0.01 })
  flight.addBinding(mesa, 'altitude', { ...ALTITUDE, step: 1 })
  flight.addBinding(mesa, 'tilt', { min: -10, max: 30, step: 0.5 })
  flight.addBinding(mesa, 'fov', { min: 40, max: 110, step: 1 })
  const day = mesaTabs.pages[1]!
  const time = day.addBinding(mesa, 'time', { ...DAY, step: 0.01, format: clock })
  const azimuth = day.addBinding(mesa, 'azimuth', { view: 'angle', step: 0.1 })
  day.addBinding(mesa, 'play')
  day.addBinding(mesa, 'day', { label: 'day length', min: 10, max: 600, step: 1 })
  const weather = mesaTabs.pages[2]!
  const clouds = weather.addFolder({ title: 'Clouds' })
  clouds.addBinding(mesa, 'coverage', { min: 0, max: 1, step: 0.01 })
  clouds.addBinding(mesa, 'clouds', { label: 'thickness', min: 0, max: 3, step: 0.01 })
  const mesaAir = weather.addFolder({ title: 'Air', expanded: false })
  mesaAir.addBinding(mesa, 'density', { min: 0, max: 3, step: 0.01 })
  mesaAir.addBinding(mesa, 'haze', { min: 0, max: 4, step: 0.01 })
  weather.addBinding(mesa, 'wind', { min: 0, max: 3, step: 0.01 })
  const desert = mesaTabs.pages[3]!
  desert.addBinding(mesa, 'mesas', { min: 0, max: 1, step: 0.01 })
  desert.addBinding(mesa, 'dunes', { min: 0, max: 3, step: 0.01 })
  const tints = desert.addFolder({ title: 'Colors', expanded: false })
  tints.addBinding(mesa, 'sand')
  tints.addBinding(mesa, 'rock')
  const mesaLens = mesaTabs.pages[4]!
  mesaLens.addBinding(mesa, 'flare', { min: 0, max: 2, step: 0.01 })
  mesaLens.addBinding(mesa, 'bloom', { min: 0, max: 2, step: 0.01 })
  mesaLens.addBinding(mesa, 'exposure', { min: 0.1, max: 2, step: 0.01 })
  mesaLens.addBinding(mesa, 'grain', { min: 0, max: 0.2, step: 0.005 })

  const earthTabs = pane.addTab({
    pages: [{ title: 'Orbit' }, { title: 'Sun' }, { title: 'Ground' }, { title: 'Lens' }],
    showIf: () => params.scene === 'earth',
  })
  const orbit = earthTabs.pages[0]!
  orbit.addBinding(earth, 'speed', { min: 0, max: 10, step: 0.1 })
  orbit.addBinding(earth, 'altitude', { min: 0.04, max: 0.4, step: 0.005 })
  orbit.addBinding(earth, 'tilt', { min: 0, max: 45, step: 0.5 })
  orbit.addBinding(earth, 'fov', { min: 40, max: 120, step: 1 })
  const surface = orbit.addFolder({ title: 'Surface', expanded: false })
  surface.addBinding(earth, 'morph', { min: 0, max: 0.1, step: 0.005 })
  surface.addBinding(earth, 'wobble', { min: 0, max: 1, step: 0.01 })

  const sun = earthTabs.pages[1]!
  const angle = sun.addFolder({ title: 'Angle' })
  angle.addBinding(earth, 'elevation', { ...ELEVATION, step: 0.1 })
  angle.addBinding(earth, 'azimuth', { view: 'angle', step: 0.1 })
  angle.addBinding(earth, 'lift', { min: 0, max: 60, step: 1 })
  const air = sun.addFolder({ title: 'Air', expanded: false })
  air.addBinding(earth, 'density', { min: 0, max: 3, step: 0.01 })
  air.addBinding(earth, 'haze', { min: 0, max: 4, step: 0.01 })

  const ground = earthTabs.pages[2]!
  const land = ground.addFolder({ title: 'Land' })
  land.addBinding(earth, 'sea', { min: 0.3, max: 0.7, step: 0.005 })
  land.addBinding(earth, 'land', { label: 'scale', min: 0.5, max: 6, step: 0.05 })
  land.addBinding(earth, 'relief', { min: 0, max: 0.06, step: 0.001 })
  const colors = land.addFolder({ title: 'Colors', expanded: false })
  colors.addBinding(earth, 'water')
  colors.addBinding(earth, 'ground')
  ground.addBinding(earth, 'clouds', { min: 0, max: 1, step: 0.01 })

  const lens = earthTabs.pages[3]!
  const flare = lens.addFolder({ title: 'Flare' })
  flare.addBinding(earth, 'flare', { label: 'strength', min: 0, max: 2, step: 0.01 })
  flare.addBinding(earth, 'drift', { min: 0, max: 2, step: 0.01 })
  const grade = lens.addFolder({ title: 'Grade', expanded: false })
  grade.addBinding(earth, 'bloom', { min: 0, max: 2, step: 0.01 })
  grade.addBinding(earth, 'exposure', { min: 0.1, max: 2, step: 0.01 })
  grade.addBinding(earth, 'grain', { min: 0, max: 0.2, step: 0.005 })

  pane.addButton({ title: 'Shuffle' }).on('click', () => {
    params.seed = Math.round(Math.random() * 100)
    switch (params.scene) {
      case 'mesa':
        mesa.time = Math.round(Math.random() * 96) / 4
        mesa.coverage = Math.round(Math.random() * 80) / 100
        break
      case 'earth':
        earth.azimuth = Math.round((Math.random() - 0.5) * 40)
        break
      default: {
        const unknown: never = params.scene
        throw new Error(`no scene ${String(unknown)}`)
      }
    }
    pane.refresh()
  })
  // the day runs in the scene's loop, so the time row catches up a few times a second
  const stopClock = onInterval(() => {
    if (params.scene === 'mesa' && mesa.play) time.refresh()
  }, 120)
  const sunTab = mesaTabs.element.querySelectorAll<HTMLElement>('.tiao-tab-button')[1]!
  return {
    pane,
    dispose: () => {
      stopClock()
      pane.dispose()
    },
    sunTab,
    time,
    azimuth,
  }
}

/** the landing tour plays once a visit, not every time the overview mounts */
let toured = false

/**
 * A mini window running a three.js scene: a tiao of its own (the `hero`
 * namespace) rooted in the view, so its pane floats in the scene's top right
 * corner and scrolls with the page, and its notch hangs from the scene's top
 * edge. The first time it mounts it fades in before dawn, and a cursor in the
 * pane brings the sun up.
 */
export function ShaderWindow() {
  const frameRef = useRef<HTMLElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const params = heroParams()
    const { mesa } = params
    const morning = mesa.time
    const touring = !toured && !matchMedia('(prefers-reduced-motion: reduce)').matches
    // dawn is the default the tour starts from, so the morning it drags to counts as a change
    if (touring) mesa.time = TOUR_DAWN
    const release = Pane.namespace('hero', { root: viewRef.current! })
    const stop = startHero(canvasRef.current!, params)
    const { pane, dispose, sunTab, time, azimuth } = mountHeroPane(params)
    let stopTour: (() => void) | null = null
    if (touring) {
      const view = viewRef.current!
      stopTour = startSunriseTour({
        frame: frameRef.current!,
        cursor: cursorRef.current!,
        reachable: () => !pane.hidden && pane.expanded && view.contains(pane.element),
        tab: sunTab,
        slider: {
          track: time.element.querySelector<HTMLElement>('.tiao-slider')!,
          range: DAY,
          to: morning,
          get: () => mesa.time,
          follow: (v) => {
            mesa.time = v
          },
          land: (v) => {
            mesa.time = v
            time.refresh()
          },
        },
        dial: {
          get: () => mesa.azimuth,
          row: azimuth.element,
          pinned: () => azimuth.pinned,
          // its pinned card, at the bottom of the view
          knob: () =>
            [...view.querySelectorAll('.tiao-pin')]
              .find((card) => card.querySelector('.tiao-angle-label')?.textContent === 'azimuth')
              ?.querySelector<HTMLElement>('.tiao-angle-knob') ?? null,
          to: TOUR_AZIMUTH,
        },
        onDone: () => {
          toured = true
        },
      })
    }
    return () => {
      stopTour?.()
      dispose()
      stop()
      release()
    }
  }, [])
  return (
    <motion.figure
      ref={frameRef}
      className="docs-window"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 3, ease: 'easeInOut' } }}
    >
      <WindowLights />
      <div ref={viewRef} className="docs-window-view">
        {/* the scene wakes up, brightening from the dark as the window fades in */}
        <motion.canvas
          ref={canvasRef}
          className="docs-window-screen"
          initial={{ filter: 'brightness(0)' }}
          animate={{
            filter: 'brightness(1)',
            transition: { duration: 4.5, ease: [0.4, 0, 0.2, 1] },
            transitionEnd: { filter: 'none' },
          }}
        />
      </div>
      <div ref={cursorRef} className="docs-tour-cursor" aria-hidden="true">
        <CursorIcon />
      </div>
    </motion.figure>
  )
}
