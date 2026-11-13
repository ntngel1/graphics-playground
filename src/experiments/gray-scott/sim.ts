// Симуляция Грея-Скотта как переиспользуемый модуль. Встраивание в другой эксперимент:
//
//   const gs = createGrayScott({ size: [640, 256], pick: 'pick' })
//   params: { ...gs.params, ...свои }, buffers: { ...gs.buffers, ...свои },
//   passes: [...свои до, ...gs.passes, свой проход с inputs: { uState: 'state' }],
//
// Состояние: буфер 'state' (R = 1 − U, G = V), wrap repeat — периодично по обеим осям.
import type { BufferSpec, ExperimentContext, Pass, ParamDef, ParamValues, PointerInfo } from '../../core/types.ts'
import initFrag from './init.frag'
import simFrag from './sim.frag'

export interface GrayScottOptions {
  // фиксированный базовый размер буфера (умножается на параметр resolution);
  // по умолчанию — доля размера экрана
  size?: [number, number]
  // имя 1×1 буфера с uv попадания кисти (rg — сейчас, ba — прошлый кадр, x < 0 — мимо);
  // по умолчанию кисть рисует по экрану (uMouse/uMousePrev)
  pick?: string
  mapMode?: boolean // режим карты feed/kill (по умолчанию true)
}

// Карта feed/kill (то же отображение, что в map.glsl): Y — feed, X — сдвиг kill от k_sn(F),
// диапазон сдвига сужается кверху (серп узоров там уже).
export const MAP_FEED: [number, number] = [0.006, 0.086]
export const MAP_DK: [number, number, number, number] = [-0.007, 0.011, -0.0012, 0.0035]
const kSaddle = (F: number) => Math.sqrt(F) / 2 - F
const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const mapToFK = ([x, y]: [number, number]) => {
  const F = mix(MAP_FEED[0], MAP_FEED[1], y)
  return { feed: F, kill: kSaddle(F) + mix(mix(MAP_DK[0], MAP_DK[2], y), mix(MAP_DK[1], MAP_DK[3], y), x) }
}
export const mapUniforms = () => ({ uMapFeed: MAP_FEED, uMapDk: MAP_DK })

export const PALETTES = ['ink', 'sunset', 'ocean', 'rainbow', 'heat', 'neon', 'flesh'] as const

// Значения проверены глазами на этой схеме (Du = 1, Dv = 0.5, dt = 1, ядро Симса),
// стартуя с reseed; режим «waves» у pmneila (0.014/0.045) здесь вымирает — взят соседний 0.010/0.047.
export const PATTERNS: Record<string, { feed: number; kill: number }> = {
  coral: { feed: 0.0545, kill: 0.062 }, // ветвящийся рост → лабиринт
  mitosis: { feed: 0.0367, kill: 0.0649 }, // пятна делятся, пока не заполнят всё
  'moving spots': { feed: 0.014, kill: 0.054 }, // блуждающие пятна-солитоны
  maze: { feed: 0.029, kill: 0.057 }, // полосы/лабиринт
  worms: { feed: 0.078, kill: 0.061 }, // редкие длинные черви и петли
  holes: { feed: 0.039, kill: 0.058 }, // соты из «дырок»
  'u-skate': { feed: 0.062, kill: 0.0609 }, // U-skate world: «негативные» пятна и стенки
  chaos: { feed: 0.026, kill: 0.051 }, // турбулентность
  waves: { feed: 0.01, kill: 0.047 }, // бегущие дуги-волны
}

export function createGrayScott(opts: GrayScottOptions = {}) {
  const fixed = opts.size
  const withMap = opts.mapMode ?? true

  const params: Record<string, ParamDef> = {
    feed: { value: 0.0545, min: 0, max: 0.1, step: 0.0001 },
    kill: { value: 0.062, min: 0.03, max: 0.075, step: 0.0001 },
    steps: { label: 'steps / frame', value: 12, min: 1, max: 48, step: 1, uniform: false },
    ...(withMap && {
      mapMode: {
        label: 'feed/kill map',
        value: false,
        onChange: (ctx: ExperimentContext) => void (ctx.params.mapMode && ctx.reinit()),
      },
    }),
    clear: { action: (ctx: ExperimentContext) => ctx.reinit({ uClear: 1 }) },
    reseed: { action: (ctx: ExperimentContext) => ctx.reinit() },
    du: { label: 'Du', value: 1.0, min: 0.1, max: 1.2, step: 0.01, folder: 'simulation' },
    dv: { label: 'Dv', value: 0.5, min: 0.05, max: 1.0, step: 0.01, folder: 'simulation' },
    dt: { value: 1.0, min: 0.1, max: 1.2, step: 0.01, folder: 'simulation' },
    resolution: fixed
      ? { value: 1, min: 0.25, max: 2, step: 0.25, uniform: false, folder: 'simulation' }
      : { value: 0.5, min: 0.125, max: 1, step: 0.125, uniform: false, folder: 'simulation' },
    brushSize: { label: 'brush size', value: 0.02, min: 0.003, max: 0.1, step: 0.001, folder: 'brush' },
    brushStrength: { label: 'brush strength', value: 1, min: 0, max: 1, step: 0.01, folder: 'brush' },
    eraser: { label: fixed || opts.pick ? 'eraser' : 'eraser [shift]', value: false, folder: 'brush' },
  }

  const buffers: Record<string, BufferSpec> = {
    state: {
      format: 'rgba32f', // half float теряет мелкие приращения около U≈1 — узоры «застывают»
      filter: 'linear', // для отображения; шаг симуляции читает центры текселей
      wrap: 'repeat',
      pingPong: true,
      ...(fixed
        ? { size: (p: ParamValues) => [fixed[0] * (p.resolution as number), fixed[1] * (p.resolution as number)] as [number, number] }
        : { scale: (p: ParamValues) => p.resolution as number }),
      init: initFrag,
    },
  }

  const passes: Pass[] = [
    {
      name: 'gray-scott',
      frag: simFrag,
      target: 'state',
      inputs: { uState: 'state', ...(opts.pick && { uPick: opts.pick }) },
      iterations: (p) => p.steps as number,
      uniforms: () => ({ ...mapUniforms(), uBrushPick: !!opts.pick }),
    },
  ]

  // В режиме карты нажатие/перетаскивание выбирает feed/kill под пальцем.
  const onPointer = (e: PointerInfo, ctx: ExperimentContext) => {
    if (!ctx.params.mapMode || e.phase === 'up') return
    const c = (t: number) => Math.min(1, Math.max(0, t))
    const { feed, kill } = mapToFK([c(e.uv[0]), c(e.uv[1])])
    ctx.set({ feed: +feed.toFixed(4), kill: +kill.toFixed(4) })
  }

  const presets: Record<string, ParamValues> = { ...PATTERNS }
  return { params, buffers, passes, presets, onPointer }
}
