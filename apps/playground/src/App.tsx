import { registerBezierPlugin } from '@nightmarket/tiao/plugin-bezier'
import { registerCameraPlugin } from '@nightmarket/tiao/plugin-camera'
import { registerMediaPlugin } from '@nightmarket/tiao/plugin-media'
import { registerRadioGridPlugin } from '@nightmarket/tiao/plugin-radio-grid'
import { registerThumbnailsPlugin } from '@nightmarket/tiao/plugin-thumbnails'
import { Docs } from './docs'
import { ExamplePage } from './examples/page'
import { usePath } from './router'

registerRadioGridPlugin()
registerBezierPlugin()
registerCameraPlugin()
registerMediaPlugin()
registerThumbnailsPlugin()

/** `/<page>` is a docs page, `/examples/<slug>` a full-screen example. */
export function App() {
  const [section = '', slug = ''] = usePath().replace(/^\//, '').split('/')
  return section === 'examples' ? <ExamplePage slug={slug} /> : <Docs slug={section} />
}
