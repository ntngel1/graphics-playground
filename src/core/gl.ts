export interface GLContext {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement
  ext: { colorBufferFloat: boolean; floatLinear: boolean; halfFloatBuffer: boolean }
  drawTriangle(): void
}

export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export function createGL(canvas: HTMLCanvasElement): GLContext {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  })
  if (!gl) throw new Error('WebGL2 is not supported')
  const ext = {
    colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
    floatLinear: !!gl.getExtension('OES_texture_float_linear'),
    halfFloatBuffer: !!gl.getExtension('EXT_color_buffer_half_float'),
  }
  // Проверка фолбэков: ?float=16 — как будто нет float32-таргетов (типично для iOS), ?float=0 — нет никаких
  const force = new URLSearchParams(location.search).get('float')
  if (force === '16' || force === '0') ext.colorBufferFloat = false
  if (force === '0') ext.halfFloatBuffer = false
  // Фуллскрин-треугольник без атрибутов: вершины из gl_VertexID, VAO пустой.
  const vao = gl.createVertexArray()
  return {
    gl,
    canvas,
    ext,
    drawTriangle() {
      gl.bindVertexArray(vao)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },
  }
}
