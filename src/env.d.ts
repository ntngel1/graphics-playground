/// <reference types="vite/client" />
declare module '*.frag' {
  const shader: import('./core/shader.ts').ShaderSource
  export default shader
}
declare module '*.glsl' {
  const shader: import('./core/shader.ts').ShaderSource
  export default shader
}
declare module '*.vert' {
  const shader: import('./core/shader.ts').ShaderSource
  export default shader
}
