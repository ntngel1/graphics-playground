// Излучение в буфер пониженного разрешения (дальше — размытие → bloom и подсветка).
// Усредняем клетки под текселем — без этого NEAREST-выборка даёт полосы в свечении.
#include "look.glsl"

void main() {
  vec2 cellsPerTexel = uStateSize / uResolution;
  vec2 base = vUv * uStateSize - 0.5 * cellsPerTexel;
  vec3 e = vec3(0.0);
  for (int y = 0; y < 3; y++)
    for (int x = 0; x < 3; x++)
      e += emission(loadCell(ivec2(base + (vec2(x, y) + 0.5) / 3.0 * cellsPerTexel)), uTime);
  fragColor = vec4(e / 9.0, 1.0);
}
