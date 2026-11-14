import { Pane, type FolderApi } from 'tweakpane'
import { createGL } from './core/gl.ts'
import { onExperimentsUpdate, onShaderUpdate } from './core/hmr.ts'
import { createInput } from './core/input.ts'
import { createLoop, type Loop } from './core/loop.ts'
import { createOverlay } from './core/overlay.ts'
import { createParams, decodeParams, defaults, encodeParams, type Params } from './core/params.ts'
import { createPipeline, type Pipeline } from './core/pipeline.ts'
import type { Experiment, ExperimentContext, ParamValues } from './core/types.ts'
import { experiments as registry } from './experiments/index.ts'
import { createGallery } from './ui/gallery.ts'
import './ui/style.css'

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
const glc = createGL(canvas)
const overlay = createOverlay()
const gallery = createGallery()
const input = createInput(canvas)
let experiments = registry

interface Current {
  ui: { root: HTMLElement; dispose?: () => void } | null
  id: string
  exp: Experiment
  params: Params
  pipeline: Pipeline
  folder: FolderApi
}
let cur: Current | null = null
let screenshot = false
let mousePrev: [number, number, number, number] = [0, 0, 0, 0]

// ---------- Цикл ----------
const loop = createLoop(canvas, (l, advance) => frame(l, advance))
function frame(l: Loop, advance: boolean) {
  if (!cur) return
  const m = input.mouse
  const mouse: [number, number, number, number] = [m.x * l.width, m.y * l.height, m.down ? 1 : 0, m.alt ? 1 : 0]
  // в первый кадр нажатия отрезок кисти начинается из точки нажатия (а не из прошлого положения;
  // и не теряется, если до кадра успело прийти несколько pointermove)
  if (mouse[2] && !mousePrev[2]) mousePrev = [m.px * l.width, m.py * l.height, 0, mousePrev[3]]
  cur.pipeline.render(
    {
      time: l.time,
      frame: l.frame,
      width: l.width,
      height: l.height,
      mouse,
      mousePrev,
      camPos: input.camera.pos,
      camTarget: input.camera.target,
    },
    cur.params.uniforms(),
    ctx,
    advance,
  )
  mousePrev = mouse
  if (screenshot) {
    screenshot = false
    // toBlob в том же таске, что и отрисовка, — буфер ещё не очищен (preserveDrawingBuffer не нужен)
    canvas.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = `${cur?.id ?? 'shot'}-${l.frame}.png`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    })
  }
}
input.onChange = () => loop.paused && loop.requestRedraw()
input.onPointer = (phase) =>
  cur?.exp.onPointer?.({ uv: [input.mouse.x, input.mouse.y], phase, shift: input.mouse.alt, size: [canvas.clientWidth, canvas.clientHeight] }, ctx)

const ctx: ExperimentContext = {
  get params() {
    return cur?.params.values ?? {}
  },
  set(v) {
    cur?.params.set(v)
    paramsChanged()
  },
  reset,
  reinit(uniforms) {
    cur?.pipeline.reset(uniforms)
    loop.requestRedraw()
  },
  get dt() {
    return loop.dt
  },
  get dragMode() {
    return input.dragMode
  },
  set dragMode(v) {
    setDragMode(v)
  },
  get camera() {
    return input.camera
  },
  read(name) {
    const b = cur?.pipeline.buffer(name)
    if (!b || b.format === 'rgba8') return null
    const { gl } = glc
    const px = new Float32Array(b.width * b.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.read.fb)
    gl.readPixels(0, 0, b.width, b.height, gl.RGBA, gl.FLOAT, px)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return px
  },
  get renderScale() {
    return loop.scale
  },
  set renderScale(v) {
    loop.scale = Math.min(1, Math.max(0.25, v))
    loop.resize()
    pane.refresh()
  },
  get time() {
    return loop.time
  },
  get frame() {
    return loop.frame
  },
}

function reset() {
  loop.reset()
  cur?.pipeline.reset()
}

// ---------- Панель ----------
const coarse = matchMedia('(pointer: coarse)').matches
// на телефоне и узком экране панель свёрнута; высота ограничена в CSS (прокрутка)
const pane = new Pane({ title: 'playground', expanded: !coarse && innerWidth > 640 })
const general = pane.addFolder({ title: 'general', expanded: false })
general.addButton({ title: 'gallery [G]' }).on('click', () => (location.hash = ''))
general.addButton({ title: 'copy link' }).on('click', copyLink)
general.addBinding(loop, 'scale', { label: 'render scale', min: 0.25, max: 1, step: 0.05 }).on('change', () => loop.resize())
general.addBinding(loop, 'paused', { label: 'pause [space]' })
general.addBinding(loop, 'fps', { readonly: true, format: (v: number) => v.toFixed(0), interval: 500 })
general.addButton({ title: 'reset [R]' }).on('click', reset)
general.addButton({ title: 'screenshot [S]' }).on('click', takeScreenshot)

// ссылка с текущими параметрами (hash пишется с дебаунсом — сначала досбрасываем)
async function copyLink() {
  flushHash()
  try {
    await navigator.clipboard.writeText(location.href)
  } catch {
    // нет Clipboard API / фокуса — старый способ через выделение текста
    const ta = document.createElement('textarea')
    ta.value = location.href
    document.body.append(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (!ok) return overlay.notice(`copy failed: ${location.href}`, 8000)
  }
  overlay.notice('link copied', 1500)
}

// строка-подсказка в углу (прячется вместе с UI по H); на тач-устройствах — только «галерея»
const hints = document.createElement('div')
hints.className = 'gp-hints'
document.body.append(hints)
const renderHints = (exp: Experiment) => {
  const d = exp.camera ? ` · D ${dragModes().join('/')}` : ''
  hints.innerHTML = `<a href="#">← gallery</a>${coarse ? '' : `<span> · space pause · S shot · R reset · H hide UI · G gallery${d}</span>`}`
}

function takeScreenshot() {
  screenshot = true
  loop.requestRedraw()
}

// Режим перетаскивания в экспериментах с камерой: вращение, кисть или свои режимы эксперимента.
const inputMode = {
  get mode() {
    return input.dragMode
  },
  set mode(v: string) {
    setDragMode(v)
  },
}
const dragModes = () => cur?.exp.dragModes ?? ['camera', 'brush']
function setDragMode(v: string) {
  if (input.dragMode === v) return
  input.dragMode = v
  pane.refresh()
  dispatchEvent(new CustomEvent('gp-dragmode', { detail: v }))
}

// ---------- URL ----------
function parseHash() {
  const h = location.hash.slice(1)
  const i = h.indexOf('?')
  return { id: decodeURIComponent(i < 0 ? h : h.slice(0, i)), query: i < 0 ? '' : h.slice(i + 1) }
}

let hashTimer = 0
function flushHash() {
  clearTimeout(hashTimer)
  if (!cur) return
  const q = encodeParams(cur.exp.params ?? {}, cur.params.values)
  history.replaceState(null, '', `#${cur.id}${q ? '?' + q : ''}`)
}
function writeHash() {
  clearTimeout(hashTimer)
  hashTimer = window.setTimeout(flushHash, 250)
}

function paramsChanged() {
  writeHash()
  loop.requestRedraw()
}

// ---------- Загрузка эксперимента ----------
// keepState: HMR index.ts — сохраняем время/кадр/камеру (и значения параметров через values).
function load(id: string, values: ParamValues, keepState = false) {
  const exp = experiments[id]
  gallery.hide()

  // HMR index.ts: буферы с той же раскладкой переезжают в новый пайплайн вместе с содержимым
  const kept = keepState ? cur?.pipeline.detachBuffers(exp.buffers) : undefined
  unload()

  const params = createParams(exp.params ?? {}, values)
  const pipeline = createPipeline(glc, exp, overlay, kept)
  const folder = pane.addFolder({ title: exp.name, index: 0 })
  cur = { id, exp, params, pipeline, folder, ui: null }

  const pick = { experiment: id }
  folder
    .addBinding(pick, 'experiment', { options: Object.fromEntries(Object.keys(experiments).map((k) => [experiments[k].name, k])) })
    .on('change', (e) => (location.hash = e.value))
  if (exp.presets) {
    const presets = exp.presets
    const sel = { preset: '' }
    folder
      .addBinding(sel, 'preset', { options: { '—': '', ...Object.fromEntries(Object.keys(presets).map((k) => [k, k])) } })
      .on('change', (e) => {
        if (!e.value) return
        ctx.set({ ...defaults(exp.params ?? {}), ...presets[e.value] })
        exp.onPreset?.(e.value, ctx)
      })
  }
  if (exp.camera) {
    if (!keepState || !dragModes().includes(input.dragMode)) input.dragMode = 'camera'
    folder.addBinding(inputMode, 'mode', { label: 'drag [D]', options: Object.fromEntries(dragModes().map((m) => [m, m])) })
  }
  params.bind(folder, () => ctx, paramsChanged)

  if (exp.mount) {
    const root = document.createElement('div')
    root.className = 'gp-exp-ui'
    document.body.append(root)
    cur.ui = { root, dispose: exp.mount(root, ctx) ?? undefined }
  }

  input.setCamera(exp.camera, keepState)
  if (!keepState) {
    loop.scale = exp.renderScale ?? 1 // масштаб — свойство эксперимента (тяжёлым — меньше)
    if (exp.paneCollapsed) pane.expanded = false
    loop.resize()
    reset()
  }
  pane.refresh()
  loop.requestRedraw()
  renderHints(exp)
  document.title = `${exp.name} · playground`
}

// Галерея: ресурсы эксперимента освобождаются, кадры не рисуются (frame() выходит сразу).
function unload() {
  cur?.pipeline.dispose()
  cur?.folder.dispose()
  cur?.ui?.dispose?.()
  cur?.ui?.root.remove()
  cur = null
}

function fromHash() {
  const { id, query } = parseHash()
  if (!experiments[id]) {
    unload()
    if (id) history.replaceState(null, '', location.pathname + location.search) // неизвестный id → чистый URL
    gallery.show(experiments)
    return
  }
  if (cur && id === cur.id) {
    cur.params.set({ ...defaults(cur.exp.params ?? {}), ...decodeParams(cur.exp.params ?? {}, query) })
    loop.requestRedraw()
    return
  }
  load(id, decodeParams(experiments[id].params ?? {}, query))
}
addEventListener('hashchange', fromHash)
fromHash()

// ---------- HMR ----------
onShaderUpdate((s) => {
  if (cur?.pipeline.onShaderUpdate(s.id)) loop.requestRedraw()
})
onExperimentsUpdate((next) => {
  experiments = next
  if (cur && experiments[cur.id]) load(cur.id, cur.params.values, true)
  else if (gallery.visible || cur) fromHash()
})

// Отладочный доступ из консоли / e2e (только dev)
if (import.meta.env.DEV) {
  // bench(n): n синхронных кадров (с ожиданием GPU через readPixels) → мс на кадр
  const bench = (n: number) => {
    const { gl } = glc
    const px = new Uint8Array(4)
    frame(loop, true)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const t0 = performance.now()
    for (let i = 0; i < n; i++) {
      frame(loop, true)
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px)
    }
    return (performance.now() - t0) / n
  }
  // step(n): n кадров синхронно с фиксированным dt = 1/60 (детерминированные прогоны; ставьте loop.paused = true)
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      loop.dt = 1 / 60
      frame(loop, true)
      loop.time += 1 / 60
      loop.frame++
    }
  }
  Object.assign(window, { __gp: { glc, loop, ctx, input, bench, step, get cur() { return cur } } })
}

// ---------- Клавиши ----------
addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement
  if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
  if (cur?.exp.ownKeys?.includes(e.code)) return
  switch (e.code) {
    case 'Space':
      loop.paused = !loop.paused
      pane.refresh()
      break
    case 'KeyS':
      takeScreenshot()
      break
    case 'KeyR':
      reset()
      break
    case 'KeyD':
      if (!cur?.exp.camera) return
      setDragMode(dragModes()[(dragModes().indexOf(input.dragMode) + 1) % dragModes().length])
      break
    case 'KeyG':
      location.hash = ''
      break
    case 'KeyH':
      document.body.classList.toggle('gp-hide-ui')
      break
    default:
      return
  }
  e.preventDefault()
})
