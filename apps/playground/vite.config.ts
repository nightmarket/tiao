import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// Alias @tiao/* to package sources so edits under packages/ HMR without a
// rebuild. Publishing is unaffected: package.json exports still point at dist.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packagesDir = path.join(repoRoot, 'packages')
const workspacePackages = fs
  .readdirSync(packagesDir)
  .filter((name) => fs.existsSync(path.join(packagesDir, name, 'src/index.ts')))

/** tsup loads .css as text (`loader: { '.css': 'text' }`); match that for package sources. */
function cssAsText(): Plugin {
  return {
    name: 'tiao-css-as-text',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || source.includes('?') || !source.endsWith('.css')) return null
      if (!importer.startsWith(packagesDir + path.sep)) return null
      const resolved = await this.resolve(source, importer, { skipSelf: true })
      if (!resolved || resolved.external) return null
      return `${resolved.id}?raw`
    },
  }
}

export default defineConfig({
  plugins: [react(), cssAsText()],
  resolve: {
    alias: {
      // Explicit entry first: side-effect CSS imports from app code should
      // still be handled as a real stylesheet by Vite.
      '@tiao/core/styles.css': path.join(packagesDir, 'core/src/styles.css'),
      ...Object.fromEntries(
        workspacePackages.map((name) => [`@tiao/${name}`, path.join(packagesDir, name, 'src/index.ts')]),
      ),
    },
  },
})
