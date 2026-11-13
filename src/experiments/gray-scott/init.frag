// Начальное состояние: U = 1, V = 0 и затравки (U = 0.5, V = 0.25). Хранится R = 1 − U, G = V.
// uClear = 1 — без затравок; в режиме карты — мелкая равномерная «крупа», чтобы проросли все области.
#include <noise>

uniform float uSeed;
uniform float uClear;
uniform bool uMapMode;

void main() {
  vec2 px = gl_FragCoord.xy;
  float u = 1.0, v = 0.0;
  if (uClear < 0.5) {
    bool seed = false;
    if (uMapMode) {
      seed = hash12(floor(px / 4.0) + uSeed * 1000.0) > 0.92;
    } else {
      for (int i = 0; i < 14; i++) {
        vec3 h = hash33(vec3(float(i), uSeed * 1000.0, 7.0));
        vec2 c = h.xy * uResolution;
        float r = (0.015 + 0.035 * h.z) * uResolution.y;
        vec2 d = abs(px - c);
        seed = seed || (i % 2 == 0 ? max(d.x, d.y) < r : length(d) < r);
      }
    }
    if (seed) { u = 0.5; v = 0.25 + 0.05 * hash12(px); }
  }
  fragColor = vec4(1.0 - u, v, 0.0, 1.0);
}
