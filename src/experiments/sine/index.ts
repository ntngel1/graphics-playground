import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext, type ParamValue } from '../../core/types.ts'
import { createSound, type Sound } from './audio.ts'
import {
  bot, DT, FREQS, MAX_ENT, MORPH, S, SEG_GAP, TAU, newGame, pack, playerAmp, playerR, setAspect, setFreq, step, voiceOf,
  difficulty, type Ent, type Game, type GameEvent, type Kind,
} from './game.ts'
import frag from './main.frag'

// «Resonance»: игра, где всё — синус. Логика — game.ts (фиксированный шаг 1/60, свой RNG);
// рисует один проход main.frag из алфавита alphabet.glsl; звук — audio.ts (только синус-осцилляторы).
// DOM — только кнопки (частоты, F, звук), экран конца и «рентген» формул (F).

type BotMode = 'off' | 'switch' | 'stay' | 'idle'

const st = hmrState('sine', {
  g: null as Game | null,
  frame: -1,
  acc: 0,
  seed: 0, // 0 — случайный при каждом старте; e2e задаёт свой
  xrayOn: false,
  xray: 0,
  best: 0,
  hintUntil: 0,
  sound: null as Sound | null, // для e2e: sound.stats, sound.ctx.state
  onEvent: ((_e: GameEvent) => {}) as (e: GameEvent) => void,
  sync: () => {},
})

const loadBest = () => {
  try { return +(localStorage.getItem('gp-sine-best') ?? 0) || 0 } catch { return 0 }
}
const saveBest = (v: number) => {
  try { localStorage.setItem('gp-sine-best', String(v)) } catch { /* приватный режим */ }
}

const canvas = () => document.querySelector<HTMLCanvasElement>('#gl')!
const aspectOf = () => {
  const c = canvas()
  return c.clientWidth / Math.max(1, c.clientHeight)
}

export function restart(seed = st.seed || (Date.now() % 1e9)) {
  st.g = newGame(seed, aspectOf())
  st.acc = 0
  st.hintUntil = 7
  st.sync()
}

const KIND_INFO: Record<Kind, { name: string; law: string }> = {
  drift: { name: 'дрейф', law: 'плывёт по синусоиде: смещение = A·sin(k·s)' },
  eight: { name: 'восьмёрка', law: 'x = A·sin(ωt), y = B·sin(2ωt) — фигура Лиссажу' },
  pulsar: { name: 'пульсар', law: 'R = R₀·(0.78 + 0.32·sin ωt): раздут — шипы жгут всех, сжат — съедобен' },
  flicker: { name: 'мерцающий', law: 'n = sin(ωt) > 0 ? n₂ : n₁ — лови момент; в переходе жжётся' },
  snake: { name: 'змейка', law: 'тело бежит по y = A·sin(k·s); голова своей частоты — +5' },
}

// ---------- шаг игры (раз в кадр из uniforms) ----------
function tick(ctx: ExperimentContext) {
  if (st.frame === ctx.frame) return
  if (!st.g || ctx.frame < st.frame || ctx.frame === 0) restart()
  st.frame = ctx.frame
  const g = st.g!
  st.xray += ((st.xrayOn ? 1 : 0) - st.xray) * Math.min(1, ctx.dt * 8)
  if (ctx.dt <= 0) return
  setAspect(g, aspectOf())
  // рентген замедляет время втрое — чтобы успеть прочитать формулы
  st.acc += ctx.dt * (1 - 0.7 * st.xray)
  const mode = ctx.params.autopilot as BotMode
  while (st.acc >= DT - 1e-9) {
    st.acc -= DT
    if (mode !== 'off') bot(g, mode)
    step(g)
    for (const e of g.events) handle(g, e)
    g.events.length = 0
  }
  if (st.hintUntil > 0 && g.t > st.hintUntil) (st.hintUntil = 0), st.sync()
}

function handle(g: Game, e: GameEvent) {
  if (e.type === 'die' && g.score > st.best) (st.best = g.score), saveBest(st.best)
  if (e.type === 'die' || e.type === 'switch' || e.type === 'eat') st.sync()
  st.onEvent(e)
}

// ---------- юниформы ----------
const buf = new Float32Array(MAX_ENT * 16)
const views = [0, 1, 2, 3].map((k) => buf.subarray(k * MAX_ENT * 4, (k + 1) * MAX_ENT * 4))
const trail = new Float32Array(40)
const rip = new Float32Array(32)
const sel = [0, 0, 0, 0]

function uniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  tick(ctx)
  const g = st.g!
  const count = pack(g, buf)
  trail.fill(0)
  g.trail.forEach(([x, y], i) => trail.set([x, y, g.over ? 0 : 1, 0], i * 4))
  rip.fill(-1)
  g.ripples.forEach((r, i) => rip.set([r.x, r.y, g.t - r.t0, r.n], i * 4))
  const cnt = [0, 0, 0, 0, 0]
  for (const e of g.ents) {
    const v = e.dead < 0 ? voiceOf(e) : null
    if (v !== null) cnt[v - 3]++
  }
  const sh = g.shake * g.shake * 0.025
  const arr = (a: Float32Array) => a as unknown as number[]
  return {
    uA: arr(views[0]), uB: arr(views[1]), uC: arr(views[2]), uD: arr(views[3]), uCount: count,
    uTrail: arr(trail), uRip: arr(rip), uT: g.t,
    uShake: [sh * S(g.t * 53), sh * S(g.t * 41 + 1)],
    uXray: st.xray, uOver: g.over ? Math.min(1, (g.t - g.overAt) / 1.2) : 0,
    uScore: g.score, uCombo: Math.min(12, g.p.combo),
    uSel: sel, uCnt0: cnt.slice(0, 4), uCnt1: cnt[4],
    uHud: canvas().width / Math.max(1, canvas().clientWidth),
  }
}

// ---------- «рентген»: строка формулы у каждого существа ----------
const f2 = (v: number) => (Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2)).replace('-', '−')
const wrapPhase = (v: number) => ((v % TAU) + TAU) % TAU
const shapeLine = (R: number, a: number, n: number | string, phi: number, spike = 0) =>
  `r(θ) = ${f2(R)}·(1 + ${f2(a)}·sin(${n}θ + ${f2(wrapPhase(phi))})${spike > 0.005 ? ` + ${f2(spike)}·sin⁴…` : ''})`

function formula(g: Game, e: Ent | null): [string, string] {
  const t = g.t
  if (!e) {
    const p = g.p, k = p.morph < MORPH
    return [
      shapeLine(playerR(p.E), playerAmp(p.E), k ? `${p.nFrom}→${p.n}` : p.n, p.ph * 2),
      `ты · E = ${f2(p.E)} · звук ${110 * p.n} Гц${p.combo ? ` · комбо ×${p.combo}` : ''}`,
    ]
  }
  const tau = t - e.t0, phi = e.ph + e.spin * tau
  switch (e.kind) {
    case 'drift':
    case 'snake': {
      const s = e.v * tau
      return [shapeLine(e.R, e.amp, e.n, phi), `сдвиг = ${f2(e.A)}·sin(${e.k.toFixed(1)}·s + ${f2(wrapPhase(e.ph2))}), s = ${f2(e.v)}t = ${f2(s)}${e.kind === 'snake' ? `, тело: s − j·${SEG_GAP}` : ''}`]
    }
    case 'eight':
      return [shapeLine(e.R, e.amp, e.n, phi), `x = ${f2(Math.abs(e.A))}·sin(${f2(e.w)}t), y = ${f2(e.B)}·sin(${f2(2 * e.w)}t), t = ${tau.toFixed(1)}`]
    case 'pulsar': {
      const s = S(e.w * tau)
      return [shapeLine(e.r, e.amp, e.n, phi, e.spike), `R = ${f2(e.R)}·(0.78 + 0.32·sin(${f2(e.w)}t)) = ${f2(e.r)}${e.spike > 0.02 ? ' · ШИПЫ' : s < 0 ? ' · сжат' : ''}`]
    }
    case 'flicker': {
      const s = S(e.k * tau), v = voiceOf(e)
      return [shapeLine(e.R, e.amp, v ?? `${e.n}|${e.n2}`, phi), `n = sin(${f2(e.k)}t) > 0 ? ${e.n2} : ${e.n}; sin = ${f2(s)}${v === null ? ' · переход!' : ''}`]
    }
  }
}

const hueCss = (n: number) => {
  // как hue() в alphabet.glsl
  let c = [0, 2.0944, 4.1888].map((o) => 0.5 + 0.5 * S((TAU * (n - 3)) / 5 + 1.2 + o))
  const lum = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11
  c = c.map((v) => Math.round(Math.min(1, (v + (0.6 - lum) * 0.45) * 0.9 + 0.1) * 255))
  return `rgb(${c.join(',')})`
}

export default defineExperiment({
  name: 'Resonance',
  order: -10,
  description: 'Игра, где всё — синус: существа, их пути, фон, HUD и звук. Ешь свою частоту, уворачивайся от чужих, меняй частоту — но перетекание делает тебя уязвимым. F — формулы.',
  paneCollapsed: true,
  ownKeys: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyM', 'KeyQ', 'KeyE'],
  params: {
    autopilot: { value: 'off', options: ['off', 'switch', 'stay', 'idle'], uniform: false },
    newGame: { label: 'new game', action: () => restart() },
  },
  passes: [{ name: 'world', frag, uniforms }],

  mount(root) {
    root.classList.add('sn-ui')
    st.best = Math.max(st.best, loadBest())
    root.innerHTML = `
<div class="sn-hint"></div>
<div class="sn-score"></div>
<div class="sn-toast" hidden></div>
<div class="sn-formulas"></div>
<div class="sn-side">
  <button class="sn-x" title="формулы [F]">f(θ)</button>
  <button class="sn-mute" title="звук [M]">♪</button>
</div>
<div class="sn-sel">${FREQS.map((n, i) => `<button data-n="${n}" title="частота ${n} [${i + 1}]" aria-label="частота ${n}"></button>`).join('')}</div>
<div class="sn-over" hidden><div><b class="sn-final"></b><span class="sn-best"></span><button class="sn-again">ещё раз</button><i>Enter / тап</i></div></div>`
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    const cv = canvas()
    const coarse = matchMedia('(pointer: coarse)').matches
    const sound: Sound = createSound()
    st.sound = sound
    const over = $('.sn-over'), hint = $('.sn-hint'), toast = $('.sn-toast'), formulas = $('.sn-formulas'), scoreEl = $('.sn-score')
    const selButtons = [...root.querySelectorAll<HTMLButtonElement>('.sn-sel button')]
    let overShownAt = 0

    hint.innerHTML = coarse
      ? 'веди пальцем · внизу — частота<br>своя частота — еда, чужая — боль'
      : 'веди мышью или WASD · 1–5 / колесо — частота · F — формулы<br>своя частота — еда, чужая — боль · смена частоты стоит энергии и даёт миг уязвимости'

    st.sync = () => {
      const g = st.g
      if (!g) return
      hint.hidden = !(st.hintUntil > 0 && g.t < st.hintUntil)
      selButtons.forEach((b) => b.classList.toggle('on', +b.dataset.n! === g.p.n))
      $('.sn-x').classList.toggle('on', st.xrayOn)
      $('.sn-mute').classList.toggle('off', sound.muted)
      if (g.over && over.hidden) overShownAt = performance.now()
      over.hidden = !g.over
      $('.sn-final').textContent = String(g.score)
      $('.sn-best').textContent = g.score >= st.best && g.score > 0 ? 'новый рекорд!' : `рекорд ${st.best}`
    }

    // события игры → звук, тосты
    let toastTimer = 0
    st.onEvent = (e) => {
      if (e.type === 'die') toast.hidden = true
      if (e.type === 'eat') sound.eat(e.n, e.combo)
      else if (e.type === 'hurt') sound.hurt(e.n, e.other)
      else if (e.type === 'switch') sound.glide(e.from, e.to, MORPH)
      else if (e.type === 'die') sound.die()
      else if (e.type === 'spawn' && e.first && e.kind !== 'drift') {
        sound.first()
        const k = KIND_INFO[e.kind]
        toast.innerHTML = `<b>новый вид: ${k.name}</b><span>${k.law}</span>`
        toast.hidden = false
        clearTimeout(toastTimer)
        toastTimer = window.setTimeout(() => (toast.hidden = true), 4500)
      }
    }

    // ---- ввод ----
    const keys = new Set<string>()
    const toWorld = (cx: number, cy: number): [number, number] => {
      const r = cv.getBoundingClientRect(), m = 0.5 * Math.min(r.width, r.height)
      return [(cx - r.left - r.width / 2) / m, -(cy - r.top - r.height / 2) / m]
    }
    let touching = false
    const onMove = (e: PointerEvent) => {
      const g = st.g
      if (!g) return
      if (e.pointerType === 'touch' && !touching) return
      ;[g.input.tx, g.input.ty] = toWorld(e.clientX, e.clientY)
      g.input.follow = true
    }
    const onDown = (e: PointerEvent) => {
      sound.start()
      if (e.pointerType === 'touch') touching = true
      onMove(e)
    }
    const onUp = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return
      touching = false
      if (st.g) st.g.input.follow = false
    }
    const keyAxis = () => {
      const g = st.g
      if (!g) return
      const k = (a: string[]) => (a.some((c) => keys.has(c)) ? 1 : 0)
      g.input.kx = k(['KeyD', 'ArrowRight']) - k(['KeyA', 'ArrowLeft'])
      g.input.ky = k(['KeyW', 'ArrowUp']) - k(['KeyS', 'ArrowDown'])
      if (g.input.kx || g.input.ky) g.input.follow = false
    }
    const cycle = (dir: number) => {
      const g = st.g
      if (!g) return
      const i = FREQS.indexOf(g.p.n as (typeof FREQS)[number])
      setFreq(g, FREQS[(i + dir + FREQS.length) % FREQS.length])
    }
    const again = () => {
      if (performance.now() - overShownAt < 600) return // не перезапустить случайным тапом в момент смерти
      restart()
    }
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      sound.start()
      const g = st.g
      if (!g) return
      if (/^Digit[1-5]$/.test(e.code)) setFreq(g, FREQS[+e.code.slice(5) - 1])
      else if (e.code === 'KeyQ') cycle(-1)
      else if (e.code === 'KeyE') cycle(1)
      else if (e.code === 'KeyF') st.xrayOn = !st.xrayOn
      else if (e.code === 'KeyM') sound.setMuted(!sound.muted)
      else if (e.code === 'Enter' && g.over) again()
      else if (/^(Key[WASD]|Arrow)/.test(e.code)) {
        keys.add(e.code)
        keyAxis()
        e.preventDefault()
      } else return
      st.sync()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code)
      keyAxis()
    }
    let wheelAcc = 0
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      wheelAcc += e.deltaY
      if (Math.abs(wheelAcc) < 40) return
      cycle(Math.sign(wheelAcc))
      wheelAcc = 0
    }
    const onBlur = () => (keys.clear(), keyAxis())

    selButtons.forEach((b) => b.addEventListener('pointerdown', (e) => {
      e.stopPropagation()
      sound.start()
      if (st.g) setFreq(st.g, +b.dataset.n!)
    }))
    $('.sn-x').addEventListener('click', () => ((st.xrayOn = !st.xrayOn), st.sync()))
    $('.sn-mute').addEventListener('click', () => (sound.start(), sound.setMuted(!sound.muted), st.sync()))
    over.addEventListener('pointerdown', () => (sound.start(), again()))

    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('pointercancel', onUp)
    cv.addEventListener('wheel', onWheel, { passive: false })
    addEventListener('keydown', onKey)
    addEventListener('keyup', onKeyUp)
    addEventListener('blur', onBlur)

    // ---- каждый кадр: положение селектора (для шейдера), формулы ----
    const labels: HTMLDivElement[] = []
    const boxes: { el: HTMLDivElement; x: number; y: number; w: number; h: number }[] = []
    let raf = 0
    const frame = () => {
      raf = requestAnimationFrame(frame)
      const g = st.g
      if (!g) return
      // селектор: центры DOM-кнопок → px канваса (шейдер рисует существ ровно под ними)
      const k = cv.width / Math.max(1, cv.clientWidth)
      const a = selButtons[0].getBoundingClientRect(), b = selButtons[1].getBoundingClientRect()
      const hidden = document.body.classList.contains('gp-hide-ui') || a.width === 0
      sel[0] = (a.left + a.width / 2) * k
      sel[1] = cv.height - (a.top + a.height / 2) * k
      sel[2] = hidden ? 0 : (b.left - a.left) * k
      sel[3] = Math.min(a.width, a.height) * 0.5 * k

      scoreEl.textContent = st.xray > 0.05 ? `счёт ${g.score} · рекорд ${st.best} · d ${difficulty(g).toFixed(2)} · время ×${(1 - 0.7 * st.xray).toFixed(1)}` : ''
      formulas.hidden = st.xray < 0.05
      if (formulas.hidden) return
      formulas.style.opacity = String(st.xray)
      const r = cv.getBoundingClientRect(), m = 0.5 * Math.min(r.width, r.height)
      const list: (Ent | null)[] = [null, ...g.ents.filter((e) => e.dead < 0 && Math.abs(e.x) < g.ax + 0.1 && Math.abs(e.y) < g.ay + 0.1)]
      list.forEach((e, i) => {
        let el = labels[i]
        if (!el) formulas.append((el = labels[i] = document.createElement('div')))
        el.hidden = false
        const x = e ? e.x : g.p.x, y = e ? e.y : g.p.y
        const R = e ? e.r * (1 + e.amp) : playerR(g.p.E) * (1 + playerAmp(g.p.E))
        const [l1, l2] = formula(g, e)
        if (el.dataset.l1 !== l1 || el.dataset.l2 !== l2) {
          el.innerHTML = `<b>${l1.replaceAll('θ', '<i>θ</i>')}</b><span>${l2}</span>`
          el.dataset.l1 = l1
          el.dataset.l2 = l2
        }
        const n = e ? (voiceOf(e) ?? e.n) : g.p.n
        el.style.color = hueCss(n)
        el.classList.toggle('me', !e)
        // справа от существа; у правого края — слева
        const w = el.offsetWidth || 260
        let lx = r.width / 2 + (x + R) * m + 4
        if (lx + w > r.width - 8) lx = r.width / 2 + (x - R) * m - 4 - w
        lx = Math.max(4, Math.min(r.width - w - 4, lx))
        boxes.push({ el, x: lx, y: r.height / 2 - y * m - 12, w, h: el.offsetHeight || 28 })
      })
      // жадная раскладка без наложений: сверху вниз, мешающую подпись сдвигаем ниже
      boxes.sort((a, b) => a.y - b.y)
      boxes.forEach((b, i) => {
        for (let j = 0; j < i; j++) {
          const o = boxes[j]
          if (b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h) b.y = o.y + o.h + 1
        }
        b.el.style.transform = `translate(${b.x}px, ${b.y}px)`
      })
      boxes.length = 0
      for (let i = list.length; i < labels.length; i++) labels[i].hidden = true
    }
    frame()
    st.sync()

    return () => {
      cancelAnimationFrame(raf)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('pointercancel', onUp)
      cv.removeEventListener('wheel', onWheel)
      removeEventListener('keydown', onKey)
      removeEventListener('keyup', onKeyUp)
      removeEventListener('blur', onBlur)
      clearTimeout(toastTimer)
      sound.dispose()
      st.onEvent = () => {}
      st.sync = () => {}
    }
  },
})

