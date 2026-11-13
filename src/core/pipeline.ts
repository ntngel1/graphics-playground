import { createBuffer, resolveFormat, sameLayout, type Buffer } from './fbo.ts'
import type { GLContext } from './gl.ts'
import type { Overlay } from './overlay.ts'
import { createProgram, ShaderCompileError, type Program, type UniformValue } from './program.ts'
import type { ShaderSource } from './shader.ts'
import type { BufferSpec, Experiment, ExperimentContext, ParamValue } from './types.ts'

type V4 = [number, number, number, number]

// Юниформы кадра. mouse/mousePrev — в px канваса (y вверх); в проходы уходят пересчитанными в px таргета.
export interface FrameState {
  time: number
  frame: number
  width: number
  height: number
  mouse: V4
  mousePrev: V4
  camPos: [number, number, number]
  camTarget: [number, number, number]
}

export interface Pipeline {
  // advance=false — перерисовка на паузе: шаги симуляций (проходы в pingPong-буферы) пропускаются
  render(f: FrameState, uniforms: Iterable<[string, UniformValue]>, ctx: ExperimentContext, advance: boolean): void
  onShaderUpdate(id: string): boolean // true, если что-то перекомпилировано
  reset(uniforms?: Record<string, ParamValue>): void // init буферов на следующем render
  detachBuffers(specs: Record<string, BufferSpec> | undefined): Map<string, Buffer> // для HMR index.ts
  buffer(name: string): Buffer | null
  dispose(): void
}

// deps — файлы последней попытки сборки (даже неудачной), null — неизвестно, пересобирать всегда.
type Entry = { key: string; frag: ShaderSource; prog: Program | null; deps: Set<string> | null }
type Slot = { name: string; spec: BufferSpec; buf: Buffer | null; init: Entry | null }

export function createPipeline(glc: GLContext, exp: Experiment, overlay: Overlay, kept?: Map<string, Buffer>): Pipeline {
  const { gl } = glc
  const maxSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  const entries: Entry[] = []

  // Компиляция с откатом: при ошибке остаётся предыдущая рабочая программа.
  const compile = (e: Entry) => {
    try {
      const prog = createProgram(gl, e.frag)
      e.prog?.dispose()
      e.prog = prog
      e.deps = prog.deps
      overlay.set(e.key, null)
    } catch (err) {
      if (!(err instanceof ShaderCompileError)) throw err
      console.error(`[shader] ${e.key}\n${err.message}`)
      overlay.set(e.key, err.errors, err.assembled?.files)
      e.deps = err.assembled?.deps ?? null
    }
  }
  const entry = (key: string, frag: ShaderSource) => {
    const e: Entry = { key, frag, prog: null, deps: null }
    compile(e)
    entries.push(e)
    return e
  }
  const configError = (key: string, message: string, file = '') => overlay.set(key, [{ file, line: 0, message }])

  // ---------- буферы ----------
  const slots = new Map<string, Slot>()
  const needInit = new Set<string>()
  let initUniforms: Record<string, ParamValue> = {}
  let lastInitKeys: string[] = []
  for (const [name, spec] of Object.entries(exp.buffers ?? {})) {
    const k = kept?.get(name)
    slots.set(name, { name, spec, buf: k ?? null, init: spec.init ? entry(`buffer '${name}' init: ${spec.init.id}`, spec.init) : null })
    if (k) kept!.delete(name)
  }
  for (const b of kept?.values() ?? []) b.dispose()

  const passes = exp.passes.map((pass, i) => {
    const key = `pass ${i}${pass.name ? ` (${pass.name})` : ''}: ${pass.frag.id}`
    const e = entry(key, pass.frag)
    const target = pass.target ?? 'screen'
    const slot = target === 'screen' ? null : (slots.get(target) ?? null)
    if (target !== 'screen' && !slot) configError(key + ' target', `unknown target buffer '${target}'`, pass.frag.id)
    for (const [u, b] of Object.entries(pass.inputs ?? {})) {
      if (!slots.has(b)) configError(key + ' ' + u, `input ${u}: unknown buffer '${b}'`, pass.frag.id)
      else if (b === target && !slot?.spec.pingPong) configError(key + ' ' + u, `input ${u} reads its own target '${b}' — mark the buffer pingPong`, pass.frag.id)
    }
    return { pass, e, slot }
  })

  const sizeOf = (spec: BufferSpec, f: FrameState, ctx: ExperimentContext): [number, number] => {
    if (spec.size) {
      const [w, h] = typeof spec.size === 'function' ? spec.size(ctx.params) : spec.size
      return [Math.min(maxSize, Math.max(1, Math.round(w))), Math.min(maxSize, Math.max(1, Math.round(h)))]
    }
    const s = typeof spec.scale === 'function' ? spec.scale(ctx.params) : (spec.scale ?? 1)
    const c = (v: number) => Math.min(maxSize, Math.max(1, Math.round(v * s)))
    return [c(f.width), c(f.height)]
  }

  const ensureBuffers = (f: FrameState, ctx: ExperimentContext) => {
    for (const s of slots.values()) {
      const [w, h] = sizeOf(s.spec, f, ctx)
      if (s.buf) {
        s.buf.resize(w, h)
        continue
      }
      const { format, error, notice } = resolveFormat(glc, s.spec.format ?? 'rgba16f')
      if (error) configError(`buffer '${s.name}'`, error)
      if (notice) overlay.notice(notice)
      s.buf = createBuffer(glc, s.spec, w, h, format)
      needInit.add(s.name)
    }
  }

  // ---------- отрисовка ----------
  let f!: FrameState
  let params: [string, UniformValue][] = []
  const scaleMouse = (m: V4, w: number, h: number): V4 => [(m[0] * w) / f.width, (m[1] * h) / f.height, m[2], m[3]]

  const draw = (prog: Program, slot: Slot | null, inputs: Record<string, string> | undefined, extra: Record<string, ParamValue> | null) => {
    const buf = slot?.buf ?? null
    const w = buf ? buf.width : f.width
    const h = buf ? buf.height : f.height
    gl.bindFramebuffer(gl.FRAMEBUFFER, buf ? buf.drawTarget().fb : null)
    gl.viewport(0, 0, w, h)
    prog.use()
    prog.set('uTime', f.time)
    prog.set('uFrame', f.frame)
    prog.set('uResolution', [w, h])
    prog.set('uScreen', [f.width, f.height])
    prog.set('uMouse', scaleMouse(f.mouse, w, h))
    prog.set('uMousePrev', scaleMouse(f.mousePrev, w, h))
    prog.set('uCamPos', f.camPos)
    prog.set('uCamTarget', f.camTarget)
    for (const [k, v] of params) prog.set(k, v)
    if (extra) for (const [k, v] of Object.entries(extra)) prog.set(k, v as UniformValue)
    let unit = 0
    for (const [u, name] of Object.entries(inputs ?? {})) {
      const b = slots.get(name)?.buf
      if (!b) continue
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, b.read.tex)
      prog.set(u, unit++)
      prog.set(u + 'Size', [b.width, b.height])
    }
    glc.drawTriangle()
    // отвязываем входы, чтобы следующий проход не получил feedback loop через «чужой» юнит
    while (unit-- > 0) gl.activeTexture(gl.TEXTURE0 + unit), gl.bindTexture(gl.TEXTURE_2D, null)
    buf?.swap()
  }

  return {
    render(frame, uniforms, ctx, advance) {
      f = frame
      params = [...uniforms]
      ensureBuffers(f, ctx)

      for (const name of needInit) {
        const s = slots.get(name)!
        if (s.init?.prog) {
          // значения юниформов живут в программе: обнуляем ключи прошлого reinit, которых нет сейчас
          const extra: Record<string, ParamValue> = { uSeed: Math.random() }
          for (const k of lastInitKeys) extra[k] = 0
          Object.assign(extra, initUniforms)
          lastInitKeys = Object.keys(initUniforms)
          draw(s.init.prog, s, undefined, extra)
        } else if (!s.init && s.buf) {
          for (const t of [s.buf.read, s.buf.write]) {
            if (!t) continue
            gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb)
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
          }
        }
      }
      needInit.clear()
      initUniforms = {}

      for (const { pass, e, slot } of passes) {
        if (!e.prog) continue
        if ((pass.target ?? 'screen') !== 'screen' && !slot?.buf) continue
        const sim = !!slot?.spec.pingPong
        if (!advance && sim && !pass.whenPaused) continue
        if (pass.enabled && !pass.enabled(ctx.params)) continue
        const extra: Record<string, ParamValue> = { ...pass.uniforms?.(ctx), uAdvance: advance }
        let n = typeof pass.iterations === 'function' ? pass.iterations(ctx.params) : (pass.iterations ?? 1)
        if (!advance && sim) n = 1 // whenPaused: один прогон с uAdvance = false (например, только кисть)
        for (let it = 0; it < n; it++) draw(e.prog, slot, pass.inputs, { ...extra, uIteration: it })
      }
    },
    onShaderUpdate(id) {
      let hit = false
      for (const e of entries) {
        if (!e.deps || e.deps.has(id)) {
          compile(e)
          hit = true
        }
      }
      return hit
    },
    reset(uniforms = {}) {
      initUniforms = uniforms
      for (const name of slots.keys()) needInit.add(name)
    },
    detachBuffers(specs) {
      const out = new Map<string, Buffer>()
      for (const s of slots.values()) {
        const next = specs?.[s.name]
        if (s.buf && next && sameLayout(s.spec, next)) out.set(s.name, s.buf), (s.buf = null)
      }
      return out
    },
    buffer: (name) => slots.get(name)?.buf ?? null,
    dispose() {
      for (const e of entries) e.prog?.dispose()
      for (const s of slots.values()) s.buf?.dispose()
      overlay.clear()
    },
  }
}
