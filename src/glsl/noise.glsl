// Хэши (целочисленный PCG, без sin — одинаково на всех GPU), value/gradient noise 2D/3D, fbm, voronoi.
// Все hash* → [0,1). vnoise → [0,1], gnoise → ~[-1,1], fbm → ~[-1,1].

uvec2 pcg2d(uvec2 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v;
}

uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}

const float U2F = 1.0 / 4294967296.0;
// floatBitsToUint: работает и для целых координат решётки, и для произвольных float.
float hash11(float p) { return float(pcg2d(uvec2(floatBitsToUint(p), 0x9e3779b9u)).x) * U2F; }
float hash12(vec2 p)  { return float(pcg2d(floatBitsToUint(p)).x) * U2F; }
vec2  hash22(vec2 p)  { return vec2(pcg2d(floatBitsToUint(p))) * U2F; }
float hash13(vec3 p)  { return float(pcg3d(floatBitsToUint(p)).x) * U2F; }
vec3  hash33(vec3 p)  { return vec3(pcg3d(floatBitsToUint(p))) * U2F; }

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x),
                 mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x),
                 mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}

float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G2(o) dot(hash22(i + o) * 2.0 - 1.0, f - o)
  float r = mix(mix(G2(vec2(0, 0)), G2(vec2(1, 0)), u.x),
                mix(G2(vec2(0, 1)), G2(vec2(1, 1)), u.x), u.y);
  #undef G2
  return r * 1.4;
}

float gnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  #define G3(o) dot(hash33(i + o) * 2.0 - 1.0, f - o)
  float r = mix(mix(mix(G3(vec3(0, 0, 0)), G3(vec3(1, 0, 0)), u.x),
                    mix(G3(vec3(0, 1, 0)), G3(vec3(1, 1, 0)), u.x), u.y),
                mix(mix(G3(vec3(0, 0, 1)), G3(vec3(1, 0, 1)), u.x),
                    mix(G3(vec3(0, 1, 1)), G3(vec3(1, 1, 1)), u.x), u.y), u.z);
  #undef G3
  return r * 1.2;
}

float fbm(vec2 p, int octaves) {
  float s = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < octaves; i++) { s += a * gnoise(p); p = m * p; a *= 0.5; }
  return s;
}

float fbm(vec3 p, int octaves) {
  float s = 0.0, a = 0.5;
  mat3 m = mat3(0.00, 1.60, 1.20, -1.60, 0.72, -0.96, -1.20, -0.96, 1.28);
  for (int i = 0; i < octaves; i++) { s += a * gnoise(p); p = m * p; a *= 0.5; }
  return s;
}

// Клеточный шум: x — расстояние до ближайшей точки (F1), y — до второй (F2), z — id ближайшей ячейки [0,1).
vec3 voronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 o = hash22(i + g);
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; id = hash12(i + g + 17.0); }
    else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
