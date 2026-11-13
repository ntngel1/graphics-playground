#include "noise.glsl"

uniform float uSpeed;
uniform vec3 uTint;
uniform bool uWobble;
uniform int uPalette;
uniform vec2 uOffset;

vec3 palette(float t) {
  if (uPalette == 1) return 0.5 + 0.5 * cos(6.2831 * (t + vec3(0.0, 0.1, 0.2)));
  if (uPalette == 2) return vec3(smoothstep(0.3, 0.7, t));
  return 0.5 + 0.5 * cos(6.2831 * (t * vec3(1.0, 0.9, 0.8) + vec3(0.6, 0.3, 0.1)));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y + uOffset;
  vec2 m = (uMouse.xy - 0.5 * uResolution) / uResolution.y;
  float t = uTime * uSpeed;

  vec2 q = uv * 2.5;
  if (uWobble) q += 0.4 * vec2(sin(t + uv.y * 3.0), cos(t * 0.8 + uv.x * 3.0));
  // domain warping
  vec2 w = vec2(fbm(q + t * 0.15), fbm(q + vec2(5.2, 1.3) - t * 0.1));
  float n = fbm(q + 2.0 * w);

  vec3 col = palette(n + 0.2 * length(w)) * mix(vec3(1.0), uTint, 0.6);
  float d = length(uv - uOffset - m);
  col += uTint * (0.02 + 0.08 * uMouse.z) / (d * d + 0.02);
  col *= 1.0 - 0.35 * dot(vUv - 0.5, vUv - 0.5) * 2.0;
  fragColor = vec4(pow(col, vec3(0.9)), 1.0);
}
