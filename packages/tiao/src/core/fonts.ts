const loads = new WeakMap<Document, Promise<unknown>>()

/**
 * Loads the bundled Geist faces into `doc`, once. The ~190 KB of font data sits in its
 * own chunk, fetched the first time a page picks Geist. Until both faces have loaded the
 * root carries `data-tiao-font-loading`, which keeps Geist panes hidden rather than drawn
 * in the system stack for a frame. Settles either way: a face that fails to load leaves
 * text in the system stack.
 */
export function loadGeist(doc: Document): Promise<unknown> {
  const FontFaceCtor = doc.defaultView?.FontFace
  if (typeof FontFaceCtor !== 'function' || !doc.fonts) return Promise.resolve()
  const pending = loads.get(doc)
  if (pending) return pending
  const root = doc.documentElement
  root.toggleAttribute('data-tiao-font-loading', true)
  const load = import('./fonts/geist')
    .then(({ GEIST_FACES }) => {
      const faces = GEIST_FACES.map(
        ({ family, src }) =>
          new FontFaceCtor(family, `url("${src}") format("woff2")`, {
            weight: '100 900',
            display: 'swap',
          }),
      )
      for (const face of faces) doc.fonts.add(face)
      return Promise.allSettled(faces.map((face) => face.load()))
    })
    // the chunk didn't arrive; the next pane tries again
    .catch(() => loads.delete(doc))
    .finally(() => root.removeAttribute('data-tiao-font-loading'))
  loads.set(doc, load)
  return load
}
