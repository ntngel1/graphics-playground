// Логика «Бесконечного зума» без DOM/GL: камера в координатах текущего узла, перебазирование
// при входе/выходе, зум к точке под курсором с упором, панорама «за точку», автозум, задания и подсказка.
// Шаг вызывается раз в кадр из Pass.uniforms с данными зонда (probe.frag) — детерминирован по __gp.step.
import {
  add, BOUND, ent, ENT_NAME, hu, len, mul, nodeAt, rnd, rootNode, rotY, SPOTS, spotPos, sub, toChild, toParent,
  TYPE_NAME, upXf, XF_ID, type Ent, type Node, type V3, type Xf,
} from './world.ts'

export const FOV = 50
export const D_DOWN = 14 // войти в ребёнка, когда до центра обзора < 14 его единиц
export const D_UP = 22 // выйти к родителю, когда > 22
export const D_HOME = 24 // обзор корня
export const FLOOR = 2.2 // ближе нельзя (в единицах узла поверхности под курсором)
export const PITCH_MIN = 0.5, PITCH_MAX = 1.45

export interface Cam { T: V3; d: number; yaw: number; pitch: number }
export interface Probe {
  hit: boolean; H: V3; t: number
  sc: number; frame: number; path: number; depth: number // узел поверхности: масштаб, кадр, путь от кадра
  mat: number; type: number; centerT: number
  sc1: number // масштаб узла на уровень глубже камеры на пути к поверхности (0 — нет)
}
export interface Task { kind: number; path: number[]; spot: number; yaw: number; found: boolean }

export const ITEMS = [
  { name: 'красную варежку', title: 'Красная варежка', found: 'Нашлась!', color: '#d9241a' },
  { name: 'потерянный ключ', title: 'Ключ', found: 'Нашёлся!', color: '#f0b030' },
  { name: 'рыжего кота', title: 'Рыжий кот', found: 'Нашёлся!', color: '#ee8a2a' },
  { name: 'синий клубок', title: 'Клубок', found: 'Нашёлся!', color: '#5566dd' },
  { name: 'жёлтую уточку', title: 'Уточка', found: 'Нашлась!', color: '#f5d21e' },
]

export interface Game {
  seed: number
  root: Node
  path: number[] // путь к узлу камеры
  node: Node
  cam: Cam
  t: number
  cursor: [number, number] // uv курсора (y вверх)
  res: [number, number] // размер буфера сцены (для лучей на CPU)
  zoomAcc: number // накопленный лог-зум колеса/щипка (<0 — ближе)
  zoomIdle: number
  spring: { H: V3; floor: number } | null // упор: куда мягко отъехать
  bump: number // время последнего упора
  orbit: [number, number] // накопленный поворот (рад)
  grab: { G: V3 | null } | null // панорама: точка-хватка (ждём зонд)
  auto: { H: V3 | null; dT: number; home?: boolean } | null
  pending: { click?: boolean; dbl?: boolean; orbit?: boolean }
  task: Task
  done: number
  foundAt: number
  maxDepth: number
  freeze?: boolean // e2e: не перебазировать (сравнение одного кадра в двух системах координат)
}

export const camDir = (c: Cam): V3 => [Math.cos(c.pitch) * Math.sin(c.yaw), Math.sin(c.pitch), Math.cos(c.pitch) * Math.cos(c.yaw)]
export const camPos = (c: Cam): V3 => add(c.T, mul(camDir(c), c.d))
const norm = (v: V3): V3 => mul(v, 1 / (len(v) || 1))
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

// луч через uv — как cameraRay в camera.glsl
export function camRay(g: Game, uv: [number, number]): V3 {
  const pos = camPos(g.cam)
  const w = norm(sub(g.cam.T, pos))
  const u = norm(cross(w, [0, 1, 0]))
  const v = cross(u, w)
  const [rx, ry] = g.res
  const m = Math.min(rx, ry)
  const px = ((2 * uv[0] - 1) * rx) / m, py = ((2 * uv[1] - 1) * ry) / m
  const f = 1 / Math.tan((FOV * Math.PI) / 360)
  return norm(add(add(mul(u, px), mul(v, py)), mul(w, f)))
}
// точка → uv экрана (для сценариев e2e); null — за камерой
export function project(g: Game, p: V3): [number, number] | null {
  const pos = camPos(g.cam)
  const w = norm(sub(g.cam.T, pos))
  const u = norm(cross(w, [0, 1, 0]))
  const v = cross(u, w)
  const r = sub(p, pos)
  const z = r[0] * w[0] + r[1] * w[1] + r[2] * w[2]
  if (z <= 0) return null
  const f = 1 / Math.tan((FOV * Math.PI) / 360)
  const [rx, ry] = g.res
  const m = Math.min(rx, ry)
  const px = ((r[0] * u[0] + r[1] * u[1] + r[2] * u[2]) / z) * f, py = ((r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) / z) * f
  return [((px * m) / rx + 1) / 2, ((py * m) / ry + 1) / 2]
}

export function newGame(seed = 1): Game {
  const root = rootNode(seed)
  const g: Game = {
    seed, root, path: [], node: root,
    cam: { T: [0, 0.3, 0], d: D_HOME, yaw: 0.6, pitch: 0.85 },
    t: 0, cursor: [0.5, 0.5], res: [960, 600],
    zoomAcc: 0, zoomIdle: 9, spring: null, bump: -9, orbit: [0, 0], grab: null, auto: null, pending: {},
    task: null as unknown as Task, done: 0, foundAt: -9, maxDepth: 0,
  }
  g.task = newTask(g)
  return g
}

// k-е задание: глубина 1, 2, 3, 4, потом 3..5; путь и место — от сида
export function newTask(g: Game): Task {
  const k = g.done
  const s = hu(Math.imul(g.seed, 31) + k * 7 + 3)
  const depth = k < 4 ? k + 1 : 3 + Math.floor(rnd(s, 0) * 2.999)
  const path: number[] = []
  for (let d = 0; d < depth; d++) path.push(Math.floor(rnd(s, 1 + d) * 2.999))
  const n = nodeAt(g.root, path)
  return {
    kind: (k + g.seed) % ITEMS.length,
    path,
    spot: Math.floor(rnd(s, 9) * (SPOTS[n.type].at.length - 0.001)),
    yaw: rnd(s, 10) * Math.PI * 2,
    found: false,
  }
}

// ---------- перебазирование ----------
// точки, живущие в координатах узла камеры, переводим вместе с камерой
function remap(g: Game, f: (p: V3) => V3, k: number) {
  if (g.spring) g.spring = { H: f(g.spring.H), floor: g.spring.floor * k }
  if (g.grab?.G) g.grab.G = f(g.grab.G)
  if (g.auto) g.auto = { ...g.auto, H: g.auto.H && f(g.auto.H), dT: g.auto.dT * k }
}
function enter(g: Game, i: number, e: Ent) {
  g.path.push(i)
  g.node = nodeAt(g.root, g.path)
  g.cam = { ...g.cam, T: toChild(g.cam.T, e), d: g.cam.d / e.s, yaw: g.cam.yaw + e.a }
  remap(g, (p) => toChild(p, e), 1 / e.s)
  g.maxDepth = Math.max(g.maxDepth, g.path.length)
}
function exit(g: Game) {
  const i = g.path.pop()!
  g.node = nodeAt(g.root, g.path)
  const e = ent(g.node.type, g.node.seed, i)
  g.cam = { ...g.cam, T: toParent(g.cam.T, e), d: g.cam.d * e.s, yaw: g.cam.yaw - e.a }
  remap(g, (p) => toParent(p, e), e.s)
}
export function rebase(g: Game): number {
  let moves = 0
  if (g.freeze) return 0
  for (let it = 0; it < 16; it++) {
    const n = g.node
    let moved = false
    for (let i = 0; i < 3 && !moved; i++) {
      const e = ent(n.type, n.seed, i)
      if (g.cam.d / e.s > D_DOWN) continue
      const T = toChild(g.cam.T, e)
      const b = BOUND[e.ct]
      if (Math.hypot(T[0], T[2]) < b[0] - 1 && T[1] > b[1] && T[1] < b[2] + 8) (enter(g, i, e), (moved = true))
    }
    if (!moved && g.path.length) {
      const b = BOUND[n.type]
      if (g.cam.d > D_UP || Math.hypot(g.cam.T[0], g.cam.T[2]) > b[0] + 0.5) (exit(g), (moved = true))
    }
    if (!moved) break
    moves++
  }
  return moves
}

// ---------- кадры для шейдера ----------
export interface Frame { type: number; seed: number; skip: number; xf: Xf }
export function frames(g: Game): Frame[] {
  const out: Frame[] = [{ type: g.node.type, seed: g.node.seed, skip: -1, xf: XF_ID }]
  let xf = XF_ID
  for (let j = 1; j <= 2 && j <= g.path.length; j++) {
    const idx = g.path[g.path.length - j]
    const par = nodeAt(g.root, g.path.slice(0, g.path.length - j))
    xf = upXf(xf, ent(par.type, par.seed, idx))
    out.push({ type: par.type, seed: par.seed, skip: idx, xf })
  }
  return out
}
// поворот узла камеры относительно корня (для солнца)
export function rootAngle(g: Game): number {
  let a = 0, n = g.root
  for (const i of g.path) {
    a += ent(n.type, n.seed, i).a
    n = nodeAt(n, [i])
  }
  return a
}
// масштаб узла камеры относительно корня (единица узла = scale единиц луга)
export function rootScale(g: Game): number {
  let s = 1, n = g.root
  for (const i of g.path) {
    s *= ent(n.type, n.seed, i).s
    n = nodeAt(n, [i])
  }
  return s
}
// где рисовать предмет: кадр, путь от кадра (base-4), глубина; кадр −1 — вне окна
export function itemRef(g: Game, fr: Frame[]): { frame: number; path: number; depth: number } {
  const P = g.task.path
  for (let f = 0; f < fr.length; f++) {
    const anchor = g.path.slice(0, g.path.length - f)
    if (P.length < anchor.length || anchor.some((v, k) => P[k] !== v)) continue
    const rel = P.slice(anchor.length)
    if (f > 0 && rel.length && rel[0] === fr[f].skip) continue
    if (rel.length >= 6) return { frame: -1, path: 0, depth: 0 }
    return { frame: f, path: rel.reduce((a, v, k) => a + v * 4 ** k, 0), depth: rel.length }
  }
  return { frame: -1, path: 0, depth: 0 }
}
export function itemLocal(g: Game): { pos: V3; yaw: number; size: number } {
  const n = nodeAt(g.root, g.task.path)
  return { pos: spotPos(n, g.task.spot), yaw: g.task.yaw, size: SPOTS[n.type].size * (g.task.kind === 2 ? 1.5 : 1) }
}

// ---------- шаг ----------
const zoomAbout = (g: Game, H: V3, k: number) => {
  g.cam.T = add(H, mul(sub(g.cam.T, H), k))
  g.cam.d *= k
}
export const needsProbe = (g: Game) =>
  g.zoomAcc !== 0 || !!g.spring || !!(g.grab && !g.grab.G) || !!(g.auto && !g.auto.H && !g.auto.home) || !!(g.pending.click || g.pending.dbl || g.pending.orbit)

export function startHome(g: Game) {
  g.auto = { H: null, dT: D_HOME, home: true }
  g.zoomAcc = 0
}

export function step(g: Game, P: Probe | null, dt: number) {
  g.t += dt
  g.zoomIdle += dt
  // клик/двойной клик/начало поворота — по зонду под курсором
  if (P) {
    const onItem = P.hit && P.mat >= 100
    if (g.pending.click && onItem && !g.task.found) found(g)
    if (g.pending.dbl) {
      if (onItem && !g.task.found) found(g)
      else if (P.hit) g.auto = { H: P.H, dT: autoTarget(g, P) }
    }
    if (g.pending.orbit && P.centerT > 0) {
      const pos = camPos(g.cam)
      const w = norm(sub(g.cam.T, pos))
      g.cam.T = add(pos, mul(w, P.centerT))
      g.cam.d = P.centerT
    }
    g.pending = {}
  }
  // поворот
  if (g.orbit[0] || g.orbit[1]) {
    g.cam.yaw -= g.orbit[0]
    g.cam.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, g.cam.pitch + g.orbit[1]))
    g.orbit = [0, 0]
  }
  // панорама: точка-хватка остаётся под курсором (плоскость на её высоте)
  if (g.grab) {
    if (!g.grab.G && P?.hit) g.grab.G = P.H
    const G = g.grab.G
    if (G) {
      const pos = camPos(g.cam), rd = camRay(g, g.cursor)
      const t = (G[1] - pos[1]) / rd[1]
      if (Math.abs(rd[1]) > 1e-4 && t > 0 && t < 40 * g.cam.d) {
        const hit = add(pos, mul(rd, t))
        g.cam.T = add(g.cam.T, [G[0] - hit[0], 0, G[2] - hit[2]])
      }
    }
  }
  // зум колесом/щипком к точке под курсором; упор — по масштабу узла поверхности
  if (g.zoomAcc !== 0 && P) {
    g.auto = null
    let w = g.zoomAcc * Math.min(1, dt * 14)
    if (Math.abs(g.zoomAcc) < 1e-3) w = g.zoomAcc
    g.zoomAcc -= w
    const pos = camPos(g.cam)
    const H = P.hit ? P.H : add(pos, mul(camRay(g, g.cursor), g.cam.d))
    if (w < 0) {
      const floor = FLOOR * (P.hit ? P.sc : 1)
      const x = Math.log(len(sub(pos, H)) / floor)
      if (x + w < 0) {
        const r = x > 0 ? 1 : Math.max(0, 1 + x / 0.3) ** 2
        w = Math.max(x > 0 ? -x + (x + w) * 0.5 : w * r, -0.3 - x)
        g.bump = g.t
      }
      g.spring = { H, floor }
    } else if (!g.path.length && g.cam.d * Math.exp(w) > D_HOME + 2) w = Math.log((D_HOME + 2) / g.cam.d)
    zoomAbout(g, H, Math.exp(w))
    g.zoomIdle = 0
  }
  // мягкий отъезд от упора, когда ввод затих
  if (g.spring && g.zoomIdle > 0.15) {
    const D = len(sub(camPos(g.cam), g.spring.H))
    if (D < g.spring.floor * 1.02) zoomAbout(g, g.spring.H, Math.exp(Math.min(Math.log((g.spring.floor * 1.04) / D), dt * 2.5)))
    else g.spring = null
  }
  // автозум (двойной клик) и «домой»
  if (g.auto) {
    const a = 1 - Math.exp(-dt * 2.6)
    if (g.auto.home) {
      if (g.path.length) g.cam.d *= Math.exp(dt * 3.2)
      else {
        g.cam.T = add(g.cam.T, mul(sub([0, 0.3, 0], g.cam.T), a))
        g.cam.d = Math.exp(Math.log(g.cam.d) + (Math.log(D_HOME) - Math.log(g.cam.d)) * a)
        if (Math.abs(Math.log(g.cam.d / D_HOME)) < 0.01) g.auto = null
      }
      g.cam.pitch += (0.85 - g.cam.pitch) * a
    } else if (g.auto.H) {
      g.cam.T = add(g.cam.T, mul(sub(g.auto.H, g.cam.T), a))
      g.cam.d = Math.exp(Math.log(g.cam.d) + (Math.log(g.auto.dT) - Math.log(g.cam.d)) * a)
      if (Math.abs(Math.log(g.cam.d / g.auto.dT)) < 0.01 && len(sub(g.auto.H, g.cam.T)) < 0.01 * g.cam.d) g.auto = null
    }
  }
  rebase(g)
  if (!g.path.length) {
    const r = Math.hypot(g.cam.T[0], g.cam.T[2])
    if (r > 26) g.cam.T = [(g.cam.T[0] * 26) / r, g.cam.T[1], (g.cam.T[2] * 26) / r]
    g.cam.d = Math.min(g.cam.d, D_HOME + 2)
  }
}

// двойной клик: на уровень глубже, если под курсором вход (обзор ребёнка), иначе втрое ближе до упора
function autoTarget(g: Game, P: Probe) {
  if (P.depth - P.frame >= 1 && P.sc1 > 0) return 9 * P.sc1
  return Math.max(FLOOR * 1.3 * P.sc, g.cam.d * 0.33)
}

function found(g: Game) {
  g.task.found = true
  g.foundAt = g.t
  g.done++
}
export function nextTask(g: Game) {
  g.task = newTask(g)
}

// ---------- подсказка «теплее/холоднее» ----------
export function warmth(g: Game): number {
  const P = g.task.path, C = g.path
  let L = 0
  while (L < P.length && L < C.length && P[L] === C[L]) L++
  if (L < C.length) return 0.3 * (L / P.length) // свернули не туда
  if (C.length === P.length) return 1
  const e = ent(g.node.type, g.node.seed, P[C.length])
  const dist = Math.hypot(g.cam.T[0] - e.c[0], g.cam.T[2] - e.c[2])
  return Math.min(0.95, 0.35 + (0.45 * C.length) / P.length + 0.15 * Math.max(0, 1 - dist / 8))
}
export const warmthText = (w: number, offPath: boolean) =>
  w >= 0.99 ? 'горячо! предмет где-то здесь' : w >= 0.7 ? 'тепло' : w >= 0.45 ? 'теплее' : offPath ? 'холодно — вернись повыше' : 'холодно'
export const offPath = (g: Game) => g.path.some((v, k) => k >= g.task.path.length || g.task.path[k] !== v)

export function crumbs(g: Game): string[] {
  const out = [TYPE_NAME[0]]
  let n = g.root
  for (const i of g.path) {
    out.push(ENT_NAME[n.type][i])
    n = nodeAt(n, [i])
  }
  return out
}

export const sunDir = (g: Game): V3 => rotY(norm([0.45, 0.78, 0.35]), -rootAngle(g))
