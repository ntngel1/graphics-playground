import type { GLContext } from './gl.ts'
import type { Overlay } from './overlay.ts'
import { createProgram, ShaderCompileError, type Program, type UniformValue } from './program.ts'
import type { Experiment, ExperimentContext, Pass } from './types.ts'

// Юниформы кадра, общие для всех проходов. mouse — в px канваса (y вверх).
export interface FrameState {
  time: number
  frame: number
  width: number
  height: number
  mouse: [number, number, number, number]
  camPos: [number, number, number]
  camTarget: [number, number, number]
}

export interface Pipeline {
  render(f: FrameState, uniforms: Iterable<[string, UniformValue]>, ctx: ExperimentContext): void
  onShaderUpdate(id: string): boolean // true, если что-то перекомпилировано
  reset(): void
  dispose(): void
}

export function createPipeline(glc: GLContext, exp: Experiment, overlay: Overlay): Pipeline {
  const { gl } = glc
  const passKey = (p: Pass, i: number) => `pass ${i}${p.name ? ` (${p.name})` : ''}: ${p.frag.id}`

  // Компиляция с откатом: при ошибке остаётся предыдущая рабочая программа.
  // deps — файлы последней попытки сборки (даже неудачной), null — неизвестно, пересобирать всегда.
  type Entry = { pass: Pass; prog: Program | null; deps: Set<string> | null }
  const compile = (e: Entry, i: number) => {
    try {
      const prog = createProgram(gl, e.pass.frag)
      e.prog?.dispose()
      e.prog = prog
      e.deps = prog.deps
      overlay.set(passKey(e.pass, i), null)
    } catch (err) {
      if (!(err instanceof ShaderCompileError)) throw err
      console.error(`[shader] ${passKey(e.pass, i)}\n${err.message}`)
      overlay.set(passKey(e.pass, i), err.errors, err.assembled?.files)
      e.deps = err.assembled?.deps ?? null
    }
  }

  const passes = exp.passes.map((p, i) => {
    const e: Entry = { pass: p, prog: null, deps: null }
    compile(e, i)
    if ((p.target ?? 'screen') !== 'screen') {
      overlay.set(`${passKey(p, i)} target`, [{ file: p.frag.id, line: 0, message: `target '${p.target}': offscreen buffers are not implemented yet` }])
    }
    return e
  })

  return {
    render(f, uniforms, ctx) {
      const list = [...uniforms]
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, f.width, f.height)
      for (const { pass, prog } of passes) {
        if (!prog || (pass.target ?? 'screen') !== 'screen') continue
        if (pass.enabled && !pass.enabled(ctx.params)) continue
        prog.use()
        prog.set('uTime', f.time)
        prog.set('uFrame', f.frame)
        prog.set('uResolution', [f.width, f.height])
        prog.set('uMouse', f.mouse)
        prog.set('uCamPos', f.camPos)
        prog.set('uCamTarget', f.camTarget)
        for (const [k, v] of list) prog.set(k, v)
        if (pass.uniforms) for (const [k, v] of Object.entries(pass.uniforms(ctx))) prog.set(k, v as UniformValue)
        const n = typeof pass.iterations === 'function' ? pass.iterations(ctx.params) : (pass.iterations ?? 1)
        for (let it = 0; it < n; it++) glc.drawTriangle()
      }
    },
    onShaderUpdate(id) {
      let hit = false
      passes.forEach((e, i) => {
        if (!e.deps || e.deps.has(id)) {
          compile(e, i)
          hit = true
        }
      })
      return hit
    },
    reset() {
      // шаг 3: переинициализация буферов
    },
    dispose() {
      for (const e of passes) e.prog?.dispose()
      overlay.clear()
    },
  }
}
