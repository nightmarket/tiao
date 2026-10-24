import type { BindingApi, Pane } from '@nightmarket/tiao/core'
import type { ThumbEntry } from '@nightmarket/tiao/plugin-thumbnails'
import { useEffect, useRef } from 'react'
import { navigate } from '../router'
import { examples } from '.'

const NAV_THUMBS: ThumbEntry[] = examples.map((e) => ({
  text: e.title,
  value: e.slug,
  thumb: e.thumb,
}))

/** One example full screen, switchable from a nav pane that drives the route. */
export function ExamplePage({ slug }: { slug: string }) {
  const example = examples.find((e) => e.slug === slug) ?? examples[0]!
  const navRef = useRef<BindingApi<string> | null>(null)

  // the nav itself is a pane: a label-less thumbnail grid driving the router
  // biome-ignore lint/correctness/useExhaustiveDependencies: built once; the effect below follows the slug
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
      const nav = pane.addBinding({ example: example.slug }, 'example', {
        view: 'thumbnails',
        options: NAV_THUMBS,
        aspect: 1.6,
        label: '',
        // the hash owns the current page; a stored value would navigate on load
        persist: false,
      })
      nav.on('change', (ev) => {
        if (ev.source === 'ui') navigate(`/examples/${ev.value}`)
      })
      pane.addButton({ title: 'Docs' }).on('click', () => {
        navigate('/')
      })
      navRef.current = nav
    })()
    return () => {
      disposed = true
      navRef.current = null
      pane?.dispose()
    }
  }, [])

  // back and forward move the selection without navigating again
  useEffect(() => {
    const nav = navRef.current
    if (nav && nav.value.get() !== example.slug) nav.value.set(example.slug)
  }, [example.slug])

  // key remounts the page so pane/scene effects fully tear down
  return <example.Component key={example.slug} />
}
