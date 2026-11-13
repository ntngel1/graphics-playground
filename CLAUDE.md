# graphics-playground

Браузерная песочница шейдерной графики: реймарчинг, реакция-диффузия, их комбинации. Важны видимый
результат и скорость итераций, код компактный, без лишних абстракций.

Стек: Vite 8 + TypeScript strict (tsc 7), чистый WebGL2 / GLSL ES 3.00, без three.js. Панель — tweakpane 4.
`#include` в шейдерах — **свой плагин `tools/glsl-plugin.ts`, а не vite-plugin-glsl**: тот склеивает
include в одну строку (номера строк драйвера не сопоставить с файлами) и не даёт подменить шейдер без
пересоздания эксперимента.

## Команды
- `npm run dev` (`dev:host` — доступ с телефона по сети), `npm run build` (tsc + vite build), `npm run preview`
- `npm run typecheck`, `npm test` (node --test tests/ — маппинг строк шейдера; Node ≥ 22.18, TS без сборки)
- `npm run thumbs` — превью галереи `public/thumbs/<id>.jpg` (headless Chrome, свой dev-сервер; `--only id1,id2`, `--url`)
- Деплой: `.github/workflows/deploy.yml` → GitHub Pages по push в main. `base: './'` (vite.config.ts) —
  работает на любом подпути; `BASE=/x/` переопределяет.

## Ядро (src/core)
- `types.ts` — Experiment / Pass / BufferSpec / ParamSchema; конвенции юниформов описаны там же.
- `pipeline.ts` — исполнение проходов: буферы создаются лениво по размеру канваса, init-проходы,
  итерации, входы. `fbo.ts` — текстуры/FBO, ping-pong, перенос содержимого при ресайзе, фолбэк форматов.
- `shader.ts` — сборка include + карта строк, разбор лога драйвера (ANGLE/Mesa). Пролог добавляется
  автоматически, если файл не начинается с `#version`: precision, `uTime uFrame uResolution uScreen uMouse
  uMousePrev uCamPos uCamTarget`, `in vec2 vUv`, `out vec4 fragColor`. Вершинный шейдер общий (фуллскрин-треугольник).
- `loop.ts` (RAF, пауза, DPR ≤ 2, на coarse pointer ≤ 1.5, × render scale), `input.ts` (pointer events,
  орбитальная камера, режим кисти), `params.ts` (схема → tweakpane + юниформы + URL), `overlay.ts`, `hmr.ts`.
- `main.ts` — роутинг по hash (`#<id>?param=…`; пустой/неизвестный → галерея `src/ui/gallery.ts`), панель, клавиши.

Проходы и буферы:
- `target: 'screen' | '<buffer>'`; `inputs: { uState: 'state' }` → `sampler2D uState` + `vec2 uStateSize` (px).
- `pingPong: true` — пишем во второй слот, swap после каждой итерации; чтение своего буфера = прошлое
  состояние. Проходы в ping-pong буферы — «шаг симуляции»: на паузе не выполняются.
- `BufferSpec`: `scale` (доля канваса, число или функция параметров) или `size` (px, массив или функция),
  `format` rgba8/16f/32f (32f недоступен → 16f + уведомление; нет float → rgba8 + ошибка в оверлее), `filter`, `wrap`, `init`.
- `uResolution` — размер текущего таргета; `uMouse`/`uMousePrev` — в px текущего таргета (y вверх),
  поэтому `uMouse.xy / uResolution` — uv в любом проходе; z — нажато, w — Shift (в 2D) / правая кнопка;
  в первый кадр нажатия `uMousePrev.xy` = точка нажатия. `uScreen` — размер канваса.
- init-проход получает `uSeed` и юниформы из `ctx.reinit({...})`. R / `ctx.reset()` — время, кадр и init.
- `Pass.uniforms(ctx)` — доп. юниформы; накопление фазы по `ctx.dt` + `hmrState(key, init)` вместо `uTime * speed`.

## Эксперимент
Папка `src/experiments/<id>/` с `index.ts` — авторегистрация, ядро не трогать. Минимум:
```ts
import { defineExperiment } from '../../core/types.ts'
import frag from './main.frag'
export default defineExperiment({
  name: 'My thing', description: 'для карточки галереи', order: 10,
  params: { speed: { value: 1, min: 0, max: 5 }, tint: { value: '#ff8844' } },  // → uSpeed, uTint (vec3)
  passes: [{ frag }],
})
```
Параметры: number, boolean, `'#rrggbb'` → vec3, `[x,y]`/`[x,y,z]`, select (`options`; юниформ — значение
или индекс строки), кнопка (`action(ctx)`). `uniform: false` — без юниформа; `onChange(ctx)` — хук панели.
Юниформы параметров **объявляются в шейдере вручную**; отсутствующие в шейдере молча пропускаются;
имена, совпадающие со стандартными (`resolution` → `uResolution`), — предупреждение в консоли.
Прочее: `camera` (орбита; включает переключатель drag camera/brush), `presets`, `onPreset`, `onPointer`,
`renderScale`, `buffers`. Превью для галереи — `npm run thumbs -- --only <id>` (без него — заглушка).

Встраивание симуляции другого эксперимента (пример — living-surface):
```ts
const gs = createGrayScott({ size: [640, 256], pick: 'pick', mapMode: false })  // gray-scott/sim.ts
params: { ...gs.params, ... }, buffers: { ...gs.buffers, ... }, passes: [...свои, ...gs.passes, свой рендер]
```
Состояние Gray-Scott: R = 1 − U (так half float не теряет приращения около U≈1), G = V; wrap repeat.

## Шейдеры
- `#include "file"` — рядом с файлом, затем `src/glsl`; `#include <name>` — только `src/glsl`; расширение
  `.glsl` можно опускать; include-once; циклы — ошибка.
- `src/glsl`: sdf (sd*/op*, rot2/rotX…), noise (PCG-хэши, vnoise/gnoise/fbm/voronoi), normal/shadow/ao/raymarch
  (требуют `float map(vec3 p)` **до** include), lighting, palette (pal*, tonemapACES, gamma), camera
  (`cameraRay(frag, res, pos, target, fov)`; fov по меньшей стороне экрана), pattern (фильтрованные шахматка/сетка).
- Цвета параметров и палитр — display-space; в освещении переводить в линейное (`pow(c, 2.2)`).

## HMR и ошибки
- Правка `.frag/.glsl` (в т.ч. include) — перекомпилируется только затронутая программа; время, камера,
  параметры, FBO сохраняются. Не компилируется — работает старая программа + оверлей с файл:строка и фрагментом.
- Правка `index.ts` эксперимента — пересоздание с сохранением параметров и буферов с той же раскладкой.
- Правка ядра — полный релоад.

## Клавиши
Space — пауза, S — PNG, R — сброс, H — спрятать UI, G — галерея, D — кисть/камера (эксперименты с camera).
Не срабатывают в полях ввода и с Ctrl/Cmd/Alt.

## Отладка и проверка
- dev: `window.__gp` = `{ glc, loop, ctx, input, cur, bench(n) }`; `cur.pipeline.buffer('state')` — буфер
  (readPixels FLOAT по `read.fb`); `bench(n)` — мс на кадр с ожиданием GPU.
- `?float=16` / `?float=0` (query до `#`) — эмуляция отсутствия float32 / любых float-таргетов (как на iOS).
- Headless Chrome: `--headless=new --use-angle=metal --enable-gpu` (SwiftShader медленный) + CDP
  (Node 26: глобальные fetch/WebSocket). Мобильный: `Emulation.setDeviceMetricsOverride` (390×844, DPR 3,
  mobile) + `setTouchEmulationEnabled` до загрузки страницы, жесты — `Input.dispatchTouchEvent`.
  Клик по координатам под панелью уходит в панель — прятать UI (H) перед синтетическими мазками.
- Процессы (dev-сервер, Chrome) останавливать по конкретному PID.

## Известные ограничения
- 60 fps living-surface мерились только на Apple M5 (~4 мс/кадр в 1200×750); по умолчанию renderScale 0.75.
- Силуэты displaced-поверхностей при renderScale < 1 слегка зубчатые (без AA).
- Сфера в living-surface — трипланар: мазок кисти дублируется в «зеркальных» местах проекции.
- В режиме кисти по поверхности первый отрезок мазка — точка (pick знает только прошлый кадр).
- Смена пресета Gray-Scott без reseed может «убить» узор (living-surface поэтому делает reseed).
