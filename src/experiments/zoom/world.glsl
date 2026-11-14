// Мир вложенных уровней (раскладка повторяет world.ts — менять синхронно!).
// Высоты входов на лугу и во мху — константы (hField / hMoss в этих точках), без разброса по seed:
// ent() зовётся на каждом уровне каждого вызова map, разнообразие даёт поворот.
// Типы: 0 луг (корень) → 1 камень → 2 мох с деревней → 3 домик → (камень на столе / мох в горшке / камень у печки) → …
// Узел = (тип, seed); вход i — ребёнок CHILD[type][i] в точке c, масштаб s, поворот a:
//   q_child = rotY(q - c, -a) / s.
// map(p) в координатах ТЕКУЩЕГО узла камеры: цикл по кадрам (текущий узел и до двух предков, преобразования —
// юниформы uFr*), в каждом — спуск в тот единственный вход, чей ограничивающий цилиндр содержит точку
// (для остальных — консервативное расстояние до цилиндра). Глубина спуска ограничена размером ребёнка
// в пикселях (gFoot — след пикселя в единицах узла камеры): мелкий ребёнок — заглушка. След и масштаб узла
// не зависят от того, в каком кадре стоит камера, поэтому смена кадра (перебазирование) не даёт скачка.
#include <sdf>
#include <noise>
#include <retro>

#define MAXD 6
const float PAD = 0.4;   // содержимое уровня — не ближе PAD к его цилиндру
const float LODK = 2.0;  // ребёнок радиусом < LODK px — заглушка

uniform ivec4 uFrI[3];   // кадр f: тип, seed (int-биты), пропустить вход (путь к узлу камеры), —
uniform vec4 uFrA[3];    // p_f = C + S R(A) p: C.xyz, S
uniform vec4 uFrB[3];    // cos A, sin A, A
uniform int uFrames;
uniform vec3 uEye;       // камера (в узле камеры)
uniform ivec4 uItemI;    // предмет: кадр (−1 нет), путь (base-4), глубина, вид
uniform vec4 uItemP;     // позиция в узле предмета xyz, поворот
uniform float uItemS;    // размер

float gFoot;    // след пикселя (ед. узла камеры) в текущей точке
float gBn;      // ограничение шага от пропущенных деталей узла (ед. узла; не поверхность — не попадание и не тень)
float gDither;  // порог «сетчатой» прозрачности пикселя (крыша растворяется)

// ---------- раскладка ----------
uint hu(uint x) { x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u; return x; }
uint childSeed(uint s, int i) { return hu(s ^ (0x9e3779b9u * uint(i + 1))); }
float rnd(uint s, int k) { return float(hu(s + uint(k) * 0x632be5abu) & 0xffffu) / 65535.0; }

float hField(vec2 x) {
  return 0.35 * sin(0.23 * x.x + 0.4) * sin(0.19 * x.y + 1.3) + 0.2 * sin(0.11 * x.x - 0.13 * x.y)
       + 0.035 * pow(max(length(x) - 16.0, 0.0), 1.5);
}
float hMoss(vec2 x) { return 3.2 * sqrt(max(1.0 - dot(x, x) / 100.0, 0.0)); }

const vec4 E0[3] = vec4[3](vec4(-4.2, -0.321696, 2.2, 0.26), vec4(4.6, 0.364284, 2.8, 0.22), vec4(0.4, 0.184617, -5.0, 0.28));
const vec4 E1[3] = vec4[3](vec4(-2.6, 6.0, 1.3, 0.15), vec4(2.5, 6.0, 2.1, 0.13), vec4(0.5, 6.0, -2.7, 0.14));
const vec4 E2[3] = vec4[3](vec4(-4.2, 2.869314, 1.4, 0.1), vec4(3.6, 2.837554, 2.9, 0.095), vec4(0.4, 2.838456, -4.6, 0.105));
const vec4 E3[3] = vec4[3](vec4(-2.0, 2.95, -0.3, 0.05), vec4(2.5, 3.38, -3.8, 0.04), vec4(4.3, 0.5, 2.7, 0.075));
const ivec3 CHILD[4] = ivec3[4](ivec3(1), ivec3(2), ivec3(3), ivec3(1, 2, 1));
const vec3 BND[4] = vec3[4](vec3(1e9, -1e9, 1e9), vec3(9.6, -2.6, 7.6), vec3(10.8, -1.2, 6.2), vec3(9.4, -3.6, 12.6));

void ent(int type, uint seed, int i, out int ct, out vec3 c, out float s, out float a) {
  vec4 e = type == 0 ? E0[i] : type == 1 ? E1[i] : type == 2 ? E2[i] : E3[i];
  ct = CHILD[type][i];
  c = e.xyz;
  s = e.w;
  a = float(hu(seed + uint(i) * 0x51ed27u) & 255u) * (6.2831853 / 256.0);
  if (type == 3 && (seed & 1u) == 1u) c.x = -c.x;
}

float boundDist(int t, vec3 q) {
  vec3 b = BND[t];
  vec2 d = vec2(length(q.xz) - b.x, max(b.y - q.y, q.y - b.z));
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

vec2 umin(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

// ---------- 0: луг ----------
// деревья — повтор по клеткам 7×7 вне центральной поляны; соседние клетки не смотрим, поэтому шаг
// ограничен расстоянием до края клетки + запас (дерево не дальше 2.8 от центра клетки)
vec2 gField(vec3 q, uint seed, float foot) {
  vec2 res = vec2((q.y - hField(q.xz)) * 0.8, 1.0);
  float hills = 0.035 * pow(max(length(q.xz) - 16.0, 0.0), 1.5);
  if (q.y > hills + 6.0) { gBn = min(gBn, q.y - hills - 5.6); return res; }
  // деревья
  vec2 cell = floor(q.xz / 7.0 + 0.5);
  vec2 cc = cell * 7.0;
  vec2 hh = hash22(cell + 31.0);
  vec2 ce = 3.5 - abs(q.xz - cc);
  gBn = min(gBn, min(ce.x, ce.y) + 0.7); // дерево соседа — не ближе 0.7 к краю клетки
  float r = length(cc);
  if (r > 10.5 && hh.x < 0.75 && abs(cc.y - (2.6 * sin(cc.x * 0.21) - 1.0)) > 2.5) {
    vec2 tp = cc + (hh - 0.5) * 2.0;
    vec3 b = vec3(q.x - tp.x, q.y - hField(tp), q.z - tp.y);
    float sz = 0.6 + 0.4 * hash12(cell + 7.0);
    vec2 t = vec2(sdCapsule(b, vec3(0.0), vec3(0.0, 2.4 * sz, 0.0), 0.22 * sz), 2.0);
    if (hh.y < 0.5) t = umin(t, vec2(sdIcosa(b - vec3(0.0, 3.3 * sz, 0.0), 1.45 * sz), 3.0));
    else t = umin(t, vec2(min(sdDodeca(b - vec3(0.0, 2.6 * sz, 0.0), 1.2 * sz), sdDodeca(b - vec3(0.0, 3.9 * sz, 0.0), 0.8 * sz)), 3.0));
    res = umin(res, t);
  }
  // забор: столбики и две жерди вдоль z = −9.5, x ∈ [−13, −3]
  if (foot < 0.3) {
    vec3 f = q - vec3(-8.0, hField(vec2(-8.0, -9.5)), -9.5);
    float fb = sdBox(f - vec3(0.0, 0.65, 0.0), vec3(5.3, 0.75, 0.25));
    if (fb > 0.3) gBn = min(gBn, fb);
    else {
      vec3 pp = f;
      pp.x -= 1.25 * clamp(round(pp.x / 1.25), -4.0, 4.0);
      float d = sdBox(pp - vec3(0.0, 0.55, 0.0), vec3(0.09, 0.65, 0.09));
      d = min(d, sdBox(vec3(f.x, abs(f.y - 0.7) - 0.25, f.z), vec3(5.1, 0.05, 0.04)));
      res = umin(res, vec2(d, 4.0));
    }
  }
  // стога
  vec3 hb = q - vec3(8.2, hField(vec2(8.2, -5.6)), -5.6);
  if (length(hb.xz) > 3.0) gBn = min(gBn, length(hb.xz) - 2.6);
  else {
    vec3 a = hb, b = hb - vec3(1.5, 0.0, 0.9);
    float d = min(sdRoundBox(a - vec3(0.0, 0.45, 0.0), vec3(0.75, 0.55, 0.55), 0.25), sdCylinder(b.xzy - vec3(0.0, 0.0, 0.55), 0.6, 0.55) - 0.05);
    res = umin(res, vec2(d, 5.0));
  }
  return res;
}

// ---------- 1: камень ----------
float boulderBody(vec3 q) {
  vec3 b = q - vec3(0.0, 2.0, 0.0);
  b.z *= 1.08;
  vec2 w = vec2(length(b.xz) - 6.0, abs(b.y) - 1.5);
  return (min(max(w.x, w.y), 0.0) + length(max(w, 0.0)) - 2.5) / 1.08;
}
vec2 gStone(vec3 q, uint seed, float foot) {
  float d = boulderBody(q);
  if (d > 2.0) { gBn = min(gBn, d - 0.8); return vec2(d, 1.0); }
  // грани: верхнее и нижнее кольцо плоскостей (плато r < 6 на y = 5 не трогают)
  float a0 = rnd(seed, 3) * 6.283;
  vec2 dir = vec2(cos(a0), sin(a0));
  const mat2 STEP = mat2(0.62349, 0.78183, -0.78183, 0.62349);  // поворот на 2π/7
  const mat2 HALF = mat2(0.90045, 0.43497, -0.43497, 0.90045);  // на 0.45 рад
  for (int i = 0; i < 7; i++) {
    d = max(d, dot(vec2(dot(q.xz, dir) - 6.4, q.y - 6.0), vec2(0.77, 0.64)));
    d = max(d, dot(vec2(dot(q.xz, HALF * dir) - 8.25, q.y - 1.8), vec2(0.94, -0.34)));
    dir = STEP * dir;
  }
  vec2 res = vec2(d, 1.0);
  if (q.y < 5.0) gBn = min(gBn, 5.6 - q.y);
  if (foot > 0.25 || q.y < 5.0) return res;
  // камешки и улитка на плато
  float pb = min(sdDodeca(q - vec3(3.8, 6.15, -0.6), 0.45), min(sdDodeca(q - vec3(-1.0, 6.1, -0.4), 0.3), sdIcosa(q - vec3(-4.3, 6.12, -0.6), 0.35)));
  res = umin(res, vec2(pb, 2.0));
  vec3 s = q - vec3(-0.2, 6.0, 4.2);
  s.xz = rot2(0.7) * s.xz;
  res = umin(res, vec2(sdSphere(s - vec3(0.15, 0.42, 0.0), 0.4), 3.0));
  res = umin(res, vec2(sdCapsule(s, vec3(-0.55, 0.12, 0.0), vec3(0.75, 0.12, 0.0), 0.13), 4.0));
  res = umin(res, vec2(min(sdCapsule(s, vec3(0.7, 0.15, 0.0), vec3(0.95, 0.45, 0.08), 0.035), sdCapsule(s, vec3(0.7, 0.15, 0.0), vec3(0.95, 0.45, -0.08), 0.035)), 4.0));
  return res;
}

// ---------- 2: мох с деревней ----------
const vec2 HS[3] = vec2[3](vec2(-4.2, 1.4), vec2(3.6, 2.9), vec2(0.4, -4.6));
const vec2 MUSH[2] = vec2[2](vec2(6.1, -2.9), vec2(-6.3, -1.6));
vec2 gMoss(vec3 q, uint seed, float foot) {
  float d = sdEllipsoid(q, vec3(10.0, 3.2, 10.0));
  d = max(d, -0.5 - q.y);
  if (d > 2.5) { gBn = min(gBn, d - 2.3); return vec2(d, 1.0); }
  // кочки ворса (пока пиксель мельче кочки)
  float amp = 0.24 * smoothstep(0.5, 0.12, foot);
  if (amp > 0.0) d = (d - amp * vnoise(q.xz * 1.6 + float(seed & 255u))) * 0.75;
  vec2 res = vec2(d, 1.0);
  if (q.y > 6.0) { gBn = min(gBn, q.y - 5.7); return res; }
  // спорогоны: тонкие ножки с коробочкой, по клеткам 1.1 (не у домов и грибов)
  if (foot < 0.08) {
    vec2 cell = floor(q.xz / 1.1 + 0.5);
    vec2 cc = cell * 1.1;
    vec2 e = 0.55 - abs(q.xz - cc);
    gBn = min(gBn, min(e.x, e.y) + 0.08); // спорогон соседа заходит в клетку не дальше 0.47
    vec2 h = hash22(cell + float(seed & 1023u));
    bool ok = h.x < 0.28 && dot(cc, cc) < 64.0;
    for (int i = 0; i < 3; i++) ok = ok && distance(cc, HS[i]) > 1.9;
    ok = ok && distance(cc, MUSH[0]) > 1.4 && distance(cc, MUSH[1]) > 1.4;
    if (ok) {
      vec2 bp = cc + (h - 0.5) * 0.3;
      vec3 b = vec3(q.x - bp.x, q.y - hMoss(bp), q.z - bp.y);
      float H = 1.2 + 0.7 * h.y;
      vec3 top = vec3((h.y - 0.5) * 0.3, H, (h.x - 0.14) * 0.5);
      float st = sdCapsule(b, vec3(0.0), top, 0.035);
      res = umin(res, umin(vec2(st, 2.0), vec2(sdEllipsoid(b - top - vec3(0.0, 0.12, 0.0), vec3(0.1, 0.2, 0.1)), 3.0)));
    }
  }
  // мухоморы
  for (int i = 0; i < 2; i++) {
    vec3 m = vec3(q.x - MUSH[i].x, q.y - hMoss(MUSH[i]), q.z - MUSH[i].y);
    float k = i == 0 ? 1.0 : 0.75;
    m /= k;
    if (dot(m.xz, m.xz) > 4.0) { gBn = min(gBn, (length(m.xz) - 1.0) * k); continue; }
    float stem = sdCapsule(m, vec3(0.0, -0.3, 0.0), vec3(0.05, 1.25, 0.0), 0.2) * k;
    float cap = max(sdEllipsoid(m - vec3(0.05, 1.25, 0.0), vec3(0.85, 0.55, 0.85)), 1.15 - m.y) * k;
    res = umin(res, umin(vec2(stem, 4.0), vec2(cap, 5.0)));
  }
  // роса
  if (foot < 0.1) {
    vec3 a = vec3(1.6, 0.0, 0.8), b = vec3(-2.0, 0.0, -2.2), c = vec3(5.0, 0.0, 1.5);
    a.y = hMoss(a.xz) + 0.15; b.y = hMoss(b.xz) + 0.15; c.y = hMoss(c.xz) + 0.15;
    res = umin(res, vec2(min(sdSphere(q - a, 0.2), min(sdSphere(q - b, 0.16), sdSphere(q - c, 0.18))), 6.0));
  }
  return res;
}

// ---------- 3: домик ----------
// Кукольный домик: когда камера близко, крыша растворяется (сетчатая прозрачность по gDither),
// а стены, обращённые к камере, опускаются — внутри видна комната. Всё — функция расстояния камеры
// до домика в его единицах, поэтому одинаково из любого кадра.
const vec2 NR = vec2(0.631, 0.775); // нормаль ската (|z|, y)
vec2 gHouse(vec3 q, uint seed, vec3 cq, float foot) {
  if ((seed & 1u) == 1u) { q.x = -q.x; cq.x = -cq.x; }
  float dc = length(cq - vec3(0.0, 4.0, 0.0));
  float roofA = smoothstep(18.0, 24.0, dc);
  float cut = 1.0 - smoothstep(13.0, 18.0, dc);
  vec2 cdir = normalize(cq.xz + vec2(1e-4));
  float far = sdBox(q - vec3(0.0, 4.0, 0.0), vec3(6.8, 8.0, 5.6));
  if (far > 1.5) return vec2(far, 1.0);
  // фундамент и пол
  vec2 res = vec2(sdBox(q - vec3(0.0, -1.25, 0.0), vec3(6.3, 1.75, 4.8)), 1.0);
  // стены: высота каждой — по тому, смотрит ли она на камеру
  float hb = mix(6.0, 1.0, cut * smoothstep(0.05, 0.5, -cdir.y));
  float hf = mix(6.0, 1.0, cut * smoothstep(0.05, 0.5, cdir.y));
  float hl = mix(6.0, 1.0, cut * smoothstep(0.05, 0.5, -cdir.x));
  float hr = mix(6.0, 1.0, cut * smoothstep(0.05, 0.5, cdir.x));
  float wb = sdBox(q - vec3(0.0, 0.25 + hb * 0.5, -4.325), vec3(6.0, hb * 0.5 - 0.25, 0.175));
  wb = max(wb, -sdBox(vec3(abs(q.x) - 2.5, q.y - 3.975, q.z + 4.325), vec3(0.8, 1.025, 0.4)));
  float wf = sdBox(q - vec3(0.0, 0.25 + hf * 0.5, 4.325), vec3(6.0, hf * 0.5 - 0.25, 0.175));
  wf = max(wf, -min(sdBox(q - vec3(1.6, 2.45, 4.325), vec3(0.75, 1.95, 0.4)), sdBox(q - vec3(-2.8, 3.7, 4.325), vec3(0.8, 1.1, 0.4))));
  float wl = sdBox(q - vec3(-5.825, 0.25 + hl * 0.5, 0.0), vec3(0.175, hl * 0.5 - 0.25, 4.5));
  wl = max(wl, -sdBox(q - vec3(-5.825, 3.7, 0.0), vec3(0.4, 1.1, 0.9)));
  float wr = sdBox(q - vec3(5.825, 0.25 + hr * 0.5, 0.0), vec3(0.175, hr * 0.5 - 0.25, 4.5));
  wr = max(wr, -sdBox(q - vec3(5.825, 3.7, 1.6), vec3(0.4, 1.1, 0.9)));
  res = umin(res, vec2(min(min(wb, wf), min(wl, wr)), 3.0));
  // подоконник с горшком (задняя стена, x = 2.5) на тумбочке; второй подоконник уходит со стеной
  float sill = sdBox(q - vec3(2.5, 2.87, -4.025), vec3(0.95, 0.08, 0.625));
  sill = min(sill, sdBox(q - vec3(2.5, 1.7, -3.85), vec3(0.75, 1.1, 0.4)));
  if (hb > 3.3) sill = min(sill, sdBox(q - vec3(-2.5, 2.87, -4.025), vec3(0.95, 0.08, 0.625)));
  res = umin(res, vec2(sill, 5.0));
  // крыша, фронтоны, труба — растворяются
  if (roofA > gDither) {
    float pl = dot(vec2(abs(q.z), q.y - 10.0), NR);
    float roof = max(abs(pl + 0.15) - 0.15, max(abs(q.x) - 6.6, abs(q.z) - 5.5));
    float gab = max(max(pl + 0.3, 6.0 - q.y), max(abs(abs(q.x) - 5.825) - 0.175, abs(q.z) - 4.5));
    res = umin(res, vec2(roof, 4.0));
    res = umin(res, vec2(gab, 3.0));
    res = umin(res, vec2(max(sdBox(q - vec3(3.2, 9.0, -2.0), vec3(0.45, 2.2, 0.45)), -pl - 3.0), 13.0));
  }
  // дверь
  res = umin(res, vec2(sdBox(q - vec3(1.6, 2.45, 4.33), vec3(0.72, 1.93, 0.07)), 14.0));
  // комната
  if (sdBox(q - vec3(0.0, 3.25, 0.0), vec3(5.7, 2.8, 4.2)) < res.x) {
    // стол со стульями
    vec3 t = q - vec3(-2.0, 0.0, -0.3);
    float d = sdBox(t - vec3(0.0, 2.83, 0.0), vec3(1.7, 0.12, 1.1));
    vec3 l = t - vec3(0.0, 1.66, 0.0);
    l.xz = abs(l.xz) - vec2(1.45, 0.85);
    d = min(d, sdBox(l, vec3(0.12, 1.16, 0.12)));
    vec3 c = t;
    c.x = abs(c.x) - 2.2;
    float ch = sdBox(c - vec3(0.0, 1.85, 0.0), vec3(0.5, 0.08, 0.5));
    vec3 cl = c - vec3(0.0, 1.17, 0.0);
    cl.xz = abs(cl.xz) - 0.4;
    ch = min(ch, sdBox(cl, vec3(0.07, 0.67, 0.07)));
    ch = min(ch, sdBox(c - vec3(0.45, 2.75, 0.0), vec3(0.06, 0.85, 0.5)));
    d = min(d, ch);
    // полка с банками на правой стене (уходит вместе со стеной)
    if (hr > 4.3) {
      d = min(d, sdBox(q - vec3(5.4, 3.7, -1.3), vec3(0.25, 0.06, 1.0)));
      vec3 j = q - vec3(5.4, 3.97, -1.3);
      j.z -= 0.7 * clamp(round(j.z / 0.7), -1.0, 1.0);
      res = umin(res, vec2(sdCylinder(j, 0.21, 0.16) - 0.02, 16.0));
    }
    res = umin(res, vec2(d, 5.0));
    // кровать
    res = umin(res, vec2(sdBox(q - vec3(-4.6, 1.0, 2.6), vec3(1.0, 0.5, 1.45)), 5.0));
    res = umin(res, vec2(sdBox(q - vec3(-4.6, 1.8, 4.0), vec3(1.0, 1.3, 0.1)), 5.0));
    res = umin(res, vec2(sdRoundBox(q - vec3(-4.6, 1.65, 2.45), vec3(0.98, 0.2, 1.32), 0.15), 6.0));
    res = umin(res, vec2(sdRoundBox(q - vec3(-4.6, 1.92, 3.55), vec3(0.72, 0.14, 0.3), 0.12), 7.0));
    // печка с огнём и трубой
    res = umin(res, vec2(min(sdBox(q - vec3(4.7, 1.6, -3.45), vec3(0.85, 1.1, 0.6)), sdCapsule(q, vec3(4.7, 2.6, -3.7), vec3(4.7, clamp(max(hb, hr) + 0.2, 2.7, 6.2), -3.7), 0.18)), 9.0));
    res = umin(res, vec2(sdBox(q - vec3(4.7, 1.25, -2.84), vec3(0.42, 0.3, 0.04)), 10.0));
    // коврик, картина
    res = umin(res, vec2(max(length(q.xz - vec2(0.9, 0.5)) - 1.6, abs(q.y - 0.52) - 0.03), 8.0));
    if (hb > 4.8) res = umin(res, vec2(sdBox(q - vec3(0.0, 4.0, -4.12), vec3(0.75, 0.55, 0.05)), 15.0));
    // горшок на подоконнике (в нём — вход «мох в горшке»)
    vec3 pt = q - vec3(2.5, 2.95, -3.8);
    float pot = max(length(pt.xz) - mix(0.25, 0.33, clamp(pt.y / 0.45, 0.0, 1.0)), abs(pt.y - 0.225) - 0.225);
    pot = max(pot, -max(length(pt.xz) - 0.27, 0.41 - pt.y)); // полость
    res = umin(res, vec2(pot, 11.0));
    res = umin(res, vec2(max(length(pt.xz) - 0.3, abs(pt.y - 0.3) - 0.07), 12.0));
  }
  return res;
}

// ---------- заглушки мелких детей ----------
vec2 proxy(int t, vec3 q, uint seed) {
  if (t == 1) return vec2(boulderBody(q), -1.0);
  if (t == 2) return vec2(max(sdEllipsoid(q, vec3(10.0, 3.2, 10.0)), -0.5 - q.y), -2.0);
  float roof = max(dot(vec2(abs(q.z), q.y - 10.0), NR), max(abs(q.x) - 6.4, 5.5 - q.y));
  return umin(vec2(sdBox(q - vec3(0.0, 2.5, 0.0), vec3(6.0, 3.5, 4.5)), -3.0), vec2(roof, -4.0));
}

vec2 geom(int type, vec3 q, uint seed, vec3 cq, float foot) {
  if (type == 0) return gField(q, seed, foot);
  if (type == 1) return gStone(q, seed, foot);
  if (type == 2) return gMoss(q, seed, foot);
  return gHouse(q, seed, cq, foot);
}

// ---------- предметы (единичный размер, лежат на y = 0) ----------
vec2 gItem(int kind, vec3 p) {
  if (kind == 0) { // варежка
    float palm = sdEllipsoid(p - vec3(0.0, 0.13, 0.08), vec3(0.3, 0.13, 0.4));
    palm = opSmoothUnion(palm, sdCapsule(p, vec3(0.18, 0.12, 0.0), vec3(0.4, 0.12, 0.28), 0.09), 0.06);
    return umin(vec2(palm, 100.0), vec2(sdRoundBox(p - vec3(0.0, 0.13, -0.36), vec3(0.32, 0.12, 0.1), 0.05), 101.0));
  }
  if (kind == 1) { // ключ
    float d = sdTorus(p - vec3(-0.32, 0.05, 0.0), vec2(0.17, 0.05));
    d = min(d, sdCapsule(p, vec3(-0.15, 0.05, 0.0), vec3(0.45, 0.05, 0.0), 0.045));
    d = min(d, sdBox(p - vec3(0.36, 0.05, 0.09), vec3(0.035, 0.035, 0.09)));
    d = min(d, sdBox(p - vec3(0.24, 0.05, 0.07), vec3(0.035, 0.035, 0.07)));
    return vec2(d, 102.0);
  }
  if (kind == 2) { // кот, свернулся
    float b = sdEllipsoid(p - vec3(0.0, 0.26, 0.0), vec3(0.48, 0.27, 0.36));
    b = opSmoothUnion(b, sdSphere(p - vec3(0.4, 0.36, 0.14), 0.21), 0.08);
    vec3 e = p - vec3(0.42, 0.56, 0.14);
    e.z = abs(e.z) - 0.1;
    b = min(b, sdOctahedron(e, 0.09));
    b = min(b, sdCapsule(p, vec3(-0.42, 0.12, 0.0), vec3(-0.05, 0.08, 0.4), 0.07));
    return vec2(b, 103.0);
  }
  if (kind == 3) { // клубок
    float d = sdSphere(p - vec3(0.0, 0.32, 0.0), 0.32);
    return vec2(min(d, sdCapsule(p, vec3(0.25, 0.06, 0.1), vec3(0.75, 0.025, 0.35), 0.025)), 104.0);
  }
  // уточка
  float d = sdEllipsoid(p - vec3(0.0, 0.24, 0.0), vec3(0.36, 0.24, 0.28));
  d = opSmoothUnion(d, sdSphere(p - vec3(0.24, 0.52, 0.0), 0.17), 0.06);
  return umin(vec2(d, 105.0), vec2(sdEllipsoid(p - vec3(0.44, 0.5, 0.0), vec3(0.1, 0.035, 0.08)), 106.0));
}

// ---------- map: запись о ближайшей поверхности ----------
float gD;       // результат map: шаг марша (с консервативными расстояниями до цилиндров входов)
float gGeo;     // только геометрия: попадание, нормаль, AO, полутень (цилиндры — не поверхность)
float gMat;     // материал (<0 — заглушка, ≥100 — предмет)
int gType;      // тип узла поверхности
uint gSeed;
vec3 gQ;        // точка в координатах узла
float gSc;      // масштаб узла (ед. узла → ед. камеры)
float gSc1;     // масштаб узла на уровень глубже камеры на пути к поверхности (0 — поверхность не глубже)
float gAng;     // поворот: n_узла = rotY(n, gAng)
int gFrame, gPath, gDepth;

float map(vec3 p) {
  gD = 1e9;
  gGeo = 1e9;
  gMat = 0.0;
  for (int f = 0; f < 3; f++) {
    if (f >= uFrames) break;
    vec4 fa = uFrA[f], fb = uFrB[f];
    vec3 q = fa.xyz + fa.w * vec3(fb.x * p.x - fb.y * p.z, p.y, fb.y * p.x + fb.x * p.z);
    vec3 cq = fa.xyz + fa.w * vec3(fb.x * uEye.x - fb.y * uEye.z, uEye.y, fb.y * uEye.x + fb.x * uEye.z);
    float sc = 1.0 / fa.w, ang = fb.z;
    int type = uFrI[f].x, skip = uFrI[f].z;
    uint seed = uint(uFrI[f].y);
    int path = 0, mul = 1;
    float s1 = 0.0;
    for (int k = 0; k < MAXD; k++) {
      float foot = gFoot / sc;
      // входы: внутрь одного — спуск, до остальных — консервативное расстояние
      int next = -1, nct = 0;
      vec3 nq = vec3(0.0), nc = vec3(0.0);
      float ns = 1.0, na = 0.0, carve = 1e9;
      for (int i = 0; i < 3; i++) {
        int ct; vec3 c; float s, a;
        ent(type, seed, i, ct, c, s, a);
        vec3 lq = rotY(q - c, -a) / s;
        float bd = boundDist(ct, lq);
        if (bd < 0.0 && ct == 3) carve = sdBox(lq - vec3(0.0, 6.65, 0.0), vec3(5.8, 6.35, 4.3)) * s; // комната домика — без земли родителя
        if (k == 0 && i == skip) continue;
        if (bd < 0.0) { next = i; nct = ct; nq = lq; nc = c; ns = s; na = a; }
        else gD = min(gD, (bd + PAD) * s * sc);
      }
      gBn = 1e9;
      vec2 g = geom(type, q, seed, cq, foot);
      g.x = max(g.x, -carve);
      gD = min(gD, gBn * sc);
      if (f == uItemI.x && k == uItemI.z && path == uItemI.y) {
        vec3 ip = rotY(q - uItemP.xyz, -uItemP.w) / uItemS;
        vec2 it = gItem(uItemI.w, ip);
        g = umin(g, vec2(it.x * uItemS, it.y));
      }
      if (g.x * sc < gGeo) {
        gGeo = g.x * sc; gMat = g.y; gType = type; gSeed = seed; gQ = q; gSc = sc; gAng = ang;
        gFrame = f; gPath = path; gDepth = k; gSc1 = s1;
      }
      if (next < 0) break;
      uint cs = childSeed(seed, next);
      if (k == f) s1 = sc * ns;
      if (BND[nct].x * ns < foot * LODK || k == MAXD - 1) {
        vec2 pr = proxy(nct, nq, cs);
        if (pr.x * ns * sc < gGeo) {
          gGeo = pr.x * ns * sc; gMat = pr.y; gType = nct; gSeed = cs; gQ = nq; gSc = sc * ns; gAng = ang - na;
          gFrame = f; gPath = path + next * mul; gDepth = k + 1; gSc1 = s1;
        }
        break;
      }
      type = nct; seed = cs; q = nq;
      cq = rotY(cq - nc, -na) / ns;
      sc *= ns; ang -= na;
      path += next * mul; mul *= 4;
    }
  }
  gD = min(gD, gGeo);
  return gD;
}
float mapGeo(vec3 p) { map(p); return gGeo; }

// Марш луча: попадание — по геометрии (gGeo), шаг — по gD, но не меньше доли следа пикселя
// (иначе луч ползёт вдоль цилиндров мелких входов). Старт внутри тела (ближе плоскости среза) —
// проходим насквозь: так получается срез «кукольного домика».
bool marchRay(vec3 ro, vec3 rd, float pixAng, float tmin, float tmax, int steps, out float t) {
  t = tmin;
  for (int i = 0; i < 10; i++) {
    gFoot = t * pixAng;
    map(ro + rd * t);
    if (gGeo > 0.0) break;
    t += max(-gGeo, gFoot) + 0.01 * tmin;
  }
  for (int i = 0; i < steps; i++) {
    gFoot = t * pixAng;
    map(ro + rd * t);
    if (gGeo < gFoot * 0.6) return true;
    t += max(gD * 0.9, gFoot * 0.4);
    if (t > tmax) return false;
  }
  return false;
}
