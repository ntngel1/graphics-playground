import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext, type ParamValue } from '../../core/types.ts'
import { createFpsControls } from '../../fps/controls.ts'
import { createRetro } from '../../retro/retro.ts'
import { BEACON, ITEM_SPOTS, PADS, camWant, newGame, pumpAt, step, torAt, torHome, worldUniforms, type Game } from './game.ts'
import probe from './probe.frag'
import scene from './scene.frag'

// «Маленькие планеты»: уютный PS1-мир из крошечных планет. Ходишь по любой форме — «вверх» это нормаль
// ближайшей планеты; мухоморы-катапульты перебрасывают на соседние планеты (полёт виден целиком).
// Цель — три свечи для маяка: на внутренней стороне бублика, за горизонтом тыквы, на клубке.

const retro = createRetro()
const { ps1Jitter: _j, ps1Facets: _f, ps1Affine: _a, ps1Fog: _fog, ...retroParams } = retro.params
retroParams.look = { ...retroParams.look, value: 'ps1' } as typeof retroParams.look

const st = hmrState('planets', {
  g: null as Game | null,
  frame: -1,
  scripted: false, // e2e: ввод задаёт сценарий
  axes: () => ({ fwd: 0, side: 0 }),
  sync: () => {},
  data: { PADS, ITEM_SPOTS, BEACON, torAt, pumpAt, torHome }, // для e2e-сценариев
})
const game = () => (st.g ??= newGame())

function probeUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  if (ctx.frame === 0 && st.frame > 0) st.g = newGame() // R — заново
  st.frame = ctx.frame
  const G = game()
  return { ...worldUniforms(G), uPos: G.pos, uUp: G.up, uCamWant: camWant(G) }
}

function sceneUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  const g = game()
  retro.syncScale(ctx, 1)
  if (ctx.dt > 0) {
    if (!st.scripted) Object.assign(g.input, st.axes())
    step(g, ctx.read('probe'), Math.min(ctx.dt, 1 / 30))
    st.sync()
  }
  const cv = document.querySelector<HTMLCanvasElement>('#gl')
  const aspect = cv ? cv.clientWidth / Math.max(1, cv.clientHeight) : 1.6
  g.camDist = aspect < 1 ? 9 : 5 // в портрете дальше и выше: иначе кривизна не читается
  g.camLift = aspect < 1 ? 0.3 : 0
  const trail = new Float32Array(96)
  g.trail.forEach((p, i) => trail.set([...p, (i + 1) / g.trail.length], i * 4))
  return { ...worldUniforms(g), uEye: g.cam, uTarget: g.look, uCamUp: g.up, uFlash: g.flash, uTrail: trail as unknown as number[] }
}

const HINTS = {
  start: 'Маяк погас. Найди три свечи на соседних планетах. Запрыгни на мухомор — он подбросит.',
  carry: 'Неси свечу к маяку.',
  done: 'Маяк горит. Видишь — окна зажглись.',
}

export default defineExperiment({
  name: 'Tiny planets',
  order: -40,
  description: 'Уютный PS1-мир из крошечных планет: ходишь по шару, бублику и тыкве, гравитация — по градиенту SDF. Мухоморы перебрасывают между планетами. Зажги маяк.',
  paneCollapsed: true,
  ownKeys: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space'],
  params: { ...retroParams },
  buffers: { probe: { size: [8, 1], format: 'rgba32f', filter: 'nearest' }, ...retro.buffers },
  passes: [
    { name: 'probe', frag: probe, target: 'probe', uniforms: probeUniforms },
    ...retro.wrap({ name: 'scene', frag: scene, uniforms: sceneUniforms }),
  ],

  mount(root) {
    root.classList.add('pl-ui')
    root.innerHTML = `
<div class="pl-hud"><b class="pl-count"></b><span class="pl-hint"></span></div>
<div class="pl-start"><div><b>Маленькие планеты</b><span class="pl-how"></span><button>начать</button></div></div>`
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    const coarse = matchMedia('(pointer: coarse)').matches
    $('.pl-how').innerHTML = coarse
      ? 'левый палец — идти, правый — смотреть<br>кнопка — прыжок'
      : 'мышь — обзор · WASD — идти · пробел — прыжок<br>R — заново'
    let started = false
    const start = () => {
      started = true
      $('.pl-start').hidden = true
      fps.lock()
    }
    $('.pl-start').addEventListener('pointerdown', (e) => (e.preventDefault(), start())) // тап в любом месте оверлея
    const fps = createFpsControls(root, {
      enabled: () => started,
      keys: { Space: 'jump' },
      onLook: (dx, dy) => {
        if (!st.g) return
        st.g.input.dyaw += dx
        st.g.input.dpitch += dy
      },
      onAction: (a) => {
        if (st.g && a === 'jump') st.g.input.jump = true
      },
      buttons: [{ id: 'jump', label: 'прыжок' }],
    })
    st.axes = () => fps.axes()
    const cv = document.querySelector<HTMLCanvasElement>('#gl')!
    const tapStart = () => !started && coarse && start()
    cv.addEventListener('pointerdown', tapStart)

    st.sync = () => {
      const g = st.g
      if (!g) return
      const n = g.items.filter((i) => i.state === 2).length
      $('.pl-count').textContent = `свечи: ${n} / 3`
      $('.pl-hint').textContent = g.done ? HINTS.done : g.carry >= 0 ? HINTS.carry : HINTS.start
    }
    st.sync()
    return () => {
      fps.dispose()
      cv.removeEventListener('pointerdown', tapStart)
      st.sync = () => {}
    }
  },
})
