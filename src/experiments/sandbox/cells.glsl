// Материалы и упаковка клетки. Состояние — rgba8: R — материал, G — время жизни/температура,
// B — оттенок зерна (случайный при рождении, едет вместе с частицей), A — флаги:
// бит 0 — направление растекания (0 влево, 1 вправо), биты 1..4 — материал, который испускает «кран».
// Список и порядок — как в MATERIALS (sim.ts).
#include <noise>

uniform sampler2D uState;
uniform vec2 uStateSize;

const int EMPTY = 0, WALL = 1, SAND = 2, WATER = 3, OIL = 4, LAVA = 5, FIRE = 6, SMOKE = 7,
          STEAM = 8, PLANT = 9, ACID = 10, STONE = 11, POWDER = 12, TAP = 13, ERASER = 15;

//                                 empty wall  sand  water oil   lava  fire  smoke steam plant acid  stone powdr tap
const float DENSITY[14] = float[14](0.0,  99.0, 1.6,  1.0,  0.8,  2.2,  -0.6, -1.0, -1.2, 99.0, 1.05, 2.6,  1.3,  99.0);
// вероятность сдвинуться за шаг (вязкость/«ленивость»)
const float MOBILITY[14] = float[14](0.0, 0.0,  1.0,  1.0,  0.9,  0.45, 0.45, 0.5,  0.6,  0.0,  1.0,  1.0,  1.0,  0.0);

struct Cell { int m; int life; int shade; int flags; };

bool isStatic(int m) { return m == WALL || m == PLANT || m == TAP; }
bool isPowder(int m) { return m == SAND || m == STONE || m == POWDER; }
bool isLiquid(int m) { return m == WATER || m == OIL || m == LAVA || m == ACID; }
bool isGas(int m) { return m == FIRE || m == SMOKE || m == STEAM; }
bool isFlammable(int m) { return m == OIL || m == PLANT || m == POWDER; }

Cell loadCell(ivec2 p) {
  ivec2 sz = ivec2(uStateSize);
  if (p.x < 0 || p.y < 0 || p.x >= sz.x || p.y >= sz.y) return Cell(WALL, 0, 128, 0); // мир окружён стеной
  vec4 t = texelFetch(uState, p, 0) * 255.0 + 0.5;
  return Cell(int(t.r), int(t.g), int(t.b), int(t.a));
}

vec4 packCell(Cell c) { return vec4(float(c.m), float(clamp(c.life, 0, 255)), float(c.shade), float(c.flags)) / 255.0; }

// новая частица: оттенок и направление — из хэша
Cell newCell(int m, int life, uint seed) {
  uvec3 h = pcg3d(uvec3(seed, 0x51ed27u, 0x2b7au));
  return Cell(m, life, int(h.x & 255u), int(h.y & 1u));
}
