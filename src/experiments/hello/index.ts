import { defineExperiment } from '../../core/types.ts'
import frag from './hello.frag'

export default defineExperiment({
  name: 'Hello',
  description: 'Плазма на fbm с domain warping; мышь — светящееся пятно (ярче при нажатии).',
  params: {
    speed: { value: 1, min: 0, max: 5, step: 0.01 },
    tint: { value: '#ff8844' },
    wobble: { value: true },
    palette: { value: 'sunset', options: ['sunset', 'rainbow', 'mono'] },
    offset: { value: [0, 0], min: -1, max: 1 },
    randomize: {
      label: 'randomize tint',
      action: (ctx) => ctx.set({ tint: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}` }),
    },
  },
  passes: [{ frag, target: 'screen' }],
  presets: {
    calm: { speed: 0.3, tint: '#4488ff', wobble: false, palette: 'mono' },
    acid: { speed: 3, tint: '#88ff44', palette: 'rainbow' },
  },
})
