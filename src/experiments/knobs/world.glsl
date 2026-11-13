// Мир текущего уровня: map(p) = levelN(p, knobs). Новый уровень — файл levels/lN.glsl с функцией
// levelN(vec3 p, vec2 knob) (knob ∈ [0,1]²), строка #include ниже и ветка в levelMap, запись в levels.ts.
#include "parts.glsl"
#include "levels/l1.glsl"
#include "levels/l2.glsl"
#include "levels/l3.glsl"

uniform int uLevel;
uniform vec2 uKnobs;   // фактические значения ручек (плавно догоняют ползунки)

float levelMap(vec3 p, vec2 k) {
  if (uLevel == 0) return level1(p, k);
  if (uLevel == 1) return level2(p, k);
  return level3(p, k);
}
float map(vec3 p) { return levelMap(p, uKnobs); }

vec3 worldNormal(vec3 p) {
  const vec2 e = vec2(0.002, -0.002);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
