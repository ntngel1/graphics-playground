// npm run thumbs [-- --url http://localhost:5173/] [-- --only gray-scott,hello]
// Превью для галереи: headless Chrome открывает каждый эксперимент, прогревает симуляцию,
// прячет UI и сохраняет public/thumbs/<id>.jpg (480×300). Без --url поднимает свой dev-сервер.
// Chrome: переменная CHROME или стандартный путь macOS/Linux.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const OUT = path.join(ROOT, 'public/thumbs')
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}
// доп. параметры и время прогрева на эксперимент (симуляциям нужно время)
const SETUP = {
  'living-surface': { query: 'steps=24', warm: 14000 },
  'gray-scott': { query: 'steps=24', warm: 10000 },
  phototroph: { query: 'steps=24&sunAzimuth=60', warm: 12000 },
  knobs: { query: 'level=hatch&knobA=0.41&knobB=0.9', warm: 2500 },
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const chromePath =
  process.env.CHROME ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => fs.existsSync(p))
if (!chromePath) throw new Error('Chrome not found: set CHROME=/path/to/chrome')

const ids = fs
  .readdirSync(path.join(ROOT, 'src/experiments'))
  .filter((d) => fs.existsSync(path.join(ROOT, 'src/experiments', d, 'index.ts')))
  .filter((d) => !arg('only') || arg('only').split(',').includes(d))

const port = 5290 + Math.floor(Math.random() * 100)
let server = null
let url = arg('url')
if (!url) {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: 'ignore' })
  url = `http://localhost:${port}/`
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break } catch { await sleep(100) }
  }
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gp-thumbs-'))
const cdpPort = 9400 + Math.floor(Math.random() * 100)
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`,
  ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []), '--enable-gpu', '--ignore-gpu-blocklist', 'about:blank',
], { stdio: 'ignore' })

let ws, seq = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) })
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value

try {
  for (let i = 0; i < 100; i++) {
    try { await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); break } catch { await sleep(100) }
  }
  const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.id && pending.has(d.id)) pending.get(d.id)(d.result ?? d), pending.delete(d.id)
  }
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 960, height: 600, deviceScaleFactor: 1, mobile: false })
  fs.mkdirSync(OUT, { recursive: true })
  for (const id of ids) {
    const { query = '', warm = 3000 } = SETUP[id] ?? {}
    await send('Page.navigate', { url: `${url}#${id}${query ? '?' + query : ''}` })
    await sleep(1500)
    await ev(`(document.body.classList.add('gp-hide-ui'), window.__gp && (__gp.loop.scale = 1, __gp.loop.resize()))`)
    await sleep(warm)
    const err = await ev(`(() => { const o = document.querySelector('.gp-overlay'); return o && !o.hidden ? o.innerText : '' })()`)
    if (err) console.warn(`[${id}] shader errors:\n${err}`)
    const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: 960, height: 600, scale: 0.5 } })
    const file = path.join(OUT, `${id}.jpg`)
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'))
    console.log(`${path.relative(ROOT, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`)
  }
} finally {
  ws?.close()
  chrome.kill()
  server?.kill()
  await sleep(500)
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
