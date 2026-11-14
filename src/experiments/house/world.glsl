// Мир «Невозможного дома»: комнаты (каждая — файл), правки игрока и порталы. Общий для рендера (scene.frag)
// и зонда столкновений (probe.frag): одна map() — один мир.
// Добавить комнату: файл rN-*.glsl с функцией vec2 room(vec3 p, out vec2 fixedPart) + область в regionGeom()
// + запись в rooms.ts (область, старт, заряды, подсказка, порталы).
#include <sdf>
#include <noise>
#include <retro>
#include "common.glsl"
#include "r1-corridor.glsl"
#include "r2-closet.glsl"
#include "r3-stairs.glsl"

// ---------- правки (инструмент игрока) ----------
#define MAXE 32
uniform vec4 uEdA[MAXE]; // центр xyz (в коридоре — в координатах ячейки), вид: 1 шар-срез, 2 проём-срез, −1/−2 — прилепить
uniform vec4 uEdB[MAXE]; // x — поворот проёма (yaw нормали), y — 1: правка коридора (повторяется во всех ячейках)
uniform int uEdN;

// «проём»: полуширина, полувысота, полуглубина вдоль нормали. Центр сдвинут от поверхности наружу на 0.15
// (game.ts/makeEdit): срез идёт на 1.0 в воздух и на 0.7 вглубь. Внутри среза max(d, −e) занижает расстояние
// у его граней — для физики это «стенка-фантом»; с таким запасом по обе стороны тонкой стенки фантом дальше
// радиуса капсулы. Стены толщиной ≥ 1 м проём не пробивает (коридор: перегородки и боковые стены по 1 м).
const vec3 BOX_H = vec3(0.55, 1.0, 0.85);
const float SPH_R = 0.55;

float editShape(vec3 q, float kind, float yaw) {
  if (abs(kind) > 1.5) {
    q.xz = rot2(yaw) * q.xz;
    return sdBox(q, BOX_H);
  }
  return sdDodeca(q, SPH_R * 0.95); // «шар» тоже гранёный
}

// ---------- порталы ----------
#define NP 10
uniform vec4 uPortC[NP]; // центр xyz, yaw нормали (нормаль смотрит в комнату, где стоит портал)
uniform vec4 uPortS[NP]; // полуширина, полувысота, индекс пары, активен (0/1)
vec3 portN(int i) { float a = uPortC[i].w; return vec3(sin(a), 0.0, cos(a)); }
vec3 portU(int i) { float a = uPortC[i].w; return vec3(cos(a), 0.0, -sin(a)); }

// пересекает ли отрезок p → p + rd·h лицевую сторону портала; возвращает расстояние s и индекс (−1 — нет)
float portalHit(vec3 p, vec3 rd, float h, out int which) {
  which = -1;
  float best = h + 1e-3;
  for (int i = 0; i < NP; i++) {
    if (uPortS[i].w < 0.5) continue;
    vec3 n = portN(i);
    float dn = dot(rd, n);
    if (dn > -1e-4) continue; // только входя с лицевой стороны
    float s = dot(uPortC[i].xyz - p, n) / dn;
    if (s < 0.0 || s > best) continue;
    vec3 x = p + rd * s - uPortC[i].xyz;
    if (abs(dot(x, portU(i))) > uPortS[i].x || abs(x.y) > uPortS[i].y) continue;
    best = s;
    which = i;
  }
  return best;
}

// перенос точки и направления из портала i в его пару (поворот на 180° в плоскости портала)
void portalXf(int i, inout vec3 p, inout vec3 d) {
  int j = int(uPortS[i].z);
  vec3 ni = portN(i), ui = portU(i), nj = portN(j), uj = portU(j);
  vec3 q = p - uPortC[i].xyz;
  p = uPortC[j].xyz - dot(q, ui) * uj - dot(q, ni) * nj + vec3(0.0, q.y, 0.0);
  d = -dot(d, ui) * uj - dot(d, ni) * nj + vec3(0.0, d.y, 0.0);
}

// ---------- мир ----------
// область по x: коридор |x| < 14, прихожая < 45, зал < 75, лестница < 120, дальше сад.
// Расстояние ограничено расстоянием до границы области + зазор до соседей (там пусто).
int regionOf(vec3 p) { return p.x < 14.0 ? 0 : p.x < 45.0 ? 1 : p.x < 75.0 ? 2 : p.x < 120.0 ? 3 : 4; }

vec2 regionGeom(vec3 p, out vec2 fixedPart, out int reg) {
  reg = regionOf(p);
  vec2 d;
  float lo, hi;
  if (reg == 0) { d = corridor(p, fixedPart); lo = -1e9; hi = 14.0; }
  else if (reg == 1) { d = landing(p, fixedPart); lo = 14.0; hi = 45.0; }
  else if (reg == 2) { d = hall(p, fixedPart); lo = 45.0; hi = 75.0; }
  else if (reg == 3) { d = stairs(p, fixedPart); lo = 75.0; hi = 120.0; }
  else { d = garden(p, fixedPart); lo = 120.0; hi = 1e9; }
  float border = min(p.x - lo, hi - p.x) + 8.0; // соседняя геометрия не ближе 8 м за границей
  d.x = min(d.x, border);
  fixedPart.x = min(fixedPart.x, border);
  return d;
}

vec2 scene(vec3 p) {
  vec2 fixedPart;
  int reg;
  vec2 d = regionGeom(p, fixedPart, reg);
  // правки: коридорные — в координатах ячейки (и соседней копии: срез у границы ячейки не обрывается)
  float zc = p.z - CP * round(p.z / CP);
  for (int i = 0; i < MAXE; i++) {
    if (i >= uEdN) break;
    vec4 a = uEdA[i], b = uEdB[i];
    bool rep = b.y > 0.5;
    if (rep && reg != 0) continue;
    vec3 pp = rep ? vec3(p.x, p.y, zc) : p;
    vec3 q = pp - a.xyz;
    float bound = length(q) - 1.25;
    float e;
    if (a.w > 0.0) { // срез: max(d, −e) — влияет, только если e < −d
      if (rep) bound = min(bound, length(q + vec3(0.0, 0.0, CP * sign(zc))) - 1.25);
      if (bound > -d.x) continue;
      e = editShape(q, a.w, b.x);
      if (rep) e = min(e, editShape(q + vec3(0.0, 0.0, CP * sign(zc)), a.w, b.x));
      if (-e > d.x) d = vec2(-e, M_CUT);
    } else {         // прилепить: min(d, e)
      if (bound > d.x) continue;
      e = editShape(q, a.w, b.x);
      if (e < d.x) d = vec2(e, M_CLAY);
    }
  }
  return U(d, fixedPart);
}

float map(vec3 p) { return scene(p).x; }

vec3 calcNormal(vec3 p, float eps) {
  const vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * map(p + k.xyy * eps) + k.yyx * map(p + k.yyx * eps) + k.yxy * map(p + k.yxy * eps) + k.xxx * map(p + k.xxx * eps));
}

// марш с порталами: до 3 переходов, общий бюджет шагов. ro/rd на выходе — последний отрезок (после переходов),
// t — длина от его начала, tTot — полный путь (для тумана)
bool marchP(inout vec3 ro, inout vec3 rd, float tmax, int steps, out float t, out float tTot, out int crossings) {
  t = 0.0;
  tTot = 0.0;
  crossings = 0;
  for (int i = 0; i < 220; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * t;
    float h = map(p);
    if (h < 0.0008 * (tTot + t) + 0.0005) return true;
    int which;
    float s = crossings < 3 ? portalHit(p, rd, h, which) : 1e9;
    if (crossings < 3 && which >= 0) {
      vec3 np = p + rd * s;
      portalXf(which, np, rd);
      tTot += t + s;
      ro = np;
      t = 0.0;
      crossings++;
      continue;
    }
    t += h;
    if (tTot + t > tmax) return false;
  }
  return false;
}
