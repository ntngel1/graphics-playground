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
- `uIteration` — номер итерации прохода в кадре (чередование сдвига блоков и т.п.); `bool uAdvance`.
  `Pass.whenPaused: true` — ping-pong проход выполняется и на паузе (1 итерация, `uAdvance = false`):
  так sandbox рисует кистью по замершему миру.
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
Прочее: `camera` (орбита; включает селектор `drag [D]`; режимы — `dragModes`, по умолчанию camera/brush;
всё, кроме camera, приходит как «рисование»: uMouse.z + `onPointer`; текущий — `ctx.dragMode`, смена шлёт
событие `gp-dragmode`), `presets`, `onPreset`, `onPointer`,
`renderScale`, `buffers`, `mount(root, ctx)` — свой DOM (root `.gp-exp-ui` в body, прячется по H и в галерее;
вернуть функцию очистки: слушатели клавиш/колеса снимать там). Пример — палитра в `sandbox/index.ts`. Превью для галереи — `npm run thumbs -- --only <id>` (без него — заглушка).

Встраивание симуляции другого эксперимента (пример — living-surface):
```ts
const gs = createGrayScott({ size: [640, 256], pick: 'pick', mapMode: false })  // gray-scott/sim.ts
params: { ...gs.params, ... }, buffers: { ...gs.buffers, ... }, passes: [...свои, ...gs.passes, свой рендер]
```
Состояние Gray-Scott: R = 1 − U (так half float не теряет приращения около U≈1), G = V; wrap repeat.

Sandbox (клеточный автомат, `src/experiments/sandbox`): состояние rgba8 NEAREST, R — материал, G — life,
B — оттенок, A — флаги (бит 0 — направление растекания, 1..4 — что льёт кран). Движение — окрестность
Марголуса: блоки 2×2, сдвиг чередуется по `uFrame·steps + uIteration`; каждый пиксель детерминированно считает
свой блок (общий RNG от координаты блока и шага) и берёт свою клетку, поэтому масса сохраняется без реакций.
Новый материал: id в `cells.glsl` (+ DENSITY/MOBILITY), реакции в `react()`, вид в `display.frag`/`look.glsl`,
кнопка в `MATERIALS` (index.ts). Тест-сцены: `ctx.reinit({ uTest: 1 })` — блок песка, `2` — столб воды.

Phototroph (`src/experiments/phototroph`): петля 3D ↔ симуляция. Проход `light` (буфер в uv поверхности,
вдвое меньше состояния) восстанавливает точку смещённой поверхности (`surfaceFrame` в living-surface/surface.glsl;
сфера здесь lat-long — развёртка обратима) и маршит тень к солнцу через полную сцену (рельеф + заслонки
`uShade[3]`). `createGrayScott({ light: 'light' })`: F ∝ свету (`lightFeed`), доп. распад V в темноте, споры,
биомасса B (канал B, растёт от V·свет, распадается медленно → «костяной» след); высота = 0.7·B + 0.3·живое
(`uHeightSrc 1`). Заслонки и солнце двигаются в JS (CPU-марш базовой формы); состояние — `hmrState('phototroph')`.
Поведение проверено численно (`e2e7.mjs` в scratchpad сессии, см. отчёты): доля живого свет/тень, переезд за
солнцем, вымирание под заслонкой, self-shadow, день/ночь.

Plasticine (`src/experiments/knobs`): головоломка — шарик катится сам, игрок крутит ручки мира (SDF).
Физика шарика — на GPU (`ball.frag`, буфер 8×1 rgba32f, 4 подшага по 1/240 с на кадр, детерминированно):
та же `map()`, что в рендере; контакт — выталкивание по нормали, поэтому мир может «наезжать» на шарик.
Ручки: ползунок = цель, фактическое значение догоняет её ≤ 0.5 диапазона/с (в JS, раз в кадр).
Новый уровень: `levels/lN.glsl` с `levelN(vec3 p, vec2 knob)` + `#include` и ветка в `world.glsl` + запись в
`levels.ts` (старт, цель, подписи ручек). Детали — `parts.glsl` (`slab`, `chute`). Честность уровней проверяется
прогоном таймлайна ручек: `__gp.loop.paused = true`, `__gpState.knobs.auto = false`, `__gp.step(n)` (синхронные кадры
по 1/60 с), статус — `ctx.read('ball')[3]` (0 ждёт, 1 катится, 2 победа, 3 упал); скрипт — `e2e8.mjs` в отчёте.
Ядро для этого получило `ctx.read(buffer)`, `__gp.step(n)`, `Experiment.paneCollapsed`.

Resonance (`src/experiments/sine`): игра «всё — синус». Логика — `game.ts`, чистый TS без DOM/GL (фиксированный
шаг 1/60, свой RNG от сида; бот `bot(g, 'switch'|'stay'|'idle')`); шаг вызывается из `Pass.uniforms` по накопленному
`ctx.dt`, R / `ctx.frame` = 0 — новая игра. Сущности уходят в шейдер юниформ-массивами `uA..uD[36]` (4 vec4 на слот,
раскладка — `pack()`; ядро уже умеет массивы: `prog.set('uA', Float32Array)`). Движение существ — явные формулы от
времени (`shapeAt`), не интеграция. **Манифест**: шейдеры папки используют только алфавит `alphabet.glsl`
(sin, арифметика, sqrt/dot, abs/min/max/clamp/mix/step/smoothstep; угол θ не считается — `cpow(z, n)`); без
текстур и include из `src/glsl` — проверяет `tests/sine-manifest.test.ts`. Звук `audio.ts` — только sine-осцилляторы.
Новый вид существа: `Kind` + `UNLOCK/WEIGHT/VALUE/FEED`, ветки в `spawn`/`shapeAt`/`pack`, код вида в `main.frag`
(`creature`/`xray`), строка в `formula()` и `KIND_INFO` (index.ts). Баланс — `tests/sine-game.test.ts` (боты в Node);
в браузере: `?autopilot=switch`, `__gpState.sine` (`seed`, `g`, `sound.stats`), `__gp.step(n)`.
Ядро для игр получило `Experiment.ownKeys` — коды клавиш, на которых молчат горячие клавиши ядра (WASD, F, M).

Tree (`src/experiments/tree`): дерево на холме, реймарчинг SDF в «глиняном» стиле. Модель — `tree.glsl`:
явный изогнутый ствол с корнями → 3..6 явных скелетных ветвей (высота/азимут/наклон от seed — ломают симметрию
на крупном масштабе) → в каждой поддерево складыванием (поворот на случайный угол узла, |x|, наклон; параметры
ребёнка — хэш от id пути, обрезка, доминирующая сторона) → крона: по 3 явных комка на ветвь + общий шум в мировых
координатах. Крупные комки на концах складок нельзя — их режет плоскость складки (видны плоские светлые грани);
там только мелкие «почки». Рост `growth`: масштаб, ствол, ветви по высоте, уровни складок по очереди, крона
последней — всё через smoothstep (скачков нет: проверено разностью кадров). Сезон — веса 4 сезонов (`SW`),
снег — по нормали. Лес — клетки 10×10 с LOD уровней. Тени/AO — `CHEAP` (без травы, мелкого шума и, при листве,
без поддеревьев). Ограничение дерева — эллипсоид кроны + капсула ствола (`treeBound`), иначе земля вокруг платит
за дерево. Производительность: GPU-узкое место — ветви; обёртки-циклы против инлайна и кэш ветвей в глобальных
массивах замедляли (проверено) — не повторять. Отладка: `debug=steps|normals`.

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
Space — пауза, S — PNG, R — сброс, H — спрятать UI, G — галерея, D — кисть/камера (эксперименты с camera;
эксперимент может забрать клавиши через `ownKeys`);
в sandbox: 1–9, 0 — материалы, E — ластик, колесо — размер кисти, правая кнопка — стереть;
в Resonance: мышь/палец/WASD/стрелки — движение, 1–5 / Q E / колесо — частота, F — формулы, M — звук, Enter — заново.
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
- Phototroph: плоскость — свет считается для одной плитки и повторяется (тени заслонок «тиражируются»);
  у lat-long сферы сжатие узора у полюсов и шов v (wrap repeat соединяет полюса).
- Sandbox: давления нет — жидкость не поднимается в сообщающихся сосудах выше, чем падает; вязкая лава
  медленно растекается; в полосе свечения у падающих частиц заметна лёгкая «рябь» (bloom в 1/4 разрешения).
