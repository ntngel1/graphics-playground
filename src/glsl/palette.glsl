// Косинусные палитры IQ, готовые пресеты, тонмаппинг ACES и гамма.

vec3 palette(float t, vec3 a, vec3 b, vec3 c, vec3 d) { return a + b * cos(6.28318 * (c * t + d)); }

vec3 palRainbow(float t) { return palette(t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)); }
vec3 palSunset(float t)  { return palette(t, vec3(0.5), vec3(0.5), vec3(1.0, 1.0, 0.5), vec3(0.8, 0.9, 0.3)); }
vec3 palOcean(float t)   { return palette(t, vec3(0.5), vec3(0.5), vec3(1.0, 0.7, 0.4), vec3(0.0, 0.15, 0.2)); }
// тепловая карта 0..1: синий → голубой → зелёный → жёлтый → красный
vec3 palHeat(float t) {
  t = clamp(t, 0.0, 1.0);
  return clamp(vec3(1.5 - abs(4.0 * t - 3.0), 1.5 - abs(4.0 * t - 2.0), 1.5 - abs(4.0 * t - 1.0)), 0.0, 1.0);
}

// ACES (аппроксимация Narkowicz)
vec3 tonemapACES(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 gamma(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }
