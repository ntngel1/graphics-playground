export interface Loop {
  time: number
  frame: number
  paused: boolean
  scale: number // масштаб рендера 0.25..1
  fps: number
  width: number
  height: number
  requestRedraw(): void // перерисовать кадр на паузе (без продвижения времени)
  reset(): void
  resize(): void
  dispose(): void
}

// render(advance): advance=false — перерисовка на паузе, симуляции шагать не должны.
export function createLoop(canvas: HTMLCanvasElement, render: (loop: Loop, advance: boolean) => void): Loop {
  const coarse = matchMedia('(pointer: coarse)')
  let raf = 0
  let last = performance.now()
  let dirty = true

  const loop: Loop = {
    time: 0,
    frame: 0,
    paused: false,
    scale: 1,
    fps: 0,
    width: 1,
    height: 1,
    requestRedraw: () => void (dirty = true),
    reset() {
      loop.time = 0
      loop.frame = 0
      dirty = true
    },
    resize() {
      const dpr = Math.min(devicePixelRatio || 1, coarse.matches ? 1.5 : 2) * loop.scale
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
      loop.width = w
      loop.height = h
      if (w !== canvas.width || h !== canvas.height) {
        canvas.width = w
        canvas.height = h
        dirty = true
      }
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
    },
  }

  const ro = new ResizeObserver(() => loop.resize())
  ro.observe(canvas)

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick)
    const dt = Math.min((now - last) / 1000, 0.1) // без скачка после вкладки в фоне
    last = now
    if (dt > 0) loop.fps += (1 / dt - loop.fps) * 0.05
    if (!loop.paused) {
      render(loop, true)
      loop.time += dt
      loop.frame++
      dirty = false
    } else if (dirty) {
      render(loop, false)
      dirty = false
    }
  }
  loop.resize()
  raf = requestAnimationFrame(tick)
  return loop
}
