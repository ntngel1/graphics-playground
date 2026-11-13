// Описания уровней (геометрия — levels/lN.glsl). Ручки: значения 0..1; locked — ручка на уровне не нужна.
type V3 = [number, number, number]

export interface Knob { label: string; hint: string; init: number; locked?: boolean }
export interface Level { id: string; name: string; hint: string; start: V3; goal: V3; goalR: number; knobs: [Knob, Knob] }

// точка над серединой дна жёлоба chute(S, E, …) (см. parts.glsl): t — от середины вдоль оси
function chuteBottom(S: V3, E: V3, t: number): V3 {
  const d = [E[0] - S[0], E[1] - S[1]], len = Math.hypot(d[0], d[1])
  const dir = [d[0] / len, d[1] / len]
  let up = [-dir[1], dir[0]] // cross(z, dir) в плоскости xy
  if (up[1] < 0) up = [-up[0], -up[1]]
  const h = 0.04 / 0.9397 + 0.12 + 0.01 // толщина дна + радиус шарика
  return [(S[0] + E[0]) / 2 + dir[0] * t + up[0] * h, (S[1] + E[1]) / 2 + dir[1] * t + up[1] * h, 0]
}
const L2 = { S: [-2.3, 0.9, 0] as V3, E: [2.3, -0.5, 0] as V3 }
const L3 = { S: [0.85, -0.85, 0] as V3, E: [3.0, -1.4, 0] as V3 }
const len = (a: V3, b: V3) => Math.hypot(b[0] - a[0], b[1] - a[1])

const MERGE: Knob = { label: 'слияние', hint: 'близкие тела оплывают и срастаются', init: 0 }
const TWIST: Knob = { label: 'скручивание', hint: 'поворачивает секции жёлоба вокруг его оси', init: 0.5 }

export const LEVELS: Level[] = [
  {
    id: 'merge',
    name: 'Слияние',
    hint: 'Шарику не перепрыгнуть пропасть. Но тела в этом мире умеют срастаться.',
    start: [-2.5, 0.82, 0],
    goal: [1.35, 0.25, 0],
    goalR: 0.3,
    knobs: [MERGE, { ...TWIST, locked: true }],
  },
  {
    id: 'twist',
    name: 'Скручивание',
    hint: 'Секции жёлоба развёрнуты. Скручивание поворачивает дальние секции сильнее ближних.',
    start: chuteBottom(L2.S, L2.E, -len(L2.S, L2.E) / 2 + 0.3),
    goal: chuteBottom(L2.S, L2.E, len(L2.S, L2.E) / 2 - 0.35),
    goalR: 0.3,
    knobs: [{ ...MERGE, locked: true }, TWIST],
  },
  {
    id: 'hatch',
    name: 'Мост и люк',
    hint: 'Мост ведёт к стене, а маяк — внизу. Слияние строит не только мосты.',
    start: [-3.1, 0.82, 0],
    goal: chuteBottom(L3.S, L3.E, len(L3.S, L3.E) / 2 - 0.35),
    goalR: 0.3,
    knobs: [MERGE, TWIST],
  },
]
