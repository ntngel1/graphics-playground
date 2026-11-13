// Отображение состояния: палитры, «рельеф» (освещение по градиенту V как карте высот),
// маркер текущей точки в режиме карты feed/kill.
#include <palette>

uniform sampler2D uState;
uniform vec2 uStateSize;
uniform int uPalette;       // ink, sunset, ocean, rainbow, heat, neon
uniform bool uRelief;
uniform float uReliefDepth;
uniform bool uMapMode;
uniform float uFeed;
uniform float uKill;
uniform vec2 uMapKill;
uniform vec2 uMapFeed;

float V(vec2 uv) { return texture(uState, uv).g; }

vec3 colorize(float v) {
  float t = smoothstep(0.02, 0.4, v);
  if (uPalette == 0) return mix(vec3(0.94, 0.92, 0.87), vec3(0.06, 0.06, 0.09), smoothstep(0.12, 0.3, v));
  if (uPalette == 1) return palSunset(t);
  if (uPalette == 2) return palOcean(t);
  if (uPalette == 3) return palRainbow(0.7 * t + 0.6) * smoothstep(0.0, 0.3, t);
  if (uPalette == 4) return palHeat(t) * smoothstep(0.0, 0.15, t);
  return vec3(0.1, 0.9, 1.0) * pow(t, 1.5) * 1.4 + vec3(1.0, 0.2, 0.7) * smoothstep(0.6, 1.0, t) * 0.5;
}

void main() {
  vec2 uv = vUv;
  float v = V(uv);
  vec3 col = colorize(v);

  if (uRelief) {
    vec2 tx = 1.0 / uStateSize;
    float dx = V(uv + vec2(tx.x, 0)) - V(uv - vec2(tx.x, 0));
    float dy = V(uv + vec2(0, tx.y)) - V(uv - vec2(0, tx.y));
    vec3 n = normalize(vec3(-dx * uReliefDepth, -dy * uReliefDepth, 1.0));
    vec3 l = normalize(vec3(-0.5, 0.6, 0.65));
    float dif = max(dot(n, l), 0.0);
    float spec = pow(max(dot(n, normalize(l + vec3(0, 0, 1))), 0.0), 48.0);
    col = col * (0.25 + 0.95 * dif) + vec3(spec) * 0.45;
  }

  if (uMapMode) {
    // сетка: kill через 0.005, feed через 0.01
    vec2 g = vec2((mix(uMapKill.x, uMapKill.y, uv.x)) / 0.005, (mix(uMapFeed.x, uMapFeed.y, uv.y)) / 0.01);
    vec2 w = fwidth(g);
    vec2 line = 1.0 - smoothstep(vec2(0.0), w * 1.5, abs(fract(g + 0.5) - 0.5));
    col = mix(col, vec3(1.0), 0.18 * max(line.x, line.y));
    vec2 m = vec2((uKill - uMapKill.x) / (uMapKill.y - uMapKill.x), (uFeed - uMapFeed.x) / (uMapFeed.y - uMapFeed.x));
    float d = length((uv - m) * uResolution) / uResolution.y;
    float ring = smoothstep(0.004, 0.0, abs(d - 0.018));
    float ringO = smoothstep(0.008, 0.0, abs(d - 0.018));
    col = mix(col, vec3(0.0), ringO * 0.8);
    col = mix(col, vec3(1.0), ring);
  }
  fragColor = vec4(col, 1.0);
}
