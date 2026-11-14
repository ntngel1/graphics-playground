// Управление от первого лица для игр (подключается в Experiment.mount):
//   const fps = createFpsControls(root, { onLook: (dx, dy) => …, onAction: (a) => …, buttons: ['cut', …] })
//   каждый кадр: fps.axes() → { fwd, side } (WASD/стрелки + тач-стик), fps.locked; в очистке — fps.dispose()
// Десктоп: клик по канвасу захватывает мышь (pointer lock), движение — обзор, ЛКМ/ПКМ — onAction('primary'|
// 'secondary'), колесо/Q/E — onAction('cycle'). Тач: левая половина экрана — виртуальный стик, правая —
// обзор перетаскиванием, кнопки справа внизу — onAction(имя). Горячие клавиши ядра на WASD/QE молчат,
// если эксперимент перечислил их в ownKeys.
export interface FpsOptions {
  onLook: (dx: number, dy: number) => void // радианы
  onAction: (a: string) => void
  buttons?: { id: string; label: string }[] // тач-кнопки
  enabled?: () => boolean // false — ввод игнорируется (например, до старта)
  keys?: Record<string, string> // KeyboardEvent.code → действие (напр. { Space: 'jump' }); код — в ownKeys эксперимента
  sensitivity?: number
}

export function createFpsControls(root: HTMLElement, o: FpsOptions) {
  const cv = document.querySelector<HTMLCanvasElement>('#gl')!
  const coarse = matchMedia('(pointer: coarse)').matches
  const sens = o.sensitivity ?? 0.0025
  const keys = new Set<string>()
  const st = { locked: false, stick: [0, 0] as [number, number] }
  const ok = () => o.enabled?.() ?? true

  const ui = document.createElement('div')
  ui.className = 'fps-touch'
  ui.innerHTML = `<div class="fps-stick"><i></i></div><div class="fps-btns">${(o.buttons ?? []).map((b) => `<button data-a="${b.id}">${b.label}</button>`).join('')}</div>`
  if (coarse) root.append(ui)
  const stickEl = ui.querySelector<HTMLElement>('.fps-stick')!, knob = stickEl.querySelector('i')!

  const onLock = () => (st.locked = document.pointerLockElement === cv)
  const onMove = (e: MouseEvent) => st.locked && ok() && o.onLook(-e.movementX * sens, -e.movementY * sens)
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch' || !ok()) return
    if (!st.locked) return void cv.requestPointerLock?.()
    o.onAction(e.button === 2 ? 'secondary' : 'primary')
  }
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (Math.abs(e.deltaY) > 20 && ok()) o.onAction('cycle')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && ok()) o.onAction('cycle')
    const act = o.keys?.[e.code]
    if (act && ok() && !e.repeat) (o.onAction(act), e.preventDefault())
    keys.add(e.code)
  }
  const onKeyUp = (e: KeyboardEvent) => void keys.delete(e.code)
  const onBlur = () => keys.clear()

  let stickId = -1, lookId = -1, sx = 0, sy = 0, lx = 0, ly = 0
  const onTouchStart = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' || !ok()) return
    if (e.clientX < innerWidth / 2 && stickId < 0) {
      stickId = e.pointerId; sx = e.clientX; sy = e.clientY
      stickEl.style.left = `${sx - 60}px`; stickEl.style.top = `${sy - 60}px`; stickEl.classList.add('on')
    } else if (lookId < 0) (lookId = e.pointerId), (lx = e.clientX), (ly = e.clientY)
  }
  const onTouchMove = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      const dx = Math.max(-50, Math.min(50, e.clientX - sx)), dy = Math.max(-50, Math.min(50, e.clientY - sy))
      st.stick = [dx / 50, -dy / 50]
      knob.style.transform = `translate(${dx}px, ${dy}px)`
    } else if (e.pointerId === lookId) {
      o.onLook(-(e.clientX - lx) * 0.006, -(e.clientY - ly) * 0.006)
      lx = e.clientX; ly = e.clientY
    }
  }
  const onTouchEnd = (e: PointerEvent) => {
    if (e.pointerId === stickId) (stickId = -1), (st.stick = [0, 0]), (knob.style.transform = ''), stickEl.classList.remove('on')
    if (e.pointerId === lookId) lookId = -1
  }
  ui.querySelectorAll<HTMLButtonElement>('.fps-btns button').forEach((b) =>
    b.addEventListener('pointerdown', (e) => (e.stopPropagation(), ok() && o.onAction(b.dataset.a!))),
  )

  const on: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [
    [document, 'pointerlockchange', onLock], [window, 'mousemove', onMove as EventListener],
    [cv, 'pointerdown', onDown as EventListener], [cv, 'pointerdown', onTouchStart as EventListener],
    [window, 'pointermove', onTouchMove as EventListener], [window, 'pointerup', onTouchEnd as EventListener],
    [window, 'pointercancel', onTouchEnd as EventListener], [cv, 'wheel', onWheel as EventListener, { passive: false }],
    [window, 'keydown', onKey as EventListener], [window, 'keyup', onKeyUp as EventListener], [window, 'blur', onBlur],
  ]
  for (const [t, n, f, opt] of on) t.addEventListener(n, f, opt)

  return {
    coarse,
    get locked() { return st.locked },
    lock: () => !coarse && cv.requestPointerLock?.(),
    axes() {
      const k = (c: string[]) => (c.some((x) => keys.has(x)) ? 1 : 0)
      return {
        fwd: k(['KeyW', 'ArrowUp']) - k(['KeyS', 'ArrowDown']) + st.stick[1],
        side: k(['KeyD', 'ArrowRight']) - k(['KeyA', 'ArrowLeft']) + st.stick[0],
      }
    },
    dispose() {
      for (const [t, n, f] of on) t.removeEventListener(n, f)
      if (document.pointerLockElement === cv) document.exitPointerLock()
      ui.remove()
    },
  }
}
