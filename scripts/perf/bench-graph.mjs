/**
 * Drive the Vite graph microbench and write JSON artifacts.
 *
 * Prereq: pnpm --filter playground dev --host 127.0.0.1 --port 5173
 * Run:    node scripts/perf/bench-graph.mjs [label]
 */
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const artifacts = join(__dirname, 'artifacts')
mkdirSync(artifacts, { recursive: true })

const label = process.argv[2] ?? 'baseline'
const port = process.env.TIAO_CDP_PORT ?? '9333'
const base = process.env.TIAO_BENCH_URL ?? 'http://127.0.0.1:5173/bench-graph.html'
const query = new URLSearchParams({
  samples: process.env.TIAO_BENCH_SAMPLES ?? '5000',
  graphs: process.env.TIAO_BENCH_GRAPHS ?? '8',
  buffer: process.env.TIAO_BENCH_BUFFER ?? '128',
})
const url = `${base}?${query}`
const chromium =
  process.env.TIAO_CHROMIUM ??
  (process.platform === 'darwin' ? '/opt/homebrew/bin/chromium' : 'chromium')

const userData = join(artifacts, `.chrome-profile-${label}`)
rmSync(userData, { recursive: true, force: true })
mkdirSync(userData, { recursive: true })

const chrome = spawn(
  chromium,
  [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
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
      if (res.ok) return res.json()
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`CDP not ready on ${port}`)
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data))
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    }
  })
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  return {
    ready,
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

try {
  await waitForCdp()
  const listRes = await fetch(`http://127.0.0.1:${port}/json/list`)
  const pages = await listRes.json()
  const page = pages.find((p) => p.type === 'page') ?? pages[0]
  if (!page?.webSocketDebuggerUrl) throw new Error('no page target')

  const client = connect(page.webSocketDebuggerUrl)
  await client.ready
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.navigate', { url })
  await client.send('Page.loadEventFired').catch(() => {})

  // Page.loadEventFired is an event, not a command — poll for the result instead.
  let result
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const evalResult = await client.send('Runtime.evaluate', {
      expression: 'window.__TIAO_GRAPH_BENCH__ ?? null',
      returnByValue: true,
      awaitPromise: false,
    })
    if (evalResult.result?.value) {
      result = evalResult.result.value
      break
    }
    // Surface module errors early.
    const err = await client.send('Runtime.evaluate', {
      expression: 'document.getElementById("out")?.textContent ?? ""',
      returnByValue: true,
    })
    const text = err.result?.value ?? ''
    if (typeof text === 'string' && text.includes('Error')) {
      throw new Error(text)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!result) throw new Error('bench did not publish __TIAO_GRAPH_BENCH__')

  const out = { label, at: new Date().toISOString(), url, ...result }
  const path = join(artifacts, `graph-bench-${label}.json`)
  writeFileSync(path, JSON.stringify(out, null, 2))
  console.log(JSON.stringify(out, null, 2))
  console.log(`wrote ${path}`)
  client.close()
} finally {
  chrome.kill('SIGKILL')
}
