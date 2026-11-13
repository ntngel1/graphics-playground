import type { CameraSpec } from './types.ts'

type V3 = [number, number, number]

export interface Input {
  // x,y в 0..1 от канваса, y вверх; alt — Shift/правая кнопка; px,py — точка нажатия (начало первого отрезка кисти)
  mouse: { x: number; y: number; px: number; py: number; down: boolean; alt: boolean }
  camera: { enabled: boolean; pos: V3; target: V3 }
  setCamera(spec: CameraSpec | undefined, keepState: boolean): void
  onChange?: () => void // для перерисовки на паузе
  onPointer?: (phase: 'down' | 'move' | 'up') => void // только для «кисти» (не вращения камеры)
  brushMode: boolean // при включённой камере: true — одиночное перетаскивание рисует (Shift+drag — всегда)
  dispose(): void
}

// Без камеры: любая кнопка/палец — «кисть» (uMouse.z = 1).
// С камерой: перетаскивание — орбита, колесо/пинч — зум, Shift+перетаскивание — «кисть».
export function createInput(canvas: HTMLCanvasElement): Input {
  const pointers = new Map<number, { x: number; y: number }>()
  let spec: CameraSpec = {}
  let yaw = 0, pitch = 0, dist = 3
  let painting = false
  let pinch = 0

  const input: Input = {
    mouse: { x: 0.5, y: 0.5, px: 0.5, py: 0.5, down: false, alt: false },
    brushMode: false,
    camera: { enabled: false, pos: [0, 0, 3], target: [0, 0, 0] },
    setCamera(s, keepState) {
      input.camera.enabled = !!s
      if (!keepState || !s) {
        spec = s ?? {}
        yaw = spec.yaw ?? 0
        pitch = spec.pitch ?? 0.3
        dist = spec.distance ?? 3
        input.camera.target = [...(spec.target ?? [0, 0, 0])]
      } else spec = s
      update()
    },
    dispose() {
      for (const [t, f] of handlers) canvas.removeEventListener(t, f as EventListener)
    },
  }

  const update = () => {
    dist = Math.min(spec.maxDistance ?? 50, Math.max(spec.minDistance ?? 0.2, dist))
    pitch = Math.min(spec.maxPitch ?? 1.55, Math.max(spec.minPitch ?? -1.55, pitch))
    const t = input.camera.target
    input.camera.pos = [
      t[0] + dist * Math.cos(pitch) * Math.sin(yaw),
      t[1] + dist * Math.sin(pitch),
      t[2] + dist * Math.cos(pitch) * Math.cos(yaw),
    ]
    input.onChange?.()
  }

  const setMouse = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect()
    input.mouse.x = (e.clientX - r.left) / r.width
    input.mouse.y = 1 - (e.clientY - r.top) / r.height
  }
  const pinchDist = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  const handlers: [string, (e: never) => void][] = [
    ['pointerdown', (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      setMouse(e)
      input.mouse.px = input.mouse.x
      input.mouse.py = input.mouse.y
      painting = !input.camera.enabled || input.brushMode || e.shiftKey
      if (pointers.size === 2) (pinch = pinchDist()), (painting = false)
      input.mouse.down = painting && pointers.size === 1
      // Shift в 3D — это «рисовать», а не модификатор; стирание там — правая кнопка или параметр
      input.mouse.alt = (e.shiftKey && !input.camera.enabled) || e.button === 2
      if (input.mouse.down) input.onPointer?.('down')
      input.onChange?.()
    }],
    ['pointermove', (e: PointerEvent) => {
      setMouse(e)
      const p = pointers.get(e.pointerId)
      if (p && input.camera.enabled && !painting) {
        if (pointers.size === 1) {
          yaw -= (e.clientX - p.x) * 0.006
          pitch += (e.clientY - p.y) * 0.006
        } else if (pointers.size === 2) {
          p.x = e.clientX, p.y = e.clientY
          const d = pinchDist()
          if (pinch > 0 && d > 0) dist *= pinch / d
          pinch = d
        }
        update()
      }
      if (p) (p.x = e.clientX), (p.y = e.clientY), (input.mouse.alt = (e.shiftKey && !input.camera.enabled) || (e.buttons & 2) !== 0)
      if (input.mouse.down) input.onPointer?.('move')
      input.onChange?.()
    }],
    ['pointerup', (e: PointerEvent) => release(e)],
    ['pointercancel', (e: PointerEvent) => release(e)],
    ['wheel', (e: WheelEvent) => {
      if (!input.camera.enabled) return
      e.preventDefault()
      dist *= Math.exp(e.deltaY * 0.001)
      update()
    }],
    ['contextmenu', (e: Event) => e.preventDefault()],
  ]
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId)
    pinch = 0
    if (input.mouse.down) input.onPointer?.('up')
    if (pointers.size === 0) (input.mouse.down = false), (painting = false), (input.mouse.alt = false)
    input.onChange?.()
  }
  for (const [t, f] of handlers) canvas.addEventListener(t, f as EventListener, { passive: false })
  update()
  return input
}
