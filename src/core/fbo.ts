// Offscreen-буферы: текстура + FBO, опционально ping-pong (два слота).
import type { GLContext } from './gl.ts'
import { createProgram, type Program } from './program.ts'
import type { BufferSpec } from './types.ts'

export type Format = NonNullable<BufferSpec['format']>

export interface Target {
  tex: WebGLTexture
  fb: WebGLFramebuffer
}

export interface Buffer {
  spec: BufferSpec
  format: Format // фактический (после фолбэков)
  width: number
  height: number
  read: Target // текущее состояние — его читают проходы
  write: Target | null // для ping-pong: сюда пишут, потом swap()
  drawTarget(): Target
  swap(): void
  resize(w: number, h: number): void // содержимое переносится (растягивается)
  dispose(): void
}

const warned = new Set<string>()
const warnOnce = (msg: string) => {
  if (!warned.has(msg)) warned.add(msg), console.warn('[fbo] ' + msg)
}

// Какой формат реально можно рендерить. error — для оверлея, если всё совсем плохо.
export function resolveFormat(glc: GLContext, want: Format): { format: Format; error?: string } {
  const { colorBufferFloat, halfFloatBuffer } = glc.ext
  if (want === 'rgba32f' && !colorBufferFloat) {
    if (halfFloatBuffer) return warnOnce('rgba32f is not renderable, using rgba16f'), { format: 'rgba16f' }
    want = 'rgba16f'
  }
  if (want === 'rgba16f' && !colorBufferFloat && !halfFloatBuffer) {
    return {
      format: 'rgba8',
      error: 'float render targets are not supported (no EXT_color_buffer_float / EXT_color_buffer_half_float) — falling back to rgba8, simulations will be wrong',
    }
  }
  return { format: want }
}

let copyProg: Program | null = null
function copy(glc: GLContext, src: WebGLTexture, dst: Target, w: number, h: number) {
  const { gl } = glc
  copyProg ??= createProgram(gl, {
    id: '<fbo-copy>',
    source: 'uniform sampler2D uSrc;\nvoid main() { fragColor = texture(uSrc, vUv); }',
    includes: [],
    version: 0,
  })
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb)
  gl.viewport(0, 0, w, h)
  copyProg.use()
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, src)
  copyProg.set('uSrc', 0)
  glc.drawTriangle()
  gl.bindTexture(gl.TEXTURE_2D, null)
}

export function createBuffer(glc: GLContext, spec: BufferSpec, w: number, h: number, format: Format): Buffer {
  const { gl } = glc
  const [internal, type] = {
    rgba8: [gl.RGBA8, gl.UNSIGNED_BYTE],
    rgba16f: [gl.RGBA16F, gl.HALF_FLOAT],
    rgba32f: [gl.RGBA32F, gl.FLOAT],
  }[format]
  let filter = spec.filter === 'linear' ? gl.LINEAR : gl.NEAREST
  if (filter === gl.LINEAR && format === 'rgba32f' && !glc.ext.floatLinear) {
    warnOnce('OES_texture_float_linear is missing: rgba32f buffers use NEAREST filtering')
    filter = gl.NEAREST
  }
  const wrap = { clamp: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT }[spec.wrap ?? 'clamp']

  const target = (w: number, h: number): Target => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null) // WebGL обнуляет память
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
    gl.bindTexture(gl.TEXTURE_2D, null)
    const fb = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`framebuffer incomplete (${format}, 0x${status.toString(16)})`)
    return { tex, fb }
  }
  const free = (t: Target | null) => {
    if (!t) return
    gl.deleteFramebuffer(t.fb)
    gl.deleteTexture(t.tex)
  }

  const buf: Buffer = {
    spec,
    format,
    width: w,
    height: h,
    read: target(w, h),
    write: spec.pingPong ? target(w, h) : null,
    drawTarget: () => buf.write ?? buf.read,
    swap() {
      if (buf.write) [buf.read, buf.write] = [buf.write, buf.read]
    },
    resize(w, h) {
      if (w === buf.width && h === buf.height) return
      const next = target(w, h)
      copy(glc, buf.read.tex, next, w, h)
      free(buf.read)
      free(buf.write)
      buf.read = next
      buf.write = spec.pingPong ? target(w, h) : null
      buf.width = w
      buf.height = h
    },
    dispose() {
      free(buf.read)
      free(buf.write)
    },
  }
  return buf
}

// Можно ли переиспользовать буфер после HMR index.ts (init и прочее не влияют на содержимое).
export function sameLayout(a: BufferSpec, b: BufferSpec) {
  return (
    (a.format ?? 'rgba16f') === (b.format ?? 'rgba16f') &&
    (a.filter ?? 'nearest') === (b.filter ?? 'nearest') &&
    (a.wrap ?? 'clamp') === (b.wrap ?? 'clamp') &&
    !!a.pingPong === !!b.pingPong &&
    String(a.size) === String(b.size) &&
    String(a.scale) === String(b.scale)
  )
}
