const registered = new WeakSet<Document>()

/**
 * Registers the bundled Geist faces with `doc`, once. The ~190 KB of font data sits in its
 * own chunk, fetched the first time a page picks Geist; text draws in the system stack
 * until it lands.
 */
export function registerGeist(doc: Document): void {
  const FontFaceCtor = doc.defaultView?.FontFace
  if (registered.has(doc) || typeof FontFaceCtor !== 'function' || !doc.fonts) return
  registered.add(doc)
  import('./fonts/geist')
    .then(({ GEIST_FACES }) => {
      for (const { family, src } of GEIST_FACES) {
        doc.fonts.add(
          new FontFaceCtor(family, `url("${src}") format("woff2")`, {
            weight: '100 900',
            display: 'swap',
          }),
        )
      }
    })
    .catch(() => registered.delete(doc))
}
