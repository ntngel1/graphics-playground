// ===================== МАНИФЕСТ «ВСЁ — СИНУС» =====================
// В игровом поле нет ни одной картинки, спрайта, шрифта, текстуры или шума. Каждая форма, цвет,
// движение, фон и HUD собраны из одной трансцендентной функции — sin — и арифметики.
//
// АЛФАВИТ (полный список встроенных функций GLSL, разрешённых в шейдерах игры):
//   sin                      — единственная «кривая»; cos(x) = sin(x + π/2) → cs()
//   + − × ÷, sqrt, dot       — арифметика (sqrt и dot — теорема Пифагора: длина вектора)
//   abs min max clamp mix step smoothstep — кромка и композиция
//   конструкторы vec2/vec3/vec4/float/int
// Запрещено: cos tan atan exp log pow fract floor mod length normalize, texture/texelFetch,
// хэши и шум, библиотека src/glsl. Угол θ не вычисляется вовсе: (cos nθ, sin nθ) получается
// возведением единичного комплексного числа z = p/|p| в степень n — это n умножений.
// Проверяется тестом tests/sine-manifest.test.ts (список вызовов в каждом файле папки ⊆ алфавит).
// ===================================================================

const float PI = 3.14159265;
const float TAU = 6.28318531;

float cs(float x) { return sin(x + 0.5 * PI); }
vec3 cs3(vec3 x) { return sin(x + 0.5 * PI); }
float len(vec2 v) { return sqrt(dot(v, v)); }

// комплексное умножение: поворот + масштаб
vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }

// z^n для единичного z = (cosθ, sinθ) → (cos nθ, sin nθ); n — целое 0..24
vec2 cpow(vec2 z, float n) {
  vec2 r = vec2(1.0, 0.0);
  for (int i = 0; i < 24; i++) {
    if (float(i) >= n) break;
    r = cmul(r, z);
  }
  return r;
}

// точка на окружности по углу — два синуса
vec2 polar(float a) { return vec2(cs(a), sin(a)); }

// цвет частоты n: «косинусная палитра» — три синуса со сдвигом в треть оборота.
// Пять частот 3..7 делят круг оттенков на пять равных частей.
vec3 hue(float n) {
  vec3 c = 0.5 + 0.5 * sin(TAU * (n - 3.0) / 5.0 + 1.2 + vec3(0.0, 2.0944, 4.1888));
  c += (0.6 - dot(c, vec3(0.3, 0.59, 0.11))) * 0.45; // выравнивание яркости: синий не тонет
  return mix(c, vec3(1.0), 0.1);
}

// свечение: лоренциан 1 / (1 + (d/w)²) — рациональная функция, без exp
float glow(float d, float w) {
  float q = d / w;
  return 1.0 / (1.0 + q * q);
}

// Полярное существо: ρ(θ) = R·(1 + a·sin(nθ + φ) + w·max(sin(nθ + φ), 0)⁴)
// z — направление на пиксель (единичное). Возвращает (ρ, dρ/dθ, sin(nθ + φ)).
// Второе слагаемое (w > 0) заостряет кончики лепестков в шипы.
vec3 petal(vec2 z, float n, float phi, float R, float a, float w) {
  vec2 q = cmul(cpow(z, n), polar(phi)); // (cos(nθ+φ), sin(nθ+φ))
  float s = q.y, c = q.x;
  float sp = max(s, 0.0);
  float s4 = sp * sp * sp * sp;
  return vec3(R * (1.0 + a * s + w * s4), R * n * c * (a + 4.0 * w * sp * sp * sp), s);
}

// расстояние со знаком до кривой ρ(θ): (r − ρ) / √(1 + (ρ'/r)²)
float polarSd(float r, vec3 P) {
  float g = P.y / max(r, 0.3 * P.x);
  return (r - P.x) / sqrt(1.0 + g * g);
}

// мягкое сжатие яркости (Рейнхард) — арифметика
vec3 tonemap(vec3 c) { return c * (1.0 + c * 0.25) / (1.0 + c); }
