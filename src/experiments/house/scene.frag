// Невозможный дом: кадр от первого лица. Луч идёт через порталы (world.glsl/marchP), свет — тёплые лампы
// комнаты попадания с мягкой тенью (тени через порталы не идут: лампы берутся из комнаты, где точка).
#include "world.glsl"

uniform vec3 uEye;
uniform float uYaw;
uniform float uPitch;
uniform vec4 uGhostA; // призрак инструмента: центр xyz, вид (0 — нет)
uniform vec4 uGhostB; // x — yaw проёма, y — 1: срез, −1: прилепить
uniform float uFlash; // вспышка-подтверждение правки (0..1)

vec3 lin(vec3 c) { return c * c; }
float tx(vec2 uv) { return hash12(floor(uv)); }

// стена: обои по комнате (тексели 16 на метр), снизу панель
vec3 wallpaper(vec3 p, vec3 n, int reg) {
  vec2 uv = vec2(abs(n.x) > 0.5 ? p.z : p.x, p.y) * 16.0;
  float h = tx(uv);
  if (reg == 0) { // коридор: зелёные полосы, деревянная панель внизу
    if (p.y < 0.9) return mix(vec3(0.36, 0.22, 0.13), vec3(0.44, 0.28, 0.16), tx(vec2(floor(uv.x / 6.0), uv.y * 0.2)));
    float s = mod(floor(uv.x), 10.0) < 3.0 ? 1.0 : 0.0;
    return mix(vec3(0.42, 0.52, 0.36), vec3(0.6, 0.66, 0.46), s) * (0.92 + 0.12 * h);
  }
  if (reg == 1) { // прихожая: бежевые с ромбиками
    vec2 c = mod(floor(uv), 8.0) - 3.5;
    float dot_ = abs(c.x) + abs(c.y) < 2.0 ? 1.0 : 0.0;
    return mix(vec3(0.82, 0.72, 0.56), vec3(0.66, 0.42, 0.34), dot_ * 0.6) * (0.94 + 0.1 * h);
  }
  if (reg == 2) { // зал: тёмно-красные с золотым узором
    vec2 c = mod(floor(uv), 12.0) - 5.5;
    float m = abs(abs(c.x) - abs(c.y)) < 1.0 ? 1.0 : 0.0;
    return mix(vec3(0.42, 0.13, 0.12), vec3(0.72, 0.56, 0.3), m * 0.7) * (0.92 + 0.12 * h);
  }
  if (reg == 3) { // лестница: синие полосы; чердак — доски
    if (p.z > 10.9 && p.y > 2.9) return mix(vec3(0.45, 0.32, 0.2), vec3(0.55, 0.4, 0.25), tx(vec2(uv.x * 0.1, floor(uv.y / 3.0))));
    float s = mod(floor(uv.x), 6.0) < 2.0 ? 1.0 : 0.0;
    return mix(vec3(0.62, 0.66, 0.78), vec3(0.42, 0.48, 0.66), s) * (0.92 + 0.12 * h);
  }
  return vec3(0.85, 0.82, 0.76) * (0.9 + 0.15 * h); // фасад в саду
}

vec3 albedo(vec3 p, vec3 n, float m, int reg) {
  vec2 tp = (abs(n.y) > 0.6 ? p.xz : abs(n.x) > 0.5 ? p.zy : p.xy) * 12.0;
  float h = tx(tp);
  if (m < 1.5) {
    if (n.y > 0.7) { // пол: доски вдоль z (в саду — земля)
      if (reg == 4) return vec3(0.4, 0.55, 0.25) * (0.85 + 0.25 * h);
      vec2 b = vec2(floor(p.x * 5.0), p.z * 1.2 + hash11(floor(p.x * 5.0)) * 7.0);
      float plank = tx(vec2(b.x, floor(b.y)));
      vec3 c = mix(vec3(0.42, 0.27, 0.15), vec3(0.58, 0.39, 0.22), plank);
      return c * (0.9 + 0.15 * tx(vec2(b.x, p.z * 14.0)));
    }
    if (n.y < -0.7) return vec3(0.86, 0.83, 0.76) * (0.95 + 0.06 * h);
    return wallpaper(p, n, reg);
  }
  if (m < 4.5) return mix(vec3(0.4, 0.25, 0.14), vec3(0.52, 0.34, 0.19), tx(vec2(tp.x * 0.25, tp.y)));
  if (m < 5.5) return vec3(0.32, 0.34, 0.38) * (0.85 + 0.2 * h);
  if (m < 6.5) return vec3(1.0, 0.9, 0.7);
  if (m < 7.5) return reg == 1 ? vec3(0.58, 0.2, 0.18) * (0.85 + 0.2 * h) : reg == 2 ? vec3(0.25, 0.3, 0.5) * (0.85 + 0.2 * h) : vec3(0.78, 0.68, 0.5) * (0.85 + 0.2 * h);
  if (m < 8.5) { // картина: небо, холм, солнце; в зале — светлые окна
    if (reg == 2) return vec3(1.0, 0.95, 0.8);
    float y = fract(p.y * 1.6 + 0.3);
    return y > 0.55 ? vec3(0.55, 0.7, 0.9) : vec3(0.35, 0.55, 0.3) * (0.85 + 0.2 * h);
  }
  if (m < 9.5) { // срез: кирпич с раствором
    vec2 b = (abs(n.y) > 0.6 ? p.xz : abs(n.x) > 0.5 ? p.zy : p.xy) * vec2(4.0, 8.0);
    b.x += 0.5 * mod(floor(b.y), 2.0);
    vec2 f = fract(b);
    return (f.x < 0.08 || f.y < 0.12) ? vec3(0.7, 0.66, 0.6) : vec3(0.6, 0.28, 0.2) * (0.85 + 0.25 * tx(b));
  }
  if (m < 10.5) return vec3(0.85, 0.5, 0.3) * (0.9 + 0.15 * h);
  if (m < 11.5) return vec3(0.36, 0.56, 0.24) * (0.8 + 0.3 * h);
  if (m < 12.5) return vec3(0.28, 0.5, 0.2) * (0.75 + 0.4 * h);
  if (m < 13.5) return vec3(0.4, 0.28, 0.18) * (0.85 + 0.2 * h);
  if (m < 14.5) { // книги: корешки по столбцам
    float col = hash12(vec2(floor((p.x + p.z) * 18.0), floor(p.y * 2.0)));
    return mix(mix(vec3(0.5, 0.15, 0.12), vec3(0.15, 0.3, 0.45), step(0.4, col)), vec3(0.6, 0.5, 0.25), step(0.75, col));
  }
  if (m < 15.5) return vec3(0.93, 0.9, 0.8);
  if (m < 16.5) return vec3(0.3, 0.5, 0.35) * (0.9 + 0.15 * h);
  return vec3(0.85, 0.66, 0.3);
}

// лампы комнаты: позиция, цвет×сила (до 3)
int lamps(vec3 p, int reg, out vec3 L[3], out vec3 C[3]) {
  vec3 warm = vec3(1.0, 0.78, 0.5);
  if (reg == 0) { L[0] = corridorLamp(p); C[0] = warm * 5.0; return 1; }
  if (reg == 1) {
    L[0] = vec3(29.5, 2.05, 0.0); C[0] = warm * 6.0;
    L[1] = vec3(28.8, 1.15, -2.45); C[1] = warm * 1.5;
    L[2] = vec3(32.6, 2.05, 0.0); C[2] = warm * 1.2;
    return 3;
  }
  if (reg == 2) {
    L[0] = vec3(60.0, 5.3, 7.0); C[0] = warm * 30.0;
    L[1] = vec3(60.0, 4.0, 13.0); C[1] = vec3(0.9, 0.95, 1.0) * 10.0;
    return 2;
  }
  if (reg == 3) {
    if (p.z > 10.9 && p.y > 2.9) { L[0] = vec3(90.0, 5.6, 14.0); C[0] = warm * 5.0; return 1; }
    L[0] = vec3(90.0, 2.05, -0.6); C[0] = warm * 5.0;
    L[1] = vec3(90.0, 5.05, 9.0); C[1] = warm * 5.0;
    return 2;
  }
  L[0] = p + normalize(vec3(0.5, 0.8, -0.3)) * 50.0; C[0] = vec3(1.0, 0.95, 0.85) * 3.0 * 2500.0; // солнце
  return 1;
}

float softShadow(vec3 ro, vec3 rd, float tmax) {
  float res = 1.0, t = 0.03;
  for (int i = 0; i < 24; i++) {
    float h = map(ro + rd * t);
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.03, 0.5);
    if (res < 0.02 || t > tmax) break;
  }
  return clamp(res, 0.0, 1.0);
}

// пересечение отрезка луча с призраком (шар-додекаэдр ~ сфера, проём — повёрнутый бокс)
vec2 ghostHit(vec3 ro, vec3 rd) {
  vec3 o = ro - uGhostA.xyz;
  if (abs(uGhostA.w) > 1.5) {
    o.xz = rot2(uGhostB.x) * o.xz;
    vec3 d = rd;
    d.xz = rot2(uGhostB.x) * d.xz;
    // видимая часть — только «в стене» (−0.85…−0.05 по нормали), без запаса в воздух
    o.z += 0.45;
    vec3 hb = vec3(BOX_H.xy, 0.4);
    vec3 inv = 1.0 / d;
    vec3 t0 = (-hb - o) * inv, t1 = (hb - o) * inv;
    vec3 tn = min(t0, t1), tf = max(t0, t1);
    return vec2(max(max(tn.x, tn.y), tn.z), min(min(tf.x, tf.y), tf.z));
  }
  float b = dot(o, rd), c = dot(o, o) - SPH_R * SPH_R, h = b * b - c;
  if (h < 0.0) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

void main() {
  vec2 sp = (2.0 * gl_FragCoord.xy - uResolution) / min(uResolution.x, uResolution.y);
  vec3 fw = vec3(sin(uYaw) * cos(uPitch), sin(uPitch), cos(uYaw) * cos(uPitch));
  vec3 rt = normalize(vec3(-cos(uYaw), 0.0, sin(uYaw)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.3 + rt * sp.x + up * sp.y); // ~75° по меньшей стороне
  vec3 ro = uEye;

  float t, tTot;
  int cr;
  bool hit = marchP(ro, rd, 60.0, 200, t, tTot, cr);
  vec3 col;
  vec3 p = ro + rd * t;
  int reg = regionOf(p);
  vec3 fogC = reg == 0 ? vec3(0.16, 0.12, 0.08) : reg == 4 ? vec3(0.7, 0.8, 0.9) : vec3(0.1, 0.08, 0.06);
  if (hit) {
    vec2 m = scene(p);
    vec3 n = calcNormal(p, 0.0015);
    vec3 alb = lin(albedo(p, n, m.y, reg));
    if (m.y > 5.5 && m.y < 6.5) col = alb * 3.0; // плафон светится
    else {
      vec3 L[3], C[3];
      int nl = lamps(p, reg, L, C);
      vec3 amb = reg == 4 ? vec3(0.35, 0.42, 0.55) : vec3(0.09, 0.075, 0.06);
      if (reg == 2 && m.y > 7.5 && m.y < 8.5) amb = vec3(2.5); // окна зала светятся
      // AO: 3 пробы
      float ao = 0.0;
      for (int k = 1; k <= 3; k++) { float hh = 0.08 * float(k); ao += (hh - map(p + n * hh)) / hh; }
      ao = clamp(1.0 - ao * 0.3, 0.2, 1.0);
      col = alb * amb * ao;
      for (int k = 0; k < 3; k++) {
        if (k >= nl) break;
        vec3 l = L[k] - p;
        float dl = length(l);
        l /= dl;
        float dif = max(dot(n, l), 0.0);
        if (dif <= 0.0) continue;
        float sh = k == 0 ? softShadow(p + n * 0.01, l, dl - 0.5) : 1.0; // у самой лампы (абажур) не затеняем
        col += alb * C[k] * dif * sh / (1.0 + dl * dl);
      }
    }
    // туман: в коридоре — тёплая глубина, в остальных комнатах лёгкий
    float fd = reg == 0 ? 0.07 : reg == 4 ? 0.01 : 0.02;
    col = mix(fogC, col, exp(-(tTot + t) * fd));
  } else {
    // небо сада (и пустота — не должна быть видна)
    col = reg == 4 ? mix(vec3(0.75, 0.84, 0.92), vec3(0.4, 0.6, 0.9), clamp(rd.y * 2.0, 0.0, 1.0)) : fogC;
    col = lin(col);
  }
  // призрак инструмента: полупрозрачная штриховка внутри формы
  if (uGhostA.w != 0.0) {
    vec2 g = ghostHit(ro, rd);
    if (g.x < g.y && g.y > 0.0 && max(g.x, 0.0) < t + 0.02) {
      float stripes = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) * 0.25));
      vec3 gc = uGhostB.y > 0.0 ? vec3(1.0, 0.9, 0.6) : vec3(0.9, 0.5, 0.3);
      col = mix(col, gc, 0.18 + 0.14 * stripes);
    }
  }
  col += uFlash * vec3(0.25, 0.2, 0.12);
  col = col / (1.0 + col * 0.4);
  col = sqrt(col);
  fragColor = vec4(col, 1.0);
}
