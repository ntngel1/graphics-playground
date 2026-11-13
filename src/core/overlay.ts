import { PRELUDE_ID, snippet, type ShaderError } from './shader.ts'

export interface Overlay {
  set(key: string, errors: ShaderError[] | null, files?: Map<string, string>): void
  notice(text: string, ms?: number): void // ненавязчивое предупреждение, само исчезает
  clear(): void
}

export function createOverlay(): Overlay {
  const el = document.createElement('div')
  el.className = 'gp-overlay'
  el.hidden = true
  document.body.append(el)
  const entries = new Map<string, { errors: ShaderError[]; files: Map<string, string> }>()

  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

  const render = () => {
    el.hidden = entries.size === 0
    let html = ''
    for (const [key, { errors, files }] of entries) {
      html += `<div class="gp-ov-pass">${esc(key)}</div>`
      const shown = new Set<string>()
      for (const e of errors) {
        const where = e.file === PRELUDE_ID ? 'prelude' : `${e.file}${e.line ? ':' + e.line : ''}`
        html += `<div class="gp-ov-err"><b>${esc(where)}</b> ${esc(e.message)}</div>`
        const src = files.get(e.file)
        const k = `${e.file}:${e.line}`
        if (src && e.line && !shown.has(k)) {
          shown.add(k)
          html += '<pre>' + snippet(src, e.line).map(([n, t, hit]) =>
            `<span${hit ? ' class="hit"' : ''}>${String(n).padStart(4)} │ ${esc(t)}</span>`).join('\n') + '</pre>'
        }
      }
    }
    el.innerHTML = html
  }

  const toast = document.createElement('div')
  toast.className = 'gp-notice'
  toast.hidden = true
  document.body.append(toast)
  let toastTimer = 0

  return {
    notice(text, ms = 7000) {
      toast.textContent = text
      toast.hidden = false
      clearTimeout(toastTimer)
      toastTimer = window.setTimeout(() => (toast.hidden = true), ms)
    },
    set(key, errors, files = new Map()) {
      if (errors?.length) entries.set(key, { errors, files })
      else entries.delete(key)
      render()
    },
    clear() {
      entries.clear()
      render()
    },
  }
}
