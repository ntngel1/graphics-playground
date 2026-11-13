// Освещение: ламберт, Blinn-Phong, GGX, Шлик, небо и туман. Цвета линейные.

float diffuse(vec3 n, vec3 l) { return max(dot(n, l), 0.0); }

float specBlinn(vec3 n, vec3 l, vec3 v, float shininess) {
  return pow(max(dot(n, normalize(l + v)), 0.0), shininess) * (shininess + 8.0) / 25.13;
}

float fresnelSchlick(float cosTheta, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(cosTheta, 0.0, 1.0), 5.0); }

// GGX + Smith (Schlick-GGX) + Шлик; v — к камере, l — к свету. Уже умножено на n·l.
float specGGX(vec3 n, vec3 v, vec3 l, float roughness, float f0) {
  vec3 h = normalize(v + l);
  float nl = max(dot(n, l), 0.0), nv = max(dot(n, v), 1e-4), nh = max(dot(n, h), 0.0);
  float a2 = pow(max(roughness, 0.02), 4.0);
  float d = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  float k = (roughness + 1.0) * (roughness + 1.0) / 8.0;
  float g = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  return d * g * fresnelSchlick(dot(h, v), f0) / (4.0 * nv);
}

// Градиент неба + солнце; при низком солнце горизонт со стороны солнца теплеет
vec3 skyColor(vec3 rd, vec3 sunDir) {
  float y = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.55, 0.66, 0.82), vec3(0.12, 0.27, 0.62), pow(y, 0.55));
  float low = pow(1.0 - max(sunDir.y, 0.0), 4.0);
  float toward = 0.35 + 0.65 * max(dot(normalize(rd.xz + 1e-5), normalize(sunDir.xz + 1e-5)), 0.0);
  vec3 haze = mix(vec3(0.74, 0.74, 0.74), vec3(1.0, 0.5, 0.25), low * toward);
  col = mix(col, haze, exp(-10.0 * max(rd.y + 0.02, 0.0))); // дымка у горизонта
  float s = max(dot(rd, sunDir), 0.0);
  col += vec3(1.0, 0.75, 0.45) * (0.25 * pow(s, 8.0) + 0.6 * pow(s, 64.0) + 12.0 * pow(s, 2048.0));
  return col;
}

// Экспоненциальный туман к цвету fogCol; density ~ 0.02..0.1
vec3 applyFog(vec3 col, float t, vec3 fogCol, float density) {
  return mix(fogCol, col, exp(-density * density * t * t));
}
