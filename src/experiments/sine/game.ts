// «Resonance»: логика игры — чистый TS без DOM/GL (гоняется и в Node: tests/sine-game.test.ts).
// Фиксированный шаг DT, свой RNG от сида — сессия детерминирована входом.
// Движение всех существ — явные формулы от времени (синусы), а не интеграция: игрок «читает волну».

export const S = Math.sin
export const C = (x: number) => Math.sin(x + Math.PI / 2) // cos = sin со сдвигом
export const TAU = Math.PI * 2
export const DT = 1 / 60
export const FREQS = [3, 4, 5, 6, 7] as const
export const MAX_ENT = 36 // слотов рендера (вкл. игрока и сегменты змеек); = размер массива в main.frag
export const MORPH = 0.45 // с: перетекание формы при смене частоты (неуязвимости нет — наоборот)
export const SWITCH_COST = 0.035 // энергии за смену частоты
export const SEGS = 6 // сегментов тела у змейки

export type Kind = 'drift' | 'eight' | 'pulsar' | 'flicker' | 'snake'
export const KIND_CODE: Record<Kind, number> = { drift: 1, eight: 2, pulsar: 3, flicker: 4, snake: 5 } // 6 — сегмент
export const UNLOCK: Record<Kind, number> = { drift: 0, eight: 0.35, pulsar: 0.8, flicker: 1.3, snake: 1.8 } // по сложности d
const WEIGHT: Record<Kind, number> = { drift: 3, eight: 2, pulsar: 1.3, flicker: 1.3, snake: 0.9 }
const VALUE: Record<Kind, number> = { drift: 1, eight: 2, pulsar: 3, flicker: 3, snake: 5 }
const FEED: Record<Kind, number> = { drift: 0.09, eight: 0.1, pulsar: 0.14, flicker: 0.14, snake: 0.3 }

export interface Ent {
  id: number
  kind: Kind
  n: number
  n2: number // flicker: вторая частота
  R: number
  amp: number
  ph: number // начальная фаза формы; φ(t) = ph + spin·τ
  spin: number
  t0: number
  life: number // с; дальше — растворяется
  // траектория: drift/snake — p0 + u·s + perp·A·sin(k·s + ph2), s = v·τ; eight/pulsar/flicker — c + лиссажу
  x0: number; y0: number; ux: number; uy: number; v: number; A: number; B: number; k: number; w: number; ph2: number
  // отброс после удара (смещение затухает)
  kx: number; ky: number; kvx: number; kvy: number
  cool: number // до этого времени не сталкивается
  dead: number // время поглощения (растворение), -1 — живо
  // вычисляемое на шаге
  x: number; y: number; r: number; spike: number; blend: number
}

export interface Player {
  x: number; y: number; vx: number; vy: number
  E: number // энергия 0..1: размер и амплитуда лепестков — это и есть «жизнь»
  n: number; nFrom: number; morph: number // morph: 0..MORPH прошло с начала смены частоты
  combo: number; inv: number; ph: number
}

export type GameEvent =
  | { type: 'eat'; n: number; combo: number; kind: Kind }
  | { type: 'hurt'; n: number; other: number }
  | { type: 'switch'; from: number; to: number }
  | { type: 'die'; score: number }
  | { type: 'spawn'; kind: Kind; first: boolean }

export interface Ripple { x: number; y: number; t0: number; n: number } // n < 0 — удар
export interface Input { tx: number; ty: number; follow: boolean; kx: number; ky: number }

export interface Game {
  seed: number; rng: number; t: number; steps: number
  ax: number; ay: number // полуразмеры арены (меньшая сторона = 1)
  p: Player
  ents: Ent[]
  ripples: Ripple[]
  trail: [number, number][]
  events: GameEvent[]
  score: number; eaten: number; switches: number; hurts: number
  over: boolean; overAt: number
  shake: number
  nextId: number; spawnIn: number
  seen: Set<Kind>
  input: Input
}

function rand(g: Game) {
  // mulberry32
  let t = (g.rng = (g.rng + 0x6d2b79f5) | 0)
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rr = (g: Game, a: number, b: number) => a + (b - a) * rand(g)
const pick = <T>(g: Game, a: readonly T[]) => a[Math.floor(rand(g) * a.length)]
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export function newGame(seed: number, aspect = 16 / 10): Game {
  const g: Game = {
    seed, rng: seed | 0, t: 0, steps: 0, ax: 1, ay: 1,
    p: { x: 0, y: 0, vx: 0, vy: 0, E: 0.6, n: 4, nFrom: 4, morph: MORPH, combo: 0, inv: 0, ph: 0 },
    ents: [], ripples: [], trail: [], events: [],
    score: 0, eaten: 0, switches: 0, hurts: 0, over: false, overAt: 0, shake: 0,
    nextId: 1, spawnIn: 1.2, seen: new Set(),
    input: { tx: 0, ty: 0, follow: false, kx: 0, ky: 0 },
  }
  setAspect(g, aspect)
  // мягкий старт: двое «своих» рядом, один чужой
  for (const n of [4, 4, 3]) spawn(g, 'drift', n)
  return g
}

export function setAspect(g: Game, aspect: number) {
  g.ax = aspect >= 1 ? aspect : 1
  g.ay = aspect >= 1 ? 1 : 1 / aspect
}

// сложность: время + счёт
export const difficulty = (g: Game) => g.t / 55 + g.score / 90
export const freqsAt = (d: number) => FREQS.slice(0, d < 0.6 ? 3 : d < 1.4 ? 4 : 5)
export const playerR = (E: number) => 0.045 + 0.05 * E
export const playerAmp = (E: number) => 0.06 + 0.3 * E
const speedMul = (d: number) => 1 + 0.18 * Math.min(d, 7)

// отображаемая частота игрока (во время перетекания — дробная смесь)
export function playerBlend(p: Player) {
  return smooth(0, 1, p.morph / MORPH)
}
export const morphing = (p: Player) => p.morph < MORPH

export function slots(g: Game) {
  let n = 1
  for (const e of g.ents) n += e.kind === 'snake' ? 1 + SEGS : 1
  return n
}

export function spawn(g: Game, kind: Kind, nForce?: number, school = 0): Ent | null {
  const d = difficulty(g)
  const sp = speedMul(d)
  const fr = freqsAt(d)
  const n = nForce ?? pick(g, fr)
  const { ax, ay } = g
  const e: Ent = {
    id: g.nextId++, kind, n, n2: n, R: 0.06, amp: 0.3, ph: rr(g, 0, TAU), spin: rr(g, -1, 1), t0: g.t, life: 1e9,
    x0: 0, y0: 0, ux: 1, uy: 0, v: 0, A: 0, B: 0, k: 0, w: 0, ph2: rr(g, 0, TAU),
    kx: 0, ky: 0, kvx: 0, kvy: 0, cool: 0, dead: -1, x: 0, y: 0, r: 0.06, spike: 0, blend: 0,
  }
  // точка внутри арены не ближе minD к игроку
  const inside = (minD: number, mx = 0.75, my = 0.7) => {
    for (let i = 0; i < 30; i++) {
      const x = rr(g, -ax * mx, ax * mx), y = rr(g, -ay * my, ay * my)
      if (Math.hypot(x - g.p.x, y - g.p.y) > minD) return [x, y]
    }
    return [-g.p.x * 0.5, -g.p.y * 0.5]
  }
  // старт за краем, направление — на случайную точку в середине арены
  const edge = () => {
    const a = rr(g, 0, TAU)
    const R = Math.hypot(ax, ay) + 0.2
    const sx = clamp(C(a) * R, -ax - 0.2, ax + 0.2), sy = clamp(S(a) * R, -ay - 0.2, ay + 0.2)
    const tx = rr(g, -ax * 0.5, ax * 0.5), ty = rr(g, -ay * 0.5, ay * 0.5)
    const l = Math.hypot(tx - sx, ty - sy)
    e.x0 = sx, e.y0 = sy, e.ux = (tx - sx) / l, e.uy = (ty - sy) / l
    return l
  }
  switch (kind) {
    case 'drift': {
      const l = edge()
      e.R = rr(g, 0.045, 0.06); e.amp = rr(g, 0.22, 0.34)
      e.v = rr(g, 0.13, 0.2) * sp; e.A = rr(g, 0.07, 0.17); e.k = rr(g, 5, 9)
      e.life = (2 * l + 0.4) / e.v
      if (school) {
        // стая: та же синусоида, участники отстают на 0.16 по пути
        const lead = g.ents[g.ents.length - 1]
        Object.assign(e, { x0: lead.x0, y0: lead.y0, ux: lead.ux, uy: lead.uy, v: lead.v, A: lead.A, k: lead.k, ph2: lead.ph2, R: lead.R, amp: lead.amp, life: lead.life, n: lead.n })
        e.t0 = lead.t0 + (school * 0.16) / e.v
        e.life += (school * 0.16) / e.v
      }
      break
    }
    case 'eight': {
      const [cx, cy] = inside(0.9, 0.45, 0.4)
      e.x0 = cx, e.y0 = cy
      e.R = rr(g, 0.05, 0.065); e.amp = rr(g, 0.25, 0.35)
      e.A = rr(g, 0.3, 0.5) * Math.min(ax, ay); e.B = rr(g, 0.16, 0.26) * Math.min(ax, ay)
      if (rand(g) < 0.5) e.A = -e.A // A < 0 — восьмёрка повёрнута на 90°
      e.w = rr(g, 0.45, 0.65) * sp; e.life = 22
      break
    }
    case 'pulsar': {
      const [cx, cy] = inside(0.8)
      e.x0 = cx, e.y0 = cy
      e.R = rr(g, 0.075, 0.095); e.amp = 0.22
      e.w = rr(g, 1.1, 1.5) * Math.sqrt(sp); e.life = 24
      break
    }
    case 'flicker': {
      const [cx, cy] = inside(0.8)
      e.x0 = cx, e.y0 = cy
      e.n2 = pick(g, fr.filter((f) => f !== n))
      e.R = rr(g, 0.055, 0.068); e.amp = 0.3
      e.A = 0.22; e.B = 0.14; e.w = 0.35 * sp; e.k = rr(g, 0.7, 0.95) // k — частота переключения
      e.life = 26
      break
    }
    case 'snake': {
      const l = edge()
      e.R = 0.06; e.amp = 0.32
      e.v = 0.17 * sp; e.A = 0.14; e.k = rr(g, 7, 9)
      e.life = (2 * l + 0.4 + SEGS * 0.06) / e.v
      break
    }
  }
  e.ph2 = school ? e.ph2 : rr(g, 0, TAU)
  g.ents.push(e)
  g.events.push({ type: 'spawn', kind, first: !g.seen.has(kind) })
  g.seen.add(kind)
  place(e, g.t)
  return e
}

// путь змейки/дрейфа: точка на расстоянии s вдоль оси
function pathAt(e: Ent, s: number): [number, number] {
  const lat = e.A * S(e.k * s + e.ph2)
  return [e.x0 + e.ux * s - e.uy * lat, e.y0 + e.uy * s + e.ux * lat]
}
export const SEG_GAP = 0.062

// положение и форма в момент t (без отброса)
export function shapeAt(e: Ent, t: number) {
  const tau = t - e.t0
  let x = 0, y = 0, r = e.R, spike = 0, blend = 0
  switch (e.kind) {
    case 'drift':
    case 'snake':
      ;[x, y] = pathAt(e, e.v * tau)
      break
    case 'eight': {
      const a = e.A * S(e.w * tau), b = e.B * S(2 * e.w * tau)
      ;[x, y] = e.A > 0 ? [e.x0 + a, e.y0 + b] : [e.x0 + b, e.y0 - a]
      break
    }
    case 'pulsar': {
      const s = S(e.w * tau)
      x = e.x0 + 0.03 * S(0.7 * tau); y = e.y0 + 0.03 * S(0.9 * tau)
      r = e.R * (0.78 + 0.32 * s)
      spike = 0.2 * smooth(0.15, 0.6, s) // раздут — шипы: опасен всем
      break
    }
    case 'flicker': {
      x = e.x0 + e.A * S(e.w * tau); y = e.y0 + e.B * S(1.5 * e.w * tau + 1)
      blend = smooth(-0.3, 0.3, S(e.k * tau)) // 0 — частота n, 1 — n2
      break
    }
  }
  return { x, y, r, spike, blend }
}

function place(e: Ent, t: number) {
  const s = shapeAt(e, t)
  e.x = s.x + e.kx; e.y = s.y + e.ky; e.r = s.r; e.spike = s.spike; e.blend = s.blend
}

export function segments(e: Ent, t: number): [number, number][] {
  const s0 = e.v * (t - e.t0)
  const out: [number, number][] = []
  for (let j = 1; j <= SEGS; j++) {
    const [x, y] = pathAt(e, s0 - j * SEG_GAP)
    out.push([x + e.kx, y + e.ky])
  }
  return out
}

// прозрачность появления/исчезновения
export function fadeOf(e: Ent, t: number) {
  const tau = t - e.t0
  const fin = clamp(tau / 0.7, 0, 1)
  const fout = e.kind === 'drift' || e.kind === 'snake' ? 1 : clamp((e.life - tau) / 1, 0, 1)
  const dead = e.dead < 0 ? 1 : clamp(1 - (t - e.dead) / 0.35, 0, 1)
  return Math.min(fin, fout) * dead
}

// какой частотой существо «звучит» сейчас; null — переходное состояние (касание = урон)
export function voiceOf(e: Ent): number | null {
  if (e.kind !== 'flicker') return e.n
  if (e.blend < 0.12) return e.n
  if (e.blend > 0.88) return e.n2
  return null
}

// исход касания: 'eat' | 'hurt' | 'none'
export function contact(g: Game, e: Ent, part: 'body' | 'seg' = 'body'): 'eat' | 'hurt' | 'none' {
  const p = g.p
  if (e.kind === 'pulsar' && e.spike > 0.05) return 'hurt' // раздутый пульсар жжёт всех
  const v = voiceOf(e)
  if (morphing(p)) return 'hurt' // во время перетекания ты — диссонанс
  if (v === null || v !== p.n) return 'hurt'
  return part === 'seg' ? 'none' : 'eat' // тело змейки своей частоты проходит насквозь
}

export function step(g: Game) {
  if (g.over) {
    g.t += DT
    g.steps++
    for (const e of g.ents) place(e, g.t)
    return
  }
  const p = g.p
  const d = difficulty(g)
  g.t += DT
  g.steps++

  // ---- игрок ----
  const vmax = 0.95 - 0.4 * p.E // крупный — медленнее
  let dx = 0, dy = 0
  const inp = g.input
  if (inp.kx || inp.ky) {
    const l = Math.hypot(inp.kx, inp.ky)
    dx = (inp.kx / l) * vmax; dy = (inp.ky / l) * vmax
  } else if (inp.follow) {
    const ex = inp.tx - p.x, ey = inp.ty - p.y, l = Math.hypot(ex, ey)
    if (l > 1e-4) {
      const sp = Math.min(vmax, l * 5)
      dx = (ex / l) * sp; dy = (ey / l) * sp
    }
  }
  const a = Math.min(1, 9 * DT)
  p.vx += (dx - p.vx) * a; p.vy += (dy - p.vy) * a
  p.x = clamp(p.x + p.vx * DT, -g.ax + 0.05, g.ax - 0.05)
  p.y = clamp(p.y + p.vy * DT, -g.ay + 0.05, g.ay - 0.05)
  p.morph = Math.min(MORPH, p.morph + DT)
  p.ph += DT * 0.8
  p.E -= (0.011 + 0.005 * d) * DT // голод растёт со сложностью: бездействие убивает
  if (g.steps % 3 === 0) {
    g.trail.unshift([p.x, p.y])
    if (g.trail.length > 10) g.trail.pop()
  }

  // ---- существа ----
  const pr = playerR(p.E) * (1 + 0.5 * playerAmp(p.E))
  for (const e of g.ents) {
    e.kvx *= 1 - 2.5 * DT; e.kvy *= 1 - 2.5 * DT
    e.kx += e.kvx * DT; e.ky += e.kvy * DT
    place(e, g.t)
    if (e.dead >= 0 || g.t < e.cool || fadeOf(e, g.t) < 0.95) continue
    const er = e.r * (1 + 0.5 * e.amp + e.spike)
    let hit: 'body' | 'seg' | null = null
    if (Math.hypot(e.x - p.x, e.y - p.y) < er + pr) hit = 'body'
    else if (e.kind === 'snake')
      for (const [sx, sy] of segments(e, g.t)) if (Math.hypot(sx - p.x, sy - p.y) < e.R * 0.55 + pr) hit = 'seg'
    if (!hit) continue
    const res = contact(g, e, hit)
    if (res === 'eat') eat(g, e)
    else if (res === 'hurt' && g.t >= p.inv) hurt(g, e)
  }
  g.ents = g.ents.filter((e) => (e.dead < 0 || g.t - e.dead < 0.4) && g.t - e.t0 < e.life)

  // ---- спавн ----
  g.spawnIn -= DT
  const want = Math.min(MAX_ENT - 8, 6 + 3.2 * d)
  if (g.spawnIn <= 0 && slots(g) < want) {
    const kinds = (Object.keys(UNLOCK) as Kind[]).filter((k) => d >= UNLOCK[k])
    // новый вид — вводится сразу, как только открылся
    const fresh = kinds.find((k) => !g.seen.has(k))
    let kind = fresh ?? kinds[0]
    if (!fresh) {
      let sum = 0
      for (const k of kinds) sum += WEIGHT[k]
      let r = rand(g) * sum
      for (const k of kinds) if ((r -= WEIGHT[k]) <= 0) { kind = k; break }
    }
    if (kind === 'snake' && slots(g) + 1 + SEGS > MAX_ENT) kind = 'drift'
    const lead = spawn(g, kind)
    if (lead && kind === 'drift' && rand(g) < 0.3 && slots(g) + 3 <= MAX_ENT) for (let i = 1; i <= 2; i++) spawn(g, 'drift', lead.n, i)
    g.spawnIn = Math.max(0.35, 1.1 - 0.15 * d)
  }

  g.shake = Math.max(0, g.shake - DT * 2.5)
  g.ripples = g.ripples.filter((r) => g.t - r.t0 < 2)
  if (p.E <= 0) {
    p.E = 0
    g.over = true
    g.overAt = g.t
    g.events.push({ type: 'die', score: g.score })
    g.ripples.push({ x: p.x, y: p.y, t0: g.t, n: -1 })
  }
}

function ripple(g: Game, x: number, y: number, n: number) {
  g.ripples.push({ x, y, t0: g.t, n })
  if (g.ripples.length > 8) g.ripples.shift()
}

function eat(g: Game, e: Ent) {
  const p = g.p
  e.dead = g.t
  p.combo++
  const mult = Math.min(4, 1 + Math.floor((p.combo - 1) / 3))
  g.score += VALUE[e.kind] * mult
  g.eaten++
  p.E = Math.min(1, p.E + FEED[e.kind])
  ripple(g, e.x, e.y, p.n)
  g.events.push({ type: 'eat', n: p.n, combo: p.combo, kind: e.kind })
}

function hurt(g: Game, e: Ent) {
  const p = g.p
  p.E -= 0.2
  p.inv = g.t + 0.9
  p.combo = 0
  g.hurts++
  const dx = e.x - p.x, dy = e.y - p.y, l = Math.hypot(dx, dy) || 1
  e.kvx += (dx / l) * 1.3; e.kvy += (dy / l) * 1.3
  p.vx -= (dx / l) * 0.8; p.vy -= (dy / l) * 0.8
  e.cool = g.t + 1.1
  g.shake = 1
  ripple(g, p.x, p.y, -1)
  g.events.push({ type: 'hurt', n: p.n, other: voiceOf(e) ?? e.n2 })
}

export function setFreq(g: Game, n: number) {
  const p = g.p
  if (g.over || n === p.n || !(FREQS as readonly number[]).includes(n)) return
  // из середины перетекания — от ближайшей видимой формы
  p.nFrom = playerBlend(p) < 0.5 ? p.nFrom : p.n
  p.n = n
  p.morph = 0
  p.combo = 0
  p.E -= SWITCH_COST
  g.switches++
  g.events.push({ type: 'switch', from: p.nFrom, to: n })
}

// ---------- упаковка для шейдера: 4 vec4 на слот ----------
// A = (x, y, R, kind)  B = (n1, n2, смесь, амплитуда)  C = (фаза, альфа, шипы, вспышка)  D = параметры пути (рентген)
export function pack(g: Game, out: Float32Array) {
  const t = g.t, p = g.p
  let i = 0
  const put = (a: number[], b: number[], c: number[], dd: number[]) => {
    out.set(a, i * 4); out.set(b, (MAX_ENT + i) * 4); out.set(c, (2 * MAX_ENT + i) * 4); out.set(dd, (3 * MAX_ENT + i) * 4)
    i++
  }
  const blink = t < p.inv && !g.over ? 0.55 + 0.45 * S(t * 38) : 1
  const fadeDead = g.over ? Math.max(0, 1 - (t - g.overAt) / 1.2) : 1
  put([p.x, p.y, playerR(p.E) * (g.over ? 1 + (t - g.overAt) * 0.6 : 1), 0], [p.nFrom, p.n, playerBlend(p), playerAmp(p.E)], [p.ph * 2, blink * fadeDead, morphing(p) ? 0.12 : 0, 0], [p.E, 0, 0, 0])
  for (const e of g.ents) {
    if (i >= MAX_ENT) break
    const tau = t - e.t0
    const al = fadeOf(e, t)
    const flash = e.dead >= 0 ? 1 - al : 0
    const R = e.r * (e.dead >= 0 ? 1 + (t - e.dead) * 3 : 1)
    const phase = e.ph + e.spin * tau
    let path = [0, 0, 0, 0]
    if (e.kind === 'drift' || e.kind === 'snake') path = [Math.atan2(e.uy, e.ux), e.A, e.k, e.k * e.v * tau + e.ph2]
    else if (e.kind === 'eight') {
      const a = e.A * S(e.w * tau), b = e.B * S(2 * e.w * tau)
      path = [e.x - (e.A > 0 ? a : b), e.y - (e.A > 0 ? b : -a), e.A, e.B]
    } else if (e.kind === 'pulsar') path = [e.R * 0.46, e.R * 1.1, S(e.w * tau), 0]
    put([e.x, e.y, R, KIND_CODE[e.kind]], [e.n, e.n2, e.blend, e.amp], [phase, al, e.spike, flash], path)
    if (e.kind === 'snake')
      for (const [j, [sx, sy]] of segments(e, t).entries()) {
        if (i >= MAX_ENT) break
        put([sx, sy, e.R * (0.5 - j * 0.035), 6], [e.n, e.n, 0, 0.18], [phase + j * 0.9, al, 0, flash], [0, 0, 0, 0])
      }
  }
  return i
}

// ---------- бот (проверка баланса) ----------
// mode: 'switch' — выбирает частоту по выгоде; 'stay' — никогда не меняет; 'idle' — стоит на месте.
export function bot(g: Game, mode: 'switch' | 'stay' | 'idle') {
  const p = g.p, inp = g.input
  inp.kx = inp.ky = 0
  if (mode === 'idle') return void ((inp.follow = false))
  inp.follow = true
  const look = 0.3
  const pr = playerR(p.E) * (1 + 0.5 * playerAmp(p.E))
  let fx = 0, fy = 0
  const value = new Map<number, number>()
  let danger = 0
  for (const e of g.ents) {
    if (e.dead >= 0 || fadeOf(e, g.t) < 0.5) continue
    const fut = shapeAt(e, g.t + look)
    const ex = fut.x + e.kx, ey = fut.y + e.ky
    const dx = ex - p.x, dy = ey - p.y, dist = Math.hypot(dx, dy) || 1e-3
    const er = e.r * (1 + 0.5 * e.amp + e.spike)
    const gap = dist - er - pr
    const v = voiceOf(e)
    const spiky = e.kind === 'pulsar' && (e.spike > 0.02 || S(e.w * (g.t + look - e.t0)) > 0)
    if (v !== null && !spiky) value.set(v, (value.get(v) ?? 0) + 1 / (dist + 0.2))
    const food = v === p.n && !morphing(p) && !spiky
    if (food) {
      const w = 1 / (dist + 0.05)
      fx += (dx / dist) * w; fy += (dy / dist) * w
    } else if (gap < 0.45) {
      const w = 0.12 / Math.max(0.02, gap) ** 2
      fx -= (dx / dist) * w; fy -= (dy / dist) * w
      danger = Math.max(danger, 0.45 - gap)
    }
    if (e.kind === 'snake' && v !== p.n)
      for (const [sx, sy] of segments(e, g.t + look)) {
        const sdx = sx - p.x, sdy = sy - p.y, sd = Math.hypot(sdx, sdy) || 1e-3, sg = sd - e.R * 0.55 - pr
        if (sg < 0.3) {
          const w = 0.1 / Math.max(0.02, sg) ** 2
          fx -= (sdx / sd) * w; fy -= (sdy / sd) * w
        }
      }
  }
  // стенки
  fx += 0.05 / Math.max(0.03, g.ax - p.x) ** 2 * -1 + 0.05 / Math.max(0.03, g.ax + p.x) ** 2
  fy += 0.05 / Math.max(0.03, g.ay - p.y) ** 2 * -1 + 0.05 / Math.max(0.03, g.ay + p.y) ** 2
  const l = Math.hypot(fx, fy)
  if (l > 1e-4) (inp.tx = p.x + (fx / l) * 0.4), (inp.ty = p.y + (fy / l) * 0.4)
  else (inp.tx = p.x * 0.9), (inp.ty = p.y * 0.9)
  if (mode === 'switch' && !morphing(p) && danger < 0.15 && g.steps % 15 === 0) {
    let best = p.n, bv = value.get(p.n) ?? 0
    for (const [n, v] of value) if (v > bv * 1.8 + 0.6) (best = n), (bv = v)
    if (best !== p.n) setFreq(g, best)
  }
}
