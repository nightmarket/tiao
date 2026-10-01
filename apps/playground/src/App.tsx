import type { BindingApi, Pane } from '@nightmarket/tiao/core'
import { registerBezierPlugin } from '@nightmarket/tiao/plugin-bezier'
import { registerCameraPlugin } from '@nightmarket/tiao/plugin-camera'
import { registerMediaPlugin } from '@nightmarket/tiao/plugin-media'
import { registerRadioGridPlugin } from '@nightmarket/tiao/plugin-radio-grid'
import type { ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { registerThumbnailsPlugin } from '@nightmarket/tiao/plugin-thumbnails'
import { useEffect, useRef, useState } from 'react'
import { examples } from './examples'

registerRadioGridPlugin()
registerBezierPlugin()
registerCameraPlugin()
registerMediaPlugin()
registerThumbnailsPlugin()

const slugFromHash = () => location.hash.replace(/^#\/?/, '')

const NAV_THUMBS: ThumbEntry[] = examples.map((e) => ({
  text: e.title,
  value: e.slug,
  thumb: e.thumb,
}))

/** Tiny hash router: each example is its own page, switchable from the nav pane. */
export function App() {
  const [slug, setSlug] = useState(slugFromHash)
  const navRef = useRef<BindingApi<string> | null>(null)

  useEffect(() => {
    const onHashChange = () => setSlug(slugFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // the nav itself is a pane: a label-less thumbnail grid driving the router
  useEffect(() => {
    let pane: Pane | undefined
    let disposed = false
    void (async () => {
      const { Pane } = await import('@nightmarket/tiao/core')
      if (disposed) return
      pane = new Pane({
        id: 'examples',
        title: 'Examples',
        anchor: 'bottom-center',
        width: 240,
        // the router belongs at the top of the sidebar, above every scene pane
        order: -10,
      })
      const nav = pane.addBinding({ example: slugFromHash() || examples[0]!.slug }, 'example', {
        view: 'thumbnails',
        options: NAV_THUMBS,
        aspect: 1.6,
        label: '',
        // the hash owns the current page; a stored value would navigate on load
        persist: false,
      })
      nav.on('change', (ev) => {
        if (ev.source === 'ui') location.hash = `#/${ev.value}`
      })
      navRef.current = nav
    })()
    return () => {
      disposed = true
      navRef.current = null
      pane?.dispose()
    }
  }, [])

  const example = examples.find((e) => e.slug === slug) ?? examples[0]!

  // back/forward and manual hash edits move the selection without navigating again
  useEffect(() => {
    const nav = navRef.current
    if (nav && nav.value.get() !== example.slug) nav.value.set(example.slug)
  }, [example.slug])

  // key remounts the page so pane/scene effects fully tear down
  return <example.Component key={example.slug} />
}
