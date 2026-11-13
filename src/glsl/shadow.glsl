// Мягкие тени (улучшенный вариант IQ — без полос и с мягким краем внутрь тени).
// Конвенция: до #include объявите в шейдере `float map(vec3 p)`.
// k — резкость (2 — очень мягко, 64 — почти жёстко). Результат 0 (тень) .. 1 (свет).

float softShadow(vec3 ro, vec3 rd, float tmin, float tmax, float k) {
  float res = 1.0, t = tmin;
  for (int i = 0; i < 96 && t < tmax; i++) {
    float h = map(ro + rd * t);
    res = min(res, k * h / t);
    t += clamp(h, 0.005, 0.25);
    if (res < -1.0) break;
  }
  res = max(res, -1.0);
  return 0.25 * (1.0 + res) * (1.0 + res) * (2.0 - res);
}
