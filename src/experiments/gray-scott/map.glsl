// Отображение экрана карты на (feed, kill) — то же, что mapToFK/fkToMap в sim.ts.
// Ось Y — feed (линейно), ось X — сдвиг kill относительно седло-узловой кривой Пирсона
// k_sn(F) = sqrt(F)/2 - F. Интересный «серп» узоров идёт вдоль этой кривой, причём сверху он уже,
// поэтому диапазон сдвига сужается с ростом feed. Так серп занимает почти весь экран.
uniform vec2 uMapFeed; // [F0, F1]
uniform vec4 uMapDk;   // диапазон сдвига kill от k_sn(F): xy — внизу (F0), zw — вверху (F1)

float kSaddle(float F) { return sqrt(F) * 0.5 - F; }

vec2 mapToFK(vec2 uv) {
  float F = mix(uMapFeed.x, uMapFeed.y, uv.y);
  vec2 dk = mix(uMapDk.xy, uMapDk.zw, uv.y);
  return vec2(F, kSaddle(F) + mix(dk.x, dk.y, uv.x));
}

vec2 fkToMap(vec2 fk) {
  float y = (fk.x - uMapFeed.x) / (uMapFeed.y - uMapFeed.x);
  vec2 dk = mix(uMapDk.xy, uMapDk.zw, y);
  return vec2((fk.y - kSaddle(fk.x) - dk.x) / (dk.y - dk.x), y);
}
