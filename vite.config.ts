import { defineConfig } from 'vite'
import { glslModules } from './tools/glsl-plugin.ts'

export default defineConfig({
  // Для GitHub Pages: BASE=/repo-name/ npm run build
  base: process.env.BASE ?? './',
  plugins: [glslModules()],
})
