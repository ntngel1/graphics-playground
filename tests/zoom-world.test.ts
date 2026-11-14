// «Бесконечный зум»: раскладка дерева уровней и перебазирование камеры (чистый TS, без браузера).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { camPos, frames, itemRef, newGame, newTask, rebase, step, type Game, type Probe } from '../src/experiments/zoom/game.ts'
import {
  applyXf, BOUND, CHILD, childSeed, ent, len, nodeAt, rootNode, SPOTS, spotPos, sub, toChild, toParent, upXf, XF_ID, type V3, type Xf,
} from '../src/experiments/zoom/world.ts'

const SEEDS = [1, 2, 3, 17, 99, 1234, 777777, 0xdeadbeef]
const near = (a: V3, b: V3, eps: number) => len(sub(a, b)) < eps

// единица узла камеры → корень (для сравнения положения камеры до и после перебазирования)
function toRoot(g: Game, p: V3): V3 {
  let x: Xf = XF_ID
  for (let j = g.path.length - 1; j >= 0; j--) {
    const par = nodeAt(g.root, g.path.slice(0, j))
    x = upXf(x, ent(par.type, par.seed, g.path[j]))
  }
  return applyXf(x, p)
}

test('seeds: deterministic, children differ', () => {
  for (const s of SEEDS) {
    const kids = [0, 1, 2].map((i) => childSeed(s >>> 0, i))
    assert.equal(new Set(kids).size, 3)
    assert.deepEqual(kids, [0, 1, 2].map((i) => childSeed(s >>> 0, i)))
  }
})

test('entrances: inverse transforms, children inside parent, no overlaps, item spots clear', () => {
  for (const s of SEEDS) {
    for (let type = 0; type < 4; type++) {
      const n = { type, seed: childSeed(s >>> 0, 7) }
      const es = [0, 1, 2].map((i) => ent(type, n.seed, i))
      for (const e of es) {
        assert.equal(e.ct, CHILD[type][es.indexOf(e)])
        const p: V3 = [1.3, -0.7, 2.9]
        assert.ok(near(toParent(toChild(p, e), e), p, 1e-9))
        if (type > 0) assert.ok(Math.hypot(e.c[0], e.c[2]) + BOUND[e.ct][0] * e.s < BOUND[type][0] - 0.4, `child bound leaves parent: type ${type}`)
      }
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++) {
          const d = Math.hypot(es[i].c[0] - es[j].c[0], es[i].c[2] - es[j].c[2])
          assert.ok(d > BOUND[es[i].ct][0] * es[i].s + BOUND[es[j].ct][0] * es[j].s, `entrances overlap: type ${type} ${i}/${j}`)
        }
      for (let k = 0; k < SPOTS[type].at.length; k++) {
        const sp = spotPos(n, k)
        for (const e of es) {
          const d = Math.hypot(sp[0] - e.c[0], sp[2] - e.c[2])
          const below = sp[1] + SPOTS[type].size < e.c[1] + BOUND[e.ct][1] * e.s // под входом (под столом)
          assert.ok(below || d > BOUND[e.ct][0] * e.s + SPOTS[type].size * 0.5, `item spot ${k} of type ${type} inside an entrance`)
        }
      }
    }
  }
})

test('rebase: entering and leaving keeps the camera where it was', () => {
  const g = newGame(5)
  const route = [1, 0, 2, 0, 1, 2, 0]
  for (const i of route) {
    const e = ent(g.node.type, g.node.seed, i)
    g.cam.T = toParent([0, 2, 0], e)
    g.cam.d = 9 * e.s
    const before = toRoot(g, camPos(g.cam))
    const depth = g.path.length
    assert.equal(rebase(g), 1)
    assert.equal(g.path.length, depth + 1)
    assert.equal(g.path.at(-1), i)
    const after = toRoot(g, camPos(g.cam))
    assert.ok(len(sub(before, after)) < 1e-9 * Math.max(1, len(before)), 'camera moved on rebase')
  }
  assert.equal(g.node.type, nodeAt(rootNode(5), route).type)
  // наружу: большой d — выходим по одному уровню, камера на месте
  while (g.path.length) {
    g.cam.d = 30
    const before = toRoot(g, camPos(g.cam))
    rebase(g)
    assert.ok(len(sub(before, toRoot(g, camPos(g.cam)))) < 1e-6)
  }
})

test('frames: up to two ancestors, transforms consistent with toParent', () => {
  const g = newGame(9)
  for (const i of [0, 2, 1, 0]) {
    const e = ent(g.node.type, g.node.seed, i)
    g.cam.T = toParent([0, 2, 0], e)
    g.cam.d = 9 * e.s
    rebase(g)
  }
  const fr = frames(g)
  assert.equal(fr.length, 3)
  const p: V3 = [0.3, 1.1, -0.4]
  const par = nodeAt(g.root, g.path.slice(0, -1))
  assert.ok(near(applyXf(fr[1].xf, p), toParent(p, ent(par.type, par.seed, g.path.at(-1)!)), 1e-9))
  assert.equal(fr[1].skip, g.path.at(-1))
})

test('tasks: depth 1..4 then 3..5, valid paths, item drawn from the root view', () => {
  for (const s of SEEDS.slice(0, 5)) {
    const g = newGame(s)
    for (let k = 0; k < 12; k++) {
      g.done = k
      const t = newTask(g)
      if (k < 4) assert.equal(t.path.length, k + 1)
      else assert.ok(t.path.length >= 3 && t.path.length <= 5)
      assert.ok(t.path.every((i) => i >= 0 && i < 3))
      assert.ok(t.spot >= 0 && t.spot < SPOTS[nodeAt(g.root, t.path).type].at.length)
      g.task = t
      const r = itemRef(g, frames(g))
      assert.equal(r.frame, 0)
      assert.equal(r.depth, t.path.length)
    }
  }
})

// зонд-заглушка: попадание в плоскость y = 0 корня, «узел поверхности» — корень (вход не под курсором)
function fakeProbe(g: Game): Probe {
  const pos = camPos(g.cam)
  const rd = sub(g.cam.T, pos)
  const t = -pos[1] / rd[1]
  return { hit: true, H: [pos[0] + rd[0] * t, 0, pos[2] + rd[2] * t], t, sc: 1, sc1: 0, frame: 0, path: 0, depth: 0, mat: 1, type: 0, centerT: t }
}
test('zoom: not over an entrance — stops at the floor and springs back', () => {
  const g = newGame(1)
  g.cam = { T: [8, 0, 6], d: 10, yaw: 0.6, pitch: 0.9 }
  let minD = 1e9
  for (let i = 0; i < 200; i++) {
    g.zoomAcc -= 0.08
    step(g, fakeProbe(g), 1 / 60)
    minD = Math.min(minD, len(sub(camPos(g.cam), [8, 0, 6])))
  }
  assert.ok(minD > 2.2 * Math.exp(-0.31), `went through the floor: ${minD}`)
  for (let i = 0; i < 200; i++) step(g, fakeProbe(g), 1 / 60)
  assert.ok(len(sub(camPos(g.cam), [8, 0, 6])) >= 2.2 * 0.999, 'did not spring back')
  assert.equal(g.path.length, 0)
})
