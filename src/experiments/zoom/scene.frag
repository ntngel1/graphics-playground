// Бесконечный зум: кадр. Камера и всё остальное — в координатах текущего узла (см. world.glsl).
// Туман и длина теней — относительно масштаба (расстояния до центра обзора / масштаба узла попадания),
// поэтому картинка одинакова в любом кадре.
#include "world.glsl"
#include <camera>

uniform vec3 uTarget;
uniform vec3 uSun;      // направление на солнце (в узле камеры)
uniform float uViewD;   // расстояние камеры до центра обзора
uniform float uNear;    // ближняя плоскость (ближе — срез, как у кукольного домика)
uniform float uGlow;    // подсветка предмета после находки (0..1)

const float FOV = 50.0;

vec3 lin(vec3 c) { return c * c; }
float tx(vec2 uv) { return hash12(floor(uv)); }
vec3 seedCol(uint s, int k, vec3 a, vec3 b, vec3 c, vec3 d) {
  float r = rnd(s, k) * 4.0;
  return r < 1.0 ? a : r < 2.0 ? b : r < 3.0 ? c : d;
}

// зерно «на любом масштабе»: тексели ~3 px, октава по следу пикселя в единицах узла (fl) — так поверхность
// родителя, увиденная из глубины, не превращается в огромные квадраты
float grain(vec2 uv, float fl) {
  float o = log2(fl * 3.0);
  float o0 = floor(o);
  float a = o - o0;
  return mix(tx(uv / exp2(o0) + 0.5), tx(uv / exp2(o0 + 1.0) + 7.5), a);
}

vec3 albedo(int type, float m, vec3 q, vec3 n, uint seed) {
  vec2 tp = (abs(n.y) > 0.6 ? q.xz : abs(n.x) > 0.6 ? q.zy : q.xy);
  if (m >= 100.0) {
    if (m < 100.5) return vec3(0.85, 0.08, 0.06);
    if (m < 101.5) return vec3(0.95, 0.92, 0.85);
    if (m < 102.5) return vec3(1.0, 0.75, 0.2);
    if (m < 103.5) return mix(vec3(0.95, 0.5, 0.15), vec3(0.7, 0.3, 0.08), step(0.5, fract(q.x * 6.0)));
    if (m < 104.5) return mix(vec3(0.3, 0.35, 0.85), vec3(0.45, 0.55, 1.0), step(0.5, fract((q.x + q.y) * 9.0)));
    if (m < 105.5) return vec3(1.0, 0.85, 0.15);
    return vec3(1.0, 0.45, 0.1);
  }
  if (m < 0.0) { // заглушки: средний цвет уровня
    if (m > -1.5) return vec3(0.55, 0.53, 0.5);
    if (m > -2.5) return vec3(0.3, 0.48, 0.16);
    if (m > -3.5) return seedCol(seed, 5, vec3(0.92, 0.88, 0.8), vec3(0.95, 0.85, 0.55), vec3(0.7, 0.8, 0.9), vec3(0.95, 0.75, 0.75));
    return seedCol(seed, 6, vec3(0.75, 0.25, 0.15), vec3(0.45, 0.3, 0.2), vec3(0.3, 0.5, 0.35), vec3(0.35, 0.4, 0.5));
  }
  float h = tx(tp * 6.0);
  if (type == 0) {
    if (m < 1.5) { // трава, тропинка, цветы
      float path = abs(q.z - (2.6 * sin(q.x * 0.21) - 1.0));
      vec3 g = mix(vec3(0.3, 0.5, 0.17), vec3(0.47, 0.62, 0.22), vnoise(q.xz * 0.35)) * (0.88 + 0.22 * tx(q.xz * 5.0));
      if (path < 0.6 + 0.15 * tx(q.xz * 4.0)) g = vec3(0.62, 0.5, 0.33) * (0.9 + 0.15 * h);
      float fl = hash12(floor(q.xz * 5.0) + 3.0);
      if (fl > 0.975) g = fl > 0.99 ? vec3(0.95, 0.95, 0.9) : fl > 0.982 ? vec3(1.0, 0.85, 0.25) : vec3(0.55, 0.6, 1.0);
      return g;
    }
    if (m < 2.5) return vec3(0.4, 0.27, 0.16) * (0.85 + 0.25 * h);
    if (m < 3.5) {
      float c = hash12(floor(q.xz / 7.0 + 0.5));
      return mix(vec3(0.2, 0.42, 0.14), vec3(0.42, 0.55, 0.15), c) * (0.85 + 0.25 * tx(q.xy * 3.0 + q.z));
    }
    if (m < 4.5) return vec3(0.55, 0.4, 0.25) * (0.85 + 0.2 * h);
    return mix(vec3(0.85, 0.7, 0.35), vec3(0.7, 0.55, 0.25), step(0.5, fract(q.y * 5.0 + 0.3 * h)));
  }
  if (type == 1) {
    if (m < 1.5) { // гранит: крапинки, лишайник, трещины
      vec3 base = mix(vec3(0.56, 0.55, 0.53), vec3(0.62, 0.55, 0.47), rnd(seed, 7));
      vec3 c = base * (0.82 + 0.3 * tx(tp * 7.0));
      if (tx(tp * 9.0 + 0.5) > 0.9) c *= 0.6;
      float l = vnoise(q.xz * 1.5 + float(seed & 63u)) * vnoise(q.xz * 0.4 + 3.0);
      if (l > 0.42 && n.y > -0.2) c = mix(vec3(0.8, 0.66, 0.36), vec3(0.62, 0.7, 0.48), rnd(seed, 8)) * (0.85 + 0.25 * tx(q.xz * 8.0));
      if (abs(vnoise(q.xz * 0.3 + 9.0) - 0.5) < 0.01) c *= 0.6;
      return c;
    }
    if (m < 2.5) return vec3(0.42, 0.42, 0.44) * (0.85 + 0.25 * h);
    if (m < 3.5) { // раковина: спираль полосками
      vec3 s = q - vec3(-0.2, 6.42, 4.2);
      return mix(vec3(0.55, 0.35, 0.18), vec3(0.85, 0.65, 0.4), step(0.5, fract(length(s) * 7.0 + atan(s.y, s.x) * 0.32)));
    }
    return vec3(0.7, 0.65, 0.55);
  }
  if (type == 2) {
    if (m < 1.5) { // мох; под домиками — утоптанная земля
      vec3 g = mix(vec3(0.17, 0.33, 0.1), vec3(0.42, 0.6, 0.18), vnoise(q.xz * 1.6 + float(seed & 255u)));
      g = mix(g, g.gbr * vec3(1.1, 1.0, 0.7), rnd(seed, 9) * 0.35);
      g *= 0.85 + 0.3 * tx(q.xz * 9.0);
      float dmin = min(min(distance(q.xz, HS[0]), distance(q.xz, HS[1])), distance(q.xz, HS[2]));
      if (dmin < 1.05 + 0.15 * tx(q.xz * 8.0)) g = vec3(0.55, 0.42, 0.28) * (0.9 + 0.15 * h);
      return g;
    }
    if (m < 2.5) return vec3(0.55, 0.32, 0.15);
    if (m < 3.5) return vec3(0.8, 0.5, 0.18);
    if (m < 4.5) return vec3(0.92, 0.88, 0.78);
    if (m < 5.5) { // шляпка мухомора с крапинками
      vec2 c = fract(q.xz * 2.2) - 0.5;
      return dot(c, c) < 0.05 && hash12(floor(q.xz * 2.2)) > 0.35 ? vec3(0.97, 0.95, 0.9) : vec3(0.85, 0.12, 0.08);
    }
    return vec3(0.75, 0.9, 1.0);
  }
  // домик (зеркальный по seed — как в gHouse)
  if ((seed & 1u) == 1u) q.x = -q.x;
  bool inside = abs(q.x) < 5.66 && abs(q.z) < 4.16 && q.y > 0.45;
  if (m < 1.5) { // фундамент / пол
    if (inside && n.y > 0.7) {
      float b = floor(q.z * 1.6);
      float plank = tx(vec2(b, floor(q.x * 0.6 + hash11(b) * 3.0)));
      return mix(vec3(0.45, 0.28, 0.15), vec3(0.62, 0.42, 0.24), plank) * (0.9 + 0.12 * tx(vec2(b, q.x * 12.0)));
    }
    vec2 s = tp * vec2(2.0, 3.0);
    s.x += 0.5 * mod(floor(s.y), 2.0);
    return fract(s).y < 0.12 || fract(s).x < 0.06 ? vec3(0.5, 0.48, 0.45) : vec3(0.62, 0.6, 0.56) * (0.85 + 0.25 * tx(s));
  }
  if (m < 3.5) { // стены: снаружи штукатурка, внутри обои, сверху брус
    if (n.y > 0.7) return vec3(0.45, 0.3, 0.18);
    vec3 plaster = seedCol(seed, 5, vec3(0.92, 0.88, 0.8), vec3(0.95, 0.85, 0.55), vec3(0.7, 0.8, 0.9), vec3(0.95, 0.75, 0.75));
    bool inner = abs(q.x) < 5.66 && abs(q.z) < 4.16;
    if (!inner) return plaster * (0.92 + 0.1 * h);
    if (q.y < 1.6) return vec3(0.42, 0.27, 0.15) * (0.9 + 0.15 * h);
    vec3 wp = seedCol(seed, 11, vec3(0.55, 0.7, 0.5), vec3(0.85, 0.6, 0.6), vec3(0.6, 0.7, 0.9), vec3(0.95, 0.85, 0.55));
    float along = abs(n.x) > 0.5 ? q.z : q.x;
    return mix(wp, wp * 0.78, step(0.5, fract(along * 2.5))) * (0.95 + 0.08 * h);
  }
  if (m < 4.5) { // черепица рядами
    vec3 rc = seedCol(seed, 6, vec3(0.75, 0.25, 0.15), vec3(0.45, 0.3, 0.2), vec3(0.3, 0.5, 0.35), vec3(0.35, 0.4, 0.5));
    float row = floor(q.y * 2.2);
    float col = floor(q.x * 1.6 + 0.5 * mod(row, 2.0));
    return rc * (0.75 + 0.35 * tx(vec2(row, col))) * (fract(q.y * 2.2) < 0.15 ? 0.7 : 1.0);
  }
  if (m < 5.5) return vec3(0.55, 0.36, 0.2) * (0.85 + 0.25 * tx(tp * vec2(1.0, 8.0)));
  if (m < 6.5) { // лоскутное одеяло
    vec3 qc = seedCol(seed, 12, vec3(0.8, 0.3, 0.3), vec3(0.3, 0.5, 0.8), vec3(0.4, 0.65, 0.4), vec3(0.9, 0.7, 0.3));
    float c = tx(q.xz * 1.8);
    return mix(qc, vec3(0.95, 0.9, 0.8), step(0.5, c)) * (0.9 + 0.1 * tx(q.xz * 9.0));
  }
  if (m < 7.5) return vec3(0.95, 0.94, 0.9);
  if (m < 8.5) { // круглый коврик кольцами
    float r = length(q.xz - vec2(0.9, 0.5));
    return mod(floor(r * 3.0), 2.0) < 1.0 ? vec3(0.75, 0.25, 0.2) : vec3(0.9, 0.75, 0.4);
  }
  if (m < 9.5) return vec3(0.22, 0.22, 0.24) * (0.85 + 0.25 * h);
  if (m < 10.5) return vec3(1.0, 0.55, 0.15);
  if (m < 11.5) return vec3(0.75, 0.38, 0.22) * (0.9 + 0.15 * h);
  if (m < 12.5) return vec3(0.25, 0.17, 0.1);
  if (m < 13.5) return vec3(0.6, 0.28, 0.2) * (fract(q.y * 3.0) < 0.15 ? 0.7 : 1.0);
  if (m < 14.5) return vec3(0.4, 0.24, 0.13) * (0.85 + 0.25 * tx(vec2(q.x * 6.0, 0.0)));
  if (m < 15.5) return fract(q.y * 0.9 + 0.2) > 0.5 ? vec3(0.55, 0.72, 0.92) : vec3(0.35, 0.58, 0.3);
  return mix(vec3(0.85, 0.4, 0.3), vec3(0.4, 0.6, 0.9), step(0.0, q.z + 1.3)) * (q.y > 4.12 ? 0.6 : 1.0);
}

vec3 sky(vec3 rd) {
  vec3 c = mix(vec3(0.98, 0.86, 0.68), vec3(0.45, 0.66, 0.92), smoothstep(-0.05, 0.6, rd.y));
  float s = max(dot(rd, uSun), 0.0);
  return c + vec3(1.0, 0.85, 0.6) * (pow(s, 400.0) * 3.0 + pow(s, 8.0) * 0.25);
}

float softShadow(vec3 ro, vec3 rd, float sc) {
  float res = 1.0, t = 0.04 * sc;
  for (int i = 0; i < 18; i++) {
    map(ro + rd * t);
    res = min(res, 9.0 * gGeo / t);
    t += clamp(gD, 0.06 * sc, 1.5 * sc);
    if (res < 0.02 || t > 9.0 * sc) break;
  }
  return clamp(res, 0.0, 1.0);
}

void main() {
  gDither = (bayer4(gl_FragCoord.xy) + 0.5 / 16.0);
  vec3 ro = uEye;
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uTarget, FOV);
  float pixAng = 2.0 / (min(uResolution.x, uResolution.y) / tan(radians(FOV) * 0.5));
  float tmax = uViewD * 30.0;

  float t;
  bool hit = marchRay(ro, rd, pixAng, uNear, tmax, 160, t);
  vec3 col;
  if (hit) {
    vec3 p = ro + rd * t;
    float foot = gFoot;
    map(p);
    float m = gMat, sc = gSc, ang = gAng;
    int type = gType;
    uint seed = gSeed;
    vec3 q = gQ;
    float e = max(foot * 0.5, 1e-5 * sc);
    const vec2 k = vec2(1.0, -1.0);
    vec3 n = normalize(k.xyy * mapGeo(p + k.xyy * e) + k.yyx * mapGeo(p + k.yyx * e) + k.yxy * mapGeo(p + k.yxy * e) + k.xxx * mapGeo(p + k.xxx * e));
    vec3 nl = rotY(n, ang);
    vec3 alb = albedo(type, m, q, nl, seed);
    vec2 gp = abs(nl.y) > 0.6 ? q.xz : abs(nl.x) > 0.6 ? q.zy : q.xy;
    alb = lin(alb * (0.9 + 0.2 * grain(gp, foot / sc)));
    // AO по масштабу узла попадания
    float ao = 0.0;
    for (int i = 1; i <= 3; i++) {
      float hh = sc * 0.18 * float(i);
      ao += (hh - mapGeo(p + n * hh)) / hh;
    }
    ao = clamp(1.0 - ao * 0.22, 0.25, 1.0);
    float dif = max(dot(n, uSun), 0.0);
    float sh = dif > 0.0 ? softShadow(p + n * max(foot, 0.01 * sc), uSun, sc) : 0.0;
    col = alb * vec3(1.0, 0.88, 0.7) * 2.4 * dif * sh;
    col += alb * vec3(0.42, 0.52, 0.7) * 0.6 * (0.6 + 0.4 * n.y) * ao;
    col += alb * vec3(0.4, 0.32, 0.2) * 0.25 * (0.5 - 0.5 * n.y) * ao;
    if (m > 9.5 && m < 10.5 && type == 3) col = alb * (2.0 + 0.6 * hash12(floor(q.xy * 8.0)));
    if (m > 5.5 && m < 6.5 && type == 2) col += vec3(0.25, 0.3, 0.35) * pow(max(dot(reflect(rd, n), uSun), 0.0), 20.0) * 3.0;
    if (m >= 100.0) col += alb * uGlow * (0.6 + 0.4 * sin(float(uFrame) * 0.3));
    // дымка: относительно расстояния до центра обзора (масштабно-инвариантно)
    float fog = 1.0 - exp(-max(t - 2.5 * uViewD, 0.0) / (8.0 * uViewD));
    col = mix(col, lin(sky(normalize(rd * vec3(1.0, 0.3, 1.0)))), fog);
  } else {
    col = lin(sky(rd));
  }
  col = col / (1.0 + col * 0.35);
  fragColor = vec4(sqrt(col), 1.0);
}
