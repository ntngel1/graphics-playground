// Поверхность, смещённая состоянием Грея-Скотта. Общий код для pick/рендера living-surface и phototroph.
// Высота — V (uHeightSrc 0) или накопленная биомасса, канал B состояния (uHeightSrc 1).
// Сфера — трипланарно (uLatLong false) или lat-long (true: развёртка обратима — нужна для карты света).
// uShade[i] — парящие шары-заслонки (xyz, радиус; w = 0 — нет), материал 2.
// Плотность текселей одинакова для всех форм: 1 / (2πR) по u и 1 / (2πr) по v, при буфере W×H с
// W/H = R/r узор не растянут (на торе — по средней линии трубки).
#include <sdf>

uniform sampler2D uState;
uniform vec2 uStateSize;
uniform int uShape;        // 0 torus, 1 plane, 2 sphere
uniform float uHeight;     // смещение на единицу V (знак: гребни / борозды)
uniform float uSpin;       // угол поворота формы вокруг Y (накапливается в index.ts)
uniform int uHeightSrc;
uniform bool uLatLong;
uniform vec4 uShade[3];
float gRelief = 1.0;       // множитель рельефа (0 — гладкая форма: тени без самозатенения)

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
vec4 stateSmooth(vec2 uv) {
  vec2 tc = uv * uStateSize - 0.5, f = fract(tc);
  tc -= f;
  vec4 xc = bspline(f.x), yc = bspline(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / uStateSize.xxyy;
  vec4 s0 = texture(uState, o.xz), s1 = texture(uState, o.yz);
  vec4 s2 = texture(uState, o.xw), s3 = texture(uState, o.yw);
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}
// (U, V, B, A); в буфере хранится R = 1 − U
vec4 stateAt(vec2 uv) {
  vec4 s = gSmooth ? stateSmooth(uv) : texture(uState, uv);
  return vec4(1.0 - s.x, s.yzw);
}
// биомасса — «курган», на нём гребни живого (V); мёртвое — только курган
float relief(vec4 s) { return uHeightSrc == 1 ? 0.7 * s.z + 0.3 * smoothstep(0.08, 0.3, s.y) : s.y; }

vec3 toLocal(vec3 p) { return rotY(p, uSpin); }

// uv на поверхности (для торa и плоскости — точные, периодические)
vec2 planarUv(vec2 a) { return vec2(a.x / (TAU * R_MAJOR), a.y / (TAU * R_MINOR)); }
vec2 torusUv(vec3 p) {
  vec2 q = vec2(length(p.xz) - R_MAJOR, p.y);
  return vec2(atan(p.z, p.x), atan(q.y, q.x)) / TAU + 0.5;
}
vec2 latLongUv(vec3 p) {
  p = normalize(p);
  return vec2(atan(p.z, p.x) / TAU + 0.5, asin(clamp(p.y, -1.0, 1.0)) / 3.14159265 + 0.5);
}

// Обратное отображение uv → точка базовой формы и нормаль (для карты света в пространстве uv).
// Плоскость — плитка вокруг начала координат; сфера — только lat-long.
void surfaceFrame(vec2 uv, out vec3 p, out vec3 n) {
  if (uShape == 0) {
    float phi = (uv.x - 0.5) * TAU, th = (uv.y - 0.5) * TAU;
    n = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
    p = vec3(cos(phi), 0.0, sin(phi)) * R_MAJOR + n * R_MINOR;
  } else if (uShape == 1) {
    p = vec3((uv.x - 0.5) * TAU * R_MAJOR, 0.0, (uv.y - 0.5) * TAU * R_MINOR);
    n = vec3(0.0, 1.0, 0.0);
  } else {
    float lon = (uv.x - 0.5) * TAU, lat = (uv.y - 0.5) * 3.14159265;
    n = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    p = n * R_SPHERE;
  }
}

// (U, V, B, A) в точке; сфера — трипланарно (три проекции, веса по нормали) или lat-long
vec4 stateOn(vec3 p) {
  if (uShape == 0) return stateAt(torusUv(p));
  if (uShape == 1) return stateAt(planarUv(p.xz));
  if (uLatLong) return stateAt(latLongUv(p));
  vec3 w = pow(abs(normalize(p)), vec3(10.0)); // узкие зоны смешивания проекций
  w /= w.x + w.y + w.z;
  return stateAt(planarUv(p.zy)) * w.x + stateAt(planarUv(p.xz)) * w.y + stateAt(planarUv(p.xy)) * w.z;
}

// uv для кисти: на сфере — проекция с наибольшим весом (рисунок ложится и в «зеркальные» места)
vec2 brushUv(vec3 p) {
  p = toLocal(p);
  if (uShape == 0) return torusUv(p);
  if (uShape == 1) return fract(planarUv(p.xz));
  if (uLatLong) return latLongUv(p);
  vec3 a = abs(p);
  vec2 uv = a.x > a.y && a.x > a.z ? planarUv(p.zy) : a.y > a.z ? planarUv(p.xz) : planarUv(p.xy);
  return fract(uv);
}

float baseSdf(vec3 p) {
  if (uShape == 0) return sdTorus(p, vec2(R_MAJOR, R_MINOR));
  if (uShape == 1) return p.y;
  return sdSphere(p, R_SPHERE);
}

float shadeSdf(vec3 p) {
  float d = 1e5;
  for (int i = 0; i < 3; i++) if (uShade[i].w > 0.0) d = min(d, length(p - uShade[i].xyz) - uShade[i].w);
  return d;
}

// x — расстояние, y — 1 для «организма», 0 для пола, 2 — заслонка
vec2 scene(vec3 p) {
  vec3 l = toLocal(p);
  float b = baseSdf(l);
  float h = uHeight * gRelief;
  // далеко от поверхности — без текстурных выборок: b - bound — нижняя оценка расстояния.
  // Порог 2·bound, чтобы оценка не доходила до нуля (иначе марш «попадает» в оболочку).
  float bound = abs(h) * 0.6 + 0.01;
  float d = b > 2.0 * bound ? b - bound : b - h * relief(stateOn(l));
  float g = uShape == 1 ? 1e5 : p.y - GROUND;
  vec2 r = g < d ? vec2(g, 0.0) : vec2(d, 1.0);
  float s = shadeSdf(p);
  return s < r.x ? vec2(s, 2.0) : r;
}

float map(vec3 p) { return scene(p).x; }

// Мягкая тень (вариант IQ) с шагом, уменьшенным под смещённый рельеф (иначе — «акне» на крутых гребнях).
float surfShadow(vec3 ro, vec3 rd, int steps, float kSoft) {
  float k = 0.9 / (1.0 + abs(uHeight) * gRelief * 10.0);
  float res = 1.0, t = 0.015;
  for (int i = 0; i < 96; i++) {
    if (i >= steps || t > 6.0) break;
    float h = map(ro + rd * t);
    res = min(res, kSoft * h / t);
    if (res < 0.001) break;
    t += clamp(h * k, 0.006, 0.25);
  }
  res = clamp(res, 0.0, 1.0);
  return res * res * (3.0 - 2.0 * res);
}

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
