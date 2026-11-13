// Внешний вид материалов (display-пространство, ≈sRGB) и излучение для свечения.
#include "cells.glsl"

float shadeF(Cell c) { return float(c.shade) / 255.0; }

// излучение (линейное), для bloom и подсветки соседей
vec3 emission(Cell c, float t) {
  float s = shadeF(c);
  if (c.m == LAVA) {
    float fl = 0.75 + 0.25 * sin(t * 3.0 + s * 20.0 + float(c.life) * 0.05);
    return vec3(1.0, 0.32, 0.05) * 2.2 * fl;
  }
  if (c.m == FIRE) {
    float k = clamp(float(c.life) / 45.0, 0.0, 1.0);
    return mix(vec3(0.9, 0.15, 0.02), vec3(1.0, 0.7, 0.3), k) * (0.9 + 1.2 * k);
  }
  if (c.m == ACID) return vec3(0.25, 1.0, 0.1) * 0.25;
  if (c.m == TAP) return vec3(0.4, 0.6, 1.0) * 0.15;
  return vec3(0.0);
}
