import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext, type ParamValue } from '../../core/types.ts'
import { createFpsControls } from '../../fps/controls.ts'
import { createRetro } from '../../retro/retro.ts'
import { editAllowed, eyeOf, makeEdit, newGame, restartRoom, step, viewDir, visAnchor, worldUniforms, type Game } from './game.ts'
import probe from './probe.frag'
import { ROOMS } from './rooms.ts'
import scene from './scene.frag'

// «Невозможный дом»: от первого лица по дому, где невозможности — свойства SDF-мира:
// повтор пространства (коридор), порталы на уровне луча (кладовка, лестница), правки-срезы,
// перетекание того, на что не смотришь. Физика — по той же map() через GPU-зонд (probe.frag),
// который JS читает в том же кадре; шаг фиксированный — __gp.step(n) воспроизводит прохождение.

const retro = createRetro()
const { ps1Jitter: _j, ps1Facets: _f, ps1Affine: _a, ...retroParams } = retro.params
retroParams.look = { ...retroParams.look, value: 'ps1' } as typeof retroParams.look

const st = hmrState('house', {
  g: null as Game | null,
  frame: -1,
  scripted: false, // e2e: ввод задаёт сценарий, клавиатура не трогает g.input
  axes: () => ({ fwd: 0, side: 0 }),
  sync: () => {},
})
const game = () => (st.g ??= newGame())

// раз в кадр, первым проходом (зонд): перезапуск по R / загрузке
function probeUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  const g = game()
  if (ctx.frame === 0 && st.frame > 0) restartRoom(g)
  st.frame = ctx.frame
  const e = eyeOf(g)
  return { ...worldUniforms(g), uPos: g.pos, uEye: e, uAimDir: viewDir(g), uVisPt: visAnchor(g) }
}

function sceneUniforms(ctx: ExperimentContext): Record<string, ParamValue> {
  const g = game()
  retro.syncScale(ctx, 1)
  if (ctx.dt > 0) {
    if (!st.scripted) Object.assign(g.input, st.axes())
    step(g, ctx.read('probe'), Math.min(ctx.dt, 1 / 30))
    st.sync()
  }
  // призрак инструмента: туда, куда смотришь, если хватает дальности и зарядов
  const ch = g.charges[g.room]
  let ghostA = [0, 0, 0, 0], ghostB = [0, 0, 0, 0]
  const cutFirst = ch.cut > 0
  if (g.lastAim.ok && (ch.cut > 0 || ch.add > 0) && !g.done && editAllowed(g, g.lastAim.p, g.lastAim.n, cutFirst)) {
    const cut = cutFirst
    const e = makeEdit(g, g.lastAim.p, g.lastAim.n, cut)
    const c = e.rep ? [e.c[0], e.c[1], e.c[2] + 5 * Math.round(g.lastAim.p[2] / 5)] : e.c
    ghostA = [c[0], c[1], c[2], e.kind]
    ghostB = [e.yaw, cut ? 1 : -1, 0, 0]
  }
  return { ...worldUniforms(g), uEye: eyeOf(g), uYaw: g.yaw, uPitch: g.pitch, uGhostA: ghostA, uGhostB: ghostB, uFlash: g.flash }
}

export default defineExperiment({
  name: 'Impossible house',
  order: -30,
  description: 'Прогулка от первого лица по дому, который ведёт себя невозможно: бесконечный коридор, комната больше, чем снаружи, лестница по кругу. Режь и лепи мир — он из формул.',
  paneCollapsed: true,
  ownKeys: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft'],
  params: { ...retroParams },
  buffers: { probe: { size: [8, 1], format: 'rgba32f', filter: 'nearest' }, ...retro.buffers },
  passes: [
    { name: 'probe', frag: probe, target: 'probe', uniforms: probeUniforms },
    ...retro.wrap({ name: 'scene', frag: scene, uniforms: sceneUniforms }),
  ],

  mount(root) {
    root.classList.add('hs-ui')
    root.innerHTML = `
<div class="hs-cross"></div>
<div class="hs-hud"><b class="hs-room"></b><span class="hs-hint"></span></div>
<div class="hs-charges"></div>
<div class="hs-start"><div><b>Невозможный дом</b><span class="hs-how"></span><button>войти</button></div></div>
<div class="hs-end" hidden><div><b>Вы вышли из дома</b><span class="hs-time"></span><button>ещё раз</button></div></div>
`
    const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!
    const cv = document.querySelector<HTMLCanvasElement>('#gl')!
    const coarse = matchMedia('(pointer: coarse)').matches
    root.classList.toggle('hs-coarse', coarse)
    $('.hs-how').innerHTML = coarse
      ? 'левый палец — идти, правый — смотреть<br>кнопки — вырезать / прилепить форму'
      : 'мышь — обзор · WASD — идти<br>ЛКМ — вырезать · ПКМ — прилепить · колесо / Q — форма · R — заново комнату'
    let started = false

    st.sync = () => {
      const g = st.g
      if (!g) return
      const r = ROOMS[g.room], ch = g.charges[g.room]
      $('.hs-room').textContent = r.name
      $('.hs-hint').textContent = r.hint
      $('.hs-charges').textContent = r.cuts + r.adds ? `${g.tool ? '▯ проём' : '⬡ шар'} · вырезать ${ch.cut} · прилепить ${ch.add}` : ''
      $('.hs-end').hidden = !g.done
      if (g.done) $('.hs-time').textContent = `за ${Math.floor(g.t / 60)}:${String(Math.floor(g.t % 60)).padStart(2, '0')}`
    }

    const start = () => {
      started = true
      $('.hs-start').hidden = true
      if (!coarse) cv.requestPointerLock?.()
    }
    $('.hs-start button').addEventListener('click', start)
    $('.hs-end button').addEventListener('click', () => {
      st.g = newGame()
      st.sync()
    })

    // управление от первого лица (src/fps/controls.ts): мышь/клавиши/тач → обзор, оси, действия
    const fps = createFpsControls(root, {
      enabled: () => started,
      onLook: (dx, dy) => {
        if (!st.g) return
        st.g.input.dyaw += dx
        st.g.input.dpitch += dy
      },
      onAction: (a) => st.g?.queue.push(a === 'secondary' || a === 'add' ? 'add' : a === 'cycle' || a === 'tool' ? 'tool' : 'cut'),
      buttons: [{ id: 'cut', label: 'вырезать' }, { id: 'add', label: 'прилепить' }, { id: 'tool', label: 'форма' }],
    })
    st.axes = () => fps.axes()
    const tapStart = () => !started && coarse && start() // на таче первый тап по сцене тоже входит
    cv.addEventListener('pointerdown', tapStart)
    st.sync()
    return () => {
      fps.dispose()
      cv.removeEventListener('pointerdown', tapStart)
      st.sync = () => {}
    }
  },
})

