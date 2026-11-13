import { defineExperiment } from '../../core/types.ts'
import display from './display.frag'
import { createGrayScott, mapUniforms, PALETTES } from './sim.ts'

const gs = createGrayScott()

export default defineExperiment({
  name: 'Gray-Scott',
  description: 'Реакция-диффузия. Рисуйте мышью/пальцем (Shift — стереть). Режим карты: feed/kill по осям, тап выбирает точку.',
  params: {
    ...gs.params,
    palette: { value: 'ocean', options: PALETTES, folder: 'display' },
    relief: { value: true, folder: 'display' },
    reliefDepth: { label: 'relief depth', value: 12, min: 1, max: 40, step: 0.5, folder: 'display' },
  },
  buffers: gs.buffers,
  passes: [...gs.passes, { name: 'display', frag: display, inputs: { uState: 'state' }, uniforms: mapUniforms }],
  presets: gs.presets,
  onPointer: gs.onPointer,
})
