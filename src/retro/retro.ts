// PS1-вид для любой экранной сцены. Встраивание:
//
//   const retro = createRetro()
//   params: { ...свои, ...retro.params }, buffers: { ...свои, ...retro.buffers },
//   passes: [...свои до, ...retro.wrap({ frag: scene, uniforms }, scenePs1), ...]
//
// Сцена рисуется в буфер 'retro': в обычном виде — размером с канвас, в ps1 — ~ps1Res строк
// (целочисленный делитель высоты канваса → пиксели ровные). Проход 'present' увеличивает NEAREST
// и квантует цвет (5 бит + Байер 4×4). В шейдере сцены доступны юниформы параметров ниже
// (uPs1Res, uPs1Bits, uPs1Dither, uPs1Jitter, uPs1Fog, uPs1Facets: индекс FACETS) и
// хелперы <retro>: retroSnap (дрожание вершин), sdPrismBranch/sdDodeca/sdIcosa, quantNormal, bayer4.
// В ps1 эксперимент должен ставить ctx.renderScale = 1 (иначе браузер размывает пиксели) — см. syncScale.
import type { ShaderSource } from '../core/shader.ts'
import type { BufferSpec, ExperimentContext, ParamDef, ParamValues, Pass } from '../core/types.ts'
import present from './present.frag'

export const FACETS = ['none', 'normals', 'snap', 'poly'] as const

const canvasSize = (): [number, number] => {
  const c = document.querySelector<HTMLCanvasElement>('#gl')
  return c ? [c.width, c.height] : [960, 600]
}
const isPs1 = (p: ParamValues) => p.look === 'ps1'
// экранных px на пиксель буфера: целое, ближайшее к высота/ps1Res
export const retroK = (p: ParamValues) => (isPs1(p) ? Math.max(1, Math.round(canvasSize()[1] / (p.ps1Res as number))) : 1)

export function createRetro(opts: { folder?: string } = {}) {
  let lastLook: string | null = null
  const folder = opts.folder ?? 'ps1'
  const params: Record<string, ParamDef> = {
    look: { value: 'normal', options: ['normal', 'ps1'] },
    ps1Res: { label: 'lines', value: 240, min: 160, max: 360, step: 8, folder },
    ps1Bits: { label: 'color bits', value: 5, min: 2, max: 8, step: 1, folder },
    ps1Dither: { label: 'dither', value: 1, min: 0, max: 2, step: 0.05, folder },
    ps1Jitter: { label: 'vertex jitter (px)', value: 1, min: 0, max: 4, step: 0.25, folder },
    ps1Fog: { label: 'draw distance', value: 24, min: 8, max: 60, step: 1, folder },
    ps1Facets: { label: 'facets', value: 'poly', options: [...FACETS], folder },
    ps1Affine: { label: 'affine uv', value: 1, min: 0, max: 1, step: 0.05, folder },
  }
  const buffers: Record<string, BufferSpec> = {
    retro: {
      format: 'rgba16f', // квантование — в present, буфер держит точность для дизеринга
      filter: 'nearest',
      size: (p) => {
        const [w, h] = canvasSize(), k = retroK(p)
        return [Math.ceil(w / k), Math.ceil(h / k)]
      },
    },
  }
  return {
    params,
    buffers,
    // scene — обычная сборка, ps1 — та же сцена с #define RETRO (файл-обёртка: `#define RETRO` +
    // `#include "scene.frag"`): так PS1-код не стоит ничего обычному виду. Без ps1 — одна программа на оба вида.
    wrap: (scene: Pass, ps1?: ShaderSource): Pass[] => [
      ps1 ? { ...scene, target: 'retro', enabled: (p) => !isPs1(p) && (scene.enabled?.(p) ?? true) } : { ...scene, target: 'retro' },
      ...(ps1 ? [{ ...scene, name: `${scene.name ?? 'scene'} (ps1)`, frag: ps1, target: 'retro', enabled: (p: ParamValues) => isPs1(p) && (scene.enabled?.(p) ?? true) }] : []),
      { name: 'present', frag: present, inputs: { uSrc: 'retro' }, uniforms: (ctx) => ({ uRetroK: retroK(ctx.params) }) },
    ],
    // раз в кадр: при смене вида (и на первом кадре) — в ps1 канвас 1:1 (чёткие пиксели),
    // в обычном — масштаб эксперимента; в остальное время ползунок render scale не трогаем
    syncScale(ctx: ExperimentContext, normalScale: number) {
      const look = String(ctx.params.look)
      if (look === lastLook) return
      lastLook = look
      ctx.renderScale = isPs1(ctx.params) ? 1 : normalScale
    },
  }
}
