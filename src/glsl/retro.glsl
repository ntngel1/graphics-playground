// PS1-вид для реймарчинга (см. src/retro/retro.ts — буфер низкого разрешения + вывод на экран).
// Здесь: дизеринг Байера и квантование цвета, гранёные примитивы, квантование нормали,
// «дрожание вершин» (привязка опорных точек к пиксельной сетке низкого буфера).

// матрица Байера 4×4 через рекурсию 2×2: порог 0..15/16, привязан к целым пикселям
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

// цвет → bits на канал с упорядоченным дизерингом (strength 0 — без него, 1 — классический)
vec3 retroQuantize(vec3 c, vec2 px, float bits, float strength) {
  float levels = exp2(bits) - 1.0;
  float th = (bayer4(px) - 0.5) * strength;
  return clamp(floor(c * levels + 0.5 + th) / levels, 0.0, 1.0);
}

// «радиус» правильного n-угольника по вписанной окружности: = r на ребре многоугольника с апофемой r
float ngonR(vec2 v, float n) {
  float s = 6.2831853 / n;
  float a = atan(v.y, v.x);
  a = mod(a + 0.5 * s, s) - 0.5 * s;
  return length(v) * cos(a);
}

// гранёная ветка: n-угольная призма вдоль +y длины L, сужение r0 → r1, плоские торцы
// (нижний торец утоплен на r0 — стык с родителем без щели)
float sdPrismBranch(vec3 q, float L, float r0, float r1, float n) {
  float h = clamp(q.y / max(L, 1e-4), 0.0, 1.0);
  float rad = ngonR(q.xz, n) - mix(r0, r1, h);
  float ax = max(-q.y - r0, q.y - L);
  return min(max(rad, ax), 0.0) + length(max(vec2(rad, ax), 0.0));
}

// додекаэдр (12 граней) — «низкополигональный шар»: max по |dot(p, n_i)|
float sdDodeca(vec3 p, float r) {
  const float a = 0.5257311, b = 0.8506508;
  p = abs(p); // нормали граней (0,±1,φ) и перестановки — после abs остаются три
  return max(dot(p, vec3(0.0, a, b)), max(dot(p, vec3(a, b, 0.0)), dot(p, vec3(b, 0.0, a)))) - r;
}

// икосаэдр-подобный (20 граней) — потоньше додекаэдра
float sdIcosa(vec3 p, float r) {
  const float g = 0.5773503, a = 0.3568221, b = 0.9341724;
  p = abs(p);
  float d = max(dot(p, vec3(g)), max(dot(p, vec3(0.0, a, b)), max(dot(p, vec3(a, b, 0.0)), dot(p, vec3(b, 0.0, a)))));
  return d - r;
}

// нормаль → ближайшее из сетки направлений по сферическим координатам (steps делений по широте)
vec3 quantNormal(vec3 n, float steps) {
  float th = acos(clamp(n.y, -1.0, 1.0));
  float ph = atan(n.z, n.x);
  float s = 3.14159265 / steps;
  th = (floor(th / s) + 0.5) * s;
  ph = (floor(ph / s) + 0.5) * s;
  return vec3(sin(th) * cos(ph), cos(th), sin(th) * sin(ph));
}

// «дрожание вершин»: смещение опорной точки w так, чтобы её проекция легла на сетку низкого буфера
// с шагом step px. Камера: позиция ro, базис (u, v, w), f = 1/tan(fov/2), res — размер буфера.
// Прибавьте результат к позиции объекта (или вычтите из локальной точки SDF).
vec3 retroSnap(vec3 wpos, vec3 ro, vec3 cu, vec3 cv, vec3 cw, float f, vec2 res, float step) {
  if (step <= 0.0) return vec3(0.0);
  vec3 r = wpos - ro;
  float z = dot(r, cw);
  if (z < 0.1) return vec3(0.0);
  float k = f * 0.5 * min(res.x, res.y); // px на единицу tan
  vec2 s = vec2(dot(r, cu), dot(r, cv)) / z * k;
  vec2 e = (floor(s / step + 0.5) * step - s) / k * z;
  return cu * e.x + cv * e.y;
}

// текстура «с дискеты»: крупные тексели без фильтрации — хэш целой клетки
vec2 texel(vec2 uv, float n) { return floor(uv * n) / n; }
