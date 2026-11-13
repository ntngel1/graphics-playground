import { FULLSCREEN_VERT } from './gl.ts'
import { assemble, parseLog, type Assembled, type ShaderError, type ShaderSource } from './shader.ts'

export type UniformValue = number | boolean | ArrayLike<number>

export class ShaderCompileError extends Error {
  errors: ShaderError[]
  assembled: Assembled | null
  constructor(errors: ShaderError[], assembled: Assembled | null) {
    super(errors.map((e) => `${e.file}:${e.line}: ${e.message}`).join('\n'))
    this.errors = errors
    this.assembled = assembled
  }
}

export interface Program {
  program: WebGLProgram
  deps: Set<string>
  has(name: string): boolean
  set(name: string, v: UniformValue): void // юниформа нет в шейдере → молча пропускается
  use(): void
  dispose(): void
}

const vertCache = new WeakMap<WebGL2RenderingContext, WebGLShader>()

function vertexShader(gl: WebGL2RenderingContext) {
  let vs = vertCache.get(gl)
  if (!vs) {
    vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(vs, FULLSCREEN_VERT)
    gl.compileShader(vs)
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs) ?? 'vertex shader')
    vertCache.set(gl, vs)
  }
  return vs
}

export function createProgram(gl: WebGL2RenderingContext, frag: ShaderSource): Program {
  let a: Assembled
  try {
    a = assemble(frag)
  } catch (e) {
    throw new ShaderCompileError([{ file: frag.id, line: 0, message: String((e as Error).message) }], null)
  }
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(fs, a.code)
  gl.compileShader(fs)
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs) ?? ''
    gl.deleteShader(fs)
    throw new ShaderCompileError(parseLog(log, a, frag.id), a)
  }
  const program = gl.createProgram()!
  gl.attachShader(program, vertexShader(gl))
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'link failed'
    gl.deleteProgram(program)
    throw new ShaderCompileError(parseLog(log, a, frag.id), a)
  }

  const uniforms = new Map<string, { loc: WebGLUniformLocation; type: number }>()
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!
    const loc = gl.getUniformLocation(program, info.name)
    if (loc) uniforms.set(info.name.replace(/\[0\]$/, ''), { loc, type: info.type })
  }

  return {
    program,
    deps: a.deps,
    has: (name) => uniforms.has(name),
    use: () => gl.useProgram(program),
    dispose: () => gl.deleteProgram(program),
    set(name, v) {
      const u = uniforms.get(name)
      if (!u) return
      const num = typeof v === 'boolean' ? +v : v
      const arr = typeof num === 'number' ? [num] : Array.from(num)
      switch (u.type) {
        case gl.FLOAT: return gl.uniform1f(u.loc, arr[0])
        case gl.FLOAT_VEC2: return gl.uniform2fv(u.loc, arr)
        case gl.FLOAT_VEC3: return gl.uniform3fv(u.loc, arr)
        case gl.FLOAT_VEC4: return gl.uniform4fv(u.loc, arr)
        case gl.INT_VEC2: case gl.BOOL_VEC2: return gl.uniform2iv(u.loc, arr)
        case gl.INT_VEC3: case gl.BOOL_VEC3: return gl.uniform3iv(u.loc, arr)
        case gl.INT_VEC4: case gl.BOOL_VEC4: return gl.uniform4iv(u.loc, arr)
        case gl.FLOAT_MAT3: return gl.uniformMatrix3fv(u.loc, false, arr)
        case gl.FLOAT_MAT4: return gl.uniformMatrix4fv(u.loc, false, arr)
        default: return gl.uniform1i(u.loc, Math.round(arr[0])) // int, bool, samplers
      }
    },
  }
}
