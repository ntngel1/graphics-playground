// Отрисовка мира: чёткие клетки (NEAREST), оттенок зерна, глубина и поверхность воды, полупрозрачные
// газы, свечение (bloom) и подсветка соседних материалов, тонмаппинг.
#include "look.glsl"
#include <palette>

uniform sampler2D uGlow;
uniform float uGlowStrength;
uniform float uBrush;
uniform int uMaterial;
uniform bool uShowCursor;

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  vec2 cp = vUv * uStateSize;
  ivec2 ip = ivec2(cp);
  vec2 f = fract(cp);
  Cell c = loadCell(ip);
  float s = shadeF(c);
  float t = uTime;

  // фон: тёмный градиент
  vec3 bg = lin(mix(vec3(0.02, 0.025, 0.04), vec3(0.06, 0.07, 0.11), vUv.y));
  vec3 col = bg;
  float lit = 0.0; // насколько материал подсвечивается чужим светом

  if (c.m == WALL) {
    col = lin(vec3(0.20, 0.20, 0.23) * (0.8 + 0.4 * s));
    col *= 0.85 + 0.15 * step(0.15, f.y) * step(f.x, 0.85); // фаска клетки
    lit = 0.6;
  } else if (c.m == SAND) {
    col = lin(mix(vec3(0.85, 0.66, 0.36), vec3(0.98, 0.84, 0.52), s));
    col *= 0.88 + 0.12 * f.y;
    lit = 1.0;
  } else if (c.m == STONE) {
    col = lin(mix(vec3(0.28, 0.27, 0.30), vec3(0.42, 0.40, 0.44), s)) * (0.85 + 0.15 * f.y);
    lit = 0.8;
  } else if (c.m == POWDER) {
    col = lin(mix(vec3(0.16, 0.15, 0.15), vec3(0.32, 0.28, 0.26), s * s)) * (0.85 + 0.15 * f.y);
    lit = 0.8;
  } else if (c.m == WATER || c.m == OIL || c.m == ACID) {
    // глубина: сколько клеток той же жидкости сверху
    int depth = 0;
    for (int k = 1; k <= 8; k++) { if (loadCell(ip + ivec2(0, k)).m != c.m) break; depth = k; }
    float d = float(depth) / 8.0;
    bool surface = depth == 0;
    if (c.m == WATER) col = lin(mix(vec3(0.25, 0.62, 0.95), vec3(0.04, 0.16, 0.42), d)) * (0.95 + 0.1 * s);
    if (c.m == OIL) col = lin(mix(vec3(0.55, 0.32, 0.06), vec3(0.22, 0.10, 0.02), d)) * (0.95 + 0.1 * s);
    if (c.m == ACID) col = lin(mix(vec3(0.6, 1.0, 0.25), vec3(0.15, 0.55, 0.08), d));
    if (surface) col += lin(vec3(0.55, 0.75, 0.9)) * 0.35 * smoothstep(0.5, 1.0, f.y) * (0.7 + 0.3 * sin(t * 2.0 + float(ip.x) * 0.7));
    lit = 0.7;
  } else if (c.m == LAVA) {
    // корка и раскалённые прожилки: тёмно-красные зёрна среди оранжевых, медленно «дышат»
    float hot = 0.5 + 0.5 * sin(t * 1.5 + s * 12.0 + float(c.life) * 0.05);
    col = lin(mix(vec3(0.35, 0.04, 0.01), vec3(1.0, 0.42, 0.06), smoothstep(0.15, 0.85, s * 0.6 + hot * 0.4)));
  } else if (c.m == FIRE) {
    float k = clamp(float(c.life) / 45.0, 0.0, 1.0);
    col = lin(mix(vec3(0.85, 0.2, 0.03), vec3(1.0, 0.9, 0.5), k));
  } else if (c.m == SMOKE) {
    float a = clamp(float(c.life) / 60.0, 0.0, 1.0) * 0.55;
    col = mix(bg, lin(vec3(0.32, 0.30, 0.30) * (0.8 + 0.4 * s)), a);
    lit = 0.3;
  } else if (c.m == STEAM) {
    float a = clamp(float(c.life) / 120.0, 0.0, 1.0) * 0.5;
    col = mix(bg, lin(vec3(0.8, 0.85, 0.9)), a);
    lit = 0.3;
  } else if (c.m == PLANT) {
    col = lin(mix(vec3(0.10, 0.42, 0.12), vec3(0.35, 0.78, 0.22), s)) * (0.85 + 0.15 * f.y);
    lit = 1.0;
  } else if (c.m == TAP) {
    int em = (c.flags >> 1) & 15;
    col = lin(vec3(0.45, 0.5, 0.58)) * (0.8 + 0.2 * f.y);
    float ring = smoothstep(0.35, 0.25, length(f - 0.5));
    col = mix(col, lin(em == LAVA ? vec3(1.0, 0.4, 0.1) : em == WATER ? vec3(0.3, 0.6, 1.0) : em == ACID ? vec3(0.5, 1.0, 0.2) : em == OIL ? vec3(0.5, 0.3, 0.05) : vec3(0.9, 0.75, 0.45)), ring);
  }

  vec3 glow = texture(uGlow, vUv).rgb;
  col += emission(c, t) * 0.35; // сам светящийся материал не пересвечиваем — ореол даёт bloom
  col += col * glow * 2.5 * lit;          // соседи освещены огнём/лавой
  col += glow * uGlowStrength * 0.6;      // ореол (bloom)
  col = gamma(tonemapACES(col * 1.1));

  // контур кисти под курсором (только мышь; на тач-устройстве курсора нет)
  float dm = length(cp - uMouse.xy / uResolution * uStateSize);
  float ring = smoothstep(1.2, 0.0, abs(dm - uBrush) * uResolution.y / uStateSize.y);
  if (uShowCursor) col = mix(col, vec3(1.0), ring * 0.25 * (1.0 - uMouse.z));
  fragColor = vec4(col, 1.0);
}
