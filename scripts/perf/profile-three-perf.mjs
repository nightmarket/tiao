/**
 * Capture a short Chromium CPU profile on the three-perf playground example.
 * Prereq: playground dev server on :5173
 * Run: node scripts/perf/profile-three-perf.mjs [label]
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const artifacts = join(__dirname, 'artifacts')
mkdirSync(artifacts, { recursive: true })

const label = process.argv[2] ?? 'baseline'
const port = process.env.TIAO_CDP_PORT ?? '9334'
const url = process.env.TIAO_PROFILE_URL ?? 'http://127.0.0.1:5173/#/three-perf'
const profileMs = Number(process.env.TIAO_PROFILE_MS ?? 3000)
const chromium =
  process.env.TIAO_CHROMIUM ??
  (process.platform === 'darwin' ? '/opt/homebrew/bin/chromium' : 'chromium')

const userData = join(artifacts, `.chrome-profile-cpu-${label}`)
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

const chrome = spawn(
  chromium,
  [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    `--user-data-dir=${userData}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

async function waitForCdp(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`CDP not ready on ${port}`)
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  const events = []
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method) {
      events.push(msg)
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return {
    ready,
    events,
    send(method, params = {}) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    close() {
      ws.close()
    },
  }
}

function summarizeProfile(profile) {
  const nodes = profile.nodes ?? []
  const rows = nodes
    .map((n) => {
      const name = n.callFrame?.functionName || '(anonymous)'
      const url = n.callFrame?.url || ''
      const line = n.callFrame?.lineNumber ?? -1
      return {
        name,
        url: url
          .replace(/^https?:\/\/[^/]+/, '')
          .replace(/^.*\/packages\//, 'packages/')
          .replace(/\?.*$/, ''),
        line: line >= 0 ? line + 1 : null,
        hitCount: n.hitCount ?? 0,
      }
    })
    .filter((r) => r.hitCount > 0)
    .sort((a, b) => b.hitCount - a.hitCount)
  const totalHits = rows.reduce((s, r) => s + r.hitCount, 0)
  const tiao = rows
    .filter((r) => /tiao|perf-pane|plugin-fps|bench-graph|monitor|ticker|blade|pane\.ts/.test(r.url + r.name))
    .slice(0, 40)
  return {
    totalHits,
    top: rows.slice(0, 40),
    tiao,
    nodeCount: nodes.length,
  }
}

try {
  await waitForCdp()
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`)
  const pages = await listRes.json()
  const page = pages.find((p) => p.type === 'page') ?? pages[0]
  const client = connect(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Profiler.enable')
  await client.send('Page.navigate', { url })

  const mountDeadline = Date.now() + 15000
  while (Date.now() < mountDeadline) {
    const r = await client.send('Runtime.evaluate', {
      expression:
        "!!(document.querySelector('.tiao-pane') && document.querySelector('canvas'))",
      returnByValue: true,
    })
    if (r.result?.value) break
    await new Promise((x) => setTimeout(x, 100))
  }

  await client.send('Profiler.setSamplingInterval', { interval: 100 })
  await client.send('Profiler.start')
  await new Promise((r) => setTimeout(r, profileMs))
  const { profile } = await client.send('Profiler.stop')

  const summary = summarizeProfile(profile)
  const out = {
    label,
    at: new Date().toISOString(),
    url,
    profileMs,
    ...summary,
  }
  const profilePath = join(artifacts, `cpu-${label}.cpuprofile`)
  const summaryPath = join(artifacts, `cpu-${label}.json`)
  writeFileSync(profilePath, JSON.stringify(profile))
  writeFileSync(summaryPath, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`wrote ${summaryPath}`)
  console.log(`wrote ${profilePath}`)
  client.close()
} finally {
  chrome.kill('SIGKILL')
}
