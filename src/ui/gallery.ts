// Галерея: стартовый экран и экран по G. Карточка — ссылка на #<id>; превью — public/thumbs/<id>.jpg
// (генерирует `npm run thumbs`), без превью — градиент-заглушка с названием.
import type { Experiment } from '../core/types.ts'

export interface Gallery {
  show(experiments: Record<string, Experiment>): void
  hide(): void
  readonly visible: boolean
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function hue(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

export function createGallery(): Gallery {
  const el = document.createElement('div')
  el.className = 'gp-gallery'
  el.hidden = true
  document.body.append(el)

  return {
    get visible() {
      return !el.hidden
    },
    show(experiments) {
      const cards = Object.entries(experiments)
        .map(([id, e]) => {
          const h = hue(id)
          return `<a class="gp-card" href="#${esc(id)}">
  <div class="gp-thumb" style="--h1:${h};--h2:${(h + 70) % 360}">
    <span class="gp-thumb-name">${esc(e.name)}</span>
    <img src="${import.meta.env.BASE_URL}thumbs/${esc(id)}.jpg" alt="" onerror="this.remove()">
  </div>
  <div class="gp-card-body"><h2>${esc(e.name)}</h2><p>${esc(e.description ?? '')}</p></div>
</a>`
        })
        .join('\n')
      el.innerHTML = `<header><h1>graphics playground</h1>
<p>Эксперименты с шейдерной графикой на чистом WebGL2: реймарчинг, реакция-диффузия и их комбинации.</p></header>
<main class="gp-cards">${cards}</main>
<footer>Space — пауза · S — скриншот · R — сброс · H — спрятать UI · G — галерея · D — кисть/камера</footer>`
      el.hidden = false
      document.body.classList.add('gp-gallery-open')
      document.title = 'graphics playground'
    },
    hide() {
      el.hidden = true
      document.body.classList.remove('gp-gallery-open')
    },
  }
}
