import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext, type PointerInfo } from '../../core/types.ts'
import { createGrayScott, PALETTES } from '../gray-scott/sim.ts'
import pick from '../living-surface/pick.frag'
import light from './light.frag'
import render from './render.frag'

// Колония Грея-Скотта на поверхности питается светом: карта света (буфер 'light', uv поверхности) считается
// реймарчингом к солнцу по той же сцене — с рельефом накопленной биомассы и заслонками. Выросшее
// затеняет соседей; солнце и заслонки двигает пользователь (или день/ночь и орбита «луны»).
const gs = createGrayScott({ size: [640, 256], pick: 'pick', light: 'light', mapMode: false })

type V3 = [number, number, number]
const SHAPES = ['torus', 'plane', 'sphere'] as const
const MODES = ['camera', 'sun', 'shade', 'brush']

// состояние вне параметров (переживает HMR): фаза дня, фаза луны, позиции заслонок, перетаскивание
const st = hmrState('phototroph', {
  day: 0,
  moon: 0,
  frame: -1,
  shades: [[0.0, 0.95, 0.0], [-0.8, 0.9, 0.5], [0.6, 0.9, -0.7]] as V3[],
  drag: -1,
  last: [0, 0] as [number, number],
})

const R = (d: number) => (d * Math.PI) / 180
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a: V3): V3 => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

const shapeOf = (p: Record<string, unknown>) => SHAPES.indexOf(p.shape as (typeof SHAPES)[number])

function sunDir(p: Record<string, unknown>): V3 {
  const az = R((p.sunAzimuth as number) + st.day), el = R(p.sunHeight as number)
  return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)]
}

// базовая форма (как baseSdf в surface.glsl) — для CPU-марша при перетаскивании заслонки
function baseSdf(shape: number, q: V3) {
  if (shape === 0) return Math.hypot(Math.hypot(q[0], q[2]) - 1, q[1]) - 0.4
  if (shape === 1) return q[1]
  return Math.hypot(...q) - 1
}

// камера как cameraRay в camera.glsl (fov 40° по меньшей стороне)
function basis(ctx: ExperimentContext) {
  const ro = ctx.camera.pos, w = norm(sub(ctx.camera.target, ro))
  const u = norm(cross(w, [0, 1, 0])), v = cross(u, w)
  return { ro, u, v, w, f: 1 / Math.tan(R(20)) }
}
function screenRay(e: PointerInfo, ctx: ExperimentContext) {
  const { ro, u, v, w, f } = basis(ctx)
  const [W, H] = e.size, s = Math.min(W, H)
  const px = (2 * e.uv[0] * W - W) / s, py = (2 * e.uv[1] * H - H) / s
  return { ro, rd: norm(add(add(add([0, 0, 0], u, px), v, py), w, f)) }
}
function project(c: V3, e: PointerInfo, ctx: ExperimentContext): [number, number] | null {
  const { ro, u, v, w, f } = basis(ctx)
  const d = sub(c, ro), z = dot(d, w)
  if (z <= 0) return null
  const [W, H] = e.size, s = Math.min(W, H)
  return [((dot(d, u) / z) * f * s + W) / 2 / W, ((dot(d, v) / z) * f * s + H) / 2 / H]
}

function onPointer(e: PointerInfo, ctx: ExperimentContext) {
  const mode = ctx.dragMode
  if (e.phase === 'up') return void (st.drag = -1)
  if (mode === 'sun') {
    // перетаскивание: по горизонтали — азимут (солнце идёт за пальцем), по вертикали — высота
    if (e.phase === 'down') return void (st.last = e.uv)
    const dx = e.uv[0] - st.last[0], dy = e.uv[1] - st.last[1]
    st.last = e.uv
    const az = (ctx.params.sunAzimuth as number) - dx * 240
    const el = Math.max(2, Math.min(89, (ctx.params.sunHeight as number) + dy * 120))
    ctx.set({ sunAzimuth: +(((az % 360) + 360) % 360).toFixed(1), sunHeight: +el.toFixed(1) })
  } else if (mode === 'shade') {
    const n = ctx.params.shades as number
    if (!n) return
    if (e.phase === 'down') {
      // ближайшая к курсору заслонка на экране
      let best = 0, bd = Infinity
      for (let i = 0; i < n; i++) {
        const s = project(st.shades[i], e, ctx)
        const d = s ? Math.hypot((s[0] - e.uv[0]) * e.size[0], (s[1] - e.uv[1]) * e.size[1]) : Infinity
        if (d < bd) (bd = d), (best = i)
      }
      st.drag = best
    }
    if (st.drag < 0) return
    // марш луча курсора до «оболочки» над поверхностью (форма, раздутая на высоту парения)
    const { ro, rd } = screenRay(e, ctx)
    const shape = shapeOf(ctx.params), hover = ctx.params.hover as number
    let t = 0
    for (let i = 0; i < 128 && t < 30; i++) {
      const h = baseSdf(shape, add(ro, rd, t)) - hover
      if (h < 1e-3) { st.shades[st.drag] = add(ro, rd, t); break }
      t += h
    }
  }
}

function uniforms(ctx: ExperimentContext) {
  const p = ctx.params
  if (st.frame !== ctx.frame) {
    if (ctx.frame === 0) (st.day = 0), (st.moon = 0)
    st.day = (st.day + ctx.dt * (p.daySpeed as number)) % 360
    st.moon += ctx.dt * (p.moonSpeed as number)
    st.frame = ctx.frame
  }
  const shape = shapeOf(p), n = p.shades as number, r = p.shadeSize as number
  if (p.moonSpeed) {
    // «луна» — заслонка 0 на орбите над формой
    const [rad, y] = shape === 0 ? [1.0, 0.95] : shape === 2 ? [1.75, 0.25] : [1.6, 0.9]
    st.shades[0] = [Math.cos(st.moon) * rad, y, Math.sin(st.moon) * rad]
  }
  const shade: number[] = []
  for (let i = 0; i < 3; i++) shade.push(...st.shades[i], i < n ? r : 0)
  return {
    uShape: shape,
    uLatLong: true,
    uHeightSrc: 1,
    uSpin: 0,
    uShade: shade,
    uSunDir: sunDir(p),
    uPickOff: ctx.dragMode === 'sun' || ctx.dragMode === 'shade',
  }
}

export default defineExperiment({
  name: 'Phototroph',
  order: -1,
  description: 'Организм, который ест свет: колония растёт там, где светло, и умирает в тени — в том числе в собственной. Двигайте солнце и заслонки, колония переползает за светом, оставляя костяной след.',
  camera: { target: [0, -0.1, 0], distance: 3.4, yaw: 0.6, pitch: 0.55, minPitch: 0.06, maxPitch: 1.5, minDistance: 1.3, maxDistance: 12 },
  renderScale: 0.75,
  dragModes: MODES,
  params: {
    shape: { value: 'torus', options: SHAPES, onChange: (ctx) => ctx.reinit() },
    sunAzimuth: { label: 'sun azimuth', value: 120, min: 0, max: 360, step: 0.1, uniform: false, folder: 'light' },
    sunHeight: { label: 'sun height', value: 45, min: 2, max: 89, step: 0.1, uniform: false, folder: 'light' },
    daySpeed: { label: 'day cycle °/s', value: 0, min: -30, max: 30, step: 0.5, uniform: false, folder: 'light' },
    ambient: { value: 0.08, min: 0, max: 0.5, step: 0.01, folder: 'light' },
    selfShadow: { label: 'self-shadow', value: true, folder: 'light' },
    shadowSteps: { label: 'shadow steps', value: 40, min: 8, max: 64, step: 1, folder: 'light' },
    shades: { value: 1, min: 0, max: 3, step: 1, uniform: false, folder: 'shades' },
    shadeSize: { label: 'size', value: 0.22, min: 0.05, max: 0.6, step: 0.01, uniform: false, folder: 'shades' },
    hover: { value: 0.45, min: 0.15, max: 1.5, step: 0.01, uniform: false, folder: 'shades' },
    moonSpeed: { label: 'moon orbit', value: 0, min: -1, max: 1, step: 0.01, uniform: false, folder: 'shades' },
    ...gs.params,
    // полный свет — полосы/«дырки», меньше света — пятна, ещё меньше — смерть (F ∝ свету)
    feed: { ...gs.params.feed, value: 0.04 },
    kill: { ...gs.params.kill, value: 0.058 },
    height: { label: 'max height', value: 0.1, min: 0, max: 0.2, step: 0.005, folder: 'look' },
    palette: { value: 'flesh', options: PALETTES, folder: 'look' },
    glow: { value: 1, min: 0, max: 3, step: 0.01, folder: 'look' },
    minimap: { value: true, folder: 'look' },
    debug: { value: 'final', options: ['final', 'light', 'biomass', 'state'], folder: 'look' },
    maxSteps: { label: 'max steps', value: 140, min: 32, max: 300, step: 1, folder: 'look' },
  },
  buffers: {
    ...gs.buffers,
    light: { format: 'rgba16f', filter: 'linear', wrap: 'repeat', size: (p) => [320 * (p.resolution as number), 128 * (p.resolution as number)] },
    pick: { size: [1, 1], format: 'rgba32f', pingPong: true },
  },
  passes: [
    { name: 'pick', frag: pick, target: 'pick', inputs: { uPickPrev: 'pick', uState: 'state' }, uniforms },
    { name: 'light', frag: light, target: 'light', inputs: { uState: 'state' }, uniforms },
    ...gs.passes,
    { name: 'render', frag: render, inputs: { uState: 'state', uLight: 'light' }, uniforms },
  ],
  onPointer,
  onPreset: (_n, ctx) => ctx.reinit(),
  presets: {
    'day cycle': { shape: 'sphere', sunHeight: 12, sunAzimuth: 80, daySpeed: 8, shades: 0, height: 0.08 },
    eclipse: { shape: 'torus', sunHeight: 70, shades: 1, shadeSize: 0.35, moonSpeed: 0.35 },
    'low sun': { shape: 'torus', sunHeight: 10, sunAzimuth: 90, shades: 0, height: 0.16, feed: 0.05, growth: 0.0006 },
    garden: { shape: 'torus', sunHeight: 50, shades: 2, daySpeed: 0, moonSpeed: 0 },
  },

  // кнопки режимов перетаскивания (для тача; D листает их же)
  mount(root, ctx) {
    root.classList.add('pt-modes')
    root.innerHTML = MODES.map((m) => `<button data-m="${m}">${m}</button>`).join('')
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    const sync = () => buttons.forEach((b) => b.classList.toggle('on', b.dataset.m === ctx.dragMode))
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button')
      if (b) ctx.dragMode = b.dataset.m!
    })
    addEventListener('gp-dragmode', sync)
    sync()
    return () => removeEventListener('gp-dragmode', sync)
  },
})
