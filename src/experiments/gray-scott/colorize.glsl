// Палитры отображения V (общие для gray-scott и living-surface). Цвета в display-пространстве (≈sRGB).
// pal: 0 ink, 1 sunset, 2 ocean, 3 rainbow, 4 heat, 5 neon, 6 flesh — порядок как в PALETTES (sim.ts).
#include <palette>

vec3 gsColor(float v, int pal) {
  float t = smoothstep(0.02, 0.4, v);
  if (pal == 0) return mix(vec3(0.94, 0.92, 0.87), vec3(0.06, 0.06, 0.09), smoothstep(0.12, 0.3, v));
  if (pal == 1) return palSunset(t);
  if (pal == 2) return palOcean(t);
  if (pal == 3) return palRainbow(0.7 * t + 0.6) * smoothstep(0.0, 0.3, t);
  if (pal == 4) return palHeat(t) * smoothstep(0.0, 0.15, t);
  if (pal == 5) return vec3(0.1, 0.9, 1.0) * pow(t, 1.5) * 1.4 + vec3(1.0, 0.2, 0.7) * smoothstep(0.6, 1.0, t) * 0.5;
  // flesh: тёмно-бордовая основа → розовая ткань → светлые влажные гребни
  vec3 c = mix(vec3(0.16, 0.02, 0.04), vec3(0.78, 0.22, 0.26), smoothstep(0.04, 0.24, v));
  return mix(c, vec3(1.0, 0.78, 0.66), smoothstep(0.26, 0.42, v));
}
