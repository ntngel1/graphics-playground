import { defineExperiment } from '../../core/types.ts'
import display from './display.frag'
import { grayScott, mapUniforms } from './sim.ts'

export default defineExperiment({
  name: 'Gray-Scott',
  description: 'Реакция-диффузия. Рисуйте мышью/пальцем (Shift — стереть). Режим карты: feed/kill по осям, тап выбирает точку.',
  params: {
    ...grayScott.params,
    palette: { value: 'ocean', options: ['ink', 'sunset', 'ocean', 'rainbow', 'heat', 'neon'], folder: 'display' },
    relief: { value: true, folder: 'display' },
    reliefDepth: { label: 'relief depth', value: 12, min: 1, max: 40, step: 0.5, folder: 'display' },
  },
  buffers: grayScott.buffers,
  passes: [...grayScott.passes, { name: 'display', frag: display, inputs: { uState: 'state' }, uniforms: mapUniforms }],
  presets: grayScott.presets,
  onPointer: grayScott.onPointer,
})
