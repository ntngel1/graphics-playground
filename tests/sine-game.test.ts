// Resonance: детерминированные сессии ботов (логика игры — чистый TS, гоняется без браузера).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bot, difficulty, MAX_ENT, newGame, pack, slots, step } from '../src/experiments/sine/game.ts'

const SEEDS = [11, 23, 37, 41, 59, 67, 71, 83]
const MAX_T = 600

function run(seed: number, mode: 'switch' | 'stay' | 'idle') {
  const g = newGame(seed)
  const buf = new Float32Array(MAX_ENT * 16)
  let maxD = 0
  while (!g.over && g.t < MAX_T) {
    bot(g, mode)
    step(g)
    maxD = Math.max(maxD, difficulty(g))
    if (g.steps % 30 === 0) {
      const n = pack(g, buf)
      assert.ok(n <= MAX_ENT && slots(g) <= MAX_ENT)
      for (let i = 0; i < buf.length; i++) assert.ok(Number.isFinite(buf[i]), `NaN in slot data, seed ${seed}, t ${g.t}`)
    }
  }
  return { t: g.t, score: g.score, over: g.over, maxD, kinds: g.seen.size }
}

test('deterministic', () => assert.deepEqual(run(5, 'switch'), run(5, 'switch')))

test('bots: idle dies fast, switching bot lives long and outscores the stubborn one', () => {
  const avg = (rs: { score: number; t: number }[], k: 'score' | 't') => rs.reduce((a, r) => a + r[k], 0) / rs.length
  const sw = SEEDS.map((s) => run(s, 'switch'))
  const st = SEEDS.map((s) => run(s, 'stay'))
  const idle = SEEDS.map((s) => run(s, 'idle'))
  console.log(`switch: score ${avg(sw, 'score').toFixed(0)}, t ${avg(sw, 't').toFixed(0)}s · stay: ${avg(st, 'score').toFixed(0)}, ${avg(st, 't').toFixed(0)}s · idle: ${avg(idle, 'score').toFixed(1)}, ${avg(idle, 't').toFixed(0)}s`)
  for (const r of idle) assert.ok(r.over && r.t < 90, `idle should die: ${r.t}`)
  for (const r of sw) assert.ok(r.t > 60, 'switching bot should survive a while')
  assert.ok(sw.every((r) => r.over), 'the game must eventually kill even the bot')
  assert.ok(sw.every((r) => r.kinds === 5 && r.maxD > 3), 'difficulty grows, all kinds appear')
  assert.ok(avg(sw, 'score') > 2.5 * avg(st, 'score'), 'frequency switching must matter')
})
