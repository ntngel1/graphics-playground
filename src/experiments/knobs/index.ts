import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext } from '../../core/types.ts'
import ball from './ball.frag'
import ballInit from './ballinit.frag'
import { LEVELS, type Level } from './levels.ts'
import render from './render.frag'

// «Пластилиновый мир»: шарик катится сам, игрок крутит параметры мира (SDF) — слияние и скручивание.
// Физика шарика — на GPU в буфере 'ball' по той же map(), что и рендер (см. ball.frag).
// Ручки: ползунок задаёт цель, фактическое значение догоняет её не быстрее KNOB_RATE в секунду, иначе
// геометрия «телепортируется» сквозь шарик. Время игры — в кадрах (1/60 с), физика детерминирована.

export const KNOB_RATE = 0.5 // доля диапазона в секунду

export const STATUS = ['ready', 'rolling', 'won', 'fell'] as const

const st = hmrState('knobs', {
  level: -1,
  frame: -1,
  knobs: [0, 0.5] as [number, number], // фактические значения
  launch: false,
  status: 0,
  winAt: -1,
  fellAt: -1,
  auto: true, // авто-рестарт при падении и проверка статуса (e2e выключает)
  sync: (() => {}) as () => void,
})

const levelOf = (ctx: ExperimentContext) => Math.max(0, LEVELS.findIndex((l) => l.id === ctx.params.level))
const cur = (ctx: ExperimentContext): Level => LEVELS[levelOf(ctx)]

// keepKnobs: уровень пришёл из hash вместе со значениями ручек — берём их (сразу, без догоняния)
function startLevel(ctx: ExperimentContext, i: number, keepKnobs = false) {
  const L = LEVELS[i]
  st.level = i
  const k = keepKnobs ? [ctx.params.knobA as number, ctx.params.knobB as number] : [L.knobs[0].init, L.knobs[1].init]
  st.knobs = [L.knobs[0].locked ? L.knobs[0].init : k[0], L.knobs[1].locked ? L.knobs[1].init : k[1]]
  st.status = 0
  st.winAt = st.fellAt = -1
  st.launch = false
  ctx.set({ level: L.id, knobA: st.knobs[0], knobB: st.knobs[1] })
  ctx.reinit()
  st.sync()
}

// раз в кадр: смена уровня из hash, догоняющие ручки
function tick(ctx: ExperimentContext) {
  if (st.frame === ctx.frame) return
  st.frame = ctx.frame
  const li = levelOf(ctx)
  if (li !== st.level) return startLevel(ctx, li, true)
  const L = LEVELS[li], max = KNOB_RATE / 60
  const target = [ctx.params.knobA as number, ctx.params.knobB as number]
  for (let i = 0; i < 2; i++) {
    if (L.knobs[i].locked) continue
    st.knobs[i] += Math.max(-max, Math.min(max, target[i] - st.knobs[i]))
  }
}

function common(ctx: ExperimentContext) {
  tick(ctx)
  const L = cur(ctx)
  const pulse = st.winAt < 0 ? 0 : Math.max(0, 1 - (ctx.frame - st.winAt) / 90)
  return { uLevel: levelOf(ctx), uKnobs: st.knobs, uGoal: L.goal, uGoalR: L.goalR, uStart: L.start, uWinPulse: pulse }
}

export function launch() {
  st.launch = true
}

export default defineExperiment({
  name: 'Plasticine',
  order: -2,
  description: 'Головоломка: шарик катится сам, а вы крутите сам мир — сращиваете тела и скручиваете пространство, пока не появится путь к маяку.',
  camera: { target: [-0.1, -0.2, 0], distance: 7.2, yaw: 0, pitch: 0.32, minPitch: -0.2, maxPitch: 1.4, minDistance: 3, maxDistance: 12 },
  renderScale: 0.85,
  paneCollapsed: true, // tweakpane — только для отладки
  params: {
    level: { value: 'merge', options: LEVELS.map((l) => l.id), uniform: false },
    knobA: { label: 'knob A (target)', value: 0, min: 0, max: 1, step: 0.001, uniform: false },
    knobB: { label: 'knob B (target)', value: 0.5, min: 0, max: 1, step: 0.001, uniform: false },
    highlight: { label: 'highlight knob parts', value: 1, min: 0, max: 1, step: 0.05 },
  },
  buffers: {
    ball: { size: [8, 1], format: 'rgba32f', pingPong: true, init: ballInit },
  },
  passes: [
    {
      name: 'physics',
      frag: ball,
      target: 'ball',
      inputs: { uBall: 'ball' },
      iterations: 4,
      uniforms: (ctx) => {
        const u = { ...common(ctx), uLaunch: st.launch }
        st.launch = false
        return u
      },
    },
    { name: 'render', frag: render, inputs: { uBall: 'ball' }, uniforms: common },
  ],

  mount(root, ctx) {
    root.classList.add('kn-ui')
    root.innerHTML = `
<div class="kn-top"><b class="kn-title"></b><span class="kn-hint"></span></div>
<div class="kn-win" hidden><b>Пройдено!</b><button class="kn-next">дальше →</button></div>
<div class="kn-bottom">
  <label class="kn-knob kn-a"><span><b></b><i></i></span><input type="range" min="0" max="1" step="0.001"></label>
  <label class="kn-knob kn-b"><span><b></b><i></i></span><input type="range" min="0" max="1" step="0.001"></label>
  <div class="kn-buttons">
    <button class="kn-go" title="пуск [Enter]">▶ пуск</button>
    <button class="kn-reset" title="заново [R]">↺</button>
    <select class="kn-level"></select>
  </div>
</div>`
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    const sliders = [$<HTMLInputElement>('.kn-a input'), $<HTMLInputElement>('.kn-b input')]
    const select = $<HTMLSelectElement>('.kn-level')
    select.innerHTML = LEVELS.map((l, i) => `<option value="${l.id}">${i + 1}. ${l.name}</option>`).join('')

    st.sync = () => {
      const i = levelOf(ctx), L = LEVELS[i]
      $('.kn-title').textContent = `${i + 1}/${LEVELS.length} · ${L.name}`
      $('.kn-hint').textContent = L.hint
      select.value = L.id
      ;(['.kn-a', '.kn-b'] as const).forEach((c, k) => {
        const el = $(c)
        el.hidden = !!L.knobs[k].locked
        el.querySelector('b')!.textContent = L.knobs[k].label
        el.querySelector('i')!.textContent = L.knobs[k].hint
        sliders[k].value = String(ctx.params[k ? 'knobB' : 'knobA'])
      })
      $('.kn-win').hidden = st.status !== 2
      $('.kn-go').toggleAttribute('disabled', st.status !== 0)
    }
    sliders.forEach((s, k) => s.addEventListener('input', () => ctx.set({ [k ? 'knobB' : 'knobA']: +s.value })))
    select.addEventListener('change', () => startLevel(ctx, LEVELS.findIndex((l) => l.id === select.value)))
    $('.kn-go').addEventListener('click', launch)
    $('.kn-reset').addEventListener('click', () => ctx.reset())
    $('.kn-next').addEventListener('click', () => startLevel(ctx, (levelOf(ctx) + 1) % LEVELS.length))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLInputElement && e.target.type !== 'range')) launch()
    }
    addEventListener('keydown', onKey)

    // статус шарика: readPixels 8×1 раз в несколько кадров
    let raf = 0, n = 0
    const poll = () => {
      raf = requestAnimationFrame(poll)
      if (!st.auto || n++ % 4) return
      const px = ctx.read('ball')
      if (!px) return
      const s = Math.round(px[3])
      if (s !== st.status) {
        if (s === 2) st.winAt = ctx.frame
        if (s === 3) st.fellAt = performance.now()
        st.status = s
        st.sync()
      }
      // упал — через 0.7 с заново (ручки остаются: видно, что именно не сработало)
      if (s === 3 && performance.now() - st.fellAt > 700) {
        ctx.reinit()
        st.status = 0
        st.sync()
      }
    }
    poll()
    st.sync()
    return () => {
      cancelAnimationFrame(raf)
      removeEventListener('keydown', onKey)
      st.sync = () => {}
    }
  },
})
