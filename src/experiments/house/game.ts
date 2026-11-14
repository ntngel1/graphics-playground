// Логика «Невозможного дома»: физика игрока по зонду (probe.frag читается в том же кадре), порталы,
// правки и заряды, двери коридора и перетекание двери наверху. Без DOM; шаг — фиксированный DT.
import { PORTALS, ROOMS, portalCross, portalXf, roomOf, type V3 } from './rooms.ts'

export const DT = 1 / 60
export const R = 0.28 // радиус капсулы
export const EYE = 1.55
export const SPEED = 2.4
export const STEP = 0.3 // ступенька, на которую шагаем без прыжка (подъём лестницы 0.25)
export const REACH = 4.0 // дальность инструмента
export const MAX_EDITS = 32
export const PROBE_H = [0.6, 0.95, 1.3, 1.65] // как H в probe.frag
export const CP = 5 // длина ячейки коридора (как в r1-corridor.glsl)
export const BOX_H: V3 = [0.55, 1.0, 0.85] // как в world.glsl; центр — на 0.15 наружу от стены
export const SPH_R = 0.55
const TOP_DOOR = { c: [90, 4.0, 10.3] as V3, hw: 0.47, hh: 1.02 } // перетекающая дверь (плоскость z = c.z)
const BAR = { y: 1.05, z: -1.93 } // засов в координатах ячейки

export interface Edit { c: V3; kind: number; yaw: number; rep: boolean; room: number }
export interface Input { fwd: number; side: number; dyaw: number; dpitch: number }

export interface Game {
  pos: V3; vel: V3; yaw: number; pitch: number; ground: boolean
  room: number; tool: 0 | 1 // 0 шар, 1 проём
  edits: Edit[]
  charges: { cut: number; add: number }[]
  doorOpen: number; barCut: boolean; morph: number
  done: boolean; t: number; frames: number
  queue: ('cut' | 'add' | 'tool')[]
  input: Input
  flash: number
  // для e2e: телеметрия
  minDist: number; teleports: number; lastAim: { p: V3; n: V3; dist: number; ok: boolean }
  looking: boolean
}

export function newGame(): Game {
  const g: Game = {
    pos: [...ROOMS[0].spawn.pos], vel: [0, 0, 0], yaw: ROOMS[0].spawn.yaw, pitch: 0, ground: true,
    room: 0, tool: 1, edits: [],
    charges: ROOMS.map((r) => ({ cut: r.cuts, add: r.adds })),
    doorOpen: 0, barCut: false, morph: 0, done: false, t: 0, frames: 0, queue: [],
    input: { fwd: 0, side: 0, dyaw: 0, dpitch: 0 }, flash: 0,
    minDist: 1e9, teleports: 0, lastAim: { p: [0, 0, 0], n: [0, 1, 0], dist: -1, ok: false }, looking: true,
  }
  return g
}

// перезапуск текущей комнаты: старт, её правки и заряды, её состояние
export function restartRoom(g: Game) {
  const r = g.room, sp = ROOMS[r].spawn
  g.pos = [...sp.pos]; g.vel = [0, 0, 0]; g.yaw = sp.yaw; g.pitch = 0
  g.edits = g.edits.filter((e) => e.room !== r)
  g.charges[r] = { cut: ROOMS[r].cuts, add: ROOMS[r].adds }
  if (r === 0) (g.doorOpen = 0), (g.barCut = false)
  if (r === 2) g.morph = 0
}

export const eyeOf = (g: Game): V3 => [g.pos[0], g.pos[1] + EYE, g.pos[2]]
export const viewDir = (g: Game): V3 => [Math.sin(g.yaw) * Math.cos(g.pitch), Math.sin(g.pitch), Math.cos(g.yaw) * Math.cos(g.pitch)]
export const portalActive = (g: Game) => PORTALS.map((_, i) => (i === 6 ? g.morph < 0.02 : true))
// ближайшая к глазам точка верхней половины двери: «смотрит ли игрок на дверь» — по ней (центр двери вблизи
// уходит вниз из конуса, а низ двери с нижних ступеней закрыт самими ступенями)
export const visAnchor = (g: Game): V3 => {
  const e = eyeOf(g), c = TOP_DOOR.c
  return [Math.max(c[0] - TOP_DOOR.hw, Math.min(c[0] + TOP_DOOR.hw, e[0])), Math.max(c[1], Math.min(c[1] + TOP_DOOR.hh, e[1])), c[2] - 0.05]
}

// SDF формы правки (для проверки засова в JS): проём — бокс, шар — сфера
export function editSdf(e: Edit, p: V3) {
  let q: V3 = [p[0] - e.c[0], p[1] - e.c[1], p[2] - e.c[2]]
  if (Math.abs(e.kind) > 1.5) {
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw)
    q = [c * q[0] - s * q[2], q[1], s * q[0] + c * q[2]]
    const d = q.map((v, i) => Math.abs(v) - BOX_H[i])
    return Math.min(Math.max(d[0], d[1], d[2]), 0) + Math.hypot(Math.max(d[0], 0), Math.max(d[1], 0), Math.max(d[2], 0))
  }
  return Math.hypot(q[0], q[1], q[2]) - SPH_R * 0.95
}

const floorRef = (p: V3) => {
  if (p[0] >= 75 && p[0] < 120) return p[2] > 10.5 ? 3 : p[2] > 8 ? 3 : p[2] > 2 ? 0.5 * (p[2] - 2) : 0
  return 0
}

// probe: Float32Array 8×4 из probe.frag
export function step(g: Game, probe: Float32Array | null, dt = DT) {
  g.t += dt
  g.frames++
  g.flash = Math.max(0, g.flash - dt * 3)
  if (!probe) return
  const smp = [0, 1, 2, 3].map((i) => ({ d: probe[i * 4], g: [probe[i * 4 + 1], probe[i * 4 + 2], probe[i * 4 + 3]] as V3 }))
  const floorY = probe[16], hasFloor = probe[17] > 0.5
  const aim = { p: [probe[20], probe[21], probe[22]] as V3, dist: probe[23], n: [probe[24], probe[25], probe[26]] as V3 }
  const visible = probe[28] > 0.5
  g.minDist = Math.min(g.minDist, ...smp.map((s) => s.d))

  // ---- действия игрока (по клику/клавише) ----
  g.lastAim = { ...aim, ok: aim.dist > 0 && aim.dist < REACH }
  for (const a of g.queue.splice(0)) {
    if (a === 'tool') { g.tool = g.tool ? 0 : 1; continue }
    if (g.done) continue
    const ch = g.charges[g.room]
    const cut = a === 'cut'
    if ((cut ? ch.cut : ch.add) <= 0 || !g.lastAim.ok || g.edits.length >= MAX_EDITS) continue
    if (!editAllowed(g, aim.p, aim.n, cut)) continue
    g.edits.push(makeEdit(g, aim.p, aim.n, cut))
    if (cut) ch.cut--
    else ch.add--
    g.flash = 1
  }

  // ---- взгляд ----
  g.yaw += g.input.dyaw
  g.pitch = Math.max(-1.4, Math.min(1.4, g.pitch + g.input.dpitch))
  g.input.dyaw = g.input.dpitch = 0

  // ---- движение по горизонтали со скольжением вдоль стен ----
  const f = [Math.sin(g.yaw), Math.cos(g.yaw)], r = [-Math.cos(g.yaw), Math.sin(g.yaw)]
  let wx = f[0] * g.input.fwd + r[0] * g.input.side, wz = f[1] * g.input.fwd + r[1] * g.input.side
  const wl = Math.hypot(wx, wz)
  if (wl > 1) (wx /= wl), (wz /= wl)
  const acc = Math.min(1, 12 * dt)
  g.vel[0] += (wx * SPEED - g.vel[0]) * acc
  g.vel[2] += (wz * SPEED - g.vel[2]) * acc
  let mx = g.vel[0] * dt, mz = g.vel[2] * dt
  let push = [0, 0], dmin = 1e9
  for (const s of smp) {
    const hl = Math.hypot(s.g[0], s.g[2])
    dmin = Math.min(dmin, s.d)
    if (hl < 0.3) continue // горизонтальная поверхность (пол/потолок) — не стена
    const hx = s.g[0] / hl, hz = s.g[2] / hl
    if (s.d < R + 0.03) {
      const into = mx * hx + mz * hz
      if (into < 0) (mx -= into * hx), (mz -= into * hz) // скольжение
    }
    if (s.d < R) (push[0] += hx * (R - s.d)), (push[1] += hz * (R - s.d)) // выталкивание
  }
  // центр капсулы никогда не входит в стену: шаг не длиннее расстояния до неё
  const ml = Math.hypot(mx, mz), lim = Math.max(0, dmin - 0.03)
  if (ml > lim) (mx *= lim / ml), (mz *= lim / ml)
  const from: V3 = [g.pos[0], g.pos[1] + 0.9, g.pos[2]]
  g.pos[0] += mx + push[0] * 0.5
  g.pos[2] += mz + push[1] * 0.5

  // ---- вертикаль: гравитация, пол, ступеньки ----
  g.vel[1] -= 9.8 * dt
  g.pos[1] += g.vel[1] * dt
  g.ground = false
  if (hasFloor && g.pos[1] <= floorY + 0.02 && floorY - g.pos[1] <= STEP) {
    g.pos[1] = floorY
    g.vel[1] = 0
    g.ground = true
  }

  // ---- порталы: отрезок центра капсулы пересёк проём → перенос ----
  const to: V3 = [g.pos[0], g.pos[1] + 0.9, g.pos[2]]
  const pi = portalCross(from, to, portalActive(g))
  if (pi >= 0) {
    const x = portalXf(pi, to, g.vel)
    g.pos = [x.p[0], x.p[1] - 0.9, x.p[2]]
    g.vel = x.d
    g.yaw += x.dyaw
    g.teleports++
  }
  g.room = roomOf(g.pos)

  // ---- коридор: засов перерублен? (точки засова внутри коридорной правки-среза) ----
  if (!g.barCut)
    for (const e of g.edits) {
      if (!e.rep || e.kind < 0) continue
      for (let x = -0.7; x <= 0.71; x += 0.1) if (editSdf(e, [x, BAR.y, BAR.z]) < 0) g.barCut = true
    }
  if (g.barCut) g.doorOpen = Math.min(1, g.doorOpen + dt * 0.6)

  // ---- лестница: дверь наверху перетекает, пока на неё не смотрят ----
  if (g.room === 2 && g.morph < 1) {
    const e = eyeOf(g), v = viewDir(g), a = visAnchor(g)
    const to2 = [a[0] - e[0], a[1] - e[1], a[2] - e[2]], l = Math.hypot(...to2)
    const cos = (to2[0] * v[0] + to2[1] * v[1] + to2[2] * v[2]) / l
    g.looking = cos > Math.cos((50 * Math.PI) / 180) && visible
    if (!g.looking && g.pos[2] > 4.0) g.morph = Math.min(1, g.morph + dt * 0.5)
  }
  if (g.room === 3 && g.pos[2] > 2) g.done = true
}

// правка допустима? Срез пола запрещён (яма глубже ступеньки — ловушка); «прилепить» не может задеть игрока
// и не ставится у порталов
export function editAllowed(g: Game, p: V3, n: V3, cut: boolean) {
  if (cut) return n[1] < 0.7
  // прилепить у портала нельзя: выход из проёма не должен оказаться внутри глины (срез геометрии не создаёт)
  if (PORTALS.some((pt) => Math.hypot(p[0] - pt.c[0], p[1] - pt.c[1], p[2] - pt.c[2]) < 1.3)) return false
  const e = makeEdit(g, p, n, cut)
  const ew = { ...e, rep: false, c: e.rep ? [e.c[0], e.c[1], e.c[2] + CP * Math.round(p[2] / CP)] as V3 : e.c }
  return PROBE_H.concat([0.2]).every((h) => editSdf(ew, [g.pos[0], g.pos[1] + h, g.pos[2]]) > R + 0.1)
}

export function makeEdit(g: Game, p: V3, n: V3, cut: boolean): Edit {
  const kind = (g.tool ? 2 : 1) * (cut ? 1 : -1)
  let c: V3 = [...p]
  let yaw = 0
  if (g.tool) {
    // проём: ориентирован по нормали стены (кратно 90°), низом на полу
    const horiz = Math.abs(n[1]) < 0.7
    const a = horiz ? Math.atan2(n[0], n[2]) : g.yaw
    yaw = Math.round(a / (Math.PI / 2)) * (Math.PI / 2)
    const fl = floorRef(p)
    if (p[1] < fl + 2.2) c[1] = fl + 1.0
    c[0] += Math.sin(yaw) * 0.15 // на 1.0 в воздух, на 0.7 вглубь
    c[2] += Math.cos(yaw) * 0.15
  } else if (!cut) c = [p[0] + n[0] * 0.3, p[1] + n[1] * 0.3, p[2] + n[2] * 0.3]
  const rep = Math.abs(c[0]) < 14 && roomOf(c) === 0
  if (rep) c = [c[0], c[1], c[2] - CP * Math.round(c[2] / CP)]
  return { c, kind, yaw, rep, room: g.room }
}

// юниформы мира (правки, порталы, состояния) — общие для зонда и кадра
export function worldUniforms(g: Game) {
  const A = new Float32Array(MAX_EDITS * 4), Bv = new Float32Array(MAX_EDITS * 4)
  g.edits.forEach((e, i) => {
    A.set([...e.c, e.kind], i * 4)
    Bv.set([e.yaw, e.rep ? 1 : 0, 0, 0], i * 4)
  })
  const PC = new Float32Array(40), PS = new Float32Array(40), act = portalActive(g)
  PORTALS.forEach((pt, i) => {
    PC.set([...pt.c, pt.yaw], i * 4)
    PS.set([pt.hw, pt.hh, pt.link, act[i] ? 1 : 0], i * 4)
  })
  const arr = (a: Float32Array) => a as unknown as number[]
  return { uEdA: arr(A), uEdB: arr(Bv), uEdN: g.edits.length, uPortC: arr(PC), uPortS: arr(PS), uDoorOpen: g.doorOpen, uBarCut: g.barCut, uMorph: g.morph }
}
