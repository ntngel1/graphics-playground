// Комната 3 — лестница, которая замыкается (x ≈ 90). Нижняя площадка (y 0) → 12 ступеней по +z → верхняя
// площадка (y 3) с дверью (портал 6), которая выводит обратно на нижнюю площадку через её заднюю дверь (портал 7).
// uMorph 0..1 — дверь наверху перетекает в арку на чердак; меняется ТОЛЬКО пока игрок на неё не смотрит
// (решает JS). При uMorph > 0 портал 6 выключен — за аркой настоящий чердак.

uniform float uMorph;

vec2 stairs(vec3 p, out vec2 fixedPart) {
  vec3 q = p - vec3(90.0, 0.0, 0.0);
  float space = sdBox(q - vec3(0.0, 1.35, 0.0), vec3(1.6, 1.35, 2.0));                 // нижняя площадка
  space = min(space, sdBox(q - vec3(0.0, 2.9, 4.8), vec3(1.2, 2.9, 3.8)));           // пролёт (заходит на площадки)
  space = min(space, sdBox(q - vec3(0.0, 4.35, 8.7), vec3(1.6, 1.35, 1.3)));         // верхняя площадка
  space = min(space, sdBox(q - vec3(-1.8, 1.05, 0.0), vec3(0.9, 1.05, 0.5)));        // вход (портал 5)
  space = min(space, sdBox(q - vec3(0.0, 1.05, -2.2), vec3(0.5, 1.05, 0.9)));        // задняя дверь (портал 7)
  // проём наверху: прямоугольник → арка (выше и шире, со скруглённым верхом) по мере перетекания
  vec3 dq = q - vec3(0.0, 3.0, 10.5);
  float rect = sdBox(dq - vec3(0.0, 1.05, 0.0), vec3(0.5, 1.05, 1.3));
  float arch = min(sdBox(dq - vec3(0.0, 0.9, 0.0), vec3(0.75, 0.9, 1.3)), max(length(dq.xy - vec2(0.0, 1.8)) - 0.75, abs(dq.z) - 1.3));
  space = min(space, mix(rect, arch, smoothstep(0.0, 1.0, uMorph)));
  // чердак за дверью: скошенная крыша
  vec3 aq = q - vec3(0.0, 3.0, 14.0);
  float attic = max(sdBox(aq - vec3(0.0, 1.75, 0.0), vec3(2.5, 1.75, 3.0)), (aq.y - 3.4 + 0.75 * abs(aq.x)) * 0.8);
  space = min(space, attic);
  space = min(space, sdBox(q - vec3(0.0, 4.05, 17.2), vec3(0.5, 1.05, 0.9)));       // выход с чердака (портал 8)
  float shell = sdBox(q - vec3(0.0, 3.3, 7.5), vec3(3.6, 4.3, 11.0));
  vec2 d = vec2(max(-space, shell), M_SHELL);
  // ступени: 12 × (подъём 0.25, проступь 0.5), сплошные до пола; две ближайшие
  float zs = q.z - 2.0;
  float i0 = clamp(floor(zs / 0.5), 0.0, 11.0);
  for (int k = 0; k < 2; k++) {
    float i = clamp(i0 + float(k) - (fract(zs / 0.5) < 0.5 ? 1.0 : 0.0), 0.0, 11.0);
    float top = 0.25 * (i + 1.0);
    d = U(d, vec2(sdBox(q - vec3(0.0, top * 0.5 - 0.5, 2.0 + 0.5 * i + 0.25), vec3(1.2, top * 0.5 + 0.5, 0.25)), M_WOOD));
  }
  // под верхней площадкой — сплошное (пролёт-пустота заходит сюда ради гладкого стыка)
  d = U(d, vec2(sdBox(q - vec3(0.0, 1.0, 8.4), vec3(1.6, 2.0, 0.4)), M_SHELL));
  // перила справа
  float rz = clamp(q.z, 2.0, 8.0);
  vec3 rp = vec3(q.x - 1.05, q.y - (0.5 * (rz - 2.0) + 0.95), q.z - rz);
  d = U(d, vec2(sdBox(rp, vec3(0.03, 0.03, 0.04)) - 0.0, M_WOOD));
  float bz = q.z - 0.5 * clamp(round(q.z / 0.5), 4.0, 16.0);
  d = U(d, vec2(sdBox(vec3(q.x - 1.05, q.y - 0.5 * (clamp(round(q.z / 0.5) * 0.5, 2.0, 8.0) - 2.0) - 0.55, bz), vec3(0.02, 0.45, 0.02)), M_WOOD));
  // нижняя площадка: картина, лампа; верхняя: картина-«окно» (подсказка), цветок
  d = U(d, picture(vec3(-(q.z + 0.3), q.y - 1.5, q.x - 1.58) * vec3(1.0, 1.0, -1.0), vec2(0.35, 0.28)));
  d = U(d, hangLamp(q - vec3(0.0, 2.7, -0.6)));
  d = U(d, hangLamp(q - vec3(0.0, 5.7, 9.0)));
  d = U(d, picture(vec3(q.z - 9.0, q.y - 4.6, q.x + 1.58), vec2(0.3, 0.4)));
  vec3 pq = q - vec3(1.2, 3.0, 9.5);
  d = U(d, vec2(max(ngonR(pq.xz, 6.0) - mix(0.16, 0.2, pq.y / 0.35), abs(pq.y - 0.17) - 0.17), M_CUT));
  d = U(d, vec2(sdDodeca(pq - vec3(0.0, 0.6, 0.0), 0.25), M_LEAF));
  // чердак: кровать, сундук, стул, круглое окно
  vec3 bq = aq - vec3(-1.4, 0.0, 1.0);
  bq.xz = rot2(1.5708) * bq.xz;
  d = U(d, bed(bq));
  d = U(d, B(aq, vec3(1.5, 0.3, -1.5), vec3(0.45, 0.3, 0.3), M_WOOD));
  vec3 ch = aq - vec3(1.4, 0.0, 1.2);
  ch.xz = rot2(-2.0) * ch.xz;
  d = U(d, chair(ch));
  d = U(d, vec2(max(length(aq.xy - vec2(1.5, 1.6)) - 0.3, abs(aq.z - 2.98) - 0.03), M_PICT)); // круглое окно сбоку от выхода
  d = U(d, hangLamp(aq - vec3(0.0, 3.3, 0.0)));

  // не режется: рамы. Рама верхней двери при перетекании утапливается в стену и исчезает
  vec3 tf = dq - vec3(0.0, 0.0, -0.48 + 0.35 * uMorph);
  fixedPart = frameZ(tf);
  fixedPart.x += 0.3 * smoothstep(0.7, 1.0, uMorph);
  vec3 e = q - vec3(0.0, 0.0, -1.98);
  fixedPart = U(fixedPart, frameZ(e));
  vec3 e2 = q - vec3(0.0, 3.0, 16.98);
  fixedPart = U(fixedPart, frameZ(e2));
  return d;
}

// Сад (x ≈ 300; далеко от границы области 120 — лучи в саду не уходят в чужую область): выход из дома — фасад с дверью (портал 9), трава, холм, дерево. Финал.
vec2 garden(vec3 p, out vec2 fixedPart) {
  vec3 q = p - vec3(300.0, 0.0, 0.0);
  float hill = 0.9 * exp(-dot(q.xz - vec2(0.0, 12.0), q.xz - vec2(0.0, 12.0)) / 40.0);
  vec2 d = vec2((q.y - hill) * 0.8, M_GRASS);
  // фасад дома позади (с дверным проёмом) — откуда вышел игрок
  float wall = sdBox(q - vec3(0.0, 2.5, -0.5), vec3(5.0, 2.5, 0.4));
  wall = max(wall, -sdBox(q - vec3(0.0, 1.05, -0.5), vec3(0.5, 1.05, 1.0))); // глубокий вычет — без «фантома» в проёме
  d = U(d, vec2(wall, M_SHELL));
  d = U(d, vec2(max(sdBox(q - vec3(0.0, 5.3, -0.5), vec3(5.4, 0.4, 0.8)), 0.0), M_CUT)); // крыша-карниз
  // дерево (гранёное, как в tree/ps1): ствол-призма и комки-додекаэдры
  vec3 tq = q - vec3(1.5, hill, 12.0);
  d = U(d, vec2(max(ngonR(tq.xz, 6.0) - mix(0.25, 0.14, clamp(tq.y / 2.5, 0.0, 1.0)), abs(tq.y - 1.2) - 1.3), M_BARK));
  for (int i = 0; i < 5; i++) {
    vec3 c = vec3(sin(float(i) * 2.4) * 0.9, 2.6 + 0.35 * float(i % 2), cos(float(i) * 2.4) * 0.9);
    vec3 bq = tq - c;
    bq.xz = rot2(float(i) * 1.3) * bq.xz;
    d = U(d, vec2(sdDodeca(bq, 0.85 - 0.08 * float(i)), M_LEAF));
  }
  fixedPart = vec2(1e9, 0.0);
  return d;
}
