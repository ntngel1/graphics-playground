// Невозможный дом: общие материалы и мебель. Мебель — коробки и призмы (гранёная, «PS1»),
// локальные координаты: пол y = 0, «перед» предмета смотрит в +z. vec2 = (расстояние, материал).

#define M_SHELL 1.0   // стены/пол/потолок комнаты (вид — по нормали и комнате)
#define M_WOOD 4.0    // мебель, дерево
#define M_IRON 5.0    // железные двери (не режутся)
#define M_LAMP 6.0    // светящийся плафон
#define M_FABRIC 7.0  // ткань: покрывало, ковёр
#define M_PICT 8.0    // картина/окно-панель
#define M_CUT 9.0     // срез от инструмента (кирпич)
#define M_CLAY 10.0   // прилепленное (глина)
#define M_GRASS 11.0
#define M_LEAF 12.0
#define M_BARK 13.0
#define M_BOOK 14.0
#define M_PAPER 15.0  // записка-подсказка
#define M_GREEN 16.0  // крашеное дерево (рамы выходов)
#define M_BRASS 17.0  // ручки, люстра

vec2 U(vec2 a, vec2 b) { return a.x < b.x ? a : b; }
vec2 B(vec3 p, vec3 c, vec3 h, float m) { return vec2(sdBox(p - c, h), m); }
float box2(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }

vec2 table(vec3 p) {
  vec2 d = B(p, vec3(0.0, 0.74, 0.0), vec3(0.6, 0.03, 0.4), M_WOOD);
  vec3 l = vec3(abs(p.x) - 0.54, p.y - 0.36, abs(p.z) - 0.34);
  return U(d, vec2(sdBox(l, vec3(0.035, 0.36, 0.035)), M_WOOD));
}

vec2 chair(vec3 p) {
  vec2 d = B(p, vec3(0.0, 0.45, 0.0), vec3(0.22, 0.025, 0.22), M_WOOD);
  vec3 l = vec3(abs(p.x) - 0.19, p.y - 0.22, abs(p.z) - 0.19);
  d = U(d, vec2(sdBox(l, vec3(0.025, 0.22, 0.025)), M_WOOD));
  d = U(d, B(p, vec3(0.0, 0.8, -0.2), vec3(0.22, 0.3, 0.025), M_WOOD));
  return d;
}

vec2 bed(vec3 p) {
  vec2 d = B(p, vec3(0.0, 0.2, 0.0), vec3(0.5, 0.2, 1.0), M_WOOD);
  d = U(d, B(p, vec3(0.0, 0.47, 0.03), vec3(0.47, 0.08, 0.95), M_FABRIC));
  d = U(d, B(p, vec3(0.0, 0.6, -0.75), vec3(0.32, 0.06, 0.15), M_PAPER));
  d = U(d, B(p, vec3(0.0, 0.6, -1.0), vec3(0.5, 0.6, 0.04), M_WOOD));
  return d;
}

vec2 wardrobe(vec3 p) { // шкаф 1.2 × 2.0 × 0.6, створки
  vec2 d = B(p, vec3(0.0, 1.0, 0.0), vec3(0.6, 1.0, 0.3), M_WOOD);
  d = U(d, B(vec3(abs(p.x), p.yz), vec3(0.05, 1.0, 0.31), vec3(0.015, 0.025, 0.015), M_BRASS));
  return d;
}

vec2 radiator(vec3 p) { // батарея: рёбра вдоль x
  float fx = p.x - 0.12 * clamp(round(p.x / 0.12), -4.0, 4.0);
  vec2 d = vec2(sdBox(vec3(fx, p.y - 0.4, p.z), vec3(0.035, 0.3, 0.07)), M_IRON);
  return U(d, B(p, vec3(0.0, 0.1, 0.0), vec3(0.55, 0.02, 0.03), M_IRON));
}

vec2 picture(vec3 p, vec2 size) { // на стене, лицом в +z: рама + холст
  vec2 d = vec2(max(sdBox(p, vec3(size + 0.05, 0.025)), -sdBox(p - vec3(0.0, 0.0, 0.03), vec3(size, 0.03))), M_WOOD);
  return U(d, vec2(sdBox(p, vec3(size, 0.012)), M_PICT));
}

vec2 hangLamp(vec3 p) { // висит с потолка: шнур + шестигранный абажур, низ светится
  vec2 d = vec2(length(p.xz) - 0.012, M_IRON);
  d.x = max(d.x, -p.y - 0.01);
  float sh = max(ngonR(p.xz, 6.0) - mix(0.2, 0.1, clamp((p.y + 0.55) / 0.25, 0.0, 1.0)), abs(p.y + 0.42) - 0.13);
  d = U(d, vec2(sh, M_FABRIC));
  return U(d, vec2(max(ngonR(p.xz, 6.0) - 0.16, abs(p.y + 0.56) - 0.012), M_LAMP));
}

vec2 wallLamp(vec3 p) { // бра на стене, лицом в +z
  vec2 d = B(p, vec3(0.0, 0.0, 0.03), vec3(0.06, 0.08, 0.03), M_BRASS);
  return U(d, vec2(max(ngonR(p.xy - vec2(0.0, 0.08), 6.0) - 0.09, abs(p.z - 0.12) - 0.08), M_LAMP));
}

// дверное полотно 0.94 × 2.0 × 0.06, петли у x = −0.47, открывается поворотом на ang; с ручкой
vec2 doorSlab(vec3 p, float ang, float m, bool win) {
  p.x += 0.47;
  p.xz = rot2(-ang) * p.xz;
  p.x -= 0.47;
  vec2 d = B(p, vec3(0.0, 1.0, 0.0), vec3(0.47, 1.0, 0.03), m);
  if (win) d.x = max(d.x, -sdBox(p - vec3(0.0, 1.55, 0.0), vec3(0.17, 0.2, 0.1))); // окошко
  return U(d, vec2(length(vec3(p.x - 0.36, p.y - 1.0, abs(p.z) - 0.07)) - 0.035, M_BRASS));
}

vec2 bookshelf(vec3 p, float h) { // стеллаж ширина 1.8, глубина 0.4, высота h; книги — материал M_BOOK
  vec2 d = vec2(max(sdBox(p - vec3(0.0, h * 0.5, 0.0), vec3(0.9, h * 0.5, 0.2)),
                    -sdBox(vec3(p.x, mod(p.y, 0.5) - 0.25, p.z - 0.05), vec3(0.85, 0.22, 0.2))), M_WOOD);
  float books = sdBox(vec3(p.x, mod(p.y, 0.5) - 0.2, p.z - 0.02), vec3(0.83, 0.17, 0.16));
  books = max(books, p.y - h + 0.1);
  return U(d, vec2(books, M_BOOK));
}

// рама проёма 0.96 × 2.04 из трёх брусков (точное SDF; «бокс минус бокс» занижал бы расстояние в проёме —
// физика упиралась бы в пустоту). frameZ — проход вдоль z, frameX — вдоль x; e — от низа центра проёма
vec2 frameZ(vec3 e) {
  float d = sdBox(vec3(abs(e.x) - 0.53, e.y - 1.07, e.z), vec3(0.05, 1.07, 0.04));
  d = min(d, sdBox(vec3(e.x, e.y - 2.09, e.z), vec3(0.58, 0.05, 0.04)));
  return vec2(d, M_GREEN);
}
vec2 frameX(vec3 e) { return frameZ(vec3(e.z, e.y, e.x)); }

vec2 note(vec3 p) { return B(p, vec3(0.0), vec3(0.14, 0.1, 0.005), M_PAPER); } // записка на стене, лицом в +z
