// Карта света в пространстве uv поверхности: для каждого текселя — 3D-точка на смещённой поверхности,
// нормаль по смещённому полю и мягкая тень маршем к солнцу через полную сцену (форма + рельеф
// биомассы + заслонки). r — освещённость с рассеянным (корм), g — прямой N·L·тень, b — тень.
#include "../living-surface/surface.glsl"

uniform vec3 uSunDir;
uniform float uAmbient;
uniform int uShadowSteps;
uniform bool uSelfShadow;

vec3 displaced(vec2 uv) {
  vec3 p, n;
  surfaceFrame(uv, p, n);
  return p + n * uHeight * relief(stateAt(uv));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec3 p0, n0;
  surfaceFrame(uv, p0, n0);
  vec2 e = 1.0 / uStateSize;
  vec3 P = displaced(uv);
  vec3 du = displaced(uv + vec2(e.x, 0.0)) - displaced(uv - vec2(e.x, 0.0));
  vec3 dv = displaced(uv + vec2(0.0, e.y)) - displaced(uv - vec2(0.0, e.y));
  vec3 N = normalize(cross(du, dv));
  if (dot(N, n0) < 0.0) N = -N;
  if (length(du) < 1e-6 || length(dv) < 1e-6) N = n0; // полюса lat-long

  float ndl = max(dot(N, uSunDir), 0.0);
  float sh = 0.0;
  if (ndl > 0.0) {
    // мягкая тень (вариант IQ); без self-shadow рельеф не участвует — тени только от формы и заслонок
    gRelief = uSelfShadow ? 1.0 : 0.0;
    sh = surfShadow(P + N * 0.006, uSunDir, uShadowSteps, 10.0);
  }
  float direct = ndl * sh;
  fragColor = vec4(uAmbient + (1.0 - uAmbient) * direct, direct, sh, 1.0);
}
