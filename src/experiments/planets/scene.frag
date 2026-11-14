// Маленькие планеты: кадр. Камера сзади-сверху персонажа, «верх» камеры — нормаль планеты под ногами,
// поэтому горизонт закругляется и уходит из-под ног. Сумеречное небо, звёзды, тёплый свет; финал — маяк.
#include "world.glsl"

uniform vec3 uEye;
uniform vec3 uTarget;
uniform vec3 uCamUp;
uniform float uFlash; // вспышка финала

const vec3 SUN = normalize(vec3(0.5, 0.6, -0.62));

vec3 skyCol(vec3 rd) {
  float s = dot(rd, SUN);
  vec3 c = mix(vec3(0.1, 0.07, 0.2), vec3(0.32, 0.18, 0.36), smoothstep(-0.6, 0.6, s));
  c = mix(c, vec3(0.95, 0.55, 0.32), smoothstep(0.55, 0.98, s) * 0.8);   // тёплое зарево
  c += vec3(1.0, 0.85, 0.6) * smoothstep(0.996, 0.999, s);                 // солнце
  // звёзды: клетки направлений, в каждой — может быть звезда; после финала их больше и они ярче
  vec3 g = rd * 90.0;
  vec3 cell = floor(g);
  vec3 h = hash33(cell);
  float th = mix(0.965, 0.9, uLit);
  if (h.x > th) {
    vec3 sp = cell + 0.2 + 0.6 * h;
    float st = smoothstep(0.35, 0.0, length(g - sp)) * (1.0 - smoothstep(0.3, 0.7, s));
    c += vec3(1.0, 0.92, 0.8) * st * (0.6 + 0.6 * uLit) * (0.6 + 0.4 * sin(uTime * (1.0 + h.y * 3.0) + h.z * 6.0));
  }
  return c;
}

float tex(vec2 uv) { return hash12(floor(uv)); }

vec3 albedo(vec3 p, vec3 n, float m) {
  vec2 uv = (abs(n.y) > 0.6 ? p.xz : abs(n.x) > 0.5 ? p.zy : p.xy) * 6.0;
  float h = tex(uv);
  if (m < 1.5) { // трава с проплешинами и тропинкой к маяку
    vec3 c = mix(vec3(0.36, 0.55, 0.22), vec3(0.46, 0.62, 0.26), h);
    if (vnoise(p.xz * 0.6 + p.y * 0.4) > 0.72) c = mix(vec3(0.55, 0.43, 0.28), vec3(0.62, 0.5, 0.33), h);
    if (tex(uv * 1.7 + 4.0) > 0.985) c = tex(uv + 2.0) > 0.5 ? vec3(0.95, 0.85, 0.35) : vec3(0.95, 0.6, 0.7);
    return c;
  }
  if (m < 2.5) { // бублик: румяное тесто с маком
    vec3 tq;
    torusLocal(p, tq);
    float top = smoothstep(-0.5, 1.5, tq.y);
    vec3 c = mix(vec3(0.78, 0.55, 0.3), vec3(0.62, 0.36, 0.16), top) * (0.9 + 0.15 * h);
    if (tex(uv * 1.5) > 0.93) c = vec3(0.12, 0.1, 0.12);
    return c;
  }
  if (m < 3.5) { // тыква: дольки темнее в бороздах
    vec3 q = p - P_PUMP;
    float rib = abs(sin(5.0 * atan(q.z, q.x)));
    return mix(vec3(0.75, 0.32, 0.08), vec3(0.95, 0.52, 0.15), smoothstep(0.0, 0.5, rib)) * (0.9 + 0.12 * h);
  }
  if (m < 4.5) { // клубок: полосы ниток вокруг двух осей
    vec3 q = normalize(p - P_MOON);
    float a = sin(q.y * 26.0 + q.x * 6.0), b = sin(dot(q, normalize(vec3(1.0, 0.3, 0.6))) * 30.0);
    return mix(vec3(0.75, 0.35, 0.45), vec3(0.9, 0.6, 0.65), step(0.0, a * b)) * (0.9 + 0.12 * h);
  }
  if (m < 5.5) return mix(vec3(0.45, 0.3, 0.18), vec3(0.58, 0.4, 0.24), tex(vec2(uv.x * 0.3, uv.y)));
  if (m < 6.5) return mix(vec3(0.62, 0.2, 0.15), vec3(0.75, 0.28, 0.2), h);
  if (m < 7.5) return mix(vec3(0.12, 0.12, 0.2), vec3(1.0, 0.8, 0.45), uLit);
  if (m < 8.5) return mix(vec3(0.55, 0.53, 0.5), vec3(0.7, 0.66, 0.6), h);
  if (m < 9.5) return mix(vec3(0.26, 0.48, 0.2), vec3(0.36, 0.58, 0.24), h);
  if (m < 10.5) return vec3(0.4, 0.28, 0.18) * (0.85 + 0.2 * h);
  if (m < 11.5) return tex(uv * 0.7 + 3.0) > 0.75 ? vec3(0.95, 0.92, 0.85) : vec3(0.85, 0.2, 0.15); // мухомор
  if (m < 12.5) return vec3(0.95, 0.9, 0.78);
  if (m < 13.5) return vec3(1.0, 0.75, 0.3);
  if (m < 14.5) return mix(vec3(0.3, 0.28, 0.25), vec3(1.0, 0.85, 0.5), uLit);
  if (m < 15.5) return vec3(0.25, 0.42, 0.7) * (0.9 + 0.1 * h);
  if (m < 16.5) return vec3(0.95, 0.75, 0.6);
  return vec3(0.4, 0.5, 0.25);
}

void main() {
  vec2 sp = (2.0 * gl_FragCoord.xy - uResolution) / min(uResolution.x, uResolution.y);
  vec3 fw = normalize(uTarget - uEye);
  vec3 rt = normalize(cross(fw, uCamUp));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 1.5 + rt * sp.x + up * sp.y);
  vec3 ro = uEye;

  float t = 0.05;
  vec2 m = vec2(0.0);
  bool hit = false;
  for (int i = 0; i < 160; i++) {
    m = world(ro + rd * t, true);
    if (m.x < 0.0008 * t + 0.0005) { hit = true; break; }
    t += m.x * 0.9;
    if (t > 90.0) break;
  }
  vec3 sky = skyCol(rd);
  vec3 col = sky;
  if (hit) {
    vec3 p = ro + rd * t;
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.002;
    vec3 n = normalize(k.xyy * world(p + k.xyy * e, true).x + k.yyx * world(p + k.yyx * e, true).x
                     + k.yxy * world(p + k.yxy * e, true).x + k.xxx * world(p + k.xxx * e, true).x);
    vec3 alb = albedo(p, n, m.y);
    float emit = m.y > 12.5 && m.y < 13.5 ? 1.6 : (m.y > 6.5 && m.y < 7.5) || (m.y > 13.5 && m.y < 14.5) ? 1.4 * uLit : 0.0;
    float dif = max(dot(n, SUN), 0.0);
    // тень от солнца — короткий марш (свои планеты затеняют друг друга)
    float sh = 1.0, ts = 0.05;
    for (int i = 0; i < 28; i++) {
      float h = world(p + n * 0.02 + SUN * ts, false).x;
      if (h < 0.002) { sh = 0.0; break; }
      ts += max(h, 0.05);
      if (ts > 20.0) break;
    }
    // тёплый свет маяка в финале
    vec3 bl = uBeaconPos + uBeaconUp * 2.8 - p;
    float bd = length(bl);
    vec3 beam = vec3(1.0, 0.75, 0.4) * uLit * 6.0 * max(dot(n, bl / bd), 0.0) / (1.0 + bd * bd * 0.15);
    col = alb * (vec3(0.32, 0.25, 0.4) + vec3(1.0, 0.8, 0.58) * 1.5 * dif * (0.3 + 0.7 * sh) + beam) + alb * emit;
    col = mix(col, sky * 0.6 + vec3(0.12, 0.08, 0.14), smoothstep(25.0, 85.0, t)); // сумеречная дымка
  }
  col += uFlash * vec3(1.0, 0.85, 0.6);
  fragColor = vec4(col / (1.0 + col * 0.25), 1.0);
}
