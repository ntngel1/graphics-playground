// Симуляция Грея-Скотта как переиспользуемый модуль: буфер состояния, проход шага, параметры,
// пресеты и обработчик карты feed/kill. Встраивание в другой эксперимент:
//
//   import { grayScott } from '../gray-scott/sim.ts'
//   params: { ...grayScott.params, ...свои }, buffers: grayScott.buffers,
//   passes: [...grayScott.passes, свой проход с inputs: { uState: 'state' }], onPointer: grayScott.onPointer,
//
// Состояние: буфер 'state', R = U, G = V.
import type { BufferSpec, ExperimentContext, Pass, ParamSchema, ParamValues, PointerInfo } from '../../core/types.ts'
import initFrag from './init.frag'
import simFrag from './sim.frag'

// Область диаграммы Пирсона для режима карты: kill по X, feed по Y.
export const MAP_KILL: [number, number] = [0.045, 0.07]
export const MAP_FEED: [number, number] = [0.01, 0.09]
export const mapUniforms = () => ({ uMapKill: MAP_KILL, uMapFeed: MAP_FEED })

const params = {
  feed: { value: 0.0545, min: 0, max: 0.1, step: 0.0001 },
  kill: { value: 0.062, min: 0.03, max: 0.075, step: 0.0001 },
  steps: { label: 'steps / frame', value: 12, min: 1, max: 48, step: 1, uniform: false },
  mapMode: {
    label: 'feed/kill map',
    value: false,
    onChange: (ctx: ExperimentContext) => void (ctx.params.mapMode && ctx.reinit()),
  },
  clear: { action: (ctx: ExperimentContext) => ctx.reinit({ uClear: 1 }) },
  reseed: { action: (ctx: ExperimentContext) => ctx.reinit() },
  du: { label: 'Du', value: 1.0, min: 0.1, max: 1.2, step: 0.01, folder: 'simulation' },
  dv: { label: 'Dv', value: 0.5, min: 0.05, max: 1.0, step: 0.01, folder: 'simulation' },
  dt: { value: 1.0, min: 0.1, max: 1.2, step: 0.01, folder: 'simulation' },
  resolution: { value: 0.5, min: 0.125, max: 1, step: 0.125, uniform: false, folder: 'simulation' },
  brushSize: { label: 'brush size', value: 0.02, min: 0.003, max: 0.1, step: 0.001, folder: 'brush' },
  brushStrength: { label: 'brush strength', value: 1, min: 0, max: 1, step: 0.01, folder: 'brush' },
  eraser: { label: 'eraser [shift]', value: false, folder: 'brush' },
} satisfies ParamSchema

const buffers: Record<string, BufferSpec> = {
  state: {
    format: 'rgba32f', // half float теряет мелкие приращения около U≈1 — узоры «застывают»
    filter: 'linear', // для отображения; шаг симуляции читает центры текселей
    wrap: 'repeat',
    pingPong: true,
    scale: (p) => p.resolution as number,
    init: initFrag,
  },
}

const passes: Pass[] = [
  {
    name: 'gray-scott',
    frag: simFrag,
    target: 'state',
    inputs: { uState: 'state' },
    iterations: (p) => p.steps as number,
    uniforms: mapUniforms,
  },
]

// Значения проверены глазами на этой схеме (Du = 1, Dv = 0.5, dt = 1, ядро Симса),
// стартуя с reseed; режим «waves» у pmneila (0.014/0.045) здесь вымирает — взят соседний 0.010/0.047.
const presets: Record<string, ParamValues> = {
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

// В режиме карты нажатие/перетаскивание выбирает feed/kill под пальцем.
function onPointer(e: PointerInfo, ctx: ExperimentContext) {
  if (!ctx.params.mapMode || e.phase === 'up') return
  const lerp = ([a, b]: [number, number], t: number) => +(a + (b - a) * Math.min(1, Math.max(0, t))).toFixed(4)
  ctx.set({ kill: lerp(MAP_KILL, e.uv[0]), feed: lerp(MAP_FEED, e.uv[1]) })
}

export const grayScott = { params, buffers, passes, presets, onPointer }
