// Маленькие планеты: логика без DOM/GL. Физика — по зонду probe.frag (тот же кадр, ctx.read), шаг фиксирован →
// __gp.step(n) воспроизводит прохождение. «Вверх» и гравитация — по градиенту поля только планет (planetsOnly):
// постройки не тянут, по стене домика не пойдёшь. Константы планет — как в world.glsl.

export type V3 = [number, number, number]
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1))
export const V = { add, sub, mul, dot, cross, len, norm }

// ---------- планеты (как в world.glsl) ----------
export const P_HOME: V3 = [0, 0, 0], R_HOME = 6
export const P_TOR: V3 = [-4, 7, 27], TOR_TILT = 0.6, TOR_R = 7, TOR_r = 2.2
export const P_PUMP: V3 = [26, -4, 6], R_PUMP = 5
export const P_MOON: V3 = [9, 17, -15], R_MOON = 2.6

const homeAt = (dir: V3) => { const d = norm(dir); return { p: add(P_HOME, mul(d, R_HOME)), up: d } }
const moonAt = (dir: V3) => { const d = norm(dir); return { p: add(P_MOON, mul(d, R_MOON)), up: d } }
// бублик: локальные координаты (поворот вокруг x на TOR_TILT, как rotX в шейдере) ↔ мир
const torToWorld = (q: V3): V3 => { const c = Math.cos(TOR_TILT), s = Math.sin(TOR_TILT); return [q[0], c * q[1] + s * q[2], -s * q[1] + c * q[2]] }
const worldToTor = (w: V3): V3 => { const c = Math.cos(TOR_TILT), s = Math.sin(TOR_TILT); return [w[0], c * w[1] - s * w[2], s * w[1] + c * w[2]] }
export const torAt = (u: number, v: number) => {
  const rr = TOR_R + TOR_r * Math.cos(v)
  const q: V3 = [rr * Math.cos(u), TOR_r * Math.sin(v), rr * Math.sin(u)]
  const n: V3 = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)]
  return { p: add(P_TOR, torToWorld(q)), up: torToWorld(n) }
}
export const pumpAt = (dir: V3) => {
  const d = norm(dir)
  const rib = Math.abs(Math.sin(5 * Math.atan2(d[2], d[0])))
  const sl = Math.hypot(d[0], d[1] * 1.25, d[2])
  const t = (R_PUMP * (1 - 0.06 * rib * Math.min(1, Math.hypot(d[0], d[2]) / 0.6))) / sl
  // нормаль — градиент приплюснутой сферы (без долек)
  return { p: add(P_PUMP, mul(d, t - 0.02)), up: norm([d[0], d[1] * 1.5625, d[2]]) }
}
// бублик, точка, смотрящая на дом
export const torHome = (() => { const h = worldToTor(sub(P_HOME, P_TOR)); return { u: Math.atan2(h[2], h[0]), v: Math.atan2(h[1], Math.hypot(h[0], h[2])) } })()

export interface Pad { p: V3; up: V3; to: V3; name: string }
const pad = (s: { p: V3; up: V3 }, to: { p: V3 }, name: string): Pad => ({ p: s.p, up: s.up, to: to.p, name })
const HOME_LAND = homeAt([0.3, 0.85, -0.05]) // подальше от грибов, домика и колодца
const TOR_LAND = torAt(torHome.u + 0.5, torHome.v)
export const PADS: Pad[] = [
  pad(homeAt(sub(P_TOR, P_HOME)), TOR_LAND, 'на бублик'),
  pad(homeAt(sub(P_PUMP, P_HOME)), pumpAt([-0.85, 0.5, 0.0]), 'на тыкву'),
  pad(homeAt(sub(P_MOON, P_HOME)), moonAt([0.6, -0.2, 0.8]), 'на клубок'), // приземление в стороне от обратного гриба
  pad(torAt(torHome.u - 0.15, torHome.v), HOME_LAND, 'домой'),
  pad(pumpAt(sub(P_HOME, P_PUMP)), HOME_LAND, 'домой'),
  pad(moonAt(sub(P_HOME, P_MOON)), HOME_LAND, 'домой'),
]
export const BEACON = homeAt([-0.45, 0.55, -0.7])
// свечи: внутренняя сторона бублика; дальняя (из-за горизонта) сторона тыквы; низ клубка
export const ITEM_SPOTS = [torAt(torHome.u + Math.PI * 0.75, Math.PI), pumpAt([1, 0.15, 0.2]), moonAt([0.6, 0.6, -0.5])]
export const SPAWN = homeAt([0.35, 0.55, 0.75])
const HOUSE_P = homeAt([0.0, 0.97, 0.243]).p

// ---------- состояние ----------
export const DT = 1 / 60
export const SPEED = 3.0, JUMP = 5.5, LAUNCH = 9, FLY_G = 9, RAD = 0.3
export interface Item { p: V3; up: V3; state: 0 | 1 | 2 } // 0 лежит, 1 в руках, 2 в маяке
export interface Game {
  pos: V3; vel: V3; up: V3; fwd: V3; camPitch: number; cam: V3
  grounded: boolean; flight: { to: V3; t: number } | null
  carry: number; items: Item[]; lit: number; done: boolean; flash: number
  walk: number; t: number; frames: number
  input: { fwd: number; side: number; dyaw: number; dpitch: number; jump: boolean }
  // телеметрия для e2e
  minClear: number; maxAlt: number; launches: number; rescues: number
}

export function newGame(): Game {
  const up = SPAWN.up
  const toHouse = sub(HOUSE_P, SPAWN.p)
  const fwd = norm(sub(toHouse, mul(up, dot(toHouse, up)))) // лицом к домику
  return {
    pos: [...SPAWN.p], vel: [0, 0, 0], up: [...up], fwd, camPitch: 0.28, cam: add(SPAWN.p, mul(up, 3)),
    grounded: true, flight: null, carry: -1,
    items: ITEM_SPOTS.map((s) => ({ p: [...s.p], up: [...s.up], state: 0 })),
    lit: 0, done: false, flash: 0, walk: 0, t: 0, frames: 0,
    input: { fwd: 0, side: 0, dyaw: 0, dpitch: 0, jump: false },
    minClear: 1e9, maxAlt: 0, launches: 0, rescues: 0,
  }
}

// поворот вектора v вокруг оси k на угол a (Родригес)
const rotAround = (v: V3, k: V3, a: number): V3 => add(add(mul(v, Math.cos(a)), mul(cross(k, v), Math.sin(a))), mul(k, dot(k, v) * (1 - Math.cos(a))))

export const rightOf = (g: Game) => norm(cross(g.up, g.fwd))
export const camWant = (g: Game): V3 => {
  const back = add(mul(g.fwd, -Math.cos(g.camPitch)), mul(g.up, Math.sin(g.camPitch)))
  return add(add(g.pos, mul(g.up, 1.4)), mul(back, 5.0))
}

// probe: 8×4 float из probe.frag
export function step(g: Game, probe: Float32Array | null, dt = DT) {
  g.t += dt
  g.frames++
  g.flash = Math.max(0, g.flash - dt * 0.8)
  if (!probe) return
  const sph = [0, 1, 2].map((i) => ({ d: probe[i * 4], n: [probe[i * 4 + 1], probe[i * 4 + 2], probe[i * 4 + 3]] as V3 }))
  const pd = probe[20], pn: V3 = [probe[21], probe[22], probe[23]] // поле планет: расстояние ног, «вверх»
  const camT = probe[16]
  g.minClear = Math.min(g.minClear, ...sph.map((s) => s.d))
  g.maxAlt = Math.max(g.maxAlt, pd)

  // ---- «вверх» и ориентация: плавно к нормали планеты; вперёд — в касательной плоскости ----
  const turn = Math.min(1, dt * (pd < 3 ? 10 : 3))
  g.up = norm(add(g.up, mul(sub(pn, g.up), turn)))
  g.fwd = rotAround(g.fwd, g.up, g.input.dyaw)
  g.fwd = norm(sub(g.fwd, mul(g.up, dot(g.fwd, g.up))))
  g.camPitch = Math.max(-0.1, Math.min(1.2, g.camPitch - g.input.dpitch))
  g.input.dyaw = g.input.dpitch = 0
  const rt = rightOf(g)

  // ---- гравитация: в полёте с катапульты — к точке приземления, иначе — к ближайшей планете ----
  if (g.flight) {
    g.flight.t += dt
    const to = sub(g.flight.to, g.pos)
    g.vel = add(g.vel, mul(norm(to), FLY_G * dt))
    if ((pd < 1.0 && g.flight.t > 0.4) || len(to) < 1.5 || g.flight.t > 8) g.flight = null
  } else {
    const gm = 14 / (1 + Math.max(0, pd - 2) ** 2 / 25)
    g.vel = add(g.vel, mul(pn, -Math.max(gm, pd > 30 ? 6 : 0) * dt))
  }
  // страховка: слишком далеко от всех планет — мягкий возврат домой
  if (pd > 40 && !g.flight) {
    g.flight = { to: [...HOME_LAND.p], t: 0 }
    g.vel = mul(g.vel, 0.3)
    g.rescues++
  }

  // ---- ходьба по касательной, прыжок ----
  g.grounded = sph[0].d < RAD + 0.08 && !g.flight
  if (g.grounded) {
    const vn = dot(g.vel, g.up)
    let vt = sub(g.vel, mul(g.up, vn))
    const want = add(mul(g.fwd, g.input.fwd * SPEED), mul(rt, g.input.side * SPEED))
    vt = add(vt, mul(sub(want, vt), Math.min(1, dt * 12)))
    g.vel = add(vt, mul(g.up, Math.max(0, vn)))
    if (g.input.jump) g.vel = add(g.vel, mul(g.up, JUMP))
    g.walk += len(vt) * dt * 4.5
  }
  g.input.jump = false

  // ---- столкновения: выталкивание сфер тела по градиенту, гашение скорости внутрь ----
  for (const s of sph) {
    if (s.d < RAD) {
      g.pos = add(g.pos, mul(s.n, RAD - s.d))
      const into = dot(g.vel, s.n)
      if (into < 0) g.vel = sub(g.vel, mul(s.n, into))
    }
  }
  // шаг не длиннее расстояния до ближайшей поверхности (сквозь планету не пролететь)
  let move = mul(g.vel, dt)
  const dmin = Math.min(...sph.map((s) => s.d))
  const lim = Math.max(0.03, dmin - 0.05)
  if (len(move) > lim && dot(move, sph[0].n) < 0) move = mul(move, lim / len(move))
  g.pos = add(g.pos, move)
  // стоим — прижать ноги к земле (на выпуклой планете шаг по касательной чуть отрывает)
  if (g.grounded && dot(g.vel, g.up) <= 0.01) g.pos = sub(g.pos, mul(g.up, Math.max(0, sph[0].d - RAD) * 0.5))

  // ---- камера: не сквозь стены (луч зонда) ----
  const want = camWant(g), head = add(g.pos, mul(g.up, 1.4))
  const dir = sub(want, head), L = len(dir)
  g.cam = add(head, mul(norm(dir), Math.max(0.8, Math.min(L, camT - 0.3))))

  // ---- катапульты ----
  if (g.grounded)
    for (const p of PADS)
      if (len(sub(g.pos, p.p)) < 1.2) { // шляпка (r 0.55) не подпускает ближе ~0.85
        g.vel = mul(p.up, LAUNCH)
        g.flight = { to: [...p.to], t: 0 }
        g.pos = add(g.pos, mul(p.up, 0.3))
        g.launches++
        break
      }

  // ---- свечи: подобрать, донести до маяка ----
  if (g.carry < 0) {
    const i = g.items.findIndex((it) => it.state === 0 && len(sub(it.p, g.pos)) < 1.0)
    if (i >= 0) (g.carry = i), (g.items[i].state = 1)
  }
  if (g.carry >= 0) {
    const it = g.items[g.carry]
    it.p = add(add(g.pos, mul(g.up, 0.95)), mul(g.fwd, 0.38))
    it.up = [...g.up]
    if (len(sub(BEACON.p, g.pos)) < 1.8) {
      // ставим в фонарь маяка: три места вокруг
      const k = g.items.filter((x) => x.state === 2).length
      const F = frame(BEACON.up)
      const a = (k / 3) * Math.PI * 2
      it.p = add(add(BEACON.p, mul(BEACON.up, 2.48)), add(mul(F[0], Math.cos(a) * 0.18), mul(F[2], Math.sin(a) * 0.18)))
      it.up = [...BEACON.up]
      it.state = 2
      g.carry = -1
      if (g.items.every((x) => x.state === 2)) (g.done = true), (g.flash = 1)
    }
  }
  if (g.done) g.lit = Math.min(1, g.lit + dt * 0.7)
}

export function frame(up: V3): [V3, V3, V3] {
  const a: V3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const r = norm(cross(a, up))
  return [r, up, cross(r, up)]
}

export function worldUniforms(g: Game) {
  const PA = new Float32Array(24), PB = new Float32Array(24), IA = new Float32Array(12), IB = new Float32Array(12)
  PADS.forEach((p, i) => { PA.set([...p.p, 1], i * 4); PB.set([...p.up, 0], i * 4) })
  g.items.forEach((it, i) => { IA.set([...it.p, it.state], i * 4); IB.set([...it.up, 0], i * 4) })
  const arr = (a: Float32Array) => a as unknown as number[]
  return {
    uPadA: arr(PA), uPadB: arr(PB), uItemA: arr(IA), uItemB: arr(IB),
    uBeaconPos: BEACON.p, uBeaconUp: BEACON.up, uLit: g.lit,
    uPlayerPos: g.pos, uPlayerUp: g.up, uPlayerFwd: g.fwd, uWalk: g.walk, uCarry: g.carry >= 0,
  }
}
