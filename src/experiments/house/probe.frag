// Зонд для физики и прицела (буфер 8×1 rgba32f, читается JS в том же кадре — ctx.read):
//  0..3 — пробы капсулы на высотах H[i] над ногами: (расстояние, градиент xyz)
//  4    — пол под игроком: (y пола, есть ли пол, -, -) — спуск лучом сверху (с высоты ног + 0.65)
//  5    — прицел: (точка попадания xyz, дистанция или −1) — луч из глаз через порталы
//  6    — нормаль в точке прицела (xyz), w — число пройденных порталов
//  7    — видимость якоря uVisPt из глаз: (1 — видно, дистанция до помехи, -, -)
#include "world.glsl"

uniform vec3 uPos;    // ноги игрока
uniform vec3 uEye;
uniform vec3 uAimDir;
uniform vec3 uVisPt;

// нижняя проба на высоте ступеньки + радиус: всё не выше STEP (0.3) — «пол» (на него шагаем, проба 4),
// всё выше — стена (иначе предметы высотой 0.3…0.6, как сиденье стула, проходили бы сквозь игрока)
const float H[4] = float[4](0.6, 0.95, 1.3, 1.65);

void main() {
  int i = int(gl_FragCoord.x);
  vec4 o = vec4(0.0);
  if (i < 4) {
    vec3 p = uPos + vec3(0.0, H[i], 0.0);
    float d = map(p);
    const vec2 k = vec2(1.0, -1.0);
    const float e = 0.01;
    vec3 g = k.xyy * map(p + k.xyy * e) + k.yyx * map(p + k.yyx * e) + k.yxy * map(p + k.yxy * e) + k.xxx * map(p + k.xxx * e);
    float gl = length(g);
    o = vec4(d, gl > 1e-6 ? g / gl : vec3(0.0)); // ровное поле — без градиента (не NaN)
  } else if (i == 4) {
    vec3 p = uPos + vec3(0.0, 0.65, 0.0);
    float t = 0.0, found = 0.0;
    for (int s = 0; s < 64; s++) {
      float h = map(p - vec3(0.0, t, 0.0));
      if (h < 0.002) { found = 1.0; break; }
      t += h * 0.9;
      if (t > 4.0) break;
    }
    o = vec4(p.y - t, found, 0.0, 0.0);
  } else if (i == 5 || i == 6) {
    vec3 ro = uEye, rd = uAimDir;
    float t, tTot;
    int cr;
    bool hit = marchP(ro, rd, 6.0, 160, t, tTot, cr);
    vec3 p = ro + rd * t;
    if (i == 5) o = hit ? vec4(p, tTot + t) : vec4(0.0, 0.0, 0.0, -1.0);
    else o = vec4(hit ? calcNormal(p, 0.002) : vec3(0.0), float(cr));
  } else {
    vec3 dir = uVisPt - uEye;
    float L = length(dir);
    dir /= L;
    float t = 0.05, vis = 1.0;
    for (int s = 0; s < 80; s++) {
      float h = map(uEye + dir * t);
      if (h < 0.003) { vis = 0.0; break; }
      t += h;
      if (t > L - 0.3) break;
    }
    o = vec4(vis, t, 0.0, 0.0);
  }
  fragColor = o;
}
