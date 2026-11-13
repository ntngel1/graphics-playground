// Живая поверхность: реймарч смещённой формы, материал и свечение от состояния Грея-Скотта.
#include "surface.glsl"
#include "../gray-scott/colorize.glsl"
#include <camera>
#include <lighting>
#include <normal>
#include <shadow>
#include <ao>

uniform int uPalette;
uniform int uMaxSteps;
uniform float uGlow;
uniform float uSunAzimuth;
uniform float uSunHeight;
uniform int uDebug;   // 0 final, 1 normals, 2 steps, 3 height

const float TMAX = 40.0;

void main() {
  vec3 ro = uCamPos;
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uCamTarget, FOV);
  float az = radians(uSunAzimuth), el = radians(uSunHeight);
  vec3 sun = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));

  // небо потемнее и холоднее библиотечного — фон для «организма»
  vec3 sky = skyColor(rd, sun) * vec3(0.32, 0.36, 0.45);
  vec2 m = marchSurface(ro, rd, TMAX, uMaxSteps);
  float t = m.x;
  vec3 col = sky;
  vec3 n = vec3(0.0);
  float vh = 0.0;

  if (t < TMAX) {
    vec3 p = ro + rd * t;
    bool organism = scene(p).y > 0.5;
    gSmooth = true;
    n = calcNormal(p, 0.0015 * max(1.0, t));
    vec4 s = stateOn(toLocal(p));
    gSmooth = false;
    vh = s.y;
    float occ = calcAO(p, n);
    float sh = softShadow(p + n * 0.004, sun, 0.02, 8.0, 10.0);
    vec3 v = -rd;

    if (organism) {
      float alive = smoothstep(0.1, 0.3, s.y);
      vec3 alb = pow(gsColor(s.y, uPalette), vec3(2.2));
      float rough = mix(0.7, 0.22, alive);         // влажный глянец на гребнях, матовая основа
      vec3 sunCol = vec3(1.0, 0.9, 0.78) * 3.0;
      float ndl = dot(n, sun);
      float wrap = max((ndl + 0.35) / 1.35, 0.0);  // мягкий «подповерхностный» терминатор
      col = alb * sunCol * mix(max(ndl, 0.0), wrap, 0.5 * alive) * sh;
      col += sunCol * specGGX(n, v, sun, rough, 0.04 + 0.04 * alive) * sh;
      col += alb * vec3(0.20, 0.26, 0.40) * (0.6 + 0.4 * n.y) * occ;
      vec3 r = reflect(rd, n);
      // rim: Шлик, но гаснет у самого силуэта — иначе там однопиксельная светлая обводка (алиасинг)
      float nv = dot(n, v);
      col += skyColor(r, sun) * 0.5 * fresnelSchlick(nv, 0.04) * smoothstep(0.0, 0.25, nv) * occ * (0.3 + 0.7 * alive);
      // свечение по фронту: край «живого» (V в переходной зоне), медленно «дышит»
      float front = smoothstep(0.05, 0.14, s.y) * (1.0 - smoothstep(0.16, 0.28, s.y));
      float pulse = 0.75 + 0.25 * sin(uTime * 1.7 + s.x * 9.0);
      col += pow(gsColor(0.34, uPalette), vec3(2.2)) * uGlow * front * pulse * 1.5;
      // подповерхностное рассеяние на просвет (контровой свет сквозь гребни)
      float back = pow(clamp(dot(v, -sun) * 0.5 + 0.5, 0.0, 1.0), 3.0) * (1.0 - abs(dot(n, v)));
      col += alb * sunCol * back * alive * 0.35 * sh;
    } else {
      // пол: тёмный матовый, ловит тени
      col = vec3(0.035) * (vec3(1.0, 0.9, 0.78) * 3.0 * max(dot(n, sun), 0.0) * sh + vec3(0.2, 0.26, 0.4) * occ);
    }
    col = mix(sky, col, exp(-0.004 * t * t));
  }

  vec3 outc;
  if (uDebug == 1) outc = t < TMAX ? n * 0.5 + 0.5 : vec3(0.0);
  else if (uDebug == 2) outc = palHeat(m.y / float(uMaxSteps));
  else if (uDebug == 3) outc = vec3(vh * 2.2);
  else {
    outc = gamma(tonemapACES(col));
    outc *= 1.0 - 0.3 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
    outc += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  }
  fragColor = vec4(outc, 1.0);
}
