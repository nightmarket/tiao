import { useEffect, useState, type CSSProperties } from 'react'
import { registerBezierPlugin } from '@tiao/plugin-bezier'
import { registerCameraPlugin } from '@tiao/plugin-camera'
import { registerMediaPlugin } from '@tiao/plugin-media'
import { registerRadioGridPlugin } from '@tiao/plugin-radio-grid'
import { examples } from './examples'

registerRadioGridPlugin()
registerBezierPlugin()
registerCameraPlugin()
registerMediaPlugin()

const slugFromHash = () => location.hash.replace(/^#\/?/, '')

/** Tiny hash router: each example is its own page, switchable from the bottom nav. */
export function App() {
  const [slug, setSlug] = useState(slugFromHash)

  useEffect(() => {
    const onHashChange = () => setSlug(slugFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const example = examples.find((e) => e.slug === slug) ?? examples[0]!

  return (
    <>
      {/* key remounts the page so pane/scene effects fully tear down */}
      <example.Component key={example.slug} />
      <nav style={navStyle}>
        {examples.map((e) => (
          <a
            key={e.slug}
            href={`#/${e.slug}`}
            style={{ ...linkStyle, ...(e === example ? activeLinkStyle : null) }}
          >
            {e.title}
          </a>
        ))}
      </nav>
    </>
  )
}

const navStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 4,
  padding: 4,
  borderRadius: 99,
  background: 'rgba(24, 24, 30, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  backdropFilter: 'blur(8px)',
  zIndex: 10,
}

const linkStyle: CSSProperties = {
  padding: '5px 12px',
  borderRadius: 99,
  fontSize: 12,
  color: '#a1a1aa',
  textDecoration: 'none',
}

const activeLinkStyle: CSSProperties = {
  color: '#fafafa',
  background: 'rgba(255, 255, 255, 0.1)',
}
