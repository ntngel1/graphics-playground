// Физика шарика (8×1 ping-pong rgba32f), шаг 1/240 с, 4 итерации на кадр — детерминированно.
// t0: pos.xyz, w — статус (0 ждёт пуска, 1 катится, 2 победа, 3 упал); t1: vel.xyz, w — время без движения;
// t2: x — время качения, y — минимальный зазор map(p) − R после контакта, z — минимальный до выталкивания; t3…t7 — след (позиции раз в 3 кадра).
#include "world.glsl"

uniform sampler2D uBall;
uniform vec3 uGoal;
uniform float uGoalR;
uniform bool uLaunch;
uniform vec3 uStart;

const float DT = 1.0 / 240.0, R = 0.12, G = 6.0, VMAX = 5.0;

vec4 T(int i) { return texelFetch(uBall, ivec2(i, 0), 0); }

void main() {
  int me = int(gl_FragCoord.x);
  vec4 t0 = T(0), t1 = T(1), t2 = T(2);
  vec3 p = t0.xyz, v = t1.xyz;
  float status = t0.w, still = t1.w, time = t2.x, clear = t2.y, depth = t2.z;

  if (status < -0.5) { p = uStart; v = vec3(0.0); status = 0.0; still = 0.0; time = 0.0; clear = 1.0; depth = 1.0; }
  else if (status < 0.5 && uLaunch) status = 1.0;
  if (status > 0.5 && status < 1.5) {
    v.y -= G * DT;
    if (length(v) > VMAX) v *= VMAX / length(v);
    p += v * DT;
    // контакт: выталкивание по нормали (мир может «наехать» на шарик — тогда он едет вместе с ним)
    depth = min(depth, map(p) - R); // проникновение до выталкивания (−R — центр шарика внутри тела)
    for (int it = 0; it < 3; it++) {
      float d = map(p) - R;
      if (d >= 0.0) break;
      vec3 n = worldNormal(p);
      p += n * (-d + 1e-4);
      float vn = dot(v, n);
      if (vn < 0.0) {
        float e = vn < -0.8 ? 0.25 : 0.0;          // слабый отскок только от сильных ударов
        vec3 vt = v - vn * n;
        v = vt * (1.0 - 0.6 * DT) - e * vn * n;     // качение с лёгким трением
      }
    }
    time += DT;
    clear = min(clear, map(p) - R);
    still = length(v) < 0.03 ? still + DT : 0.0;
    if (length(p - uGoal) < uGoalR) status = 2.0;
    if (p.y < -3.0) status = 3.0;
  }

  vec4 o;
  if (me == 0) o = vec4(p, status);
  else if (me == 1) o = vec4(v, still);
  else if (me == 2) o = vec4(time, clear, depth, 0.0);
  else {
    bool shift = uIteration == 0 && uFrame % 3 == 0 && status > 0.5 && status < 2.5;
    o = shift ? (me == 3 ? vec4(t0.xyz, 1.0) : T(me - 1)) : T(me);
    if (t0.w < -0.5) o = vec4(uStart, 0.0); // след после сброса — невидим
  }
  fragColor = o;
}
