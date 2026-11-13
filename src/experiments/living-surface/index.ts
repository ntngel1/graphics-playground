import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext } from '../../core/types.ts'
import { createGrayScott, PALETTES, PATTERNS } from '../gray-scott/sim.ts'
import pick from './pick.frag'
import render from './render.frag'

// Симуляция импортируется из gray-scott: фиксированный буфер 640×256 (W/H = R/r тора, узор без
// растяжения), кисть — из 1×1 буфера 'pick' (uv попадания луча мыши в поверхность).
const gs = createGrayScott({ size: [640, 256], pick: 'pick', mapMode: false })

// Угол вращения копится по dt (без скачков при движении ползунка); общий для pick и рендера.
// Хранится вне модуля (hmrState): правка index.ts не сбрасывает угол; новый запуск (кадр 0) — сбрасывает.
const rot = hmrState('living-surface', { angle: 0, frame: -1 })
const spinUniform = (ctx: ExperimentContext) => {
  if (rot.frame !== ctx.frame) {
    rot.angle = ctx.frame === 0 ? 0 : rot.angle + ctx.dt * (ctx.params.spin as number)
    rot.frame = ctx.frame
  }
  return { uSpin: rot.angle }
}

export default defineExperiment({
  name: 'Living surface',
  order: 1,
  description: 'Реакция-диффузия Грея-Скотта как живая ткань на торе, сфере или плоскости. Рисуйте прямо по поверхности: режим «brush» в панели или D.',
  camera: { target: [0, -0.1, 0], distance: 3.3, yaw: 0.5, pitch: 0.6, minPitch: 0.06, maxPitch: 1.5, minDistance: 1.2, maxDistance: 12 },
  renderScale: 0.75,
  params: {
    shape: { value: 'torus', options: ['torus', 'plane', 'sphere'] },
    ...gs.params,
    height: { value: 0.06, min: -0.12, max: 0.12, step: 0.005, folder: 'surface' },
    spin: { label: 'spin speed', value: 0.08, min: -1, max: 1, step: 0.01, uniform: false, folder: 'surface' },
    palette: { value: 'flesh', options: PALETTES, folder: 'surface' },
    glow: { value: 0.8, min: 0, max: 3, step: 0.01, folder: 'surface' },
    sunAzimuth: { label: 'sun azimuth', value: 120, min: 0, max: 360, step: 1, folder: 'light' },
    sunHeight: { label: 'sun height', value: 40, min: 2, max: 89, step: 1, folder: 'light' },
    maxSteps: { label: 'max steps', value: 140, min: 32, max: 300, step: 1, folder: 'render' },
    debug: { value: 'final', options: ['final', 'normals', 'steps', 'height'], folder: 'render' },
  },
  buffers: {
    ...gs.buffers,
    pick: { size: [1, 1], format: 'rgba32f', pingPong: true },
  },
  passes: [
    { name: 'pick', frag: pick, target: 'pick', inputs: { uPickPrev: 'pick', uState: 'state' }, uniforms: spinUniform },
    ...gs.passes,
    { name: 'render', frag: render, inputs: { uState: 'state' }, uniforms: spinUniform },
  ],
  // пресет меняет режим и форму — новая культура растёт с нуля (старый узор при смене режима часто вымирает)
  onPreset: (_name, ctx) => ctx.reinit(),
  presets: {
    'coral torus': { ...PATTERNS.coral, shape: 'torus', palette: 'flesh', height: 0.06, glow: 0.8 },
    'brain sphere': { ...PATTERNS.maze, shape: 'sphere', palette: 'ink', height: 0.05, glow: 0.2 },
    'bacteria plane': { ...PATTERNS.mitosis, shape: 'plane', palette: 'neon', height: 0.07, glow: 1.2, sunHeight: 30 },
    'u-skate torus': { ...PATTERNS['u-skate'], shape: 'torus', palette: 'ocean', height: -0.06, glow: 0.8 },
  },
})
