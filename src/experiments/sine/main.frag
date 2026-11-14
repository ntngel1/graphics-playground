// Resonance — один экранный проход рисует всё: фон-интерференцию, рябь, существ, игрока, HUD.
// Только алфавит из alphabet.glsl (см. манифест там же).
#include "alphabet.glsl"

#define N 36
// слот: A = (x, y, R, вид)  B = (n1, n2, смесь, амплитуда)  C = (фаза, альфа, шипы, вспышка)  D = путь
// вид: 0 игрок, 1 дрейф, 2 восьмёрка, 3 пульсар, 4 мерцающий, 5 голова змейки, 6 сегмент
uniform vec4 uA[N];
uniform vec4 uB[N];
uniform vec4 uC[N];
uniform vec4 uD[N];
uniform int uCount;
uniform vec4 uTrail[10]; // (x, y, вес, -)
uniform vec4 uRip[8];    // (x, y, возраст, n; n < 0 — удар)
uniform float uT;        // игровое время
uniform vec2 uShake;
uniform float uXray;     // 0..1 — режим формул
uniform float uOver;     // 0..1 — конец игры
uniform float uScore;
uniform float uCombo;
uniform vec4 uSel;       // селектор частот: (x первой кнопки, y, шаг, радиус) в px канваса
uniform vec4 uCnt0;      // число существ частот 3..6 на поле
uniform float uCnt1;     // частоты 7
uniform float uHud;      // px канваса на css px

float aa;

// ---------------- фон: тихая интерференция трёх плоских волн ----------------
float field(vec2 p, float t) {
  return (sin(dot(p, vec2(4.3, 1.4)) - 0.55 * t)
        + sin(dot(p, vec2(-2.1, 3.9)) - 0.4 * t + 1.7)
        + sin(dot(p, vec2(-3.2, -2.9)) - 0.7 * t + 4.1)) / 3.0;
}

// ---------------- существо ----------------
void creature(inout vec3 col, vec2 p, int i) {
  vec4 A = uA[i], B = uB[i], C = uC[i];
  float alpha = C.y;
  if (alpha <= 0.0) return;
  vec2 d = p - A.xy;
  float r2 = dot(d, d);
  float R = A.z;
  vec3 hc = mix(hue(B.x), hue(B.y), B.z);
  float reach = R * (1.0 + B.w + C.z) + 0.06;
  if (r2 > reach * reach * 4.0) { // далеко — только мягкий ореол
    col += hc * alpha * 0.018 * R * R / r2;
    return;
  }
  float r = sqrt(r2);
  vec2 z = d / max(r, 1e-5);
  float w = C.z;
  vec3 P = mix(petal(z, B.x, C.x, R, B.w, w), petal(z, B.y, C.x, R, B.w, w), B.z);
  float sd = polarSd(r, P);
  float u = r / max(P.x, 1e-4); // 0 центр … 1 кромка вдоль луча

  float fill = smoothstep(aa, -aa, sd);
  // тело: темнее к центру, жилки по середине лепестков, бегущие кольца
  vec3 body = hc * (0.28 + 0.62 * u * u);
  body += hc * smoothstep(0.55, 1.0, P.z) * (1.0 - u) * 0.55;
  body *= 0.88 + 0.12 * sin(u * 16.0 - uT * 3.0 + C.x);
  body += vec3(1.0) * glow(r, R * 0.16) * 0.55;
  float rim = smoothstep(2.0 * aa, 0.0, abs(sd));
  vec3 rimC = mix(hc * 1.5, vec3(1.0), 0.25 + 0.5 * w / 0.2);
  // мерцающий в переходе и игрок в перетекании — «дрожащая» кромка
  float unstable = B.z * (1.0 - B.z) * 4.0;
  if (A.w == 4.0 || A.w == 0.0) rimC = mix(rimC, vec3(1.0, 0.95, 0.9) * (0.7 + 0.6 * sin(uT * 40.0 + u * 9.0)), unstable);
  float halo = glow(max(sd, 0.0), R * 0.35) * 0.4;
  float flash = C.w;

  col = mix(col, body, fill * alpha * (1.0 - flash));
  col += (rimC * rim + hc * halo) * alpha;
  col += mix(hc, vec3(1.0), 0.5) * flash * smoothstep(3.0 * aa, 0.0, abs(sd)) * 1.5;

  // игрок: белая пунктирная орбита + точки комбо на ней; при низкой энергии орбита бьётся пульсом
  if (A.w == 0.0) {
    float E = uD[0].x;
    float orbit = P.x * 0.0 + R * (1.0 + B.w) * 1.45 + 0.012;
    float dashes = 0.5 + 0.5 * cpow(z, 16.0).y * cs(uT) + 0.5 * cpow(z, 16.0).x * sin(uT);
    float ring = smoothstep(aa * 1.2, 0.0, abs(r - orbit)) * smoothstep(0.35, 0.65, dashes);
    float beat = E < 0.3 ? 0.5 + 0.5 * sin(uT * (10.0 + 20.0 * (0.3 - E))) : 1.0;
    vec3 ringC = mix(vec3(1.0, 0.25, 0.2), vec3(0.95), smoothstep(0.1, 0.3, E));
    col += ringC * ring * 0.8 * alpha * beat;
    for (int k = 0; k < 12; k++) {
      if (float(k) >= uCombo) break;
      vec2 q = A.xy + orbit * polar(TAU * float(k) / 12.0 + uT * 1.3 + PI * 0.5);
      col += hc * 1.6 * smoothstep(0.011, 0.006, len(p - q)) * alpha;
    }
  }
}

// ---------------- рентген: формы и пути, которыми существа нарисованы ----------------
float line(float dist, float w) { return smoothstep(w, 0.0, abs(dist)); }

void xray(inout vec3 col, vec2 p, int i) {
  vec4 A = uA[i], B = uB[i], C = uC[i], D = uD[i];
  if (C.y <= 0.0) return;
  vec3 hc = mix(hue(B.x), hue(B.y), B.z);
  vec2 d = p - A.xy;
  float r = len(d);
  vec2 z = d / max(r, 1e-5);
  float k = A.w;
  float a = C.y * uXray;
  // базовая окружность R (пунктир 24 штриха)
  float dash = smoothstep(-0.2, 0.2, cpow(z, 24.0).y);
  col += vec3(0.85) * line(r - A.z, aa) * dash * a * 0.6;
  // ось нулевой фазы: луч θ = −φ/n (где начинается первый лепесток)
  if (k == 1.0 || k == 5.0) {
    // путь: lat(s) = A·(sin(k·s + Φ) − sin Φ) в осях (û, n̂) из текущей точки
    vec2 u = polar(D.x);
    float s = dot(d, u), l = dot(d, vec2(-u.y, u.x));
    float lc = D.y * (sin(D.z * s + D.w) - sin(D.w));
    float g = D.y * D.z * cs(D.z * s + D.w);
    float dist = (l - lc) / sqrt(1.0 + g * g);
    float span = smoothstep(-0.25, 0.0, s) * smoothstep(1.6, 0.4, s);
    col += hc * line(dist, aa * 1.2) * span * a * 0.8;
  } else if (k == 2.0) {
    // восьмёрка Лиссажу x = A sin ωt, y = B sin 2ωt ⇔ y² = 4B²u²(1 − u²), u = x/A
    vec2 q = p - D.xy;
    float Aa = abs(D.z);
    vec2 XY = D.z > 0.0 ? q : q.yx;
    float uu = XY.x / Aa;
    float F = XY.y * XY.y - 4.0 * D.w * D.w * uu * uu * (1.0 - uu * uu);
    vec2 gF = vec2(-4.0 * D.w * D.w * (2.0 * uu - 4.0 * uu * uu * uu) / Aa, 2.0 * XY.y);
    float dist = F / max(len(gF), 1e-4);
    col += hc * line(dist, aa * 1.2) * step(abs(uu), 1.0) * a * 0.8;
    col += vec3(0.8) * smoothstep(0.012, 0.006, len(q)) * a; // центр
  } else if (k == 3.0) {
    // пульсар: радиус от R_min до R_max; за порогом — шипы
    float dm = line(r - D.x, aa), dM = line(r - D.y, aa);
    col += (hc * dm + vec3(1.0, 0.5, 0.4) * dM) * a * 0.7 * dash;
  } else if (k == 4.0) {
    // мерцающий: обе его формы — контуром
    vec3 P1 = petal(z, B.x, C.x, A.z, B.w, 0.0), P2 = petal(z, B.y, C.x, A.z, B.w, 0.0);
    col += hue(B.x) * line(polarSd(r, P1), aa) * a * 0.9;
    col += hue(B.y) * line(polarSd(r, P2), aa) * a * 0.9;
  }
}

// ---------------- HUD: тоже синусы ----------------
// счёт — три кольца по 9 точек: единицы, десятки, сотни (горит столько точек, какова цифра)
void scoreRings(inout vec3 col, vec2 f, vec3 tint) {
  vec2 c = vec2(0.5 * uResolution.x, uResolution.y - 50.0 * uHud);
  vec2 q = f - c;
  if (dot(q, q) > 2500.0 * uHud * uHud) return;
  float sc = uScore;
  float h = 0.0;
  for (int j = 0; j < 9; j++) if (sc >= 100.0) { sc -= 100.0; h += 1.0; } // цифры — вычитанием
  float t = 0.0;
  for (int j = 0; j < 9; j++) if (sc >= 10.0) { sc -= 10.0; t += 1.0; }
  float digit[3] = float[3](sc, t, h);
  for (int ring = 0; ring < 3; ring++) {
    float rad = (12.0 + 10.5 * float(ring)) * uHud;
    float dr = (2.1 + 0.7 * float(ring)) * uHud;
    for (int k = 0; k < 9; k++) {
      vec2 pk = rad * polar(PI * 0.5 - TAU * float(k) / 9.0);
      float on = step(float(k) + 0.5, digit[ring]);
      float m = smoothstep(dr + 1.0, dr - 1.0, len(q - pk));
      col = mix(col, mix(vec3(0.16), tint * 1.3 + 0.15, on), m * (0.55 + 0.45 * on));
    }
  }
  // в центре — пульс, дрожащий в такт комбо
  float beat = 0.5 + 0.5 * sin(uT * (3.0 + uCombo));
  col += tint * smoothstep(5.0 * uHud, 2.0 * uHud, len(q)) * (0.4 + 0.6 * beat);
}

// селектор частот внизу: пять существ n = 3..7, текущее — крупнее, под каждым — сколько таких на поле
void selector(inout vec3 col, vec2 f) {
  if (uSel.z <= 0.0) return;
  if (f.y > uSel.y + uSel.w * 2.2) return;
  float nFrom = uB[0].x, nTo = uB[0].y, k = uB[0].z;
  for (int i = 0; i < 5; i++) {
    float n = 3.0 + float(i);
    vec2 c = vec2(uSel.x + uSel.z * float(i), uSel.y);
    vec2 q = f - c;
    if (dot(q, q) > uSel.w * uSel.w * 4.0) continue;
    float act = (n == nTo ? k : 0.0) + (n == nFrom ? 1.0 - k : 0.0);
    float R = uSel.w * (0.55 + 0.17 * act);
    float r = len(q);
    vec2 z = q / max(r, 1e-4);
    vec3 P = petal(z, n, uT * (0.6 + 0.4 * act) + n, R, 0.32, 0.0);
    float sd = polarSd(r, P);
    float a = 1.0 / uHud;
    vec3 hc = hue(n);
    float fill = smoothstep(a, -a, sd / uHud);
    float u = r / P.x;
    col = mix(col, hc * (0.3 + 0.7 * u * u) * (0.45 + 0.55 * act), fill * (0.55 + 0.45 * act));
    col += hc * smoothstep(1.5, 0.0, abs(sd) / uHud) * (0.4 + 0.6 * act);
    // кольцо выбора (во время перетекания — разгорается у цели)
    float ring = smoothstep(1.4, 0.0, abs(r - uSel.w * 0.98) / uHud);
    col += vec3(0.95) * ring * (n == nTo ? 0.25 + 0.75 * k : 0.0);
    // счётчик: точки под существом
    float cnt = i < 4 ? uCnt0[i] : uCnt1;
    for (int j = 0; j < 8; j++) {
      if (float(j) >= cnt) break;
      vec2 pj = c + vec2((float(j) - (min(cnt, 8.0) - 1.0) * 0.5) * 6.0 * uHud, -uSel.w * 1.18);
      col += hc * smoothstep(2.4 * uHud, 1.2 * uHud, len(f - pj));
    }
  }
}

void main() {
  vec2 f = gl_FragCoord.xy;
  float m = 0.5 * min(uResolution.x, uResolution.y);
  vec2 p = (f - 0.5 * uResolution) / m + uShake;
  aa = 1.2 / m;

  // рябь: расходящиеся синус-волны от точек поглощения/удара — сдвигают всё (преломление)
  float rip = 0.0;
  vec3 ripC = vec3(0.0);
  for (int j = 0; j < 8; j++) {
    vec4 R = uRip[j];
    if (R.z < 0.0 || R.z > 2.0) continue;
    vec2 q = p - R.xy;
    float r = len(q);
    float dd = r - 0.85 * R.z;
    float fade = (1.0 - R.z / 2.0) * (1.0 - R.z / 2.0);
    float wave = R.w < 0.0 ? sin(dd * 45.0) * sin(dd * 49.0) * 2.0 : sin(dd * 45.0);
    float env = glow(dd, 0.07) * fade;
    rip += wave * env;
    p += q / max(r, 1e-4) * wave * env * 0.01;
    vec3 rc = R.w < 0.0 ? vec3(1.0, 0.25, 0.2) : mix(hue(R.w), vec3(1.0), 0.3);
    ripC += rc * glow(dd, 0.006) * fade * 0.9;
  }

  // фон
  float w = field(p, uT) + 0.6 * rip;
  vec3 tint = mix(hue(uB[0].x), hue(uB[0].y), uB[0].z);
  vec3 col = vec3(0.012, 0.016, 0.035);
  col += mix(vec3(0.05, 0.07, 0.13), tint * 0.12, 0.35) * (0.5 + 0.5 * w);
  float iso = sin(w * 9.0);
  col += tint * 0.05 * glow(iso, 0.12);
  // край арены — мягкая виньетка
  vec2 uv = f / uResolution - 0.5;
  col *= 1.0 - 0.9 * dot(uv, uv);
  col *= 1.0 - 0.55 * uXray;
  col += ripC;

  // след игрока
  vec3 pc = tint;
  for (int j = 0; j < 10; j++) {
    vec4 T = uTrail[j];
    if (T.z <= 0.0) continue;
    float rr = uA[0].z * (0.75 - 0.06 * float(j));
    col += pc * glow(len(p - T.xy), rr * 0.45) * T.z * 0.06 * (1.0 - float(j) / 10.0);
  }

  for (int i = 0; i < N; i++) {
    if (i >= uCount) break;
    if (uXray > 0.0) xray(col, p, i);
  }
  // существа поверх, игрок — последним
  for (int i = N - 1; i >= 0; i--) {
    if (i >= uCount) continue;
    creature(col, p, i);
  }

  // конец игры — мир выцветает
  float gray = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(gray) * 0.5, uOver * 0.75);

  scoreRings(col, f, tint);
  selector(col, f);
  fragColor = vec4(tonemap(col), 1.0);
}
