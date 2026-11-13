// Уровень 1 «Слияние»: две плиты через пропасть. Ручка A — k smooth union: при большом k
// плиты оплывают навстречу друг другу и срастаются в пандус.
float level1(vec3 p, vec2 knob) {
  float k = 2.4 * knob.x;
  float a = slab(p, vec3(-1.75, 0.45, 0.0), vec3(1.0, 0.12, 0.45), -0.13);
  float b = slab(p, vec3(1.0, 0.0, 0.0), vec3(0.9, 0.12, 0.45), 0.0);
  return opSmoothUnion(a, b, k);
}
