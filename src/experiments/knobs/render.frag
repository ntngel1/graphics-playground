// «Глиняный» рендер: матовый мир, мягкие тени, AO; части, которые двигает ручка, подкрашены её цветом;
// шарик с коротким следом, цель — кольцо-маяк с лучом.
#include "world.glsl"
#include <camera>
#include <lighting>
#include <palette>

uniform sampler2D uBall;
uniform vec3 uGoal;
uniform float uGoalR;
uniform float uWinPulse;   // 0..1 после победы
uniform float uHighlight;

const float R = 0.12;
const vec3 COL_A = vec3(1.0, 0.55, 0.2), COL_B = vec3(0.25, 0.55, 1.0);

vec4 ballT(int i) { return texelFetch(uBall, ivec2(i, 0), 0); }

// x — расстояние, y — материал: 0 мир, 1 шарик, 2 след, 3 кольцо цели
vec2 scene(vec3 p) {
  vec2 r = vec2(map(p), 0.0);
  vec4 b = ballT(0);
  float db = length(p - b.xyz) - R;
  if (db < r.x) r = vec2(db, 1.0);
  if (b.w > 0.5) for (int i = 3; i < 8; i++) {
    vec4 t = ballT(i);
    if (t.w < 0.5) continue;
    float dt = length(p - t.xyz) - R * (0.75 - 0.1 * float(i - 3));
    if (dt < r.x) r = vec2(dt, 2.0 + float(i - 3) * 0.1);
  }
  vec3 q = p - uGoal;
  float ring = length(vec2(length(q.xz) - uGoalR * 0.9, q.y + 0.02)) - 0.03;
  if (ring < r.x) r = vec2(ring, 3.0);
  return r;
}
float sdist(vec3 p) { return scene(p).x; }

vec3 nrm(vec3 p) {
  const vec2 e = vec2(0.001, -0.001);
  return normalize(e.xyy * sdist(p + e.xyy) + e.yyx * sdist(p + e.yyx) + e.yxy * sdist(p + e.yxy) + e.xxx * sdist(p + e.xxx));
}

float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 64; i++) {
    float h = sdist(ro + rd * t);
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.01, 0.3);
    if (res < 0.002 || t > 8.0) break;
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

float ao(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.02 + 0.1 * float(i);
    o += (h - sdist(p + n * h)) * s;
    s *= 0.8;
  }
  return clamp(1.0 - 2.0 * o, 0.0, 1.0);
}

void main() {
  vec3 ro = uCamPos;
  // уровни вытянуты по x: на портретном экране шире угол, чтобы старт и цель помещались
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uCamTarget, uResolution.x < uResolution.y ? 64.0 : 40.0);
  vec3 sun = normalize(vec3(-0.45, 0.85, 0.5));
  vec3 bgTop = vec3(0.86, 0.84, 0.80), bgBot = vec3(0.62, 0.66, 0.72);
  vec3 bg = mix(bgBot, bgTop, smoothstep(-0.6, 0.6, rd.y));
  vec3 col = pow(bg, vec3(2.2));

  float t = 0.0;
  vec2 h = vec2(1e5, -1.0);
  for (int i = 0; i < 160; i++) {
    h = scene(ro + rd * t);
    if (h.x < 0.0008 * max(t, 1.0) || t > 30.0) break;
    t += h.x;
  }

  if (t < 30.0) {
    vec3 p = ro + rd * t;
    vec3 n = nrm(p);
    float sh = shadow(p + n * 0.003, sun);
    float occ = ao(p, n);
    vec3 alb;
    float spec = 0.0;
    if (h.y < 0.5) {
      alb = vec3(0.80, 0.76, 0.70);
      // что двигает каждая ручка: насколько меняется поле при её сдвиге
      float dA = abs(levelMap(p, uKnobs) - levelMap(p, uKnobs + vec2(0.06, 0.0)));
      float dB = abs(levelMap(p, uKnobs) - levelMap(p, uKnobs + vec2(0.0, 0.06)));
      alb = mix(alb, COL_A * 0.9, smoothstep(0.002, 0.03, dA) * 0.55 * uHighlight);
      alb = mix(alb, COL_B * 0.9, smoothstep(0.002, 0.03, dB) * 0.55 * uHighlight);
    } else if (h.y < 1.5) {
      alb = vec3(0.85, 0.12, 0.10);
      spec = 0.6;
    } else if (h.y < 2.9) {
      alb = mix(vec3(0.85, 0.12, 0.10), vec3(0.95, 0.8, 0.75), (h.y - 2.0) * 2.0);
    } else {
      alb = mix(vec3(0.1, 0.75, 0.55), vec3(1.0), uWinPulse);
    }
    alb = pow(alb, vec3(2.2));
    float ndl = max(dot(n, sun), 0.0);
    col = alb * vec3(1.0, 0.95, 0.88) * 2.6 * ndl * sh;
    col += alb * pow(bg, vec3(2.2)) * (0.55 + 0.45 * n.y) * occ * 0.9;
    col += spec * vec3(1.0) * pow(max(dot(reflect(rd, n), sun), 0.0), 40.0) * sh;
    if (h.y > 2.9) col += vec3(0.1, 0.9, 0.6) * (0.6 + 2.0 * uWinPulse);
    col = mix(col, pow(bg, vec3(2.2)), smoothstep(10.0, 22.0, t));
  }

  // луч-маяк над целью (аддитивно, по расстоянию луча камеры до вертикальной оси цели)
  vec3 oc = ro - uGoal;
  vec2 d2 = rd.xz;
  float tb = -dot(oc.xz, d2) / max(dot(d2, d2), 1e-5);
  vec3 pb = ro + rd * max(tb, 0.0);
  float rb = length(pb.xz - uGoal.xz);
  float above = pb.y - uGoal.y;
  if (tb > 0.0 && (t > 29.0 || tb < t) && above > 0.0) {
    float beam = exp(-rb * rb / 0.004) * exp(-above * 0.6) * (0.35 + 1.5 * uWinPulse);
    col += vec3(0.2, 1.0, 0.7) * beam;
  }

  vec3 o = gamma(tonemapACES(col));
  o *= 1.0 - 0.2 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
  fragColor = vec4(o, 1.0);
}
