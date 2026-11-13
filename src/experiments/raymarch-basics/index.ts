import { defineExperiment } from '../../core/types.ts'
import frag from './scene.frag'

export default defineExperiment({
  name: 'Raymarch basics',
  description: 'Примитивы со smooth union и смешиванием материалов, мягкие тени, AO, туман. Камера — мышью.',
  camera: { target: [0, 0.75, 0], distance: 5.2, yaw: 0.7, pitch: 0.3, minPitch: 0.04, maxPitch: 1.45, minDistance: 1.8, maxDistance: 15 },
  params: {
    blend: { label: 'smooth k', value: 0.45, min: 0, max: 1, step: 0.01 },
    speed: { value: 1, min: 0, max: 3, step: 0.01 },
    sunAzimuth: { label: 'sun azimuth', value: 150, min: 0, max: 360, step: 1, folder: 'light' },
    sunHeight: { label: 'sun height', value: 32, min: 2, max: 89, step: 1, folder: 'light' },
    softness: { label: 'shadow softness', value: 0.5, min: 0, max: 1, step: 0.01, folder: 'light' },
    ao: { label: 'AO strength', value: 1, min: 0, max: 2, step: 0.01, folder: 'light' },
    colorA: { label: 'material A', value: '#e0603a', folder: 'material' },
    colorB: { label: 'material B', value: '#3a7fe0', folder: 'material' },
    floor: { value: 'checker', options: ['checker', 'grid', 'plain'], folder: 'material' },
    maxSteps: { label: 'max steps', value: 160, min: 16, max: 400, step: 1, folder: 'march' },
    debug: { value: 'final', options: ['final', 'normals', 'steps', 'ao', 'shadow', 'depth'], folder: 'march' },
  },
  passes: [{ frag }],
  presets: {
    liquid: { blend: 0.95, speed: 0.6, softness: 0.85, colorA: '#d94f8a', colorB: '#3fc9b4' },
    'hard edges': { blend: 0, softness: 0.03, sunHeight: 62, ao: 1.5, colorA: '#ece4d6', colorB: '#c0392b', floor: 'grid' },
    sunset: { sunHeight: 7, sunAzimuth: 250, softness: 0.35, colorA: '#ffb347', colorB: '#6a4cff' },
  },
})
