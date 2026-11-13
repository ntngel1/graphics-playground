// Организм, который ест свет: реймарч смещённой биомассой поверхности, живое (V) — насыщенное и влажное,
// мёртвое (биомасса без V) — костяной матовый след, голая поверхность — тёмный камень. Солнце видно на
// небе, заслонки — тёмные парящие шары. Вставка-миникарта: развёртка uv со светом и живым.
#include "../living-surface/surface.glsl"
#include "../gray-scott/colorize.glsl"
#include <camera>
#include <lighting>
#include <normal>
#include <ao>

uniform sampler2D uLight;
uniform vec3 uSunDir;
uniform int uPalette;
uniform int uMaxSteps;
uniform float uGlow;
uniform int uDebug;        // 0 final, 1 light, 2 biomass, 3 state
uniform bool uMinimap;

const float TMAX = 30.0;
vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 skyCol(vec3 rd) {
  float s = max(dot(rd, uSunDir), 0.0);
  vec3 c = mix(vec3(0.006, 0.007, 0.012), vec3(0.02, 0.025, 0.045), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  c += vec3(1.0, 0.75, 0.45) * (0.04 * pow(s, 6.0) + 0.25 * pow(s, 60.0));
  c += vec3(1.0, 0.9, 0.75) * 30.0 * smoothstep(0.9993, 0.9997, s); // диск солнца
  return c;
}

// поле для отладочных режимов: свет / биомасса / состояние
vec3 debugField(vec2 uv, vec4 s) {
  vec3 L = texture(uLight, uv).rgb;
  if (uDebug == 1) return vec3(L.r) * vec3(1.0, 0.9, 0.7);
  if (uDebug == 2) return palHeat(s.z);
  return vec3(s.z * 0.6, s.y * 2.5, (1.0 - s.x) * 1.5);
}

vec3 minimap(vec2 uv) {
  vec4 s = stateAt(uv);
  if (uDebug == 2) return palHeat(s.z);
  if (uDebug == 3) return vec3(s.z * 0.6, s.y * 2.5, (1.0 - s.x) * 1.5);
  float L = texture(uLight, uv).r;
  vec3 c = vec3(0.05, 0.05, 0.07) + vec3(0.5, 0.45, 0.35) * L;           // свет — фон
  c = mix(c, vec3(0.75, 0.7, 0.6), smoothstep(0.05, 0.5, s.z) * 0.5);    // след биомассы
  return mix(c, gsColor(s.y, uPalette), smoothstep(0.08, 0.22, s.y));    // живое
}

void main() {
  // вставка-миникарта: левый нижний угол, развёртка uv в пропорциях буфера состояния
  if (uMinimap) {
    // на портретном экране — шире и выше нижних кнопок режимов
    bool portrait = uResolution.x < uResolution.y;
    float w = portrait ? uResolution.x * 0.6 : min(uResolution.x * 0.34, 420.0 * uResolution.y / 750.0);
    vec2 size = vec2(w, w * uStateSize.y / uStateSize.x);
    vec2 q = (gl_FragCoord.xy - vec2(12.0, portrait ? uResolution.y * 0.19 : 12.0)) / size;
    if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) {
      vec3 c = minimap(q);
      vec2 edge = min(q, 1.0 - q) * size;
      c = mix(vec3(0.6), c, smoothstep(0.0, 1.5, min(edge.x, edge.y)));
      fragColor = vec4(pow(c, vec3(1.0 / 1.2)), 1.0);
      return;
    }
  }

  vec3 ro = uCamPos;
  vec3 rd = cameraRay(gl_FragCoord.xy, uResolution, ro, uCamTarget, FOV);
  vec3 sky = skyCol(rd);
  vec2 m = marchSurface(ro, rd, TMAX, uMaxSteps);
  float t = m.x;
  vec3 col = sky;
  vec3 sunCol = vec3(1.0, 0.86, 0.68) * 4.0;
  vec3 amb = vec3(0.10, 0.13, 0.22);

  if (t < TMAX) {
    vec3 p = ro + rd * t;
    float mat = scene(p).y;
    gSmooth = true;
    vec3 n = calcNormal(p, 0.0015 * max(1.0, t));
    vec4 s = stateOn(p);
    gSmooth = false;
    vec2 uv = brushUv(p);
    float occ = calcAO(p, n);
    float sh = surfShadow(p + n * 0.004, uSunDir, 72, 12.0);
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 v = -rd;

    if (mat > 1.5) {
      // заслонка: чёрный обсидиан, узкий блик и холодная кромка
      col = vec3(0.01) * (ndl * sh + 0.2) + sunCol * specGGX(n, v, uSunDir, 0.2, 0.04) * sh;
      col += vec3(0.25, 0.35, 0.6) * pow(1.0 - max(dot(n, v), 0.0), 4.0) * 0.4;
    } else if (mat > 0.5) {
      float alive = smoothstep(0.08, 0.25, s.y);
      float bone = smoothstep(0.04, 0.45, s.z) * (1.0 - alive);
      float L = texture(uLight, uv).r;
      vec3 rock = vec3(0.035, 0.035, 0.04);
      vec3 boneC = lin(vec3(0.78, 0.72, 0.6)) * 0.55;
      vec3 life = lin(gsColor(s.y, uPalette));
      vec3 alb = mix(mix(rock, boneC, bone), life, alive);
      float rough = mix(mix(0.8, 0.9, bone), 0.25, alive);   // живое влажное, кость матовая
      col = alb * sunCol * ndl * sh;
      col += sunCol * specGGX(n, v, uSunDir, rough, 0.04) * sh * (0.3 + 0.7 * alive);
      col += alb * amb * (0.5 + 0.5 * n.y) * occ;
      // фронт роста светится на свету; умирающее в темноте — слабая биолюминесценция
      float front = smoothstep(0.04, 0.12, s.y) * (1.0 - smoothstep(0.14, 0.26, s.y));
      col += life * uGlow * front * L * 1.2;
      col += vec3(0.1, 0.6, 0.8) * uGlow * alive * pow(1.0 - L, 3.0) * 0.08 * (0.7 + 0.3 * sin(uTime * 2.0 + s.y * 30.0));
      if (uDebug > 0) col = debugField(uv, s) * (0.35 + 0.65 * max(dot(n, normalize(vec3(0.3, 1.0, 0.4))), 0.0));
    } else {
      // земля: почти чёрная, ловит длинные тени
      col = vec3(0.02) * (sunCol * ndl * sh + amb * occ);
    }
    col = mix(sky, col, exp(-0.003 * t * t));
  }

  vec3 outc = gamma(tonemapACES(col));
  outc *= 1.0 - 0.35 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
  outc += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  fragColor = vec4(outc, 1.0);
}
