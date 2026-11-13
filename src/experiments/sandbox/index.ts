import { hmrState } from '../../core/hmr.ts'
import { defineExperiment, type ExperimentContext } from '../../core/types.ts'
import blur from './blur.frag'
import display from './display.frag'
import emit from './emit.frag'
import init from './init.frag'
import sim from './sim.frag'

// Материалы палитры: id — как в cells.glsl. key — клавиша выбора.
const MATERIALS = [
  { id: 2, name: 'sand', color: '#e0b469', key: '1' },
  { id: 3, name: 'water', color: '#3f8fe6', key: '2' },
  { id: 4, name: 'oil', color: '#7a4a12', key: '3' },
  { id: 5, name: 'lava', color: '#ff6a1a', key: '4' },
  { id: 6, name: 'fire', color: '#ffc04a', key: '5' },
  { id: 9, name: 'plant', color: '#4fb43a', key: '6' },
  { id: 10, name: 'acid', color: '#9dff3a', key: '7' },
  { id: 12, name: 'powder', color: '#4a4442', key: '8' },
  { id: 1, name: 'wall', color: '#5a5a66', key: '9' },
  { id: 13, name: 'tap', color: '#8fa3bd', key: '0' },
  { id: 15, name: 'eraser', color: '#1b1d24', key: 'E' },
] as const
const TOOLS = new Set([1, 13, 15]) // не «вещества»: кран испускает последнее выбранное вещество

const ui = hmrState('sandbox', { tapMat: 3, sync: (() => {}) as () => void })

const setMaterial = (ctx: ExperimentContext, id: number) => {
  if (!TOOLS.has(id)) ui.tapMat = id
  if (ctx.params.material !== id) ctx.set({ material: id })
  ui.sync()
}

export default defineExperiment({
  name: 'Alchemy sandbox',
  order: 0,
  description: 'Падающий песок целиком на GPU: рисуйте песок, воду, масло, лаву, огонь, растения и кислоту — они текут, горят и реагируют друг с другом. Краны оживляют мир.',
  params: {
    material: { value: 2, options: Object.fromEntries(MATERIALS.map((m) => [m.name, m.id])), uniform: 'uMaterial', onChange: (ctx) => setMaterial(ctx, ctx.params.material as number) },
    brush: { label: 'brush [wheel]', value: 3, min: 1, max: 30, step: 1 },
    speed: { label: 'steps / frame', value: 4, min: 1, max: 12, step: 1, uniform: 'uSteps' },
    glowStrength: { label: 'glow', value: 1.2, min: 0, max: 4, step: 0.05 },
    pixel: { label: 'cell size (px)', value: 4, min: 2, max: 12, step: 1, uniform: false },
    scene: { value: 'diorama', options: ['diorama', 'volcano', 'jungle'], onChange: (ctx) => ctx.reinit() },
    restart: { label: 'restart scene', action: (ctx) => ctx.reinit() },
    clear: { action: (ctx) => ctx.reinit({ uClear: 1 }) },
  },
  presets: {
    diorama: { scene: 'diorama' },
    volcano: { scene: 'volcano', glowStrength: 1.6 },
    'jungle + acid rain': { scene: 'jungle' },
  },
  onPreset: (_n, ctx) => ctx.reinit(),
  buffers: {
    // мир: клетка = pixel px канваса; rgba8 хватает (id и счётчики целые)
    state: { format: 'rgba8', filter: 'nearest', pingPong: true, scale: (p) => 1 / (p.pixel as number), init },
    glow: { format: 'rgba16f', filter: 'linear', scale: 0.25 },
    blur: { format: 'rgba16f', filter: 'linear', scale: 0.25 },
  },
  passes: [
    {
      name: 'sim',
      frag: sim,
      target: 'state',
      inputs: { uState: 'state' },
      iterations: (p) => p.speed as number,
      whenPaused: true, // на паузе мир стоит, но кисть рисует
      uniforms: () => ({ uTapMat: ui.tapMat }),
    },
    { name: 'emit', frag: emit, target: 'glow', inputs: { uState: 'state' } },
    { name: 'blur h', frag: blur, target: 'blur', inputs: { uSrc: 'glow' }, uniforms: () => ({ uDir: [1, 0] }) },
    { name: 'blur v', frag: blur, target: 'glow', inputs: { uSrc: 'blur' }, uniforms: () => ({ uDir: [0, 1] }) },
    {
      name: 'display',
      frag: display,
      inputs: { uState: 'state', uGlow: 'glow' },
      uniforms: () => ({ uShowCursor: matchMedia('(pointer: fine)').matches }),
    },
  ],

  // палитра материалов внизу экрана + клавиши 1–9, 0, E + колесо — размер кисти
  mount(root, ctx) {
    root.classList.add('sb-palette')
    root.innerHTML = MATERIALS.map(
      (m) => `<button data-id="${m.id}" title="${m.name} [${m.key}]"><i style="background:${m.color}"></i><span>${m.name}</span></button>`,
    ).join('')
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')]
    ui.sync = () => buttons.forEach((b) => b.classList.toggle('on', +b.dataset.id! === ctx.params.material))
    ui.sync()
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button')
      if (b) setMaterial(ctx, +b.dataset.id!)
    })
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      const m = MATERIALS.find((m) => m.key === e.key.toUpperCase() || (e.code === `Digit${m.key}`))
      if (m) setMaterial(ctx, m.id)
    }
    const canvas = document.querySelector('#gl')!
    const onWheel = (e: Event) => {
      const w = e as WheelEvent
      w.preventDefault()
      const b = Math.min(30, Math.max(1, (ctx.params.brush as number) - Math.sign(w.deltaY)))
      ctx.set({ brush: b })
    }
    addEventListener('keydown', onKey)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      removeEventListener('keydown', onKey)
      canvas.removeEventListener('wheel', onWheel)
      ui.sync = () => {}
    }
  },
})
