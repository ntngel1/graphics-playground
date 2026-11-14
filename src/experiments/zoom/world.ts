// Мир вложенных уровней: раскладка входов (повторяет world.glsl — менять синхронно!).
// Узел = (тип, seed); seed ребёнка — хэш от seed родителя и номера входа, поэтому дерево бесконечное
// и одинаковое в TS и в шейдере. Вход i узла: ребёнок типа CHILD[type][i] с началом координат c,
// масштабом s (единица ребёнка = s единиц родителя) и поворотом a вокруг y:
//   p_child = R(-a)(p_parent - c) / s,   p_parent = c + s R(a) p_child,   R(a) = rotY из sdf.glsl.
export type V3 = [number, number, number]

export const FIELD = 0, STONE = 1, MOSS = 2, HOUSE = 3
export const TYPE_NAME = ['луг', 'камень', 'мох', 'домик']
// x, y, z, s (y у луга и мха — высота поверхности в этой точке, посчитана заранее: hField / hMoss)
const ENT: number[][][] = [
  [[-4.2, -0.321696, 2.2, 0.26], [4.6, 0.364284, 2.8, 0.22], [0.4, 0.184617, -5.0, 0.28]],
  [[-2.6, 6, 1.3, 0.15], [2.5, 6, 2.1, 0.13], [0.5, 6, -2.7, 0.14]],
  [[-4.2, 2.869314, 1.4, 0.1], [3.6, 2.837554, 2.9, 0.095], [0.4, 2.838456, -4.6, 0.105]],
  [[-2.0, 2.95, -0.3, 0.05], [2.5, 3.38, -3.8, 0.04], [4.3, 0.5, 2.7, 0.075]],
]
export const CHILD = [[1, 1, 1], [2, 2, 2], [3, 3, 3], [1, 2, 1]]
// ограничивающий цилиндр уровня в его единицах: радиус, y от, y до (содержимое — на PAD внутри)
export const BOUND = [[1e9, -1e9, 1e9], [9.6, -2.6, 7.6], [10.8, -1.2, 6.2], [9.4, -3.6, 12.6]]
// названия входов для «хлебных крошек»
export const ENT_NAME = [
  ['камень', 'камень', 'камень'],
  ['мох', 'мох', 'мох'],
  ['домик', 'домик', 'домик'],
  ['камень на столе', 'мох в горшке', 'камень у печки'],
]

export const hu = (x: number) => {
  x >>>= 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}
export const childSeed = (s: number, i: number) => hu((s ^ Math.imul(0x9e3779b9, i + 1)) >>> 0)
export const rnd = (s: number, k: number) => (hu((s + Math.imul(k, 0x632be5ab)) >>> 0) & 0xffff) / 65535

export const hField = (x: number, z: number) =>
  0.35 * Math.sin(0.23 * x + 0.4) * Math.sin(0.19 * z + 1.3) + 0.2 * Math.sin(0.11 * x - 0.13 * z) +
  0.035 * Math.max(Math.hypot(x, z) - 16, 0) ** 1.5
export const hMoss = (x: number, z: number) => 3.2 * Math.sqrt(Math.max(1 - (x * x + z * z) / 100, 0))

export interface Ent { ct: number; c: V3; s: number; a: number }
export function ent(type: number, seed: number, i: number): Ent {
  const e = ENT[type][i]
  const c: V3 = [e[0], e[1], e[2]]
  const a = (hu((seed + Math.imul(i, 0x51ed27)) >>> 0) & 255) * (2 * Math.PI / 256)
  if (type === HOUSE && (seed & 1)) c[0] = -c[0]
  return { ct: CHILD[type][i], c, s: e[3], a }
}

export const rotY = (v: V3, a: number): V3 => {
  const c = Math.cos(a), s = Math.sin(a)
  return [c * v[0] - s * v[2], v[1], s * v[0] + c * v[2]]
}
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k]
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2])
export const toChild = (p: V3, e: Ent): V3 => mul(rotY(sub(p, e.c), -e.a), 1 / e.s)
export const toParent = (p: V3, e: Ent): V3 => add(e.c, mul(rotY(p, e.a), e.s))

export interface Node { type: number; seed: number }
export const rootNode = (gameSeed: number): Node => ({ type: FIELD, seed: hu(gameSeed * 7919 + 17) })
export function nodeAt(root: Node, path: readonly number[]): Node {
  let n = root
  for (const i of path) n = { type: CHILD[n.type][i], seed: childSeed(n.seed, i) }
  return n
}

// Подобие «кадр → предок»: p_anc = C + S R(A) p
export interface Xf { C: V3; S: number; A: number }
export const XF_ID: Xf = { C: [0, 0, 0], S: 1, A: 0 }
// поднять преобразование на один уровень (через вход e родителя): E ∘ X
export const upXf = (x: Xf, e: Ent): Xf => ({ C: toParent(x.C, e), S: e.s * x.S, A: x.A + e.a })
export const applyXf = (x: Xf, p: V3): V3 => add(x.C, mul(rotY(p, x.A), x.S))

// Места, где можно спрятать предмет (координаты уровня; y = поверхность), и размер предмета.
export const SPOTS: { at: [number, number, number][]; size: number }[] = [
  { at: [[-7.2, 0, 5.0], [5.6, 0, -3.4], [-1.6, 0, 6.6], [8.6, 0, 1.4], [-7.6, 0, -4.6], [3.2, 0, -8.2]], size: 0.8 },
  { at: [[2.0, 6, -0.6], [-0.9, 6, 2.7], [-3.6, 6, -1.9], [4.8, 6, 0.6]], size: 0.9 },
  { at: [[-0.8, 0, 0.4], [2.6, 0, -2.4], [-3.0, 0, -3.6], [5.8, 0, 0.0], [-1.6, 0, 4.9]], size: 0.6 },
  { at: [[1.1, 0.55, 0.6], [-2.0, 0.5, -0.3], [-4.5, 1.85, 2.3], [3.2, 0.5, -2.4], [2.0, 0.5, 3.3]], size: 0.8 },
]
export function spotPos(n: Node, k: number): V3 {
  const [x, y, z] = SPOTS[n.type].at[k]
  if (n.type === FIELD) return [x, hField(x, z), z]
  if (n.type === MOSS) return [x, hMoss(x, z), z]
  if (n.type === HOUSE && (n.seed & 1)) return [-x, y, z]
  return [x, y, z]
}
