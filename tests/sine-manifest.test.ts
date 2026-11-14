// Манифест Resonance: в шейдерах игры нет ничего, кроме алфавита из alphabet.glsl.
// Встроенные функции — только из ALLOWED; include — только файлы этой же папки; никаких текстур.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const DIR = path.join(import.meta.dirname, '../src/experiments/sine')
const ALLOWED = new Set(['sin', 'sqrt', 'dot', 'abs', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep'])
const CONSTRUCTORS = new Set(['vec2', 'vec3', 'vec4', 'float', 'int', 'bool'])
const KEYWORDS = new Set(['if', 'for', 'while', 'return', 'switch'])
const TYPES = '(?:void|float|int|bool|vec2|vec3|vec4)'

const files = fs.readdirSync(DIR).filter((f) => /\.(frag|glsl)$/.test(f))
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const sources = Object.fromEntries(files.map((f) => [f, strip(fs.readFileSync(path.join(DIR, f), 'utf8'))]))
const userFns = new Set(Object.values(sources).flatMap((s) => [...s.matchAll(new RegExp(`^\\s*${TYPES}\\s+(\\w+)\\s*\\(`, 'gm'))].map((m) => m[1])))

test('sine shaders use only the alphabet', () => {
  assert.ok(files.includes('alphabet.glsl') && files.includes('main.frag'))
  for (const [f, s] of Object.entries(sources)) {
    for (const m of s.matchAll(/#include\s+(.+)/g)) assert.match(m[1], /^"[\w.-]+"\s*$/, `${f}: include outside the game folder: ${m[1]}`)
    assert.ok(!/\bsampler\w*\b|\btexture\w*\s*\(|\btexelFetch\b/.test(s), `${f}: textures are not allowed`)
    const used = new Set([...s.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]))
    const extra = [...used].filter((n) => !ALLOWED.has(n) && !CONSTRUCTORS.has(n) && !KEYWORDS.has(n) && !userFns.has(n))
    assert.deepEqual(extra, [], `${f}: calls outside the alphabet`)
  }
})

test('manifest check catches forbidden calls', () => {
  const bad = strip('float f(vec2 p) { return atan(p.y, p.x) + cos(p.x); } // sin only')
  const used = [...bad.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]).filter((n) => !ALLOWED.has(n) && !CONSTRUCTORS.has(n) && n !== 'f')
  assert.deepEqual(used, ['atan', 'cos'])
})
