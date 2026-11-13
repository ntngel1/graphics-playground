// Горячая подмена без релоада страницы.
// - Шейдеры: модули .frag/.glsl self-accept-ятся (см. tools/glsl-plugin.ts), мутируют свой
//   канонический ShaderSource и шлют 'glsl-update' — пересобираются только программы, в чьи deps
//   входит файл. Время, камера, параметры, (позже) FBO не трогаются.
// - index.ts эксперимента: граница HMR — experiments/index.ts; он шлёт 'experiments-update',
//   и main пересоздаёт текущий эксперимент с сохранением значений параметров.
// - Правка ядра/main.ts — обычный full reload.
import type { ShaderSource } from './shader.ts'
import type { Experiment } from './types.ts'

function listen<T>(name: string, cb: (v: T) => void) {
  const f = (e: Event) => cb((e as CustomEvent<T>).detail)
  addEventListener(name, f)
  return () => removeEventListener(name, f)
}

export const onShaderUpdate = (cb: (s: ShaderSource) => void) => listen('glsl-update', cb)
export const onExperimentsUpdate = (cb: (e: Record<string, Experiment>) => void) => listen('experiments-update', cb)
export const emitExperimentsUpdate = (e: Record<string, Experiment>) =>
  dispatchEvent(new CustomEvent('experiments-update', { detail: e }))

// Состояние модуля эксперимента, переживающее HMR (модуль index.ts при правке выполняется заново).
export function hmrState<T extends object>(key: string, init: T): T {
  const g = globalThis as { __gpState?: Record<string, object> }
  return ((g.__gpState ??= {})[key] ??= init) as T
}
