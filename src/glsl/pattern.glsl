// Процедурные узоры с аналитической фильтрацией (без муара вдали). Используют fwidth —
// вызывайте в равномерном потоке управления (не внутри ветвей, зависящих от пикселя).

// 0/1 шахматка, сглаженная по размеру пикселя
float checkersFiltered(vec2 p) {
  vec2 w = fwidth(p) + 1e-4;
  vec2 i = 2.0 * (abs(fract((p - 0.5 * w) * 0.5) - 0.5) - abs(fract((p + 0.5 * w) * 0.5) - 0.5)) / w;
  return 0.5 - 0.5 * i.x * i.y;
}

// 1 внутри ячейки, 0 на линии; n — отношение размера ячейки к толщине линии
float gridFiltered(vec2 p, float n) {
  vec2 w = fwidth(p) + 1e-4;
  vec2 a = p + 0.5 * w, b = p - 0.5 * w;
  vec2 i = (floor(a) + min(fract(a) * n, 1.0) - floor(b) - min(fract(b) * n, 1.0)) / (n * w);
  return (1.0 - i.x) * (1.0 - i.y);
}
