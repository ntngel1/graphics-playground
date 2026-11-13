import type { CameraSpec } from './types.ts'

type V3 = [number, number, number]

export interface Input {
  mouse: { x: number; y: number; down: boolean } // x,y в 0..1 от канваса, y вверх
  camera: { enabled: boolean; pos: V3; target: V3 }
  setCamera(spec: CameraSpec | undefined, keepState: boolean): void
  onChange?: () => void // для перерисовки на паузе
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
    mouse: { x: 0.5, y: 0.5, down: false },
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
    pitch = Math.min(1.55, Math.max(-1.55, pitch))
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
      painting = !input.camera.enabled || e.shiftKey
      if (pointers.size === 2) (pinch = pinchDist()), (painting = false)
      input.mouse.down = painting && pointers.size === 1
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
      if (p) (p.x = e.clientX), (p.y = e.clientY)
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
    if (pointers.size === 0) (input.mouse.down = false), (painting = false)
    input.onChange?.()
  }
  for (const [t, f] of handlers) canvas.addEventListener(t, f as EventListener, { passive: false })
  update()
  return input
}
