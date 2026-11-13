// Ambient occlusion по SDF вдоль нормали (5 проб).
// Конвенция: до #include объявите в шейдере `float map(vec3 p)`. Результат 0 (закрыто) .. 1.

// map(p) вычитается как базовая линия: точка попадания марша лежит чуть над поверхностью,
// без этого на AO проступают кольца-изолинии числа шагов.
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0, d0 = map(p);
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.12 * float(i) / 4.0;
    occ += (h - (map(p + h * n) - d0)) * sca;
    sca *= 0.95;
  }
  return clamp(1.0 - 3.0 * occ, 0.0, 1.0);
}
