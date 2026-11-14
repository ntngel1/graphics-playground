// Данные «Невозможного дома»: порталы (уходят в шейдер юниформами — один список на рендер и физику)
// и комнаты (область, старт, заряды, подсказка). Геометрия комнат — в rN-*.glsl.

export type V3 = [number, number, number]

export interface Portal {
  c: V3 // центр проёма
  yaw: number // нормаль (sin yaw, 0, cos yaw) смотрит в комнату, где стоит портал
  hw: number
  hh: number
  link: number
}

const PX = Math.PI / 2
const door = (c: V3, yaw: number, link: number): Portal => ({ c, yaw, hw: 0.47, hh: 1.02, link })

// индексы совпадают с комментариями в GLSL
export const PORTALS: Portal[] = [
  door([-1.45, 1.0, 9.0], PX, 1), // 0 коридор: выход в стене x < 0 ячейки 2 (z = 9)
  door([26.85, 1.0, 0.0], PX, 0), // 1 прихожая: вход
  door([31.65, 1.0, 0.0], -PX, 3), // 2 дверь кладовки → зал
  door([60.0, 1.0, -0.3], 0, 2), // 3 зал: вход
  door([33.15, 1.0, 0.0], -PX, 5), // 4 задняя стенка кладовки (только изнутри будки) → лестница
  door([88.15, 1.0, 0.0], PX, 4), // 5 лестница: вход снизу
  door([90.0, 4.0, 10.3], Math.PI, 7), // 6 дверь наверху → обратно вниз (выключен, когда дверь перетекла)
  door([90.0, 1.0, -2.3], 0, 6), // 7 задняя дверь нижней площадки
  door([90.0, 4.0, 17.3], Math.PI, 9), // 8 чердак → сад
  door([300.0, 1.0, -0.2], 0, 8), // 9 сад: дверь дома
]

export interface Room {
  id: string
  name: string
  hint: string
  inside: (p: V3) => boolean
  spawn: { pos: V3; yaw: number }
  cuts: number
  adds: number
}

export const ROOMS: Room[] = [
  {
    id: 'corridor', name: 'Коридор', hint: 'Каждая стена здесь — одна и та же стена.',
    inside: (p) => p[0] < 14, spawn: { pos: [0, 0, 0], yaw: 0 }, cuts: 1, adds: 1,
  },
  {
    id: 'closet', name: 'Кладовка', hint: 'Через дверь сюда входят все.',
    inside: (p) => p[0] >= 14 && p[0] < 75, spawn: { pos: [28.2, 0, 0], yaw: PX }, cuts: 1, adds: 1,
  },
  {
    id: 'stairs', name: 'Лестница', hint: 'Дом меняется, пока на него не смотрят.',
    inside: (p) => p[0] >= 75 && p[0] < 120, spawn: { pos: [89.0, 0, 0], yaw: PX }, cuts: 1, adds: 1,
  },
  {
    id: 'garden', name: 'Сад', hint: '',
    inside: (p) => p[0] >= 120, spawn: { pos: [300, 0, 1.5], yaw: 0 }, cuts: 0, adds: 0,
  },
]
export const roomOf = (p: V3) => Math.max(0, ROOMS.findIndex((r) => r.inside(p)))

export const portN = (pt: Portal): V3 => [Math.sin(pt.yaw), 0, Math.cos(pt.yaw)]
export const portU = (pt: Portal): V3 => [Math.cos(pt.yaw), 0, -Math.sin(pt.yaw)]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

// отрезок a → b пересёк лицевую сторону активного портала? → индекс, иначе −1
export function portalCross(a: V3, b: V3, active: boolean[]): number {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  for (let i = 0; i < PORTALS.length; i++) {
    if (!active[i]) continue
    const pt = PORTALS[i], n = portN(pt)
    const da = dot([a[0] - pt.c[0], a[1] - pt.c[1], a[2] - pt.c[2]], n)
    const db = dot([b[0] - pt.c[0], b[1] - pt.c[1], b[2] - pt.c[2]], n)
    if (!(da > 0 && db <= 0)) continue
    const s = da / (da - db)
    const x: V3 = [a[0] + d[0] * s - pt.c[0], a[1] + d[1] * s - pt.c[1], a[2] + d[2] * s - pt.c[2]]
    if (Math.abs(dot(x, portU(pt))) <= pt.hw && Math.abs(x[1]) <= pt.hh) return i
  }
  return -1
}

// перенос точки/направления через портал i (как portalXf в world.glsl)
export function portalXf(i: number, p: V3, d: V3): { p: V3; d: V3; dyaw: number } {
  const A = PORTALS[i], Bp = PORTALS[A.link]
  const ni = portN(A), ui = portU(A), nj = portN(Bp), uj = portU(Bp)
  const q: V3 = [p[0] - A.c[0], p[1] - A.c[1], p[2] - A.c[2]]
  const a = dot(q, ui), b = dot(q, ni), da = dot(d, ui), db = dot(d, ni)
  return {
    p: [Bp.c[0] - a * uj[0] - b * nj[0], Bp.c[1] + q[1], Bp.c[2] - a * uj[2] - b * nj[2]],
    d: [-da * uj[0] - db * nj[0], d[1], -da * uj[2] - db * nj[2]],
    dyaw: Bp.yaw - A.yaw + Math.PI,
  }
}
