// Зонд физики (8×1 rgba32f, читается JS в том же кадре через ctx.read):
//  0..2 — сферы тела на высотах 0.3 / 0.9 / 1.5 вдоль «вверх»: (расстояние, градиент)
//  3    — луч к земле вдоль −вверх от высоты 0.8: (дистанция, нормаль); x = −1 — нет земли в пределах 3 м
//  4    — луч камеры от головы к желаемой точке камеры: (дистанция до помехи, -, -, -)
//  5    — поле только планет (без построек) в точке ног: (расстояние, градиент) — по нему гравитация и «вверх»
#include "world.glsl"

uniform vec3 uPos;
uniform vec3 uUp;
uniform vec3 uCamWant;

vec3 grad(vec3 p, bool planets) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.01;
  vec3 g = planets
    ? k.xyy * planetsOnly(p + k.xyy * e) + k.yyx * planetsOnly(p + k.yyx * e) + k.yxy * planetsOnly(p + k.yxy * e) + k.xxx * planetsOnly(p + k.xxx * e)
    : k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e);
  float l = length(g);
  return l > 1e-6 ? g / l : uUp;
}

void main() {
  int i = int(gl_FragCoord.x);
  vec4 o = vec4(0.0);
  if (i < 3) {
    vec3 p = uPos + uUp * (0.3 + 0.6 * float(i));
    o = vec4(map(p), grad(p, false));
  } else if (i == 3) {
    vec3 p = uPos + uUp * 0.8;
    float t = 0.0;
    o = vec4(-1.0, 0.0, 0.0, 0.0);
    for (int s = 0; s < 48; s++) {
      float h = map(p - uUp * t);
      if (h < 0.002) { o = vec4(t, grad(p - uUp * t, false)); break; }
      t += h * 0.9;
      if (t > 3.0) break;
    }
  } else if (i == 4) {
    vec3 a = uPos + uUp * 1.4;
    vec3 d = uCamWant - a;
    float L = length(d);
    d /= L;
    float t = 0.1;
    for (int s = 0; s < 40; s++) {
      float h = map(a + d * t);
      if (h < 0.05) break;
      t += h;
      if (t > L) { t = L; break; }
    }
    o = vec4(min(t, L), L, 0.0, 0.0);
  } else if (i == 5) {
    vec3 p = uPos + uUp * 0.3;
    o = vec4(planetsOnly(p), grad(p, true));
  }
  fragColor = o;
}
