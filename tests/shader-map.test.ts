// node --test tests/ — маппинг строк склеенного шейдера обратно на файл:строку.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assemble, FRAG_PRELUDE, parseLog, PRELUDE_ID, type ShaderSource } from '../src/core/shader.ts'

const src = (id: string, source: string, includes: [number, ShaderSource][] = []): ShaderSource =>
  ({ id, source, includes, version: 0 })

const util = src('lib/util.glsl', 'float a() {\n  return 1.0;\n}')
const noise = src('lib/noise.glsl', '#include "util.glsl"\nfloat n() {\n  return BROKEN;\n}', [[0, util]])
const main = src('exp/main.frag', '#include "noise.glsl"\n#include "util.glsl"\nvoid main() {\n  fragColor = vec4(oops);\n}', [[0, noise], [1, util]])

const lineOf = (code: string, needle: string) => code.split('\n').findIndex((l) => l.includes(needle)) + 1

test('maps driver lines back to files, include-once', () => {
  const a = assemble(main)
  const pre = FRAG_PRELUDE.split('\n').length
  assert.equal(a.map.length, a.code.split('\n').length)
  assert.equal(a.map[0].file, PRELUDE_ID)
  assert.deepEqual(a.map[pre], { file: 'lib/util.glsl', line: 1 }) // самый глубокий include идёт первым
  assert.equal(a.code.split('\n').filter((l) => l.startsWith('float a()')).length, 1)
  assert.deepEqual([...a.deps].sort(), ['exp/main.frag', 'lib/noise.glsl', 'lib/util.glsl'])

  const l1 = lineOf(a.code, 'BROKEN')
  const l2 = lineOf(a.code, 'oops')
  const log = `ERROR: 0:${l1}: 'BROKEN' : undeclared identifier\nERROR: 0:${l2}: 'oops' : undeclared identifier\nERROR: 2 compilation errors.  No code generated.\n\0`
  const errs = parseLog(log, a)
  assert.deepEqual(errs.map((e) => `${e.file}:${e.line}`), ['lib/noise.glsl:3', 'exp/main.frag:4'])
  // mesa-формат
  assert.deepEqual(parseLog(`0:${l2}(15): error: oops undeclared`, a)[0], { file: 'exp/main.frag', line: 4, message: 'oops undeclared' })
})

test('no prelude when shader has #version', () => {
  const a = assemble(src('x.frag', '#version 300 es\nvoid main(){}'))
  assert.deepEqual(a.map[0], { file: 'x.frag', line: 1 })
})

test('circular include is reported', () => {
  const a = src('a.glsl', 'x', [])
  const b = src('b.glsl', 'y', [[0, a]])
  a.includes = [[0, b]]
  assert.throws(() => assemble(a), /circular/)
})
