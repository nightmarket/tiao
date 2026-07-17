import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/core/index.ts',
    react: 'src/react/index.ts',
    'perf-pane': 'src/perf-pane/index.ts',
    'export-pane': 'src/export-pane/index.ts',
    'plugin-fps': 'src/plugin-fps/index.ts',
    'plugin-bezier': 'src/plugin-bezier/index.ts',
    'plugin-radio-grid': 'src/plugin-radio-grid/index.ts',
    'plugin-media': 'src/plugin-media/index.ts',
    'plugin-camera': 'src/plugin-camera/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: true,
  external: ['react', 'mediabunny'],
  loader: { '.css': 'text' },
})
