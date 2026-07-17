import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Alias tiao-tiao subpaths to package sources so edits HMR without a rebuild.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const tiaoSrc = path.join(repoRoot, 'packages/tiao/src')

const aliases = [
  { find: /^tiao-tiao$/, replacement: path.join(tiaoSrc, 'core/index.ts') },
  { find: /^tiao-tiao\/styles\.css$/, replacement: path.join(tiaoSrc, 'core/styles.css') },
  { find: /^tiao-tiao\/react$/, replacement: path.join(tiaoSrc, 'react/index.ts') },
  { find: /^tiao-tiao\/perf-pane$/, replacement: path.join(tiaoSrc, 'perf-pane/index.ts') },
  { find: /^tiao-tiao\/export-pane$/, replacement: path.join(tiaoSrc, 'export-pane/index.ts') },
  { find: /^tiao-tiao\/plugin-fps$/, replacement: path.join(tiaoSrc, 'plugin-fps/index.ts') },
  { find: /^tiao-tiao\/plugin-bezier$/, replacement: path.join(tiaoSrc, 'plugin-bezier/index.ts') },
  {
    find: /^tiao-tiao\/plugin-radio-grid$/,
    replacement: path.join(tiaoSrc, 'plugin-radio-grid/index.ts'),
  },
  { find: /^tiao-tiao\/plugin-media$/, replacement: path.join(tiaoSrc, 'plugin-media/index.ts') },
  { find: /^tiao-tiao\/plugin-camera$/, replacement: path.join(tiaoSrc, 'plugin-camera/index.ts') },
]

/** tsup loads .css as text (`loader: { '.css': 'text' }`); match that for package sources. */
function cssAsText(): Plugin {
  return {
    name: 'tiao-css-as-text',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || source.includes('?') || !source.endsWith('.css')) return null
      if (!importer.startsWith(tiaoSrc + path.sep)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved || resolved.external) return null
      return `${resolved.id}?raw`
    },
  }
}

export default defineConfig({
  plugins: [react(), cssAsText()],
  resolve: {
    alias: aliases,
  },
})
