// Зонд (4×1 rgba32f): луч под курсором и луч в центр экрана — тем же map(), что и кадр (тот же след
// пикселя → та же детализация). JS читает его в том же кадре (ctx.read) и решает, куда зумить.
//  px0: точка попадания xyz (в узле камеры), t (−1 — небо)
//  px1: масштаб узла поверхности (ед. узла → ед. камеры), кадр, путь от кадра (base-4), глубина
//  px2: материал (≥100 — предмет), тип узла, масштаб узла на уровень глубже камеры на пути к поверхности
//  px3: t луча в центр экрана (−1 — небо)
#include "world.glsl"
#include <camera>

uniform vec3 uTarget;
uniform vec2 uCursor;    // 0..1, y вверх
uniform vec2 uSceneRes;  // размер буфера сцены, px
uniform float uNear;
uniform float uViewD;

const float FOV = 50.0;

float trace(vec2 uv, out bool hit) {
  vec3 ro = uEye;
  vec3 rd = cameraRay(uv * uSceneRes, uSceneRes, ro, uTarget, FOV);
  float pixAng = 2.0 / (min(uSceneRes.x, uSceneRes.y) / tan(radians(FOV) * 0.5));
  float t;
  hit = marchRay(ro, rd, pixAng, uNear, uViewD * 30.0, 220, t);
  if (hit) map(ro + rd * t); // запись — о точке попадания
  return t;
}

void main() {
  gDither = 0.5;
  int i = int(gl_FragCoord.x);
  bool hit;
  float t = trace(i == 3 ? vec2(0.5) : uCursor, hit);
  vec3 rd = cameraRay((i == 3 ? vec2(0.5) : uCursor) * uSceneRes, uSceneRes, uEye, uTarget, FOV);
  if (i == 0) fragColor = vec4(uEye + rd * t, hit ? t : -1.0);
  else if (i == 1) fragColor = vec4(gSc, float(gFrame), float(gPath), float(gDepth));
  else if (i == 2) fragColor = vec4(hit ? gMat : 0.0, float(gType), gSc1, 0.0);
  else fragColor = vec4(hit ? t : -1.0, 0.0, 0.0, 0.0);
}
