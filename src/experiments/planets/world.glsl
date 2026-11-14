// Маленькие планеты: мир (общий для кадра и зонда физики). Тела планет — planetsOnly(): по ним считается
// гравитация («вверх» = градиент), постройки и предметы — только для столкновений и вида.
// Константы планет продублированы в game.ts (PLANETS) — меняйте в обоих местах.
#include <sdf>
#include <noise>
#include <retro>

#define M_GRASS 1.0
#define M_DOUGH 2.0   // бублик
#define M_PUMP 3.0    // тыква
#define M_YARN 4.0    // клубок-луна
#define M_WOOD 5.0
#define M_ROOF 6.0
#define M_WIN 7.0     // окна (горят после финала)
#define M_STONE 8.0
#define M_LEAF 9.0
#define M_BARK 10.0
#define M_CAP 11.0    // шляпка гриба-катапульты
#define M_WAX 12.0
#define M_FLAME 13.0
#define M_LAMP 14.0   // фонарь маяка
#define M_CLOTH 15.0  // персонаж: одежда
#define M_SKIN 16.0
#define M_STEM 17.0   // хвостик тыквы, ножка гриба
#define M_SCARF 18.0  // красный шарф и шапочка
#define M_TRAIL 19.0  // (зарезервировано)

const vec3 P_HOME = vec3(0.0, 0.0, 0.0);
const float R_HOME = 6.0;
const vec3 P_TOR = vec3(-4.0, 7.0, 27.0);
const float TOR_TILT = 0.6;              // поворот бублика вокруг x
const vec2 T_TOR = vec2(7.0, 2.2);
const vec3 P_PUMP = vec3(26.0, -4.0, 6.0);
const float R_PUMP = 5.0;
const vec3 P_MOON = vec3(9.0, 17.0, -15.0);
const float R_MOON = 2.6;

uniform vec4 uPadA[6];   // катапульты: основание xyz, w — есть
uniform vec4 uPadB[6];   // нормаль поверхности (вверх гриба)
uniform vec4 uItemA[3];  // свечи: позиция xyz, w — 0 лежит, 1 в руках, 2 в маяке
uniform vec4 uItemB[3];  // «вверх» свечи
uniform vec3 uBeaconPos;
uniform vec3 uBeaconUp;
uniform float uLit;      // 0..1 — маяк зажжён (финал)
uniform vec3 uPlayerPos;
uniform vec3 uPlayerUp;
uniform vec3 uPlayerFwd;
uniform float uWalk;     // фаза шага
uniform bool uCarry;

vec2 U(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

// рамка «вверх = up» и локальные координаты (x — вправо, y — вверх, z — вперёд)
mat3 frameUp(vec3 up) {
  vec3 a = abs(up.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 r = normalize(cross(a, up));
  return mat3(r, up, cross(r, up));
}
vec3 toLocal(vec3 p, vec3 base, mat3 F) { vec3 d = p - base; return vec3(dot(d, F[0]), dot(d, F[1]), dot(d, F[2])); }

// ---------- тела планет (гравитация) ----------
float torusLocal(vec3 p, out vec3 q) {
  q = p - P_TOR;
  q.yz = rot2(TOR_TILT) * q.yz;
  return sdTorus(q, T_TOR);
}
float pumpkin(vec3 p) {
  vec3 q = p - P_PUMP;
  float rib = abs(sin(5.0 * atan(q.z, q.x)));          // 10 долек
  vec3 s = q * vec3(1.0, 1.25, 1.0);                    // приплюснута
  return (length(s) - R_PUMP * (1.0 - 0.06 * rib * smoothstep(0.0, 0.6, length(q.xz) / R_PUMP))) / 1.3;
}
float planetsOnly(vec3 p) {
  vec3 tq;
  float d = length(p - P_HOME) - R_HOME;
  d = min(d, torusLocal(p, tq));
  d = min(d, pumpkin(p));
  d = min(d, length(p - P_MOON) - R_MOON);
  return d;
}

// ---------- постройки ----------
vec2 cottage(vec3 q) { // домик: стены, двускатная крыша, дверь, окна
  vec2 d = vec2(sdBox(q - vec3(0.0, 0.7, 0.0), vec3(0.9, 0.75, 0.7)), M_WOOD);
  vec3 r = q - vec3(0.0, 1.45, 0.0);
  float roof = max(abs(r.z) * 0.8 + r.y * 1.0 - 0.75, max(-r.y, abs(r.x) - 1.05));
  d = U(d, vec2(roof * 0.75, M_ROOF));
  d = U(d, vec2(sdBox(q - vec3(0.0, 0.5, 0.71), vec3(0.22, 0.42, 0.03)), M_BARK));
  vec3 w = vec3(abs(q.x) - 0.55, q.y - 0.85, q.z - 0.71);
  d = U(d, vec2(sdBox(w, vec3(0.16, 0.16, 0.03)), M_WIN));
  vec3 w2 = vec3(q.x - 0.91, q.y - 0.85, q.z);
  d = U(d, vec2(sdBox(w2, vec3(0.03, 0.16, 0.18)), M_WIN));
  d = U(d, vec2(sdBox(q - vec3(0.5, 1.8, -0.2), vec3(0.1, 0.35, 0.1)), M_STONE)); // труба
  return d;
}
vec2 well(vec3 q) {
  float ring = max(ngonR(q.xz, 8.0) - 0.55, -(ngonR(q.xz, 8.0) - 0.4));
  vec2 d = vec2(max(ring, abs(q.y - 0.3) - 0.35), M_STONE);
  vec3 c = vec3(abs(q.x) - 0.48, q.y - 0.9, q.z);
  d = U(d, vec2(sdBox(c, vec3(0.05, 0.6, 0.05)), M_WOOD));
  vec3 r = q - vec3(0.0, 1.55, 0.0);
  d = U(d, vec2(max(abs(r.z) * 0.9 + r.y - 0.3, max(-r.y, abs(r.x) - 0.65)) * 0.7, M_ROOF));
  return d;
}
vec2 treeObj(vec3 q, float s) { // ствол-призма и комки-додекаэдры (как сад в доме)
  vec2 d = vec2(max(ngonR(q.xz, 6.0) - mix(0.2, 0.1, clamp(q.y / 2.0, 0.0, 1.0)) * s, abs(q.y - 1.0 * s) - 1.0 * s), M_BARK);
  for (int i = 0; i < 4; i++) {
    vec3 c = vec3(sin(float(i) * 2.4) * 0.6, 2.1 + 0.3 * float(i % 2), cos(float(i) * 2.4) * 0.6) * s;
    vec3 b = q - c;
    b.xz = rot2(float(i) * 1.3) * b.xz;
    d = U(d, vec2(sdDodeca(b, (0.7 - 0.08 * float(i)) * s), M_LEAF));
  }
  return d;
}
vec2 beacon(vec3 q) { // маяк: гранёная башенка в полоску, фонарь наверху, три подставки под свечи
  float h = clamp(q.y / 2.4, 0.0, 1.0);
  vec2 d = vec2(max(ngonR(q.xz, 6.0) - mix(0.45, 0.28, h), abs(q.y - 1.2) - 1.2), M_STONE);
  d = U(d, vec2(max(ngonR(q.xz, 6.0) - 0.42, abs(q.y - 2.45) - 0.05), M_WOOD));
  d = U(d, vec2(max(ngonR(q.xz, 6.0) - 0.3, abs(q.y - 2.75) - 0.28), M_LAMP));
  vec3 r = q - vec3(0.0, 3.05, 0.0);
  d = U(d, vec2(max(ngonR(r.xz, 6.0) - (0.4 - r.y * 1.2), max(-r.y, r.y - 0.33)), M_ROOF));
  return d;
}
vec2 pad(vec3 q) { // гриб-катапульта
  vec2 d = vec2(max(ngonR(q.xz, 6.0) - 0.16, abs(q.y - 0.25) - 0.25), M_STEM);
  vec3 c = q - vec3(0.0, 0.5, 0.0);
  float cap = max(sdDodeca(c * vec3(1.0, 2.2, 1.0), 0.55) / 2.2, -c.y);
  return U(d, vec2(cap, M_CAP));
}
vec2 candle(vec3 q) {
  vec2 d = vec2(max(ngonR(q.xz, 6.0) - 0.09, abs(q.y - 0.17) - 0.17), M_WAX);
  vec3 f = (q - vec3(0.0, 0.43, 0.0)) * vec3(1.0, 0.6, 1.0);
  return U(d, vec2(sdDodeca(f, 0.06) * 0.6, M_FLAME));
}

// персонаж: ноги шагают, руки несут свечу, голова — додекаэдр
// масштаб персонажа 0.85: q делим, расстояние умножаем
const float PS = 0.85;
vec2 player(vec3 p) {
  vec3 up = uPlayerUp, fw = uPlayerFwd, rt = normalize(cross(up, fw));
  vec3 d0 = p - uPlayerPos;
  vec3 q = vec3(dot(d0, rt), dot(d0, up), dot(d0, fw)) / PS;
  if (dot(q, q) > 9.0) return vec2((length(q) - 2.0) * PS, M_CLOTH);
  float sw = sin(uWalk) * 0.5;
  vec2 d = vec2(1e9, M_CLOTH);
  for (int i = 0; i < 2; i++) {
    float sg = i == 0 ? 1.0 : -1.0;
    vec3 l = q - vec3(0.11 * sg, 0.55, 0.0);
    l.yz = rot2(sw * sg) * l.yz;
    d = U(d, vec2(sdBox(l - vec3(0.0, -0.27, 0.0), vec3(0.06, 0.27, 0.07)), M_WOOD));
  }
  d = U(d, vec2(max(ngonR(q.xz, 6.0) - mix(0.24, 0.2, clamp((q.y - 0.55) / 0.55, 0.0, 1.0)), abs(q.y - 0.85) - 0.32), M_CLOTH));
  d = U(d, vec2(sdDodeca(q - vec3(0.0, 1.38, 0.0), 0.2), M_SKIN));
  d = U(d, vec2(max(ngonR((q - vec3(0.0, 1.5, 0.0)).xz, 6.0) - 0.2, abs(q.y - 1.56) - 0.06), M_SCARF)); // шапочка
  d = U(d, vec2(max(ngonR(q.xz, 6.0) - 0.25, abs(q.y - 1.17) - 0.06), M_SCARF)); // шарф
  d = U(d, vec2(sdBox(q - vec3(0.12, 1.0, 0.2), vec3(0.05, 0.17, 0.025)), M_SCARF)); // конец шарфа
  for (int i = 0; i < 2; i++) {
    float sg = i == 0 ? 1.0 : -1.0;
    vec3 a = q - vec3(0.27 * sg, 1.08, 0.0);
    a.yz = rot2(uCarry ? -1.2 : -sw * sg) * a.yz;
    d = U(d, vec2(sdBox(a - vec3(0.0, -0.2, 0.0), vec3(0.05, 0.22, 0.05)), M_CLOTH));
  }
  return vec2(d.x * PS, d.y);
}

// весь мир: x — расстояние, y — материал. withPlayer: зонд физики считает мир без самого игрока
vec2 world(vec3 p, bool withPlayer) {
  // дом-планета с постройками
  vec2 d = vec2(length(p - P_HOME) - R_HOME, M_GRASS);
  if (length(p - P_HOME) < R_HOME + 4.5) {
    const vec3 D_HOUSE = vec3(0.0, 0.970, 0.243), D_WELL = vec3(0.731, 0.657, 0.183), D_TREE = vec3(-0.95, 0.3, -0.05); // не на тропе «бублик → маяк»
    d = U(d, cottage(toLocal(p, P_HOME + D_HOUSE * (R_HOME - 0.05), frameUp(D_HOUSE))));
    d = U(d, well(toLocal(p, P_HOME + D_WELL * (R_HOME - 0.05), frameUp(D_WELL))));
    vec3 dt = normalize(D_TREE);
    d = U(d, treeObj(toLocal(p, P_HOME + dt * (R_HOME - 0.05), frameUp(dt)), 1.0));
    vec3 dt2 = normalize(vec3(-0.2, -0.3, 0.93));
    d = U(d, treeObj(toLocal(p, P_HOME + dt2 * (R_HOME - 0.05), frameUp(dt2)), 0.8));
    d = U(d, beacon(toLocal(p, uBeaconPos, frameUp(uBeaconUp))));
  } else d.x = min(d.x, length(p - P_HOME) - R_HOME - 4.0);
  // бублик
  vec3 tq;
  float tor = torusLocal(p, tq);
  d = U(d, vec2(tor, M_DOUGH));
  // тыква с хвостиком
  vec2 pk = vec2(pumpkin(p), M_PUMP);
  vec3 sq = p - P_PUMP - vec3(0.0, R_PUMP / 1.25 - 0.1, 0.0);
  sq.xz = rot2(sq.y * 0.8) * sq.xz;
  pk = U(pk, vec2(max(ngonR(sq.xz, 5.0) - 0.35, abs(sq.y - 0.6) - 0.6), M_STEM));
  d = U(d, pk);
  // клубок-луна
  d = U(d, vec2(length(p - P_MOON) - R_MOON, M_YARN));
  // катапульты и свечи
  for (int i = 0; i < 6; i++) {
    if (uPadA[i].w < 0.5) continue;
    vec3 l = toLocal(p, uPadA[i].xyz, frameUp(uPadB[i].xyz));
    if (dot(l, l) > 4.0) { d.x = min(d.x, length(l) - 1.2); continue; }
    d = U(d, pad(l));
  }
  for (int i = 0; i < 3; i++) {
    vec3 l = toLocal(p, uItemA[i].xyz, frameUp(uItemB[i].xyz));
    if (dot(l, l) > 1.0) { d.x = min(d.x, length(l) - 0.6); continue; }
    if (uItemA[i].w > 0.5 && uItemA[i].w < 1.5 && !withPlayer) continue; // в руках — не мешает физике
    d = U(d, candle(l));
  }
  if (withPlayer) d = U(d, player(p));
  return d;
}

float map(vec3 p) { return world(p, false).x; }
