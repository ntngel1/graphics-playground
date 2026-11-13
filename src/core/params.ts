import type { FolderApi, Pane } from 'tweakpane'
import type { UniformValue } from './program.ts'
import type { ExperimentContext, ParamDef, ParamSchema, ParamValue, ParamValues, SelectParam } from './types.ts'

type Kind = 'number' | 'bool' | 'color' | 'vec2' | 'vec3' | 'select' | 'button'

export function kindOf(d: ParamDef): Kind {
  if ('action' in d) return 'button'
  if ('options' in d) return 'select'
  const v = d.value
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'string') return 'color'
  if (Array.isArray(v)) return v.length === 2 ? 'vec2' : 'vec3'
  return 'number'
}

const uniformName = (key: string, d: ParamDef) =>
  d.uniform === false ? null : (d.uniform ?? 'u' + key[0].toUpperCase() + key.slice(1))

const selectOptions = (d: SelectParam): [label: string, value: string | number][] =>
  Array.isArray(d.options)
    ? d.options.map((o) => [String(o), o])
    : Object.entries(d.options as Record<string, string | number>)

function toUniform(d: ParamDef, v: ParamValue): UniformValue {
  switch (kindOf(d)) {
    case 'color': {
      const n = parseInt(String(v).slice(1, 7), 16)
      return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
    }
    case 'select': {
      if (typeof v === 'number') return v
      return Math.max(0, selectOptions(d as SelectParam).findIndex(([, o]) => o === v))
    }
    default:
      return v as UniformValue
  }
}

export function defaults(schema: ParamSchema): ParamValues {
  const out: ParamValues = {}
  for (const [k, d] of Object.entries(schema)) if (!('action' in d)) out[k] = structuredClone(d.value)
  return out
}

// ---------- URL: #id?feed=0.037&tint=%23ff8844&offset=0.1,0.2 ----------
const fmt = (n: number) => String(+n.toPrecision(6))

export function encodeParams(schema: ParamSchema, values: ParamValues): string {
  const q: string[] = []
  for (const [k, d] of Object.entries(schema)) {
    if ('action' in d) continue
    const v = values[k]
    if (JSON.stringify(v) === JSON.stringify(d.value)) continue
    const s = Array.isArray(v) ? v.map(fmt).join(',') : typeof v === 'number' ? fmt(v) : typeof v === 'boolean' ? (v ? '1' : '0') : String(v)
    q.push(`${encodeURIComponent(k)}=${encodeURIComponent(s)}`)
  }
  return q.join('&')
}

export function decodeParams(schema: ParamSchema, query: string): ParamValues {
  const out: ParamValues = {}
  for (const [k, s] of new URLSearchParams(query)) {
    const d = schema[k]
    if (!d || 'action' in d) continue
    switch (kindOf(d)) {
      case 'number': if (isFinite(+s)) out[k] = +s; break
      case 'bool': out[k] = s === '1' || s === 'true'; break
      case 'color': if (/^#[0-9a-f]{6}$/i.test(s)) out[k] = s; break
      case 'vec2': case 'vec3': {
        const a = s.split(',').map(Number)
        if (a.length === (d.value as number[]).length && a.every(isFinite)) out[k] = a
        break
      }
      case 'select': {
        const opt = selectOptions(d as SelectParam).find(([, o]) => String(o) === s)
        if (opt) out[k] = opt[1]
      }
    }
  }
  return out
}

// ---------- Модель параметров ----------
export interface Params {
  values: ParamValues
  uniforms(): [string, UniformValue][]
  set(v: ParamValues): void // программно (пресет, URL) — обновляет панель, onChange не зовёт
  bind(folder: FolderApi | Pane, ctx: () => ExperimentContext, onChange: () => void): void
}

const RESERVED = new Set(['uTime', 'uFrame', 'uResolution', 'uMouse', 'uMousePrev', 'uCamPos', 'uCamTarget', 'uSeed', 'uScreen', 'uIteration', 'uAdvance'])

export function createParams(schema: ParamSchema, initial: ParamValues): Params {
  for (const [k, d] of Object.entries(schema)) {
    const u = uniformName(k, d)
    if (u && RESERVED.has(u)) console.warn(`[params] '${k}' maps to reserved uniform ${u} — set uniform: false or rename`)
  }
  const values = defaults(schema)
  let cache: [string, UniformValue][] | null = null
  // Представление для tweakpane: вектора — объектами {x,y,z}.
  const model: Record<string, unknown> = {}
  let refresh = () => {}

  const sync = () => {
    cache = null
    for (const [k, d] of Object.entries(schema)) {
      const v = values[k]
      if (Array.isArray(v)) model[k] = kindOf(d) === 'vec2' ? { x: v[0], y: v[1] } : { x: v[0], y: v[1], z: v[2] }
      else if (v !== undefined) model[k] = v
    }
  }
  const assign = (v: ParamValues) => {
    for (const [k, x] of Object.entries(v)) if (k in values && typeof x === typeof values[k]) values[k] = structuredClone(x)
  }
  assign(initial)
  sync()

  return {
    values,
    uniforms() {
      if (!cache) {
        cache = []
        for (const [k, d] of Object.entries(schema)) {
          const u = uniformName(k, d)
          if (u && k in values) cache.push([u, toUniform(d, values[k])])
        }
      }
      return cache
    },
    set(v) {
      assign(v)
      sync()
      refresh()
    },
    bind(folder, ctx, onChange) {
      const groups = new Map<string, FolderApi>()
      const bindings: { refresh(): void }[] = []
      const parentFor = (d: ParamDef) => {
        if (!d.folder) return folder
        let g = groups.get(d.folder)
        if (!g) groups.set(d.folder, (g = folder.addFolder({ title: d.folder })))
        return g
      }
      for (const [k, d] of Object.entries(schema)) {
        const parent = parentFor(d)
        const label = d.label ?? k
        const kind = kindOf(d)
        if (kind === 'button') {
          parent.addButton({ title: label }).on('click', () => (d as { action: (c: ExperimentContext) => void }).action(ctx()))
          continue
        }
        const opts: Record<string, unknown> = { label }
        if ('min' in d && d.min !== undefined) opts.min = d.min
        if ('max' in d && d.max !== undefined) opts.max = d.max
        if ('step' in d && d.step !== undefined) opts.step = d.step
        if (kind === 'select') opts.options = Object.fromEntries(selectOptions(d as SelectParam))
        if (kind === 'vec2') opts.y = { inverted: true }
        const b = parent.addBinding(model, k, opts)
        bindings.push(b)
        b.on('change', (ev) => {
          const m = ev.value as unknown
          values[k] = typeof m === 'object' && m
            ? kind === 'vec2' ? [(m as { x: number }).x, (m as { y: number }).y]
              : [(m as { x: number }).x, (m as { y: number }).y, (m as { z: number }).z]
            : (m as ParamValue)
          cache = null
          onChange()
          d.onChange?.(ctx())
        })
      }
      refresh = () => bindings.forEach((b) => b.refresh())
    },
  }
}
