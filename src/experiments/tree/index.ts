import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext } from '../../core/types.ts'
import { createRetro } from '../../retro/retro.ts'
import frag from './scene.frag'
import fragPs1 from './scene-ps1.frag'

// Дерево на холме: SDF-реймарчинг в «глиняном» стиле. Модель — tree.glsl (явный ствол и скелетные
// ветви от seed + складывание пространства по уровням), сцена и свет — scene.frag.
// Рост (growth) и сезон (season) — параметры; кнопки проигрывают их во времени.

const NORMAL_SCALE = 0.55
const retro = createRetro()

const st = hmrState('tree', { windT: 0, growing: false, seed: 7, species: 'broadleaf' as string })

function tick(ctx: ExperimentContext) {
  retro.syncScale(ctx, NORMAL_SCALE)
  const dt = ctx.dt
  st.seed = ctx.params.seed as number // пресеты (сезон, лес) не должны сбрасывать дерево — см. onPreset
  st.species = ctx.params.species as string
  st.windT += dt * (0.5 + 0.9 * (ctx.params.wind as number))
  if (st.growing) {
    const g = Math.min(1, (ctx.params.growth as number) + dt / 8)
    ctx.set({ growth: g })
    if (g >= 1) st.growing = false
  }
  if (ctx.params.seasonCycle && dt > 0) ctx.set({ season: ((ctx.params.season as number) + dt / 40) % 1 })
  return { uWindT: st.windT }
}

export default defineExperiment({
  name: 'Tree',
  order: -20,
  description: 'Дерево из формул: ствол, ветви складыванием пространства, листва-комки. Seed — новое дерево, рост от ростка, четыре сезона, ветер и лес.',
  camera: { target: [0, 2.4, 0], distance: 10.5, yaw: 0.65, pitch: 0.13, minPitch: -0.05, maxPitch: 1.3, minDistance: 2.5, maxDistance: 30 },
  renderScale: NORMAL_SCALE, // глиняный стиль мягкий — разрешение почти не видно, а дерево дорогое (см. CLAUDE.md)
  params: {
    species: { value: 'broadleaf', options: ['broadleaf', 'birch', 'spruce'] },
    seed: { value: 7, min: 0, max: 9999, step: 1, uniform: 'uTreeSeed' },
    newTree: {
      label: 'new tree',
      action: (ctx) => ctx.set({ seed: Math.floor(Math.random() * 10000) }),
    },
    growth: { value: 1, min: 0, max: 1, step: 0.001 },
    grow: {
      label: 'grow (8 s)',
      action: (ctx) => {
        ctx.set({ growth: 0 })
        st.growing = true
      },
    },
    season: { value: 0.375, min: 0, max: 1, step: 0.001 },
    seasonCycle: { label: 'cycle seasons', value: false, uniform: false },
    wind: { value: 0.5, min: 0, max: 2, step: 0.01 },
    forest: { value: false },
    sunAzimuth: { label: 'sun azimuth', value: 125, min: 0, max: 360, step: 1, folder: 'light' },
    sunHeight: { label: 'sun height', value: 28, min: 5, max: 80, step: 1, folder: 'light' },
    debug: { value: 'final', options: ['final', 'steps', 'normals'], folder: 'light' },
    ...retro.params, // look: normal | ps1 + папка ps1
  },
  buffers: retro.buffers,
  presets: {
    spring: { season: 0.125 },
    summer: { season: 0.375 },
    autumn: { season: 0.625, wind: 0.8 },
    winter: { season: 0.875, wind: 0.3 },
    sprout: { growth: 0.18, season: 0.2 },
    forest: { forest: true, season: 0.42 },
    ps1: { look: 'ps1' },
    'ps1 forest': { look: 'ps1', forest: true, season: 0.42, ps1Fog: 45 },
  },
  onPreset: (_n, ctx) => ctx.set({ seed: st.seed, species: st.species }),
  passes: retro.wrap({ name: 'scene', frag, uniforms: tick }, fragPs1),
})
