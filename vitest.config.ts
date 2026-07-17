import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    include: ['packages/tiao/src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./packages/tiao/vitest.setup.ts'],
  },
})
