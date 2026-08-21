import { afterEach, describe, expect, it, vi } from 'vitest'

/** Fresh module per test so the enabled override and query cache reset. */
async function loadConfig() {
  vi.resetModules()
  return await import('./config')
}

function setSearch(search: string) {
  window.history.replaceState(null, '', `${window.location.pathname}${search}`)
}

afterEach(() => {
  vi.unstubAllEnvs()
  setSearch('')
})

describe('isTiaoEnabled', () => {
  it('defaults to enabled outside production (NODE_ENV fallback)', async () => {
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(true)
  })

  it('defaults to disabled in production (NODE_ENV fallback)', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
  })

  it('prefers the local argument over everything', async () => {
    vi.stubEnv('DEBUG_LEVEL', '0')
    const { isTiaoEnabled, setTiaoEnabled } = await loadConfig()
    setTiaoEnabled(false)
    expect(isTiaoEnabled(true)).toBe(true)
    expect(isTiaoEnabled(false)).toBe(false)
  })

  it('prefers the global override over the level', async () => {
    vi.stubEnv('DEBUG_LEVEL', '0')
    const { isTiaoEnabled, setTiaoEnabled } = await loadConfig()
    setTiaoEnabled(true)
    expect(isTiaoEnabled()).toBe(true)
  })

  it('level 0 is off even with ?debug=true', async () => {
    vi.stubEnv('DEBUG_LEVEL', '0')
    setSearch('?debug=true')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
  })

  it('level 1 is off without the query param', async () => {
    vi.stubEnv('DEBUG_LEVEL', '1')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
  })

  it('level 1 turns on with ?debug and ?debug=true', async () => {
    vi.stubEnv('DEBUG_LEVEL', '1')
    setSearch('?debug')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(true)
    setSearch('?debug=true')
    expect(isTiaoEnabled()).toBe(true)
  })

  it('level 1 stays off with ?debug=false and ?debug=0', async () => {
    vi.stubEnv('DEBUG_LEVEL', '1')
    setSearch('?debug=false')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
    setSearch('?debug=0')
    expect(isTiaoEnabled()).toBe(false)
  })

  it('level 2 is on regardless of NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('DEBUG_LEVEL', '2')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(true)
  })

  it('level 2 turns off with ?debug=false', async () => {
    vi.stubEnv('DEBUG_LEVEL', '2')
    setSearch('?debug=false')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
  })

  it('re-reads the query param when the search string changes', async () => {
    vi.stubEnv('DEBUG_LEVEL', '1')
    setSearch('?debug=true')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(true)
    setSearch('?debug=false')
    expect(isTiaoEnabled()).toBe(false)
  })

  it('reads the NEXT_PUBLIC_ prefix', async () => {
    vi.stubEnv('NEXT_PUBLIC_DEBUG_LEVEL', '0')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(false)
  })

  it('NEXT_PUBLIC_DEBUG_LEVEL=1 wins over NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_DEBUG_LEVEL', '1')
    setSearch('?debug=true')
    const { isTiaoEnabled } = await loadConfig()
    expect(isTiaoEnabled()).toBe(true)
  })
})
