// Шаг Грея-Скотта: R = 1 − U, G = V (U хранится как дефицит: мелкие приращения около U≈1
// остаются около нуля, где у half float точность выше — на rgba16f узоры не «застывают»). Лапласиан 9-точечный (веса Карла Симса: 0.2 / 0.05 / -1).
// Края: wrap repeat буфера; в режиме карты — clamp (соседи зажимаются), чтобы не было швов.
// Кисть — отрезок prev → cur с учётом периодичности (через шов рисуется коротким путём).
// Источник кисти: экран (uMouse/uMousePrev) или 1×1 текстура uPick: rg — uv сейчас, ba — uv
// на прошлом кадре, x < 0 — нет попадания.
#include "map.glsl"

uniform sampler2D uState;
uniform vec2 uStateSize;
uniform float uFeed;
uniform float uKill;
uniform float uDu;
uniform float uDv;
uniform float uDt;
uniform float uBrushSize;     // доля высоты буфера
uniform float uBrushStrength;
uniform bool uEraser;
uniform bool uMapMode;
uniform bool uBrushPick;
uniform sampler2D uPick;

// расстояние в px до отрезка A→B на торе размера sz (отрезок короче половины периода)
float segDistWrapped(vec2 p, vec2 a, vec2 b, vec2 sz) {
  vec2 ba = b - a;
  ba -= sz * round(ba / sz);
  vec2 pa = p - a;
  pa -= sz * round((pa - 0.5 * ba) / sz);
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 tx = 1.0 / uStateSize;
  vec2 uv = gl_FragCoord.xy * tx;
  vec2 lo = 0.5 * tx, hi = 1.0 - 0.5 * tx;
  #define S(dx, dy) texture(uState, uMapMode ? clamp(uv + vec2(dx, dy) * tx, lo, hi) : uv + vec2(dx, dy) * tx).rg
  vec2 c = S(0, 0);
  vec2 lap = -c
    + 0.20 * (S(1, 0) + S(-1, 0) + S(0, 1) + S(0, -1))
    + 0.05 * (S(1, 1) + S(-1, 1) + S(1, -1) + S(-1, -1));
  #undef S

  float F = uFeed, K = uKill;
  if (uMapMode) {
    vec2 fk = mapToFK(uv);
    F = fk.x;
    K = fk.y;
  }
  float u = 1.0 - c.x, v = c.y, uvv = u * v * v;
  u += uDt * (-uDu * lap.x - uvv + F * (1.0 - u)); // лапласиан (1 − U) = −лапласиан U
  v += uDt * (uDv * lap.y + uvv - (F + K) * v);

  bool draw = uMouse.z > 0.5 && !uMapMode;
  vec2 a = uMousePrev.xy, b = uMouse.xy;
  if (uBrushPick) {
    vec4 pk = texture(uPick, vec2(0.5));
    draw = draw && pk.x >= 0.0;
    b = pk.xy * uStateSize;
    a = (pk.z >= 0.0 ? pk.zw : pk.xy) * uStateSize;
  }
  if (draw) {
    float r = max(uBrushSize * uResolution.y, 1.0);
    float m = (1.0 - smoothstep(r * 0.5, r, segDistWrapped(gl_FragCoord.xy, a, b, uStateSize))) * uBrushStrength;
    if (uEraser || uMouse.w > 0.5) { u = mix(u, 1.0, m); v = mix(v, 0.0, m); }
    else { u = mix(u, 0.5, m); v = mix(v, 0.25, m); }
  }
  fragColor = vec4(clamp(1.0 - u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}
