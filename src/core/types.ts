import type { ShaderSource } from './shader.ts'

// ---------- Параметры ----------
// Имя ключа `feed` → юниформ `uFeed` (можно переопределить через `uniform`, false — без юниформа).
interface ParamBase {
  label?: string
  uniform?: string | false
  folder?: string // группа в панели
  onChange?: (ctx: ExperimentContext) => void // только при изменении из панели
}
export interface NumberParam extends ParamBase { value: number; min?: number; max?: number; step?: number }
export interface BoolParam extends ParamBase { value: boolean }
export interface ColorParam extends ParamBase { value: `#${string}` } // → vec3 (0..1)
export interface Vec2Param extends ParamBase { value: [number, number]; min?: number; max?: number; step?: number }
export interface Vec3Param extends ParamBase { value: [number, number, number]; min?: number; max?: number; step?: number }
// Юниформ получает число: значение опции, а для строковых опций — её индекс.
export interface SelectParam extends ParamBase {
  value: string | number
  options: readonly (string | number)[] | Record<string, string | number>
}
export interface ButtonParam extends ParamBase { action: (ctx: ExperimentContext) => void }

export type ParamDef = NumberParam | BoolParam | ColorParam | Vec2Param | Vec3Param | SelectParam | ButtonParam
export type ParamSchema = Record<string, ParamDef>
export type ParamValue = number | boolean | string | number[]
export type ParamValues = Record<string, ParamValue>

// ---------- Буферы и проходы ----------
// Именованные offscreen-буферы (Experiment.buffers), в которые пишут проходы с target: '<имя>'.
//
// Конвенции юниформов в проходе:
//  - uResolution — размер ТЕКУЩЕГО таргета в px (буфера или экрана); uScreen — размер канваса в px;
//  - uMouse / uMousePrev (vec4) — в px текущего таргета, y вверх: uMouse.xy / uResolution — uv
//    в любом проходе. z — кнопка зажата, w — модификатор (Shift или правая кнопка).
//    uMousePrev — значение на прошлом кадре; в первый кадр нажатия xy совпадает с uMouse;
//  - inputs: { uState: 'state' } → sampler2D uState (текущее состояние буфера) и vec2 uStateSize (px).
//    texel = 1.0 / uStateSize;
//  - int uIteration — номер итерации прохода в кадре; bool uAdvance — false при перерисовке на паузе;
//  - init-проход буфера получает те же юниформы + float uSeed (случайное при каждом init)
//    + доп. юниформы из ctx.reinit({...}).
//
// Ping-pong: проход пишет во второй слот и меняет слоты после каждой итерации, поэтому чтение
// буфера внутри его же прохода даёт прошлое состояние. Без pingPong читать свой таргет нельзя.
// Проходы в pingPong-буферы — «шаг симуляции»: на паузе при перерисовке они не выполняются.
export interface BufferSpec {
  // доля от размера канваса (по умолчанию 1); функция — от параметров (разрешение симуляции)
  scale?: number | ((p: ParamValues) => number)
  size?: [number, number] | ((p: ParamValues) => [number, number]) // фиксированный размер в px, приоритетнее scale
  format?: 'rgba8' | 'rgba16f' | 'rgba32f' // по умолчанию rgba16f
  filter?: 'linear' | 'nearest' // по умолчанию nearest
  wrap?: 'clamp' | 'repeat' | 'mirror' // по умолчанию clamp
  pingPong?: boolean
  init?: ShaderSource // проход инициализации: при создании, по R / ctx.reset() и ctx.reinit()
}

export interface Pass {
  name?: string
  frag: ShaderSource
  target?: 'screen' | (string & {}) // имя из Experiment.buffers; по умолчанию 'screen'
  inputs?: Record<string, string> // sampler-юниформ → имя буфера, напр. { uState: 'state' }
  iterations?: number | ((p: ParamValues) => number) // прогонов за кадр (ping-pong свапается каждый раз)
  enabled?: (p: ParamValues) => boolean
  uniforms?: (ctx: ExperimentContext) => Record<string, ParamValue> // доп. юниформы прохода
  // проход в ping-pong буфер выполняется и на паузе (1 итерация, bool uAdvance = false) — напр. чтобы рисовать
  whenPaused?: boolean
}

// ---------- Камера ----------
export interface CameraSpec {
  target?: [number, number, number]
  distance?: number
  yaw?: number // рад
  pitch?: number // рад
  minPitch?: number // рад; > 0 — камера не уходит под горизонт цели (по умолчанию -1.55)
  maxPitch?: number // рад (по умолчанию 1.55)
  minDistance?: number
  maxDistance?: number
}

// ---------- Эксперимент ----------
export interface Experiment {
  name: string
  description?: string // текст карточки в галерее
  order?: number // порядок в галерее (меньше — раньше; без order — в конце, по id)
  params?: ParamSchema
  passes: Pass[]
  buffers?: Record<string, BufferSpec>
  camera?: CameraSpec // включает орбитальную камеру (мышь перестаёт быть «кистью»)
  presets?: Record<string, ParamValues>
  renderScale?: number // масштаб рендера по умолчанию
  // Нажатие/перетаскивание по канвасу (uv 0..1, y вверх). Вызывается в дополнение к uMouse.
  onPointer?: (e: PointerInfo, ctx: ExperimentContext) => void
  onPreset?: (name: string, ctx: ExperimentContext) => void // после применения пресета из панели
  // Свой DOM поверх канваса (палитра, кнопки): root смонтирован в body, прячется по H и в галерее.
  // Возвращаемая функция вызывается при выгрузке/пересоздании эксперимента (снять слушатели и т.п.).
  mount?: (root: HTMLElement, ctx: ExperimentContext) => (() => void) | void
  // режимы перетаскивания для экспериментов с camera (селектор `drag [D]`, D листает по кругу);
  // по умолчанию ['camera', 'brush']. Всё, кроме 'camera', приходит как «рисование» (uMouse.z, onPointer).
  dragModes?: string[]
  paneCollapsed?: boolean // панель настроек свёрнута при открытии (у игр своя UI)
}

export interface PointerInfo {
  uv: [number, number]
  phase: 'down' | 'move' | 'up'
  shift: boolean
  size: [number, number] // размер канваса в css px (для аспекта)
}

// То, что доступно кнопкам и колбэкам проходов.
export interface ExperimentContext {
  params: ParamValues
  set(values: ParamValues): void
  reset(): void // время, кадр и init всех буферов
  reinit(uniforms?: Record<string, ParamValue>): void // только init буферов, с доп. юниформами
  time: number
  frame: number
  dt: number // с, длительность кадра; 0 на паузе — для накопления фазы в Pass.uniforms
  dragMode: string // текущий режим перетаскивания (запись меняет режим; событие 'gp-dragmode' на window)
  readonly camera: { pos: [number, number, number]; target: [number, number, number] }
  read(buffer: string): Float32Array | null // readPixels float-буфера (маленьких! синхронно ждёт GPU)
}

export const defineExperiment = <T extends Experiment>(e: T): T => e
