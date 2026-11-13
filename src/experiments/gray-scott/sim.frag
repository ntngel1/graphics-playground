// Шаг Грея-Скотта: R = U, G = V. Лапласиан 9-точечный (веса Карла Симса: 0.2 / 0.05 / -1),
// wrap repeat задаётся буфером. Кисть рисует отрезок uMousePrev → uMouse.
uniform sampler2D uState;
uniform vec2 uStateSize;
uniform float uFeed;
uniform float uKill;
uniform float uDu;
uniform float uDv;
uniform float uDt;
uniform float uBrushSize;     // доля высоты
uniform float uBrushStrength;
uniform bool uEraser;
uniform bool uMapMode;        // feed/kill по осям: kill — X, feed — Y
uniform vec2 uMapKill;        // диапазоны карты (из sim.ts)
uniform vec2 uMapFeed;

float segDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main() {
  vec2 tx = 1.0 / uStateSize;
  vec2 uv = gl_FragCoord.xy * tx;
  #define S(dx, dy) texture(uState, uv + vec2(dx, dy) * tx).rg
  vec2 c = S(0, 0);
  vec2 lap = -c
    + 0.20 * (S(1, 0) + S(-1, 0) + S(0, 1) + S(0, -1))
    + 0.05 * (S(1, 1) + S(-1, 1) + S(1, -1) + S(-1, -1));
  #undef S

  float F = uFeed, K = uKill;
  if (uMapMode) {
    K = mix(uMapKill.x, uMapKill.y, uv.x);
    F = mix(uMapFeed.x, uMapFeed.y, uv.y);
  }
  float u = c.x, v = c.y, uvv = u * v * v;
  u += uDt * (uDu * lap.x - uvv + F * (1.0 - u));
  v += uDt * (uDv * lap.y + uvv - (F + K) * v);

  if (uMouse.z > 0.5 && !uMapMode) {
    float r = max(uBrushSize * uResolution.y, 1.0);
    float m = (1.0 - smoothstep(r * 0.5, r, segDist(gl_FragCoord.xy, uMousePrev.xy, uMouse.xy))) * uBrushStrength;
    if (uEraser || uMouse.w > 0.5) { u = mix(u, 1.0, m); v = mix(v, 0.0, m); }
    else { u = mix(u, 0.5, m); v = mix(v, 0.25, m); }
  }
  fragColor = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}
