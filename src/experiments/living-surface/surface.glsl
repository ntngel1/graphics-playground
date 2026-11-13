// Поверхность, смещённая состоянием Грея-Скотта (V — высота). Общий код для прохода pick и рендера.
// Плотность текселей одинакова для всех форм: 1 / (2πR) по u и 1 / (2πr) по v, при буфере W×H с
// W/H = R/r узор не растянут (на торе — по средней линии трубки).
#include <sdf>

uniform sampler2D uState;
uniform vec2 uStateSize;
uniform int uShape;        // 0 torus, 1 plane, 2 sphere
uniform float uHeight;     // смещение на единицу V (знак: гребни / борозды)
uniform float uSpin;       // угол поворота формы вокруг Y (накапливается в index.ts)

const float TAU = 6.28318531;
const float R_MAJOR = 1.0;
const float R_MINOR = 0.4;  // = R_MAJOR * H / W для буфера 640×256
const float R_SPHERE = 1.0;
const float GROUND = -1.35;
const float FOV = 40.0;

bool gSmooth = false;      // бикубическое чтение высоты (для нормали/шейдинга, не для марша)

// B-сплайн по 4 билинейным выборкам (без ступенек текселей на крупном плане)
vec4 bspline(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) / 6.0;
}
vec2 stateSmooth(vec2 uv) {
  vec2 tc = uv * uStateSize - 0.5, f = fract(tc);
  tc -= f;
  vec4 xc = bspline(f.x), yc = bspline(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / uStateSize.xxyy;
  vec2 s0 = texture(uState, o.xz).rg, s1 = texture(uState, o.yz).rg;
  vec2 s2 = texture(uState, o.xw).rg, s3 = texture(uState, o.yw).rg;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
vec2 stateAt(vec2 uv) { return gSmooth ? stateSmooth(uv) : texture(uState, uv).rg; }

vec3 toLocal(vec3 p) { return rotY(p, uSpin); }

// uv на поверхности (для торa и плоскости — точные, периодические)
vec2 planarUv(vec2 a) { return vec2(a.x / (TAU * R_MAJOR), a.y / (TAU * R_MINOR)); }
vec2 torusUv(vec3 p) {
  vec2 q = vec2(length(p.xz) - R_MAJOR, p.y);
  return vec2(atan(p.z, p.x), atan(q.y, q.x)) / TAU + 0.5;
}

// (U, V) в точке; сфера — трипланарно (три проекции, веса по нормали)
vec2 stateOn(vec3 p) {
  if (uShape == 0) return stateAt(torusUv(p));
  if (uShape == 1) return stateAt(planarUv(p.xz));
  vec3 w = pow(abs(normalize(p)), vec3(10.0)); // узкие зоны смешивания проекций
  w /= w.x + w.y + w.z;
  return stateAt(planarUv(p.zy)) * w.x + stateAt(planarUv(p.xz)) * w.y + stateAt(planarUv(p.xy)) * w.z;
}

// uv для кисти: на сфере — проекция с наибольшим весом (рисунок ложится и в «зеркальные» места)
vec2 brushUv(vec3 p) {
  p = toLocal(p);
  if (uShape == 0) return torusUv(p);
  if (uShape == 1) return fract(planarUv(p.xz));
  vec3 a = abs(p);
  vec2 uv = a.x > a.y && a.x > a.z ? planarUv(p.zy) : a.y > a.z ? planarUv(p.xz) : planarUv(p.xy);
  return fract(uv);
}

float baseSdf(vec3 p) {
  if (uShape == 0) return sdTorus(p, vec2(R_MAJOR, R_MINOR));
  if (uShape == 1) return p.y;
  return sdSphere(p, R_SPHERE);
}

// x — расстояние, y — 1 для «организма», 0 для пола
vec2 scene(vec3 p) {
  vec3 l = toLocal(p);
  float b = baseSdf(l);
  // далеко от поверхности — без текстурных выборок: b - bound — нижняя оценка расстояния.
  // Порог 2·bound, чтобы оценка не доходила до нуля (иначе марш «попадает» в оболочку).
  float bound = abs(uHeight) * 0.6 + 0.01;
  float d = b > 2.0 * bound ? b - bound : b - uHeight * stateOn(l).y;
  float g = uShape == 1 ? 1e5 : p.y - GROUND;
  return g < d ? vec2(g, 0.0) : vec2(d, 1.0);
}

float map(vec3 p) { return scene(p).x; }

// Марш с уменьшенным шагом: смещение ломает липшицевость поля (|∇| до 1 + |h|·|∇V|).
vec2 marchSurface(vec3 ro, vec3 rd, float tmax, int maxSteps) {
  float k = 0.9 / (1.0 + abs(uHeight) * 10.0);
  float t = 0.0;
  int i = 0;
  for (; i < maxSteps; i++) {
    float h = map(ro + rd * t);
    if (abs(h) < 0.0003 * t) break;
    t += h * k;
    if (t > tmax) break;
  }
  return vec2(i == maxSteps || t > tmax ? tmax + 1.0 : t, float(i));
}
