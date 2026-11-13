// Сборка шейдера из ShaderSource (+ include) с картой строк и разбор лога драйвера.
// Модуль без импортов — тестируется прямо в node.

export interface ShaderSource {
  id: string // путь от корня проекта
  source: string
  includes: [line: number, src: ShaderSource][] // 0-based строка с #include → подключаемый файл
  version: number // растёт при каждом HMR-обновлении
}

export interface SrcLoc {
  file: string
  line: number // 1-based; 0 для пролога ядра
}

export interface Assembled {
  code: string
  map: SrcLoc[] // map[i] — откуда пришла строка i+1 итогового кода
  deps: Set<string> // все id файлов, вошедших в сборку
  files: Map<string, string> // id → исходник (для фрагмента в оверлее)
}

export interface ShaderError extends SrcLoc {
  message: string
}

export const PRELUDE_ID = '<prelude>'

export const FRAG_PRELUDE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform float uTime;
uniform vec2 uResolution;
uniform vec2 uScreen;
uniform vec4 uMouse;
uniform vec4 uMousePrev;
uniform int uFrame;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
in vec2 vUv;
out vec4 fragColor;`

// Пролог не добавляется, если файл сам начинается с #version.
export function assemble(root: ShaderSource, prelude = FRAG_PRELUDE): Assembled {
  const out: string[] = []
  const map: SrcLoc[] = []
  const deps = new Set<string>()
  const files = new Map<string, string>()

  if (!/^\s*#version/.test(root.source)) {
    for (const l of prelude.split('\n')) out.push(l), map.push({ file: PRELUDE_ID, line: 0 })
  }

  const stack: string[] = []
  const walk = (s: ShaderSource) => {
    deps.add(s.id)
    files.set(s.id, s.source)
    stack.push(s.id)
    const inc = new Map(s.includes)
    s.source.split(/\r?\n/).forEach((line, i) => {
      const child = inc.get(i)
      if (!child) {
        out.push(line)
        map.push({ file: s.id, line: i + 1 })
      } else if (stack.includes(child.id)) {
        throw new Error(`circular #include: ${[...stack, child.id].join(' → ')}`)
      } else if (deps.has(child.id)) {
        out.push(`// #include ${child.id} (already included)`) // include-once
        map.push({ file: s.id, line: i + 1 })
      } else {
        walk(child)
      }
    })
    stack.pop()
  }
  walk(root)
  return { code: out.join('\n'), map, deps, files }
}

// ANGLE/Chrome/Firefox/Safari: "ERROR: 0:12: 'x' : undeclared identifier"
// Mesa: "0:12(5): error: ..."
const LOG_RE = /^(?:(?:ERROR|WARNING):\s*)?\d+:(\d+)(?:\(\d+\))?:\s*(?:error:\s*)?(.*)$/

export function parseLog(log: string, a: Assembled | null, fallbackFile = '?'): ShaderError[] {
  const errs: ShaderError[] = []
  for (const raw of log.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('WARNING')) continue
    const m = LOG_RE.exec(line)
    if (!m) {
      if (!/compilation errors|^\0/.test(line)) errs.push({ file: fallbackFile, line: 0, message: line })
      continue
    }
    const n = +m[1]
    const loc = a?.map[n - 1] ?? { file: fallbackFile, line: n }
    errs.push({ ...loc, message: m[2] })
  }
  return errs
}

// Фрагмент исходника вокруг строки ошибки: [номер, текст, это строка ошибки]
export function snippet(source: string, line: number, radius = 3): [number, string, boolean][] {
  const lines = source.split(/\r?\n/)
  const from = Math.max(1, line - radius)
  const to = Math.min(lines.length, line + radius)
  const res: [number, string, boolean][] = []
  for (let i = from; i <= to; i++) res.push([i, lines[i - 1], i === line])
  return res
}
