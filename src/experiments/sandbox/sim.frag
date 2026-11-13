// Шаг клеточного автомата в окрестности Марголуса: мир режется на блоки 2×2, сдвиг сетки блоков
// чередуется по шагам. Каждый пиксель вычисляет СВОЙ блок целиком (детерминированно, одинаково для
// всех 4 клеток) и берёт из результата свою клетку: движение — перестановки внутри блока, поэтому
// масса сохраняется и порядок обхода не важен. Реакции — по парам клеток блока с общим случайным числом.
#include "cells.glsl"

uniform int uMaterial;      // материал кисти (ERASER — ластик)
uniform int uTapMat;        // что испускает «кран»
uniform float uBrush;       // радиус кисти в клетках
uniform int uSteps;         // итераций за кадр (для номера шага)
uniform bool uAdvance;      // false — перерисовка на паузе: только кисть

Cell c[4];      // 0 — верх-лево, 1 — верх-право, 2 — низ-лево, 3 — низ-право (y вверх)
bool moved[4];
int below[2];   // материалы под нижним рядом блока (для «опоры» при растекании)
uint rs;        // состояние генератора блока

float rnd() { rs = rs * 747796405u + 2891336453u; uint w = ((rs >> ((rs >> 28u) + 4u)) ^ rs) * 277803737u; return float((w >> 22u) ^ w) / 4294967296.0; }

bool movable(int m) { return !isStatic(m); }
float dens(int m) { return DENSITY[m]; }

void swapCells(int i, int j) { Cell t = c[i]; c[i] = c[j]; c[j] = t; moved[i] = true; moved[j] = true; }

void ignite(int i, float p) {
  if (rnd() < p) {
    int life = c[i].m == OIL ? 40 : c[i].m == POWDER ? 14 : 28;
    c[i] = Cell(FIRE, life + int(rnd() * 20.0), c[i].shade, c[i].flags);
  }
}

// реакция пары (порядок аргументов не важен — вызываем в обе стороны)
void react(int i, int j) {
  int a = c[i].m, b = c[j].m;
  if (a == WATER && b == LAVA && rnd() < 0.5) { c[i] = Cell(STEAM, 90 + int(rnd() * 60.0), c[i].shade, c[i].flags); c[j].m = STONE; c[j].life = 0; return; }
  if (a == WATER && b == FIRE && rnd() < 0.5) { c[j] = Cell(STEAM, 50 + int(rnd() * 40.0), c[j].shade, c[j].flags); if (rnd() < 0.15) c[i].m = STEAM, c[i].life = 60; return; }
  if ((a == FIRE || a == LAVA) && isFlammable(b)) { ignite(j, b == POWDER ? 0.9 : b == OIL ? 0.3 : 0.08); return; }
  if (a == ACID && b != ACID && b != EMPTY && b != WALL && b != TAP && !isGas(b) && rnd() < 0.08) {
    c[i] = Cell(SMOKE, 25 + int(rnd() * 20.0), c[i].shade, 0);
    c[j] = Cell(EMPTY, 0, c[j].shade, 0);
    return;
  }
  if (a == PLANT && b == WATER && rnd() < 0.003) { c[j].m = PLANT; c[j].life = 0; return; }
  if (a == TAP && b == EMPTY) {
    int m = (c[i].flags >> 1) & 15;
    if (rnd() > (m == LAVA ? 0.12 : m == ACID ? 0.04 : 0.1)) return;
    c[j] = newCell(m, m == FIRE ? 40 : m == STEAM ? 120 : 0, rs);
    rnd();
    return;
  }
  // искры над лежащей лавой (не над каплями в полёте)
  if (a == LAVA && b == EMPTY && j == i - 2 && below[i - 2] != EMPTY && rnd() < 0.001) c[j] = newCell(FIRE, 20, rs), rnd();
  // языки пламени: огонь подкидывает огонь в пустоту над собой
  if (a == FIRE && b == EMPTY && j < 2 && i >= 2 && c[i].life > 10 && rnd() < 0.08) c[j] = Cell(FIRE, c[i].life / 2, c[i].shade ^ 77, c[i].flags), rnd();
}

void age(int i) {
  int m = c[i].m;
  if (m == FIRE) {
    c[i].life -= rnd() < 0.6 ? 1 : 0;
    if (c[i].life <= 0) { if (rnd() < 0.35) c[i] = Cell(SMOKE, 40 + int(rnd() * 40.0), c[i].shade, c[i].flags); else c[i] = Cell(EMPTY, 0, c[i].shade, 0); }
  } else if (m == SMOKE) {
    c[i].life -= rnd() < 0.5 ? 1 : 0;
    if (c[i].life <= 0) c[i] = Cell(EMPTY, 0, c[i].shade, 0);
  } else if (m == STEAM) {
    c[i].life -= rnd() < 0.5 ? 1 : 0;
    if (c[i].life <= 0) { if (rnd() < 0.3) c[i] = Cell(WATER, 0, c[i].shade, c[i].flags); else c[i] = Cell(EMPTY, 0, c[i].shade, 0); } // конденсация
  } else if (m == LAVA) {
    c[i].life = (c[i].life + 1) & 255; // фаза мерцания
  }
  if ((isLiquid(m) || isGas(m)) && rnd() < 0.02) c[i].flags ^= 1; // иногда меняем направление
}

bool canSwap(int u, int l) { return movable(c[u].m) && movable(c[l].m) && dens(c[u].m) > dens(c[l].m); }

// тяжёлое сверху (u) и лёгкое снизу (l) меняются местами
void tryFall(int u, int l, float diagScale) {
  if (moved[u] || moved[l]) return;
  int mu = c[u].m, ml = c[l].m;
  if (!canSwap(u, l)) return;
  // диагональ — только если по вертикали путь закрыт (иначе капли в полёте разбредаются вбок)
  if ((u ^ l) == 3 && (canSwap(u, u + 2) || canSwap(l - 2, l))) return;
  float p = max(mu == EMPTY ? 0.0 : MOBILITY[mu], ml == EMPTY ? 0.0 : MOBILITY[ml]);
  // свободное падение в воздухе — без вязкости (вязкость лавы — про растекание, а не про полёт)
  if (ml == EMPTY && (u ^ l) == 2) p = 1.0;
  if (isPowder(mu) && ml != EMPTY && !isGas(ml)) p *= 0.5; // в жидкости тонет медленнее
  if (rnd() < p * diagScale) swapCells(u, l);
}

// жидкость растекается, только когда стоит на опоре (в свободном падении капли не «размазываются»)
bool supported(int i) {
  int m = i < 2 ? c[i + 2].m : below[i - 2];
  return !(movable(m) && dens(m) < dens(c[i].m));
}

// горизонтальное растекание жидкостей и газов с «инерцией» направления (бит 0 флагов)
void tryFlow(int l, int r) {
  if (moved[l] || moved[r]) return;
  int ml = c[l].m, mr = c[r].m;
  bool fl = isGas(ml) || (isLiquid(ml) && supported(l)), fr = isGas(mr) || (isLiquid(mr) && supported(r));
  bool canL = fl && (c[l].flags & 1) == 1 && (mr == EMPTY || (isLiquid(ml) && isGas(mr)));
  bool canR = fr && (c[r].flags & 1) == 0 && (ml == EMPTY || (isLiquid(mr) && isGas(ml)));
  if (canL && rnd() < MOBILITY[ml]) { swapCells(l, r); return; }
  if (canR && rnd() < MOBILITY[mr]) { swapCells(l, r); return; }
  // упёрлись в соседа по блоку — разворачиваемся
  if (fl && (c[l].flags & 1) == 1 && !canL && mr != EMPTY) c[l].flags ^= 1;
  if (fr && (c[r].flags & 1) == 0 && !canR && ml != EMPTY) c[r].flags ^= 1;
}

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  uint step = uint(uFrame) * uint(max(uSteps, 1)) + uint(uIteration);
  ivec2 off = ivec2(int(step & 1u));
  ivec2 bo = ivec2(floor(vec2(p - off) * 0.5)) * 2 + off; // левый нижний угол блока
  ivec2 l = p - bo;
  int me = l.y == 1 ? l.x : 2 + l.x;

  Cell cur = loadCell(p);
  if (uAdvance) {
    c[0] = loadCell(bo + ivec2(0, 1)); c[1] = loadCell(bo + ivec2(1, 1));
    c[2] = loadCell(bo + ivec2(0, 0)); c[3] = loadCell(bo + ivec2(1, 0));
    below[0] = loadCell(bo + ivec2(0, -1)).m; below[1] = loadCell(bo + ivec2(1, -1)).m;
    for (int i = 0; i < 4; i++) moved[i] = false;
    rs = pcg3d(uvec3(uvec2(bo + 4096), step)).x;

    // реакции: все 6 пар, в обе стороны
    for (int i = 0; i < 4; i++)
      for (int j = 0; j < 4; j++)
        if (i != j) react(i, j);
    for (int i = 0; i < 4; i++) age(i);

    // движение: вертикаль, затем диагонали, затем растекание
    tryFall(0, 2, 1.0);
    tryFall(1, 3, 1.0);
    bool ab = rnd() < 0.5; // какая диагональ первой — случайно (без перекоса)
    float dp0 = isPowder(c[0].m) ? 0.6 : 1.0, dp1 = isPowder(c[1].m) ? 0.6 : 1.0;
    if (ab) { tryFall(0, 3, dp0); tryFall(1, 2, dp1); } else { tryFall(1, 2, dp1); tryFall(0, 3, dp0); }
    if (rnd() < 0.5) { tryFlow(2, 3); tryFlow(0, 1); } else { tryFlow(0, 1); tryFlow(2, 3); }
    cur = c[me];
  }

  // кисть: отрезок uMousePrev → uMouse (в клетках буфера)
  if (uMouse.z > 0.5) {
    float d = segDist(vec2(p) + 0.5, uMousePrev.xy, uMouse.xy);
    if (d < uBrush) {
      uvec3 h = pcg3d(uvec3(uvec2(p), uint(uFrame) * 7u + uint(uIteration)));
      float r = float(h.x) / 4294967296.0;
      int m = uMouse.w > 0.5 ? ERASER : uMaterial;
      if (m == ERASER) cur = Cell(EMPTY, 0, cur.shade, 0);
      else if (m == WALL || m == TAP) { cur = newCell(m, 0, h.y); if (m == TAP) cur.flags = uTapMat << 1; }
      else if (m == PLANT) { if (cur.m == EMPTY || cur.m == WATER) cur = newCell(PLANT, 0, h.y); }
      else if (cur.m == EMPTY && r < (uAdvance ? 0.25 : 0.6)) cur = newCell(m, m == FIRE ? 40 : m == STEAM ? 120 : 0, h.y);
    }
  }
  fragColor = packCell(cur);
}
