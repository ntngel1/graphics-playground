// Отображение состояния: палитры, «рельеф» (освещение по градиенту V как карте высот),
// в режиме карты — изолинии feed/kill и маркер текущей точки.
#include "colorize.glsl"
#include "map.glsl"

uniform sampler2D uState;
uniform vec2 uStateSize;
uniform int uPalette;
uniform bool uRelief;
uniform float uReliefDepth;
uniform bool uMapMode;
uniform float uFeed;
uniform float uKill;

float V(vec2 uv) { return texture(uState, uv).g; }

void main() {
  vec2 uv = vUv;
  vec3 col = gsColor(V(uv), uPalette);

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
    // изолинии: kill через 0.0025 (кривые), feed через 0.01
    vec2 fk = mapToFK(uv);
    vec2 g = vec2(fk.y / 0.0025, fk.x / 0.01);
    vec2 w = fwidth(g);
    vec2 line = 1.0 - smoothstep(vec2(0.0), w * 1.5, abs(fract(g + 0.5) - 0.5));
    col = mix(col, vec3(1.0), 0.16 * max(line.x, line.y));
    vec2 m = fkToMap(vec2(uFeed, uKill));
    float d = length((uv - m) * uResolution) / uResolution.y;
    col = mix(col, vec3(0.0), smoothstep(0.008, 0.0, abs(d - 0.018)) * 0.8);
    col = mix(col, vec3(1.0), smoothstep(0.004, 0.0, abs(d - 0.018)));
  }
  fragColor = vec4(col, 1.0);
}
