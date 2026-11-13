// Стандартный sphere tracing. Конвенция: до #include объявите `float map(vec3 p)`.
// Возвращает vec2(t, шаги); промах — t > tmax.

vec2 raymarch(vec3 ro, vec3 rd, float tmin, float tmax, int maxSteps) {
  float t = tmin;
  int i = 0;
  for (; i < maxSteps; i++) {
    float h = map(ro + rd * t);
    if (abs(h) < 0.0004 * t) break; // относительная точность: вдали можно грубее
    t += h;
    if (t > tmax) break;
  }
  return vec2(i == maxSteps ? tmax + 1.0 : t, float(i));
}
