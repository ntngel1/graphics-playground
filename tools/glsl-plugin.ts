// Мини-плагин вместо vite-plugin-glsl: тот склеивает #include в одну строку и теряет
// исходные файл:строку, а нам нужен точный маппинг ошибок и HMR без пересоздания эксперимента.
//
// Каждый .glsl/.frag/.vert превращается в JS-модуль, который:
//   - импортирует свои #include как обычные модули (Vite сам строит граф и следит за файлами);
//   - экспортирует ShaderSource { id, source, includes }, а склейку делает рантайм (core/shader.ts),
//     который знает, из какого файла какая строка;
//   - self-accept в HMR: новая версия модуля мутирует канонический объект из глобального реестра
//     и шлёт событие 'glsl-update' — ядро перекомпилирует только затронутые программы.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const SHADER_RE = /\.(glsl|frag|vert)$/
export const INCLUDE_RE = /^\s*#include\s+["<]([^">]+)[">]\s*;?\s*$/

export function glslModules(opts: { libDir?: string } = {}): Plugin {
  let root = process.cwd()
  return {
    name: 'glsl-modules',
    enforce: 'pre',
    configResolved(c) {
      root = c.root
    },
    transform(code, rawId) {
      const id = rawId.split('?')[0]
      if (!SHADER_RE.test(id)) return
      const lib = path.resolve(root, opts.libDir ?? 'src/glsl')
      const imports: string[] = []
      const includes: string[] = []
      code.split(/\r?\n/).forEach((line, i) => {
        const m = INCLUDE_RE.exec(line)
        if (!m) return
        const req = path.extname(m[1]) ? m[1] : m[1] + '.glsl'
        const candidates = req.startsWith('/')
          ? [path.join(root, req)]
          : [path.resolve(path.dirname(id), req), path.resolve(lib, req)]
        const file = candidates.find((f) => fs.existsSync(f))
        if (!file) this.error(`#include "${m[1]}" not found (${path.relative(root, id)}:${i + 1})`)
        const v = `__inc${imports.length}`
        imports.push(`import ${v} from ${JSON.stringify(file)};`)
        includes.push(`[${i}, ${v}]`)
      })
      const rel = path.relative(root, id).split(path.sep).join('/')
      return {
        code: `${imports.join('\n')}
const next = { id: ${JSON.stringify(rel)}, source: ${JSON.stringify(code)}, includes: [${includes.join(', ')}] };
const reg = (globalThis.__glslRegistry ??= new Map());
const prev = reg.get(next.id);
if (prev) {
  Object.assign(prev, next);
  prev.version++;
  globalThis.dispatchEvent?.(new CustomEvent('glsl-update', { detail: prev }));
} else {
  next.version = 0;
  reg.set(next.id, next);
}
export default prev ?? next;
if (import.meta.hot) import.meta.hot.accept();
`,
        map: null,
      }
    },
  }
}
