import { Pane, type FolderApi } from 'tweakpane'
import { createGL } from './core/gl.ts'
import { onExperimentsUpdate, onShaderUpdate } from './core/hmr.ts'
import { createInput } from './core/input.ts'
import { createLoop } from './core/loop.ts'
import { createOverlay } from './core/overlay.ts'
import { createParams, decodeParams, defaults, encodeParams, type Params } from './core/params.ts'
import { createPipeline, type Pipeline } from './core/pipeline.ts'
import type { Experiment, ExperimentContext, ParamValues } from './core/types.ts'
import { experiments as registry } from './experiments/index.ts'
import './ui/style.css'

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!
const glc = createGL(canvas)
const overlay = createOverlay()
const input = createInput(canvas)
let experiments = registry

interface Current {
  id: string
  exp: Experiment
  params: Params
  pipeline: Pipeline
  folder: FolderApi
}
let cur: Current | null = null
let screenshot = false

// ---------- Цикл ----------
const loop = createLoop(canvas, (l) => {
  if (!cur) return
  cur.pipeline.render(
    {
      time: l.time,
      frame: l.frame,
      width: l.width,
      height: l.height,
      mouse: [input.mouse.x * l.width, input.mouse.y * l.height, input.mouse.down ? 1 : 0, 0],
      camPos: input.camera.pos,
      camTarget: input.camera.target,
    },
    cur.params.uniforms(),
    ctx,
  )
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
})
input.onChange = () => loop.paused && loop.requestRedraw()

const ctx: ExperimentContext = {
  get params() {
    return cur?.params.values ?? {}
  },
  set(v) {
    cur?.params.set(v)
    paramsChanged()
  },
  reset,
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
const pane = new Pane({ title: 'playground', expanded: !coarse })
const general = pane.addFolder({ title: 'general', expanded: false })
general.addBinding(loop, 'scale', { label: 'render scale', min: 0.25, max: 1, step: 0.05 }).on('change', () => loop.resize())
general.addBinding(loop, 'paused', { label: 'pause [space]' })
general.addBinding(loop, 'fps', { readonly: true, format: (v: number) => v.toFixed(0), interval: 500 })
general.addButton({ title: 'reset [R]' }).on('click', reset)
general.addButton({ title: 'screenshot [S]' }).on('click', takeScreenshot)

function takeScreenshot() {
  screenshot = true
  loop.requestRedraw()
}

// ---------- URL ----------
function parseHash() {
  const h = location.hash.slice(1)
  const i = h.indexOf('?')
  return { id: decodeURIComponent(i < 0 ? h : h.slice(0, i)), query: i < 0 ? '' : h.slice(i + 1) }
}

let hashTimer = 0
function writeHash() {
  clearTimeout(hashTimer)
  hashTimer = window.setTimeout(() => {
    if (!cur) return
    const q = encodeParams(cur.exp.params ?? {}, cur.params.values)
    history.replaceState(null, '', `#${cur.id}${q ? '?' + q : ''}`)
  }, 250)
}

function paramsChanged() {
  writeHash()
  loop.requestRedraw()
}

// ---------- Загрузка эксперимента ----------
// keepState: HMR index.ts — сохраняем время/кадр/камеру (и значения параметров через values).
function load(id: string, values: ParamValues, keepState = false) {
  if (!experiments[id]) id = Object.keys(experiments)[0]
  const exp = experiments[id]
  if (!exp) throw new Error('no experiments in src/experiments')

  cur?.pipeline.dispose()
  cur?.folder.dispose()

  const params = createParams(exp.params ?? {}, values)
  const pipeline = createPipeline(glc, exp, overlay)
  const folder = pane.addFolder({ title: exp.name, index: 0 })
  cur = { id, exp, params, pipeline, folder }

  const pick = { experiment: id }
  folder
    .addBinding(pick, 'experiment', { options: Object.fromEntries(Object.keys(experiments).map((k) => [experiments[k].name, k])) })
    .on('change', (e) => (location.hash = e.value))
  if (exp.presets) {
    const presets = exp.presets
    const sel = { preset: '' }
    folder
      .addBinding(sel, 'preset', { options: { '—': '', ...Object.fromEntries(Object.keys(presets).map((k) => [k, k])) } })
      .on('change', (e) => e.value && ctx.set({ ...defaults(exp.params ?? {}), ...presets[e.value] }))
  }
  params.bind(folder, () => ctx, paramsChanged)

  input.setCamera(exp.camera, keepState)
  if (!keepState) {
    if (exp.renderScale) (loop.scale = exp.renderScale), loop.resize()
    reset()
  }
  pane.refresh()
  loop.requestRedraw()
  document.title = `${exp.name} · playground`
}

function fromHash() {
  const { id, query } = parseHash()
  if (cur && id === cur.id) {
    cur.params.set({ ...defaults(cur.exp.params ?? {}), ...decodeParams(cur.exp.params ?? {}, query) })
    loop.requestRedraw()
    return
  }
  const exp = experiments[id]
  load(id, exp ? decodeParams(exp.params ?? {}, query) : {})
  if (cur && cur.id !== id) writeHash()
}
addEventListener('hashchange', fromHash)
fromHash()

// ---------- HMR ----------
onShaderUpdate((s) => {
  if (cur?.pipeline.onShaderUpdate(s.id)) loop.requestRedraw()
})
onExperimentsUpdate((next) => {
  experiments = next
  if (cur) load(cur.id, cur.params.values, true)
})

// ---------- Клавиши ----------
addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement
  if (e.ctrlKey || e.metaKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
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
    case 'KeyH':
      document.body.classList.toggle('gp-hide-ui')
      break
    default:
      return
  }
  e.preventDefault()
})
