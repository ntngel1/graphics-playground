// Дерево на холме: реймарчинг SDF, игрушечный «глиняный» стиль — мягкий дневной свет, длинные тени, дымка.
#include <sdf>
#include <noise>
#include <camera>

uniform float uTreeSeed;
uniform float uGrowth;
uniform float uSeason;   // 0..1 по кругу: весна .125, лето .375, осень .625, зима .875
uniform float uWind;
uniform float uWindT;    // фаза ветра (копится в JS)
uniform int uSpecies;    // 0 лиственное, 1 берёза, 2 ель
uniform bool uForest;
uniform float uSunAzimuth;
uniform float uSunHeight;
uniform int uDebug;      // 0 картинка, 1 шаги марша, 2 нормали

// глобалы, которые читает tree.glsl
vec3 PW;
bool CHEAP = false;    // тени и AO: без травы и шума листвы (и без границ клеток травы)
bool REC = false;      // запись подробностей ближайшей поверхности (только для точки попадания)
float recBark, recHash, recLevel;
vec3 recLocal;
#include "tree.glsl"

// ZERO не известен компилятору: циклы с ним не разворачиваются, и тяжёлая map() не размножается
// по копиям тела цикла (иначе шейдер раздувается и не хватает регистров — это дороже самих вычислений)
#define ZERO min(uFrame, 0)

vec4 SW;       // веса сезонов: весна, лето, осень, зима (сумма 1)
float SNOW;
vec3 TREE0;
vec3 ROCK[3];
vec3 SUN;

float seasonW(float s, float c) {
  float d = abs(fract(s - c + 0.5) - 0.5);
  return smoothstep(0.0, 1.0, clamp(1.0 - d * 4.0, 0.0, 1.0));
}

// пологий холм в центре + мягкие волны (в лесу — холмистее)
float groundH(vec2 xz) {
  float r2 = dot(xz, xz);
  float h = 0.95 * exp(-r2 / 26.0) - 0.3;
  float far = smoothstep(3.0, 14.0, sqrt(r2));
  h += (vnoise(xz * 0.11 + 3.1) - 0.5) * (0.5 + (uForest ? 1.6 : 0.6) * far);
  return h;
}

float sdCone2(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}

const float GC = 0.5; // клетка травы

// пучки травы (5 толстых травинок) и цветы — по клетке на точку; шаг ограничен границей клетки
vec2 grass(vec3 p, float gh) {
  float y = p.y - gh;
  vec2 gp = mat2(0.8776, 0.4794, -0.4794, 0.8776) * p.xz; // сетка повёрнута — ряды не смотрят в камеру
  vec2 cell = floor(gp / GC);
  vec2 lp = gp - (cell + 0.5) * GC;
  vec3 h = hash33(vec3(cell, 4.2));
  float d = GC * 0.5 - max(abs(lp.x), abs(lp.y)) + 0.05; // пучок не дальше 0.2 от центра клетки
  float m = 4.0;
  float r = length(p.xz);
  float dens = mix(0.25, 0.95, smoothstep(0.3, 0.7, vnoise(cell * 0.23 + 1.7))) * smoothstep(12.0, 8.0, r) * smoothstep(0.45, 1.0, length(p.xz - TREE0.xz));
  float tall = mix(1.0, 0.45, SW.w);
  vec2 c = (h.yz - 0.5) * 0.2;
  vec3 q = vec3(lp.x - c.x, y, lp.y - c.y);
  float wv = uWind * 0.07 * sin(uWindT * 2.2 + cell.x * 0.7 + cell.y * 0.4) + 0.02 * sin(uWindT * 3.1 + h.y * 6.0);
  if (h.x < dens) {
    // пучок-веер: 6 толстых травинок, наружные короче и сильнее отогнуты
    float sc = mix(0.8, 1.25, h.y);
    for (int k = 0; k < 5; k++) {
      float a = float(k) * 1.2566 + h.z * 6.0;
      vec3 o = vec3(cos(a), 0.0, sin(a));
      float fk = fract(float(k) * 0.618 + h.y);
      float hg = mix(0.12, 0.24, fk) * tall * sc;
      vec3 tip = o * mix(0.1, 0.04, fk) * sc + vec3(wv * hg * 4.0, hg, 0.0);
      d = min(d, sdCone2(q, o * 0.025 - vec3(0.0, 0.04, 0.0), tip, 0.03, 0.006));
    }
  } else if (h.x < dens + 0.09 * (SW.x + 0.6 * SW.y) && r < 9.0) {
    // цветок: стебель + головка
    float hg = mix(0.18, 0.3, h.y);
    vec3 top = vec3(wv * 0.6, hg, 0.0);
    float st = sdCone2(q, vec3(0.0, -0.05, 0.0), top, 0.01, 0.007);
    float hd = length((q - top) * vec3(1.0, 1.6, 1.0)) / 1.6 - 0.045;
    d = min(d, st);
    if (hd < d) { d = hd; m = 6.0; }
  }
  return vec2(d, m);
}

vec2 rocks(vec3 p) {
  float d = 1e9;
  for (int i = 0; i < 3; i++) {
    vec3 q = p - ROCK[i];
    float s = 0.18 + 0.1 * float(i);
    if (dot(q, q) > (s * 3.0) * (s * 3.0)) { d = min(d, length(q) - s * 2.0); continue; }
    q = rotY(q, float(i) * 1.9);
    float e = sdEllipsoid(q, vec3(1.4, 0.8, 1.1) * s);
    e += 0.03 * gnoise(p * 6.0 + float(i));
    d = min(d, e * 0.8);
  }
  return vec2(d, 5.0);
}

// нижняя оценка расстояния до дерева (в локальных координатах дерева, gs — масштаб роста):
// эллипсоид кроны поднят над землёй + узкая капсула ствола с корнями — земля вокруг не платит за дерево
float treeBound(vec3 tp, float gs) {
  vec3 R = vec3(4.5, 2.9, 4.5) * gs;
  float crown = (length((tp - vec3(0.0, 3.0 * gs, 0.0)) / R) - 1.0) * R.y;
  vec3 c = tp;
  c.y -= clamp(c.y, -0.4 * gs, 1.6 * gs);
  float trunk = length(c) - 1.45 * gs;
  return min(crown, trunk);
}

vec2 treeAt(vec3 lp, float seed, float g, int sp, int levels) {
  if (sp == 2) return spruce(lp, seed, g);
  return broadleaf(lp, seed, g, sp, levels);
}

// x — расстояние, y — материал: 0 земля, 1 кора, 2 листва, 3 хвоя, 4 трава, 5 камень, 6 цветок
vec2 scene(vec3 p) {
  PW = p;
  float gh = groundH(p.xz);
  vec2 res = vec2((p.y - gh) * 0.75, 0.0);
  if (!CHEAP && p.y - gh < 0.42 && dot(p.xz, p.xz) < 144.0) {
    vec2 gr = grass(p, gh);
    if (gr.x < res.x) res = gr;
  }
  vec2 rk = rocks(p);
  if (rk.x < res.x) res = rk;

  // главное дерево — в ограничивающем объёме (лучи мимо не платят за ветки)
  WIND_LOCAL = uWind;
  float gs = mix(0.3, 1.0, smoothstep(0.0, 0.85, uGrowth));
  vec3 tp = p - TREE0;
  if (treeBound(tp, gs) < res.x) {
    vec2 tr = treeAt(tp, uTreeSeed, uGrowth, uSpecies, 4);
    tr.x *= 0.7; // складки и шум — осторожный шаг (иначе луч проскакивает складки между комками)
    if (tr.x < res.x) res = vec2(tr.x, tr.y > 1.5 ? 3.0 : tr.y > 0.5 ? 2.0 : 1.0);
  }

  // лес: по дереву в клетке 10×10 (кроме центральной), свой seed/вид/размер, LOD по расстоянию
  if (uForest) {
    const float CS = 10.0;
    vec2 cell = round(p.xz / CS);
    vec2 lp = p.xz - cell * CS;
    if (!CHEAP) res.x = min(res.x, CS * 0.5 - max(abs(lp.x), abs(lp.y)) + 0.6);
    vec3 h = hash33(vec3(cell, 31.0));
    if (cell != vec2(0.0) && max(abs(cell.x), abs(cell.y)) <= 4.0 && h.x < 0.62) {
      vec2 c = cell * CS + (h.yz - 0.5) * 3.0;
      float sz = mix(0.75, 1.15, h.y);
      vec3 fp = (p - vec3(c.x, groundH(c) - 0.05, c.y)) / sz;
      if (treeBound(fp, 1.0) * sz < res.x) {
        float dc = length(c - uCamPos.xz);
        int sp = h.z < 0.3 ? 2 : h.z < 0.5 ? 1 : 0;
        vec2 tr = treeAt(fp, floor(h.x * 977.0 + cell.x * 13.0 + cell.y * 7.0), 1.0, sp, dc < 16.0 ? 3 : 2);
        tr.x *= 0.7 * sz;
        if (tr.x < res.x) res = vec2(tr.x, tr.y > 1.5 ? 3.0 : tr.y > 0.5 ? 2.0 : 1.0);
      }
    }
  }
  return res;
}

float map(vec3 p) { return scene(p).x; }


vec3 calcNormal(vec3 p, float eps) {
  vec3 n = vec3(0.0);
  for (int i = ZERO; i < 4; i++) {
    vec3 e = 0.5773 * (2.0 * vec3(float(((i + 3) >> 1) & 1), float((i >> 1) & 1), float(i & 1)) - 1.0);
    n += e * map(p + e * eps);
  }
  return normalize(n);
}

float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0, d0 = 0.0;
  for (int i = ZERO; i < 6; i++) { // i = 0 — базовая линия map(p) (одна точка вызова map)
    float h = i == 0 ? 0.0 : 0.01 + 0.12 * float(i - 1) / 4.0;
    float d = map(p + h * n);
    if (i == 0) { d0 = d; continue; }
    occ += (h - (d - d0)) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}

// мягкая тень: шаг до 0.6 — длинные тени дёшево
float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.03;
  for (int i = ZERO; i < 32; i++) {
    float h = map(ro + rd * t);
    res = min(res, 7.0 * h / t);
    t += clamp(h, 0.06, 0.9);
    if (res < -1.0 || t > 14.0) break;
  }
  res = max(res, -1.0);
  return 0.25 * (1.0 + res) * (1.0 + res) * (2.0 - res);
}

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 skyCol(vec3 rd) {
  vec3 zen = mix(vec3(0.33, 0.58, 0.92), vec3(0.55, 0.7, 0.9), SW.w);
  vec3 hor = mix(vec3(0.88, 0.92, 0.95), vec3(0.9, 0.93, 0.97), SW.w);
  hor = mix(hor, vec3(1.0, 0.88, 0.74), SW.z * 0.45);
  vec3 c = mix(hor, zen, smoothstep(0.0, 0.55, rd.y));
  float s = max(dot(rd, SUN), 0.0);
  c += vec3(1.0, 0.85, 0.6) * (0.35 * pow(s, 12.0) + 0.6 * smoothstep(0.9993, 0.9997, s));
  return lin(c);
}

// облака — SDF-комки на кольце вокруг сцены, медленно плывут
float cloudSdf(vec3 p, out vec3 nc) {
  float d = 1e9;
  nc = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 4; i++) {
    float a = float(i) * 1.7 + 0.4 + uTime * 0.004;
    vec3 c = vec3(cos(a) * 46.0, 10.0 + float(i) * 2.0, sin(a) * 46.0);
    vec3 q = p - c;
    if (dot(q, q) > 400.0) { d = min(d, length(q) - 16.0); continue; }
    float dc = 1e9, best = 1e9;
    for (int k = 0; k < 6; k++) {
      float fk = float(k) - 2.5;
      vec3 o = vec3(fk * 2.3, (1.2 - abs(fk) * 0.55) + 0.4 * sin(float(k) * 1.7 + float(i)), sin(float(k) * 2.3 + float(i)) * 1.4);
      float r = 2.9 - abs(fk) * 0.45 + 0.5 * sin(float(k) * 3.1 + float(i) * 1.3);
      float s = length(q - o) - r;
      if (s < best) { best = s; if (s < d) nc = normalize(q - o); }
      dc = opSmoothUnion(dc, s, 1.2);
    }
    d = min(d, max(dc, -(q.y + 1.2))); // плоское дно
  }
  return d;
}

vec4 clouds(vec3 ro, vec3 rd) {
  if (rd.y < 0.01) return vec4(0.0);
  float t = (6.0 - ro.y) / rd.y;
  vec3 n;
  float md = 1e9;
  for (int i = 0; i < 48; i++) {
    vec3 p = ro + rd * t;
    float d = cloudSdf(p, n);
    md = min(md, d);
    if (d < 0.02) {
      // пухлый свет: мягкий ламберт + светлый верх, тень снизу голубоватая
      float l = 0.75 + 0.3 * max(dot(n, SUN), 0.0) + 0.1 * n.y;
      vec3 c = mix(vec3(0.78, 0.84, 0.95), vec3(1.0, 0.98, 0.95), smoothstep(-0.6, 0.5, n.y)) * l;
      return vec4(lin(c) * 1.35, 1.0);
    }
    t += d;
    if (t > 140.0) break;
  }
  return vec4(lin(vec3(1.0, 0.99, 0.97)) * 1.3, smoothstep(0.5, 0.0, md) * 0.0);
}

// падающие листья (осень), лепестки (весна), снежинки (зима) — пересечение луча со сферами
vec4 particles(vec3 ro, vec3 rd, float tHit) {
  vec4 acc = vec4(0.0);
  float gs = mix(0.3, 1.0, smoothstep(0.0, 0.85, uGrowth));
  bool broad = uSpecies != 2;
  for (int i = 0; i < 28; i++) {
    vec3 h = hash33(vec3(float(i), 7.7, 1.3));
    float autumn = broad ? SW.z * smoothstep(0.55, 0.9, uGrowth) : 0.0;
    float spring = broad && uSpecies == 0 ? SW.x * smoothstep(0.7, 0.95, uGrowth) : 0.0;
    float snow = SW.w;
    float w = max(max(autumn, spring), snow);
    if (h.x > w * 0.9) continue;
    vec3 pos, col;
    float r;
    float ph;
    if (snow >= max(autumn, spring)) {
      ph = fract(uTime / 9.0 + h.z);
      pos = vec3((h.y - 0.5) * 12.0, mix(7.0, -0.5, ph), (fract(h.z * 7.3) - 0.5) * 12.0);
      pos.xz += uCamTarget.xz * 0.0 + vec2(sin(uTime * 0.7 + float(i)), cos(uTime * 0.6 + float(i))) * 0.3 + uWind * ph * vec2(2.0, 0.5);
      col = vec3(1.0);
      r = 0.035;
    } else {
      ph = fract(uTime / (6.0 + h.y * 4.0) + h.z);
      vec2 o = (vec2(h.y, fract(h.z * 5.1)) - 0.5) * 4.4 * gs;
      pos = TREE0 + vec3(o.x, mix(3.2 * gs, -0.1, ph), o.y);
      pos.xz += vec2(sin(uTime * 1.5 + float(i)), cos(uTime * 1.1 + float(i) * 2.0)) * 0.25 + uWind * ph * vec2(1.6, 0.4);
      col = spring > autumn ? mix(vec3(1.0, 0.85, 0.9), vec3(1.0), h.y) : mix(vec3(0.95, 0.6, 0.15), vec3(0.85, 0.28, 0.12), h.y);
      r = 0.045;
    }
    vec3 oc = ro - pos;
    float b = dot(oc, rd), c = dot(oc, oc) - r * r, disc = b * b - c;
    if (disc <= 0.0) continue;
    float tt = -b - sqrt(disc);
    if (tt < 0.0 || tt > tHit) continue;
    float a = smoothstep(0.0, r * r * 0.5, disc);
    acc.rgb = mix(acc.rgb, lin(col) * (0.9 + 0.5 * max(SUN.y, 0.0)), a * (1.0 - acc.a));
    acc.a += a * (1.0 - acc.a);
  }
  return acc;
}

void main() {
  SW = vec4(seasonW(uSeason, 0.125), seasonW(uSeason, 0.375), seasonW(uSeason, 0.625), seasonW(uSeason, 0.875));
  SW /= max(dot(SW, vec4(1.0)), 1e-3);
  SNOW = SW.w;
  LEAF = dot(SW, vec4(0.8, 1.0, 0.75, 0.0));
  TREE0 = vec3(0.0, groundH(vec2(0.0)) - 0.05, 0.0);
  ROCK[0] = vec3(1.5, 0.0, 0.9);
  ROCK[1] = vec3(-1.3, 0.0, 1.5);
  ROCK[2] = vec3(0.4, 0.0, -1.9);
  for (int i = 0; i < 3; i++) ROCK[i].y = groundH(ROCK[i].xz) + 0.04;
  float az = radians(uSunAzimuth), el = radians(uSunHeight);
  SUN = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));

  vec3 ro = uCamPos;
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uCamTarget, 40.0);

  float t = 0.05, tmax = uForest ? 70.0 : 45.0;
  int steps = 0;
  vec2 m = vec2(0.0);
  bool hit = false;
  for (int i = ZERO; i < 200; i++) {
    m = scene(ro + rd * t);
    if (abs(m.x) < 0.0009 * t) { hit = true; break; }
    t += m.x;
    steps = i;
    if (t > tmax) break;
  }
  if (!hit && t < tmax && m.x < 0.05) hit = true; // кончились шаги у поверхности — это поверхность, не небо

  vec3 sky = skyCol(rd);
  vec3 col = sky;
  vec3 n = vec3(0.0);
  if (hit) {
    vec3 p = ro + rd * t;
    REC = true;
    recBark = 1e9;
    m = scene(p);
    REC = false;
    float mat = m.y;
    n = calcNormal(p, 0.0012 * max(1.0, t * 0.5));
    CHEAP = true;
    float occ = calcAO(p, n);
    float sh = shadow(p + n * 0.02, SUN);
    CHEAP = false;

    vec3 alb;
    float wrap = 0.0, trans = 0.0;
    float nz = vnoise(p.xz * 1.3) * 0.6 + vnoise(p.xz * 5.0) * 0.4;
    vec3 grassC = SW.x * vec3(0.55, 0.76, 0.3) + SW.y * vec3(0.42, 0.63, 0.26) + SW.z * vec3(0.7, 0.62, 0.32) + SW.w * vec3(0.6, 0.58, 0.45);
    if (mat < 0.5) { // земля
      alb = mix(grassC * 0.72, grassC * 0.98, nz);
      alb = mix(alb, vec3(0.55, 0.45, 0.34), smoothstep(0.55, 0.85, vnoise(p.xz * 0.7 + 9.0)) * 0.35);
    } else if (mat < 1.5) { // кора: вертикальные волокна по локальной оси ветки
      vec3 q = recLocal;
      float ang = atan(q.z, q.x);
      float fib = vnoise(vec2(ang * 5.0, q.y * 1.2)) * 0.7 + vnoise(vec2(ang * 13.0, q.y * 3.0)) * 0.3;
      if (uSpecies == 1) {
        alb = vec3(0.9, 0.88, 0.83) * (0.9 + 0.1 * fib);
        float mark = smoothstep(0.72, 0.8, vnoise(vec2(ang * 2.0, q.y * 9.0)));
        alb = mix(alb, vec3(0.2, 0.18, 0.17), mark * step(recLevel, 1.5));
      } else {
        alb = mix(vec3(0.36, 0.25, 0.18), vec3(0.52, 0.38, 0.26), fib);
        alb *= 0.85 + 0.25 * smoothstep(0.35, 0.7, fib);
      }
      // молодой стебель — зелёный, деревенеет с ростом
      alb = mix(vec3(0.42, 0.62, 0.25), alb, max(smoothstep(0.08, 0.4, uGrowth), step(4.0, length(p.xz - TREE0.xz)))); // лес не трогаем
    } else if (mat < 2.5) { // листва
      float hh = fract(recHash * 0.618);
      vec3 spring = mix(vec3(0.58, 0.8, 0.34), vec3(0.66, 0.84, 0.4), hh);
      vec3 summer = mix(vec3(0.27, 0.5, 0.2), vec3(0.4, 0.58, 0.22), hh);
      vec3 autumn = uSpecies == 1 ? mix(vec3(0.98, 0.82, 0.25), vec3(0.95, 0.68, 0.18), hh)
                  : hh < 0.4 ? mix(vec3(0.98, 0.74, 0.2), vec3(0.95, 0.55, 0.15), hh / 0.4)
                  : mix(vec3(0.92, 0.42, 0.14), vec3(0.75, 0.22, 0.14), (hh - 0.4) / 0.6);
      alb = (SW.x * spring + SW.y * summer + SW.z * autumn + SW.w * autumn) / max(SW.x + SW.y + SW.z + SW.w, 1e-3);
      alb *= 0.88 + 0.24 * vnoise(p * 9.0);
      // весеннее цветение (лиственное): светлые точки
      if (uSpecies == 0) {
        float bl = smoothstep(0.82, 0.9, vnoise(p * 14.0)) * SW.x;
        alb = mix(alb, vec3(1.0, 0.9, 0.93), bl);
      }
      wrap = 0.45;
      trans = 1.0;
    } else if (mat < 3.5) { // хвоя
      alb = mix(vec3(0.17, 0.33, 0.22), vec3(0.3, 0.48, 0.26), SW.x * 0.6) * (0.85 + 0.3 * vnoise(p * 8.0));
      wrap = 0.3;
      trans = 0.4;
    } else if (mat < 4.5) { // трава: кончики светлее
      float y = clamp((p.y - groundH(p.xz)) / 0.3, 0.0, 1.0);
      vec3 gh = hash33(vec3(floor(mat2(0.8776, 0.4794, -0.4794, 0.8776) * p.xz / GC), 4.2));
      alb = grassC * mix(0.7, 1.15, y) * (0.85 + 0.3 * gh.y);
      wrap = 0.4;
      trans = 0.6;
    } else if (mat < 5.5) { // камень
      alb = mix(vec3(0.55, 0.53, 0.5), vec3(0.68, 0.64, 0.58), vnoise(p * 4.0));
    } else { // цветок
      vec3 gh = hash33(vec3(floor(mat2(0.8776, 0.4794, -0.4794, 0.8776) * p.xz / GC), 4.2));
      alb = gh.z < 0.3 ? vec3(0.98, 0.84, 0.3) : gh.z < 0.6 ? vec3(0.97, 0.55, 0.62) : gh.z < 0.8 ? vec3(0.98, 0.97, 0.94) : vec3(0.68, 0.62, 0.95);
      wrap = 0.5;
    }
    // снег сверху — по нормали
    float sn = SNOW * smoothstep(0.25, 0.65, n.y + 0.25 * (vnoise(p.xz * 4.0) - 0.5) + (mat < 0.5 ? 0.4 : 0.0));
    alb = mix(alb, vec3(0.95, 0.96, 1.0), sn);
    alb = lin(alb);

    vec3 sunCol = mix(vec3(1.0, 0.86, 0.68), vec3(1.0, 0.95, 0.9), SW.w) * 3.4;
    sunCol = mix(sunCol, vec3(1.0, 0.8, 0.6) * 3.0, SW.z * 0.3);
    vec3 skyAmb = lin(vec3(0.62, 0.72, 0.92)) * 0.55;
    float dif = clamp((dot(n, SUN) + wrap) / (1.0 + wrap), 0.0, 1.0) * sh;
    col = alb * sunCol * dif;
    col += alb * skyAmb * (0.55 + 0.45 * n.y) * occ;
    col += alb * lin(grassC) * 0.35 * clamp(0.5 - 0.5 * n.y, 0.0, 1.0) * occ; // отражённый от травы
    col += alb * sunCol * trans * 0.35 * pow(clamp(dot(rd, SUN), 0.0, 1.0), 3.0) * (0.3 + 0.7 * sh); // просвет листвы
    col += skyAmb * 0.12 * pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 3.0) * occ; // мягкий ободок «глины»
    // воздушная перспектива
    vec3 haze = skyCol(normalize(vec3(rd.x, 0.02, rd.z)));
    col = mix(col, haze, 1.0 - exp(-t * (uForest ? 0.02 : 0.011)));
  } else {
    vec4 cl = clouds(ro, rd);
    col = mix(sky, cl.rgb, cl.a);
  }
  vec4 pt = particles(ro, rd, hit ? t : 1e4);
  col = mix(col, pt.rgb, pt.a);

  // тон: мягкая кривая без пересвета, затем гамма
  col = col / (1.0 + col * 0.3);
  col = pow(col, vec3(1.0 / 2.2));
  col = mix(col, col * col * (3.0 - 2.0 * col), 0.2); // чуть контраста
  vec2 uv = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - 0.18 * dot(uv, uv);
  if (uDebug == 1) col = mix(vec3(0.1, 0.2, 0.6), vec3(1.0, 0.3, 0.1), float(steps) / 200.0);
  if (uDebug == 2) col = n * 0.5 + 0.5;
  fragColor = vec4(col + (hash12(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
}
