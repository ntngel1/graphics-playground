// Звук «Resonance»: только OscillatorNode type 'sine' + огибающие громкости (GainNode). Ни сэмплов, ни шума.
// Частоты — гармонический ряд одной основы F0: частота существа n звучит как F0·n, поэтому всё созвучно.
// Комбо поднимает ноту на октаву (×2, ×4), удар — два синуса с расстройкой 6 % (биения), дрон — F0 и 1.5·F0.
// AudioContext создаётся по первому жесту (политика автоплея).

const F0 = 110

export interface Sound {
  ctx: AudioContext | null
  muted: boolean
  stats: { oscillators: number; notes: number }
  start(): void
  setMuted(m: boolean): void
  eat(n: number, combo: number): void
  hurt(n: number, other: number): void
  glide(from: number, to: number, dur: number): void
  die(): void
  first(): void // новый вид существ: восходящее арпеджио
  dispose(): void
}

export function createSound(): Sound {
  let master: GainNode | null = null
  let droneGain: GainNode | null = null
  const live: OscillatorNode[] = []

  const osc = (freq: number) => {
    const o = s.ctx!.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    s.stats.oscillators++
    return o
  }
  // нота: синус с огибающей атака → экспоненциальный спад
  const note = (freq: number, at: number, dur: number, vol: number, dest: AudioNode = master!) => {
    if (!s.ctx || !master) return
    const t = s.ctx.currentTime + at
    const g = s.ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(vol, t + 0.008)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    const o = osc(freq)
    o.connect(g).connect(dest)
    o.start(t)
    o.stop(t + dur + 0.05)
    s.stats.notes++
    return o
  }

  const s: Sound = {
    ctx: null,
    muted: false,
    stats: { oscillators: 0, notes: 0 },
    start() {
      if (s.ctx) return void s.ctx.resume()
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      s.ctx = new AC()
      master = s.ctx.createGain()
      master.gain.value = s.muted ? 0 : 0.5
      master.connect(s.ctx.destination)
      // дрон арены: F0/2 и квинта, громкость медленно дышит синусом 0.07 Гц
      droneGain = s.ctx.createGain()
      droneGain.gain.value = 0.05
      droneGain.connect(master)
      const lfo = osc(0.07), lfoAmt = s.ctx.createGain()
      lfoAmt.gain.value = 0.03
      lfo.connect(lfoAmt).connect(droneGain.gain)
      for (const [f, v] of [[F0 / 2, 0.8], [(F0 / 2) * 1.5, 0.35], [F0, 0.2]] as const) {
        const o = osc(f), g = s.ctx.createGain()
        g.gain.value = v
        o.connect(g).connect(droneGain)
        o.start()
        live.push(o)
      }
      lfo.start()
      live.push(lfo)
    },
    setMuted(m) {
      s.muted = m
      if (master && s.ctx) master.gain.setTargetAtTime(m ? 0 : 0.5, s.ctx.currentTime, 0.05)
    },
    eat(n, combo) {
      const oct = combo >= 7 ? 4 : combo >= 4 ? 2 : 1
      const f = F0 * n * oct
      note(f, 0, 0.55, 0.22)
      note(f * 2, 0.0, 0.25, 0.06) // обертон
      if (combo >= 3) note(f * 1.5, 0.07, 0.4, 0.08) // квинта сверху — «аккорд» серии
    },
    hurt(n, other) {
      // диссонанс: своя нота против чужой и её расстроенной копии — биения
      const f = F0 * n
      note(f, 0, 0.5, 0.2)
      note(f * 1.06, 0, 0.5, 0.2)
      note(F0 * other * 0.5, 0, 0.35, 0.12)
    },
    glide(from, to, dur) {
      if (!s.ctx || !master) return
      const t = s.ctx.currentTime
      const o = note(F0 * from, 0, dur + 0.25, 0.1)
      o?.frequency.setValueAtTime(F0 * from, t)
      o?.frequency.exponentialRampToValueAtTime(F0 * to, t + dur)
    },
    die() {
      ;[7, 5, 4, 3, 2].forEach((n, i) => note(F0 * n * 0.5, i * 0.12, 0.9, 0.16))
    },
    first() {
      ;[3, 4, 5, 6].forEach((n, i) => note(F0 * n * 2, i * 0.06, 0.4, 0.07))
    },
    dispose() {
      for (const o of live) try { o.stop() } catch { /* уже остановлен */ }
      s.ctx?.close()
      s.ctx = null
    },
  }
  return s
}
