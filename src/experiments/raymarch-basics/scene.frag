#include <sdf>
#include <camera>
#include <lighting>
#include <palette>
#include <pattern>

uniform float uBlend;
uniform float uPhase; // накопленное время анимации (speed интегрируется в index.ts — без скачков)
uniform float uSunAzimuth;
uniform float uSunHeight;
uniform float uSoftness;
uniform float uAo;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform int uFloor;    // 0 checker, 1 grid, 2 plain
uniform int uMaxSteps;
uniform int uDebug;    // 0 final, 1 normals, 2 steps, 3 ao, 4 shadow, 5 depth

const float TMAX = 40.0;
float T; // анимационное время

// x — расстояние, y — материал (0 пол, 1 объекты), z — вес материала A в шве
vec3 scene(vec3 p) {
  float k = uBlend;
  // группа A: сфера + наклонный тор
  float sph = sdSphere(p - vec3(1.1 * sin(T * 0.7), 0.85 + 0.25 * sin(T * 1.3), 0.5 * cos(T * 0.9)), 0.55);
  vec3 pt = rotX(rotZ(p - vec3(0.0, 1.15, 0.0), T * 0.5), 1.1 + 0.4 * sin(T * 0.6));
  float tor = sdTorus(pt, vec2(0.8, 0.16));
  float a = opSmoothUnion(sph, tor, k);
  // группа B: вращающийся скруглённый куб + капсула
  vec3 pb = rotY(p - vec3(-1.2 * cos(T * 0.5), 0.55, 1.0 * sin(T * 0.5)), T * 0.8);
  float box = sdRoundBox(rotX(pb, 0.6), vec3(0.34), 0.08);
  vec3 c0 = vec3(0.95 * cos(T * 0.8 + 2.0), 0.35, 0.95 * sin(T * 0.8 + 2.0));
  float cap = sdCapsule(p, c0, c0 + vec3(0.25 * sin(T), 0.9, 0.0), 0.2);
  float b = opSmoothUnion(box, cap, k);

  vec2 m = opSmoothUnionMix(a, b, k);
  float fl = p.y;
  return fl < m.x ? vec3(fl, 0.0, 0.0) : vec3(m.x, 1.0, m.y);
}

float map(vec3 p) { return scene(p).x; }

#include <raymarch>
#include <normal>
#include <shadow>
#include <ao>

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }

void main() {
  T = uPhase;
  vec3 ro = uCamPos;
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uCamTarget, 45.0);
  float az = radians(uSunAzimuth), el = radians(uSunHeight);
  vec3 sun = vec3(cos(el) * sin(az), sin(el), cos(el) * cos(az));

  // Узор пола считаем по аналитическому пересечению с y=0 вне ветвлений — fwidth тут корректен.
  float tp = rd.y < -1e-4 ? -ro.y / rd.y : 1e4;
  vec2 fuv = (ro + rd * tp).xz;
  float chk = checkersFiltered(fuv);
  float grid = gridFiltered(fuv * 2.0, 24.0) * gridFiltered(fuv * 0.5, 60.0);

  vec3 sky = skyColor(rd, sun);
  vec2 rm = raymarch(ro, rd, 0.01, TMAX, uMaxSteps);
  float t = rm.x;
  bool hit = t < TMAX;

  vec3 col = sky, n = vec3(0.0);
  float occ = 1.0, sh = 1.0;
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 s = scene(p);
    n = calcNormal(p, 0.0005 * max(1.0, t));
    occ = pow(calcAO(p, n), uAo);
    sh = softShadow(p + n * 0.003, sun, 0.01, 10.0, mix(48.0, 2.5, uSoftness));

    vec3 alb;
    float rough;
    if (s.y < 0.5) {
      float pat = uFloor == 0 ? chk : uFloor == 1 ? grid : 1.0;
      alb = mix(vec3(0.16), vec3(0.24), pat);
      if (uFloor == 1) alb = mix(vec3(0.10), vec3(0.24), pat);
      rough = 0.7;
    } else {
      alb = mix(srgbToLinear(uColorB), srgbToLinear(uColorA), s.z);
      rough = mix(0.45, 0.25, s.z);
    }

    vec3 v = -rd;
    vec3 sunCol = mix(vec3(1.0, 0.45, 0.18), vec3(1.0, 0.86, 0.68), smoothstep(0.05, 0.5, sun.y)) * 3.2; // низкое солнце — оранжевое
    float dif = diffuse(n, sun) * sh;
    col = alb * sunCol * dif;
    col += sunCol * specGGX(n, v, sun, rough, 0.04) * sh;
    col += alb * vec3(0.28, 0.38, 0.58) * (0.6 + 0.4 * n.y) * occ;                          // небо
    col += alb * vec3(0.30, 0.24, 0.18) * clamp(0.5 - 0.5 * n.y, 0.0, 1.0) * occ * 0.5;     // отражённый от пола
    vec3 r = reflect(rd, n);
    col += skyColor(r, sun) * fresnelSchlick(dot(n, v), 0.04) * occ * smoothstep(-0.1, 0.3, r.y) * 0.6;
    col = mix(sky, col, exp(-0.0012 * t * t)); // туман к цвету неба по лучу
  }

  vec3 outc;
  if (uDebug == 1) outc = hit ? n * 0.5 + 0.5 : vec3(0.0);
  else if (uDebug == 2) outc = palHeat(rm.y / float(uMaxSteps));
  else if (uDebug == 3) outc = vec3(hit ? occ : 1.0);
  else if (uDebug == 4) outc = vec3(hit ? sh : 1.0);
  else if (uDebug == 5) outc = vec3(hit ? 1.0 - log(1.0 + t) / log(1.0 + TMAX) : 0.0);
  else {
    outc = gamma(tonemapACES(col * 0.9));
    outc *= 1.0 - 0.25 * dot(vUv - 0.5, vUv - 0.5) * 2.0;                       // виньетка
    outc += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; // дизеринг
  }
  fragColor = vec4(outc, 1.0);
}
