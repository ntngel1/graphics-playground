import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext, type ParamValue } from '../../core/types.ts'
import { createRetro, retroK } from '../../retro/retro.ts'
import {
  camPos, crumbs, frames, itemLocal, itemRef, ITEMS, needsProbe, newGame, nextTask, offPath, rootScale, startHome, step,
  sunDir, warmth, warmthText, type Game, type Probe,
} from './game.ts'
import probe from './probe.frag'
import scene from './scene.frag'
import { UI_CSS } from './ui.ts'

// «Бесконечный зум»: игра-поиск вглубь масштаба. Луг → камень → мох с деревней → домик → камень на столе → …
// Мир — дерево вложенных уровней (world.ts / world.glsl), камера всегда в координатах текущего узла
// и перебазируется при входе/выходе (game.ts). Зонд probe.frag говорит, что под курсором и насколько это мелко.

const retro = createRetro()
const { ps1Jitter: _j, ps1Facets: _f, ps1Affine: _a, ps1Fog: _g, ...retroParams } = retro.params
retroParams.look = { ...retroParams.look, value: 'ps1' } as typeof retroParams.look

const st = hmrState('zoom', {
  g: null as Game | null,
  frame: -1,
  probeFrame: -1,
  probe: null as Probe | null,
  hints: false,
  sync: (_g: Game) => {},
})
const game = () => (st.g ??= newGame(1))

const sceneRes = (ctx: ExperimentContext): [number, number] => {
  const c = document.querySelector<HTMLCanvasElement>('#gl')
  const k = retroK(ctx.params)
  return c ? [Math.ceil(c.width / k), Math.ceil(c.height / k)] : [960, 600]
}

function worldUniforms(g: Game): Record<string, ParamValue> {
  const fr = frames(g)
  const I: number[] = [], A: number[] = [], B: number[] = []
  for (let f = 0; f < 3; f++) {
    const x = fr[f] ?? fr[0]
    I.push(x.type, x.seed | 0, x.skip, 0)
    A.push(...x.xf.C, x.xf.S)
    B.push(Math.cos(x.xf.A), Math.sin(x.xf.A), x.xf.A, 0)
  }
  const ir = itemRef(g, fr), il = itemLocal(g)
  return {
    uFrI: I, uFrA: A, uFrB: B, uFrames: fr.length,
    uEye: camPos(g.cam), uTarget: g.cam.T, uViewD: g.cam.d, uNear: 0.1 * g.cam.d,
    uItemI: [ir.frame, ir.path, ir.depth, g.task.kind], uItemP: [...il.pos, il.yaw], uItemS: il.size,
  }
}

function probeUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  const g = game()
  st.probeFrame = ctx.frame
  return { ...worldUniforms(g), uCursor: g.cursor, uSceneRes: sceneRes(ctx) }
}

function readProbe(ctx: ExperimentContext): Probe | null {
  if (st.probeFrame !== ctx.frame) return null
  const d = ctx.read('probe')
  if (!d) return null
  return {
    hit: d[3] >= 0, H: [d[0], d[1], d[2]], t: d[3],
    sc: d[4], frame: d[5], path: d[6], depth: d[7], mat: d[8], type: d[9], sc1: d[10], centerT: d[12],
  }
}

function sceneUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  const g = game()
  retro.syncScale(ctx, 0.6)
  if (ctx.frame === 0 && st.frame > 0) resetView(g)
  st.frame = ctx.frame
  g.res = sceneRes(ctx)
  st.hints = !!ctx.params.hints
  st.probe = readProbe(ctx)
  step(g, st.probe, Math.min(ctx.dt, 1 / 20))
  st.sync(g)
  const glow = g.task.found ? Math.max(0, 1 - (g.t - g.foundAt) / 3) : 0
  return { ...worldUniforms(g), uSun: sunDir(g), uGlow: glow }
}

function resetView(g: Game) {
  const fresh = newGame(g.seed)
  Object.assign(g, { path: fresh.path, node: fresh.node, cam: fresh.cam, zoomAcc: 0, spring: null, grab: null, auto: null })
}

export default defineExperiment({
  name: 'Infinite zoom',
  order: -35,
  description: 'Игра-поиск вглубь масштаба: луг → камень → мох с деревней → домик → камень на столе → … и так без конца. Колесо/щипок — к точке, двойной клик — подлететь. Найди варежку, ключ, кота.',
  paneCollapsed: true,
  renderScale: 0.6,
  params: {
    seed: { value: 1, min: 1, max: 9999, step: 1, uniform: false, onChange: (ctx) => {
      st.g = newGame(ctx.params.seed as number)
    } },
    hints: { label: 'warmer/colder', value: false, uniform: false },
    ...retroParams,
  },
  buffers: { probe: { size: [4, 1], format: 'rgba32f', filter: 'nearest' }, ...retro.buffers },
  passes: [
    { name: 'probe', frag: probe, target: 'probe', enabled: () => !!st.g && needsProbe(st.g), uniforms: probeUniforms },
    ...retro.wrap({ name: 'scene', frag: scene, uniforms: sceneUniforms }),
  ],

  mount(root, ctx) {
    if (st.g?.seed !== ctx.params.seed) st.g = newGame(ctx.params.seed as number)
    const style = document.createElement('style')
    style.textContent = UI_CSS
    document.head.append(style)
    root.classList.add('zm-ui')
    const coarse = matchMedia('(pointer: coarse)').matches
    root.innerHTML = `
<div class="zm-card"><small>Найди</small><b class="zm-what"></b><i class="zm-sw"></i></div>
<div class="zm-crumbs"></div>
<div class="zm-side"><button class="zm-home" title="к лугу">↑ наверх</button><button class="zm-hint">подсказка</button></div>
<div class="zm-warm" hidden><span class="zm-bar"><i></i></span><span class="zm-wt"></span></div>
<div class="zm-bump">глубже нельзя</div>
<div class="zm-help">${coarse
      ? 'щипок — зум к точке · палец — сдвиг · два пальца — поворот · двойной тап — подлететь · тап по предмету — нашёл'
      : 'колесо — зум к курсору · тащи — сдвиг · правая кнопка / Shift — поворот · двойной клик — подлететь · клик по предмету — нашёл'}</div>
<div class="zm-found" hidden><div><b></b><span class="zm-ft"></span><button>Дальше</button></div></div>
`
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    const cv = document.querySelector<HTMLCanvasElement>('#gl')!
    let last = ''
    st.sync = (g) => {
      const it = ITEMS[g.task.kind]
      const w = warmth(g)
      const key = [g.task.kind, g.task.found, g.done, g.path.join(','), st.hints, w.toFixed(2)].join('|')
      const bump = g.t - g.bump < 0.5
      $('.zm-bump').classList.toggle('on', bump)
      if (bump) $('.zm-bump').style.transform = `translate(${g.cursor[0] * innerWidth}px, ${(1 - g.cursor[1]) * innerHeight}px)`
      const mag = 24 / (g.cam.d * rootScale(g))
      $('.zm-crumbs').dataset.mag = mag < 10 ? mag.toFixed(1) : Math.round(mag).toLocaleString('ru-RU')
      if (key === last) return
      last = key
      $('.zm-what').textContent = it.name
      $('.zm-sw').style.background = it.color
      $('.zm-card').dataset.done = String(g.done)
      $('.zm-crumbs').innerHTML = crumbs(g).map((c) => `<span>${c}</span>`).join('<i>›</i>')
      $('.zm-warm').hidden = !st.hints || g.task.found
      $('.zm-hint').classList.toggle('on', st.hints)
      $<HTMLElement>('.zm-bar i').style.width = `${Math.round(w * 100)}%`
      $<HTMLElement>('.zm-bar i').style.background = `hsl(${220 - 210 * w} 80% 55%)`
      $('.zm-wt').textContent = warmthText(w, offPath(g))
      const f = $('.zm-found')
      if (g.task.found && f.hidden) {
        f.hidden = false
        $('.zm-found b').textContent = it.found
        $('.zm-ft').textContent = `${it.title} — на глубине ${g.task.path.length}. Найдено: ${g.done}`
        celebrate(it.color)
      }
      if (!g.task.found) f.hidden = true
    }
    $('.zm-found button').addEventListener('click', () => {
      if (st.g) nextTask(st.g)
      ctx.set({}) // перерисовать на паузе
    })
    $('.zm-home').addEventListener('click', () => st.g && startHome(st.g))
    $('.zm-hint').addEventListener('click', () => ctx.set({ hints: !ctx.params.hints }))

    // праздник: конфетти и звон
    let actx: AudioContext | null = null
    const celebrate = (color: string) => {
      for (let i = 0; i < 46; i++) {
        const c = document.createElement('i')
        c.className = 'zm-conf'
        c.style.left = `${50 + (Math.random() - 0.5) * 30}vw`
        c.style.background = i % 3 ? color : ['#fff4c2', '#7fd1ff', '#ff8fb1'][i % 3 === 0 ? (i / 3) % 3 : 0]
        c.style.setProperty('--dx', `${(Math.random() - 0.5) * 70}vw`)
        c.style.setProperty('--dy', `${30 + Math.random() * 60}vh`)
        c.style.setProperty('--r', `${(Math.random() - 0.5) * 1440}deg`)
        c.style.animationDelay = `${Math.random() * 0.25}s`
        root.append(c)
        setTimeout(() => c.remove(), 2600)
      }
      try {
        actx ??= new AudioContext()
        const t0 = actx.currentTime
        ;[523.25, 659.25, 783.99, 1046.5].forEach((fq, i) => {
          const o = actx!.createOscillator(), gn = actx!.createGain()
          o.frequency.value = fq
          gn.gain.setValueAtTime(0, t0 + i * 0.09)
          gn.gain.linearRampToValueAtTime(0.12, t0 + i * 0.09 + 0.02)
          gn.gain.exponentialRampToValueAtTime(0.001, t0 + i * 0.09 + 0.6)
          o.connect(gn).connect(actx!.destination)
          o.start(t0 + i * 0.09)
          o.stop(t0 + i * 0.09 + 0.65)
        })
      } catch { /* без звука */ }
    }

    // ---------- ввод ----------
    const pts = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>()
    let mode: 'pan' | 'orbit' | 'pinch' | null = null
    let pinch = { d: 0, a: 0 }
    let lastTap = { t: 0, x: 0, y: 0 }
    const uvOf = (x: number, y: number): [number, number] => {
      const r = cv.getBoundingClientRect()
      return [(x - r.left) / r.width, 1 - (y - r.top) / r.height]
    }
    const two = () => {
      const [a, b] = [...pts.values()]
      return { mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    const down = (e: PointerEvent) => {
      const g = game()
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() })
      g.cursor = uvOf(e.clientX, e.clientY)
      g.auto = null
      if (pts.size === 1) {
        mode = e.button === 2 || e.shiftKey ? 'orbit' : 'pan'
        if (mode === 'pan') g.grab = { G: null }
        else g.pending.orbit = true
      } else if (pts.size === 2) {
        const t = two()
        mode = 'pinch'
        pinch = { d: t.d, a: t.a }
        g.cursor = uvOf(t.mx, t.my)
        g.grab = { G: null }
      }
    }
    const move = (e: PointerEvent) => {
      const g = game()
      const p = pts.get(e.pointerId)
      if (!p) {
        if (e.pointerType === 'mouse') g.cursor = uvOf(e.clientX, e.clientY)
        return
      }
      const dx = e.clientX - p.x, dy = e.clientY - p.y
      p.x = e.clientX
      p.y = e.clientY
      if (mode === 'pan') g.cursor = uvOf(e.clientX, e.clientY)
      else if (mode === 'orbit') {
        g.orbit[0] += dx * 0.007
        g.orbit[1] += dy * 0.005
      } else if (mode === 'pinch' && pts.size === 2) {
        const t = two()
        g.cursor = uvOf(t.mx, t.my)
        if (pinch.d > 0 && t.d > 0) g.zoomAcc += Math.log(pinch.d / t.d) * 1.4
        let da = t.a - pinch.a
        if (da > Math.PI) da -= 2 * Math.PI
        if (da < -Math.PI) da += 2 * Math.PI
        g.orbit[0] -= da
        pinch = { d: t.d, a: t.a }
      }
    }
    const up = (e: PointerEvent) => {
      const g = game()
      const p = pts.get(e.pointerId)
      pts.delete(e.pointerId)
      if (p && pts.size === 0 && mode !== 'pinch') {
        const tap = Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 7 && performance.now() - p.t0 < 350
        if (tap) {
          g.cursor = uvOf(e.clientX, e.clientY)
          const now = performance.now()
          const dbl = e.pointerType !== 'mouse' && now - lastTap.t < 330 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30
          if (dbl) g.pending.dbl = true
          else g.pending.click = true
          lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY }
        }
      }
      if (pts.size === 0) (mode = null), (g.grab = null)
      else if (pts.size === 1) {
        // из щипка в одиночный палец: продолжаем сдвиг от новой точки
        const [q] = [...pts.values()]
        mode = 'pan'
        g.cursor = uvOf(q.x, q.y)
        g.grab = { G: null }
      }
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const g = game()
      g.cursor = uvOf(e.clientX, e.clientY)
      g.zoomAcc += e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)
      g.auto = null
    }
    const dbl = (e: MouseEvent) => {
      const g = game()
      g.cursor = uvOf(e.clientX, e.clientY)
      g.pending = { dbl: true }
    }
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const g = game()
      const fw: [number, number] = [-Math.sin(g.cam.yaw), -Math.cos(g.cam.yaw)]
      const k = g.cam.d * 0.08
      const pan = (a: number, b: number) => (g.cam.T = [g.cam.T[0] + (fw[0] * a - fw[1] * b) * k, g.cam.T[1], g.cam.T[2] + (fw[1] * a + fw[0] * b) * k])
      if (e.code === 'ArrowUp') pan(1, 0)
      else if (e.code === 'ArrowDown') pan(-1, 0)
      else if (e.code === 'ArrowLeft') pan(0, -1)
      else if (e.code === 'ArrowRight') pan(0, 1)
      else if (e.code === 'KeyQ') g.orbit[0] -= 0.12
      else if (e.code === 'KeyE') g.orbit[0] += 0.12
      else if (e.code === 'Equal' || e.code === 'Minus') {
        g.cursor = [0.5, 0.5]
        g.zoomAcc += e.code === 'Equal' ? -0.35 : 0.35
      } else return
      e.preventDefault()
    }
    const handlers: [EventTarget, string, EventListener][] = [
      [cv, 'pointerdown', down as EventListener], [cv, 'pointermove', move as EventListener],
      [cv, 'pointerup', up as EventListener], [cv, 'pointercancel', up as EventListener],
      [cv, 'wheel', wheel as EventListener], [cv, 'dblclick', dbl as EventListener], [window, 'keydown', key as EventListener],
    ]
    for (const [t, n, f] of handlers) t.addEventListener(n, f, { passive: false })
    return () => {
      for (const [t, n, f] of handlers) t.removeEventListener(n, f)
      style.remove()
      st.sync = () => {}
      actx?.close()
    }
  },
})
