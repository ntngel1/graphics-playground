// Детали уровней: наклонная плита и жёлоб из секций, которые «скручивание» поворачивает вокруг оси жёлоба.
#include <sdf>

// плита: центр c, полуразмеры b, наклон вокруг оси z (рад, + — правый край выше)
float slab(vec3 p, vec3 c, vec3 b, float tilt) {
  p -= c;
  p.xy = rot2(-tilt) * p.xy;
  return sdRoundBox(p, b, 0.03);
}

// Жёлоб S→E (в плоскости xy) из n секций с V-образным дном (уклон 20° к середине — шарик сам держится
// по центру). Секция i повёрнута вокруг оси жёлоба на угол (K − Kstar)·t_i, t_i — расстояние центра секции
// от первой (первая не вращается никогда — шарик стартует/падает туда): при K = Kstar все стоят ровно и
// складываются в непрерывный жёлоб; при другом K дальние секции наклоняются сильнее ближних, и наклон больше ~20° сбрасывает шарик вбок. Торцы закрыты.
float chute(vec3 p, vec3 S, vec3 E, int n, float W, float K, float Kstar) {
  vec3 dir = normalize(E - S);
  vec3 side = vec3(0.0, 0.0, 1.0);
  vec3 up = cross(side, dir);
  if (up.y < 0.0) up = -up; // жёлоб открыт вверх при любом направлении S→E
  float len = length(E - S), L = len / float(n);
  vec3 q = p - 0.5 * (S + E);
  float t = dot(q, dir);
  vec2 yz = vec2(dot(q, up), dot(q, side));
  float i0 = clamp(floor((t + 0.5 * len) / L), 0.0, float(n - 1));
  const float CA = 0.9397, SA = 0.3420; // cos/sin 20°
  float d = 1e5;
  for (int j = -1; j <= 1; j++) {
    float i = i0 + float(j);
    if (i < 0.0 || i > float(n - 1)) continue;
    float ti = -0.5 * len + (i + 0.5) * L;
    vec2 r = rot2((K - Kstar) * i * L) * yz;
    float vee = max(abs(r.x * CA - abs(r.y) * SA) - 0.04, abs(r.y) - W);
    float cap = 1e5;
    if (i == 0.0) cap = max(max(abs(r.y) - W, abs(r.x - 0.1) - 0.14), abs(t + 0.5 * len) - 0.04);
    if (i == float(n - 1)) cap = max(max(abs(r.y) - W, abs(r.x - 0.1) - 0.14), abs(t - 0.5 * len) - 0.04);
    d = min(d, max(min(vee, cap), abs(t - ti) - 0.5 * L - 0.004));
  }
  return d;
}
