// SDF-примитивы (sd*) и операции (op*): булевы, smooth (с коэффициентом смешения для материалов),
// повторение/симметрия, повороты, twist/bend, onion/round. Примитивы центрированы в начале координат.

// ---------- примитивы ----------
float sdSphere(vec3 p, float r) { return length(p) - r; }

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdRoundBox(vec3 p, vec3 b, float r) { return sdBox(p, b - r) - r; }

// t.x — большой радиус, t.y — радиус трубки; кольцо в плоскости XZ
float sdTorus(vec3 p, vec2 t) { return length(vec2(length(p.xz) - t.x, p.y)) - t.y; }

float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// вертикальный цилиндр с крышками: h — полувысота
float sdCylinder(vec3 p, float h, float r) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// n — нормаль (нормированная), h — смещение вдоль неё
float sdPlane(vec3 p, vec3 n, float h) { return dot(p, n) + h; }

float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  float m = p.x + p.y + p.z - s;
  vec3 q;
  if (3.0 * p.x < m) q = p.xyz;
  else if (3.0 * p.y < m) q = p.yzx;
  else if (3.0 * p.z < m) q = p.zxy;
  else return m * 0.57735027;
  float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return length(vec3(q.x, q.y - s + k, q.z - k));
}

// не точная SDF (оценка снизу) — шагать осторожнее
float sdEllipsoid(vec3 p, vec3 r) {
  float k0 = length(p / r), k1 = length(p / (r * r));
  return k0 * (k0 - 1.0) / k1;
}

// ---------- булевы ----------
float opUnion(float a, float b) { return min(a, b); }
float opSubtract(float a, float b) { return max(a, -b); } // a минус b
float opIntersect(float a, float b) { return max(a, b); }

// ---------- smooth (полиномиальный smin, k — ширина шва в единицах расстояния) ----------
float opSmoothUnion(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / max(k, 1e-6);
  return min(a, b) - h * h * k * 0.25;
}
float opSmoothSubtract(float a, float b, float k) { return -opSmoothUnion(-a, b, k); }
float opSmoothIntersect(float a, float b, float k) { return -opSmoothUnion(-a, -b, k); }

// x — расстояние, y — вес a в шве (1 — чисто a, 0 — чисто b): mix(matB, matA, r.y)
vec2 opSmoothUnionMix(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-6), 0.0, 1.0);
  return vec2(mix(b, a, h) - k * h * (1.0 - h), h);
}

// ---------- домен ----------
vec3 opRep(vec3 p, vec3 s) { return p - s * round(p / s); }
vec3 opRepLim(vec3 p, float s, vec3 l) { return p - s * clamp(round(p / s), -l, l); }
vec3 opSymX(vec3 p) { return vec3(abs(p.x), p.yz); }
vec3 opSymXZ(vec3 p) { return vec3(abs(p.x), p.y, abs(p.z)); }

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
vec3 rotX(vec3 p, float a) { p.yz = rot2(a) * p.yz; return p; }
vec3 rotY(vec3 p, float a) { p.xz = rot2(a) * p.xz; return p; }
vec3 rotZ(vec3 p, float a) { p.xy = rot2(a) * p.xy; return p; }

// искажения ломают липшицевость — умножайте результат map на ~0.5..0.8
vec3 opTwist(vec3 p, float k) { return vec3(rot2(k * p.y) * p.xz, p.y).xzy; }
vec3 opBend(vec3 p, float k) { return vec3(rot2(k * p.x) * p.xy, p.z); }

float opOnion(float d, float t) { return abs(d) - t; }
float opRound(float d, float r) { return d - r; }
