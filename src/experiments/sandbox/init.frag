// Стартовые сцены (uScene: 0 диорама, 1 вулкан, 2 джунгли и кислотный дождь), uClear — пустой мир,
// uTest — отладочные сцены без реакций (1 — блок песка, 2 — столб воды) для проверки массы/уровня.
#include "cells.glsl"

uniform int uScene;
uniform float uClear;
uniform float uTest;
uniform float uSeed;

uint hseed;
Cell make(int m, int life) { hseed = hseed * 747796405u + 2891336453u; return newCell(m, life, hseed); }
Cell tap(int m) { Cell c = make(TAP, 0); c.flags = m << 1; return c; }

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 sz = uResolution; // init пишет в state, но не читает его — uStateSize тут не задан
  vec2 u = (vec2(p) + 0.5) / sz;           // 0..1
  float a = sz.x / sz.y;                    // аспект: x в «высотах» = u.x * a
  vec2 q = vec2(u.x * a, u.y);
  hseed = pcg3d(uvec3(uvec2(p), floatBitsToUint(uSeed))).x;
  float n = vnoise(vec2(p) * 0.15 + uSeed * 37.0);
  Cell c = make(EMPTY, 0);

  bool border = p.x < 1 || p.y < 1 || p.x >= int(sz.x) - 1 || p.y >= int(sz.y) - 1;
  if (border) c = make(WALL, 0);
  if (border || uClear > 0.5) { fragColor = packCell(c); return; }

  if (uTest > 1.5) {          // столб воды в пустой коробке
    if (abs(u.x - 0.5) < 0.03 && u.y < 0.8) c = make(WATER, 0);
  } else if (uTest > 0.5) {   // блок песка над полом
    if (abs(u.x - 0.5) < 0.1 && u.y > 0.55 && u.y < 0.8) c = make(SAND, 0);
  } else if (uScene == 0) {
    // диорама: чаша с водой и плёнкой масла, горка песка, растения, кран с лавой и кран с водой
    float bx = 0.08 * a, bw = 0.42 * a; // чаша по x (в «высотах»)
    bool inBowlX = q.x > bx && q.x < bx + bw;
    if (p.y < 4) c = make(WALL, 0);
    else if (inBowlX && q.y < 0.36 && (q.x < bx + 0.015 || q.x > bx + bw - 0.015 || q.y < 0.06)) c = make(WALL, 0);
    else if (inBowlX && q.y < 0.27) c = make(WATER, 0);
    else if (inBowlX && q.y < 0.31) c = make(OIL, 0);
    else if (q.y < 0.32 - abs(q.x - 0.74 * a) * 1.1 + 0.03 * n && q.x > bx + bw + 0.02) c = make(SAND, 0);
    if (inBowlX && q.x > bx + bw - 0.06 && q.x < bx + bw - 0.015 && q.y > 0.06 && q.y < 0.12 + 0.05 * n) c = make(PLANT, 0);
    if (abs(q.x - (bx + 0.3 * bw)) < 0.008 && abs(q.y - 0.9) < 0.008) c = tap(LAVA);
    if (abs(q.x - 0.82 * a) < 0.008 && abs(q.y - 0.88) < 0.008) c = tap(WATER);
    if (abs(q.x - 0.62 * a) < 0.008 && abs(q.y - 0.93) < 0.008) c = tap(SAND);
  } else if (uScene == 1) {
    // вулкан: каменная гора с жерлом, лава снизу, склоны в зарослях, озеро у подножия
    float cx = 0.45 * a, h = 0.62 - abs(q.x - cx) * 1.25 + 0.02 * n;
    bool vent = q.y > 0.4 && abs(q.x - cx) < 0.025 + 0.12 * max(0.0, q.y - 0.5); // кратер с жерлом
    // источник — у верха жерла: давления в автомате нет, лава из глубины не поднялась бы
    if (p.y < 4) c = make(WALL, 0);
    else if (q.y < h && !vent) c = make(WALL, 0);
    else if (q.y < h + 0.03 && q.y >= h && n > 0.45) c = make(PLANT, 0);
    else if (q.y < h + 0.05 && q.y >= h && n > 0.3) c = make(SAND, 0);
    if (abs(q.x - cx) < 0.01 && abs(q.y - 0.66) < 0.006) c = tap(LAVA); // над кратером: лава падает в него и переливается
    if (q.x > 0.8 * a && q.y < 0.2 && p.y >= 4) c = make(q.x < 0.81 * a ? WALL : WATER, 0);
    if (q.x < 0.12 * a && q.y < 0.15 && p.y >= 4) c = make(OIL, 0);
  } else {
    // джунгли: песчаная почва, деревья-растения, лужи, кислотные «тучи»
    float ground = 0.12 + 0.03 * n;
    float tx = fract(q.x * 3.2), trunk = abs(tx - 0.5);
    if (p.y < 4) c = make(WALL, 0);
    else if (q.y < ground) c = make(SAND, 0);
    else if (trunk < 0.02 && q.y < 0.45) c = make(PLANT, 0);
    else if (length(vec2(trunk * 1.0 / 3.2, q.y - 0.47)) < 0.07 + 0.03 * n) c = make(PLANT, 0);
    else if (q.y < ground + 0.05 && trunk > 0.3 && trunk < 0.42) c = make(WATER, 0);
    if (abs(q.y - 0.94) < 0.006 && fract(q.x * 3.0 + 0.3) < 0.03) c = tap(ACID);
    if (abs(q.y - 0.94) < 0.006 && abs(q.x - 0.5 * a) < 0.006) c = tap(WATER);
  }
  fragColor = packCell(c);
}
