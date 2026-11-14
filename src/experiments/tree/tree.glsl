// Дерево как SDF. Требует <sdf>, <noise>, <retro> и глобалов из scene.frag: PW (мировая точка), REC и запись rec*,
// POLY (гранёный PS1-вид) и snapW() (дрожание вершин), TREE_ORG/TREE_SC (мировые начало и масштаб дерева).
//
// Строение лиственного дерева:
//  1. ствол — явный: изогнутая (crook/lean) сужающаяся колонна с корневым наплывом и 4 корнями;
//  2. скелетные ветви (limbs) — явные, 3..6 штук на разной высоте/азимуте/наклоне от seed —
//     так ломается симметрия «снежинки» на крупном масштабе;
//  3. внутри каждой скелетной ветви — складывание пространства: на уровне i поворот вокруг оси на
//     случайный угол узла, отражение |x| (два ребёнка), наклон ребёнка, перенос к его основанию.
//     Параметры ребёнка (угол, длина, обрезка) — хэш от id пути (id = 2·id + сторона складки),
//     поэтому соседние развилки разные, а цена — линейна по числу уровней;
//  4. листва — комки на концах глубоких веток + «масса» кроны у каждой скелетной ветви; всё
//     объединено smin и смещено одним шумом в мировых координатах (комки не швами, а буграми).

const float TAU = 6.2831853;

float sdBranch(vec3 q, float L, float r0, float r1) {
  if (POLY) return sdPrismBranch(q, L, r0, r1, 5.0); // PS1: пятигранная призма с плоскими торцами
  float h = clamp(q.y / max(L, 1e-4), 0.0, 1.0);
  return length(vec3(q.x, q.y - h * L, q.z)) - mix(r0, r1, h);
}

struct TP {
  float H, rB, crook, lean;   // ствол
  float limbs, y0, eMin, eMax, eTop, L, limbTaper; // скелетные ветви
  float ang0, ang1, ratio, prune; // складывание
  float leafR, mass;          // листва: комки и масса кроны
};

// Параметры дерева из seed. spread 0 — стройное, 1 — раскидистое; crook — кривизна.
TP treeParams(float seed, int species) {
  vec3 a = hash33(vec3(seed, 1.7, 3.1));
  vec3 b = hash33(vec3(seed, 5.3, 0.2));
  vec3 c = hash33(vec3(seed, 9.1, 7.7));
  float spread = a.x;
  TP t;
  t.crook = a.y * a.y * 1.3;
  t.lean = (b.xy - 0.5).x * 0.6;
  t.H = mix(2.0, 1.25, spread) * mix(0.9, 1.15, b.z);
  t.rB = mix(0.15, 0.22, spread) * mix(0.9, 1.1, c.x);
  t.limbs = 3.0 + floor(c.y * 3.0);
  t.y0 = mix(0.55, 0.4, spread);
  t.eMin = mix(0.35, 0.75, spread);
  t.eMax = mix(0.7, 1.2, spread);
  t.eTop = mix(0.05, 0.35, a.z);
  t.L = mix(1.0, 1.35, spread) * mix(0.85, 1.15, b.x);
  t.limbTaper = mix(0.55, 0.85, spread);
  t.ang0 = mix(0.38, 0.5, c.z);
  t.ang1 = mix(0.75, 1.0, spread);
  t.ratio = mix(0.66, 0.78, b.y);
  t.prune = mix(0.08, 0.3, c.x);
  t.leafR = mix(0.36, 0.48, b.z);
  t.mass = mix(0.85, 1.1, a.z);
  if (species == 1) { // берёза: стройная, тонкая, ветви круто вверх, крона лёгкая
    t.H *= 1.45; t.rB *= 0.6; t.y0 = 0.5; t.eMin = 0.25; t.eMax = 0.55; t.eTop = 0.08;
    t.L *= 0.8; t.limbs = 5.0 + floor(c.y * 2.0); t.ang0 = 0.3; t.ang1 = 0.6; t.leafR *= 0.75; t.mass = 0.62;
  }
  return t;
}

float LEAF;       // количество листвы (сезон)
float WIND_LOCAL; // сила ветра для текущего дерева
float TREE_LS = 1.0; // мировых единиц на локальную единицу текущего дерева (рост × размер)

// PS1: дрожание отдельного тела (комка, сегмента ветви, яруса). Псевдо-якорь тела — точка у кроны по хэшу
// ключа; его проекция привязывается к пикселю низкого буфера, тело сдвигается на разницу (≤ ½ шага jitter).
// Направление сдвига в локальной рамке тела не совпадает с экранным, но длина та же (вращения её не меняют),
// а моменты скачков у соседних тел разные — картинка «трещит» по телам, как полигоны на PS1.
vec3 bodyJit(float key) {
  if (!JITTER) return vec3(0.0);
  vec3 a = TREE_ORG + (hash33(vec3(key, TREE_ORG.x, TREE_ORG.z)) * vec3(3.0, 4.0, 3.0) - vec3(1.5, -0.4, 1.5)) * TREE_LS;
  return snapW(a) / TREE_LS;
}

// листовой комок: точное расстояние до сферы, шум добавляется позже (один на всё дерево)
void blob(inout float leaf, vec3 q, float R, float id) {
  if (R <= 0.001) return;
  float lb;
  if (POLY) { // PS1: многогранник, повёрнутый по id — грани у соседних комков не совпадают; дрожит сам по себе
    q -= bodyJit(id);
    q.xz = rot2(id * 1.7) * q.xz;
    q.yz = rot2(id * 0.9) * q.yz;
    lb = sdDodeca(q, R * 0.92);
  } else lb = length(q) - R;
  if (REC && lb < leaf) recHash = id;
  leaf = POLY ? min(leaf, lb) : opSmoothUnion(leaf, lb, 0.25);
}

void bark(inout float d, float b, float k, vec3 q, float lvl) {
  if (REC && b < recBark) { recBark = b; recLocal = q; recLevel = lvl; }
  d = opSmoothUnion(d, b, POLY ? k * 0.12 : k); // PS1: почти жёсткие стыки — видны грани
}

// поддерево скелетной ветви складыванием; g — рост этой ветви 0..1 (уровни появляются по очереди)
void subtree(inout float d, inout float leaf, vec3 q, float L, float r, float seed, int levels, float g, TP t) {
  float id = 1.0;
  float Lfull = L;
  for (int i = 0; i < 5; i++) {
    float Li = L;
    // остаток ветки (она + все потомки, длины убывают ≤ 0.84 на уровень) лежит в сфере вокруг (0, L, 0)
    // радиуса 2.2·L: точка дальше текущего минимума — глубже не идём
    if (length(q - vec3(0.0, Li, 0.0)) - 2.2 * Li - r - 0.1 > min(d, leaf)) break;
    // рост следующего уровня
    float gn = clamp(g * float(levels + 1) - float(i + 1), 0.0, 1.0);
    bool last = i >= levels - 1 || gn <= 0.0;
    // концевая ветка заострена, промежуточная сужается до радиуса детей (переход плавный — рост без скачков)
    float kids = i >= levels - 1 ? 0.0 : smoothstep(0.0, 0.35, gn);
    bark(d, sdBranch(q - bodyJit(id * 7.0 + seed + float(i)), Li, r, r * mix(0.3, 0.72, kids)), r * 1.4, q, float(i) + 1.0);
    // комки на концах двух последних уровней (и на любой оборванной ветке)
    float tipLeaf = t.leafR * LEAF * mix(1.0, i >= levels - 2 ? 0.7 : 0.0, kids) * smoothstep(0.0, 0.6, g);
    // на концах складываемых веток — только мелкие «почки»: крупный комок резала бы плоскость складки
    if (tipLeaf > 0.0) blob(leaf, q - vec3(0.0, Li, 0.0), min(tipLeaf * 0.3, Li * 0.35), id + seed);
    if (last) break;
    // к детям: перенос к развилке, поворот на случайный угол узла, складка
    vec3 hn = hash33(vec3(id, seed, float(i)));
    q.y -= Li * mix(0.7, 1.0, hn.x);
    q.xz = rot2(hn.y * TAU) * q.xz;
    float side = step(0.0, q.x);
    q.x = abs(q.x);
    id = id * 2.0 + side;
    vec3 h = hash33(vec3(id, seed, float(i) + 0.5));
    if (i > 0 && h.x < t.prune) { // эта сторона обрезана: конец с комком
      break;
    }
    // доминирующая сторона — ближе к оси и длиннее (асимметричная развилка)
    bool dom = side == step(0.5, hn.z);
    float ang = dom ? t.ang0 * mix(0.6, 1.2, h.y) : t.ang1 * mix(0.75, 1.15, h.y);
    ang += WIND_LOCAL * 0.07 * float(i + 1) * sin(uWindT * 1.7 + id * 1.37 + seed);
    q.xy = rot2(ang) * q.xy;
    float ratio = t.ratio * (dom ? 1.08 : mix(0.75, 0.95, h.z));
    L = Lfull * ratio * gn;
    Lfull *= ratio;
    r *= dom ? 0.74 : 0.62;
  }
}

// x — расстояние, y — 1, если ближе листва (иначе кора)
vec2 broadleaf(vec3 p, float seed, float g, int species, int levels) {
  TP t = treeParams(seed, species);
  float gs = mix(0.3, 1.0, smoothstep(0.0, 0.85, g));
  p /= gs;
  TREE_LS = gs * TREE_SC;
  // ветер: всё дерево гнётся, сильнее к верху
  float sw = WIND_LOCAL * 0.016 * (sin(uWindT * 0.9 + seed) + 0.45 * sin(uWindT * 2.3 + seed * 2.0));
  p.x -= sw * p.y * p.y;
  // кривизна ствола
  float yy = max(p.y, 0.0);
  vec2 off = vec2(t.lean, t.lean * 0.4) * yy * yy * 0.12
           + t.crook * 0.22 * vec2(sin(yy * 1.9 + seed * 3.0), sin(yy * 1.4 + seed * 1.7)) * smoothstep(0.0, 1.2, yy);
  vec3 q = vec3(p.x - off.x, p.y, p.z - off.y);

  float H = t.H * mix(0.45, 1.0, smoothstep(0.0, 0.4, g));
  float rB = t.rB * mix(0.4, 1.0, g);
  float rT = rB * 0.55;
  float hh = clamp(q.y / H, 0.0, 1.0);
  float r = mix(rB, rT, hh) + rB * 0.7 * exp(-max(q.y, 0.0) * 5.0);
  float d = POLY ? max(ngonR(q.xz, 7.0) - r, q.y - H) : length(vec3(q.x, q.y - hh * H, q.z)) - r;
  if (REC) { recBark = d; recLocal = q; recLevel = 0.0; }
  // корни: расходятся и уходят в землю
  bool nearBase = q.y < rB * 3.0 + 0.4 && dot(q.xz, q.xz) < (rB * 6.0 + 0.4) * (rB * 6.0 + 0.4);
  for (int k = 0; k < 4; k++) {
    if (!nearBase) break;
    float a = seed * 4.1 + float(k) * 1.62 + 0.4 * hash11(seed + float(k));
    vec3 dir = vec3(cos(a), -0.32, sin(a));
    float rl = rB * mix(4.0, 5.5, hash11(seed * 1.3 + float(k)));
    vec3 lq = q - vec3(0.0, rB * 1.2, 0.0);
    float h = clamp(dot(lq, dir) / (rl * dot(dir, dir)), 0.0, 1.0);
    float rd = length(lq - dir * rl * h) - mix(rB * 0.55, rB * 0.12, h);
    bark(d, rd, rB * 0.9, lq, 0.0);
  }
  float leaf = 1e9;
  // росток: пара листьев на макушке, пока нет кроны
  float sprout = (1.0 - smoothstep(0.25, 0.55, g)) * step(0.001, LEAF);
  if (sprout > 0.0) {
    // два плоских листика на макушке, раскрыты в стороны
    for (int j = 0; j < 2; j++) {
      float sgn = j == 0 ? 1.0 : -1.0;
      vec3 lq = q - vec3(0.0, H * 0.96, 0.0);
      lq.xz = rot2(seed + float(j) * 3.14159) * lq.xz;
      lq.xy = rot2(-0.45) * (lq.xy - vec2(0.36, 0.06));
      float e = sdEllipsoid(lq, vec3(0.42, 0.07, 0.22) * sprout);
      if (REC && e < leaf) recHash = 3.0 + float(j);
      leaf = min(leaf, e);
    }
  }

  // скелетные ветви; в тенях/AO при листве поддеревья не считаем — тень даёт крона
  bool subOK = !CHEAP || LEAF < 0.3;
  int K = int(t.limbs);
  for (int k = 0; k < 6; k++) {
    if (k >= K) break;
    vec3 h = hash33(vec3(seed, float(k), 11.0));
    float fk = (float(k) + 0.25 + 0.5 * h.x) / float(K);
    bool top = k == K - 1;
    float gk = clamp((g - 0.15 - 0.3 * fk) / 0.3, 0.0, 1.0);
    if (gk <= 0.0) continue;
    float y0 = H * (top ? 0.97 : mix(t.y0, 0.95, fk));
    float az = float(k) * 2.39996 + h.y * 1.2 + seed * 5.0;
    float el = top ? t.eTop : mix(t.eMin, t.eMax, h.z);
    float Lf = t.L * mix(0.8, 1.2, h.x) * mix(1.0, t.limbTaper, fk) * (top ? 0.85 : 1.0);
    float L = Lf * smoothstep(0.0, 1.0, gk);
    float rr = mix(rB, rT, y0 / H) * (top ? 0.85 : 0.68);
    vec3 lq = q - vec3(0.0, y0, 0.0);
    // PS1: опорная точка ветви «прыгает» по пикселям низкого буфера независимо от ствола
    if (POLY || JITTER) lq -= snapW(TREE_ORG + vec3(0.0, y0 + L, 0.0) * gs * TREE_SC) / (gs * TREE_SC);
    lq.xz = rot2(az) * lq.xz;
    lq.xy = rot2(el + WIND_LOCAL * 0.04 * sin(uWindT * 1.3 + float(k) * 2.1 + seed)) * lq.xy;
    // ограничивающая сфера ветви вместе с её кроной: далёкие точки (земля, другие ветви) не платят
    // ни за комки, ни за складки
    float bnd = length(lq - vec3(0.0, 1.3 * L, 0.0)) - 2.0 * L - 0.85 * Lf * t.mass - 0.3;
    if (bnd > min(d, leaf)) continue;
    // крона: три комка вдоль ветви, сплюснутых по вертикали (явные — без срезов складкой);
    // распускаются последними и по очереди
    float m = t.mass * Lf * LEAF * 0.48;
    if (m > 0.0) {
      for (int j = 0; j < 3; j++) {
        vec3 hj = hash33(vec3(seed, float(k), float(j) + 20.0)) - 0.5;
        float bloom = smoothstep(0.6 + 0.08 * float(j), 0.88 + 0.06 * float(j), g);
        vec3 c = vec3(0.0, (1.05 + 0.5 * float(j)) * L, 0.0) + hj * vec3(0.8, 0.4, 0.8) * L;
        blob(leaf, (lq - c) * vec3(1.0, 1.3, 1.0), m * (1.15 - 0.2 * abs(float(j) - 1.0)) * bloom * mix(0.85, 1.15, hj.y + 0.5), float(k) * 3.0 + float(j) + seed * 7.0);
      }
    }
    if (!subOK) {
      bark(d, sdBranch(lq, L, rr, rr * 0.72), rr * 1.4, lq, 1.0);
      continue;
    }
    // ограничивающая сфера поддерева
    bnd = length(lq - vec3(0.0, 1.2 * L, 0.0)) - 1.9 * L - 0.5;
    if (bnd > min(d, leaf)) continue;
    subtree(d, leaf, lq, L, rr, seed + float(k) * 17.0, CHEAP ? min(levels, 2) : levels, gk, t);
  }

  // одно смещение шумом на всю листву: бугры-комки + мелкая «листовая» фактура; ветер её шевелит
  if (leaf < 0.4 && !POLY) {
    vec3 wp = PW / gs + vec3(sin(uWindT * 2.1), 0.0, cos(uWindT * 1.7)) * 0.05 * WIND_LOCAL;
    leaf += 0.16 * gnoise(wp * 2.2);
    // мелкая фактура — только у самой поверхности и не для теней/AO
    if (!CHEAP && leaf < 0.12) leaf += 0.045 * gnoise(wp * 7.0);
    // осенью крона редеет: дыры (летом не считаем)
    if (LEAF < 0.97) leaf = max(leaf, -(gnoise(wp * 1.4 + 7.0) * 0.5 + 0.5 - (1.0 - LEAF) * 1.1) * 0.6);
  }
  return vec2(min(d, leaf) * gs, leaf < d ? 1.0 : 0.0);
}

// Ель: прямой ствол + ярусы-«юбки» с зубчатым краем (три ближайших яруса)
vec2 spruce(vec3 p, float seed, float g) {
  vec3 h = hash33(vec3(seed, 2.2, 8.8));
  float gs = mix(0.3, 1.0, smoothstep(0.0, 0.85, g));
  p /= gs;
  TREE_LS = gs * TREE_SC;
  float H = mix(3.6, 4.8, h.x);
  float sw = WIND_LOCAL * 0.012 * (sin(uWindT * 0.9 + seed) + 0.45 * sin(uWindT * 2.3 + seed * 2.0));
  p.x -= sw * p.y * p.y;
  p.xz -= (h.yz - 0.5) * 0.08 * p.y * p.y * 0.1;
  float rB = 0.17 * mix(0.4, 1.0, g);
  float hh = clamp(p.y / H, 0.0, 1.0);
  float d = (POLY ? max(ngonR(p.xz, 6.0) - mix(rB, 0.02, hh), p.y - H) : length(vec3(p.x, p.y - hh * H, p.z)) - mix(rB, 0.02, hh)) - rB * 0.5 * exp(-max(p.y, 0.0) * 6.0);
  if (REC) { recBark = d; recLocal = p; recLevel = 0.0; }
  float y0 = 0.7, n = 7.0, sp = (H - y0) / n;
  float leaf = 1e9;
  float rr = POLY ? ngonR(p.xz, 8.0) : length(p.xz); // PS1: восьмигранные ярусы
  float a = atan(p.z, p.x);
  float base = floor((p.y - y0) / sp);
  for (int j = 0; j < 3; j++) {
    float i = clamp(base + float(j) - 1.0, 0.0, n - 1.0);
    float yi = y0 + i * sp;
    float f = i / n;
    float R = mix(1.55, 0.35, f) * mix(0.9, 1.1, hash11(seed + i)) * smoothstep(0.0, 0.7, g);
    // зубчатый край: радиус колеблется по углу
    if (!POLY) R *= 1.0 + 0.09 * sin(a * (7.0 + i) + seed + i * 1.3) + 0.05 * sin(a * 13.0 + i);
    // юбка: отрезок в плоскости (r, y) от ствола вниз-наружу, толщина убывает к краю
    vec2 A = vec2(0.0, yi + sp * 1.1), B = vec2(R, yi - sp * 0.35);
    vec2 P = vec2(rr, p.y);
    if (JITTER) { // ярус дрожит целиком
      vec3 pj = p - bodyJit(seed + i * 3.1);
      P = vec2(ngonR(pj.xz, 8.0), pj.y);
    }
    vec2 ab = B - A;
    float t = clamp(dot(P - A, ab) / dot(ab, ab), 0.0, 1.0);
    float th = mix(0.28, 0.06, t) * (0.6 + 0.4 * (1.0 - f));
    float s = length(P - A - ab * t) - th;
    if (REC && s < leaf) recHash = i + seed;
    leaf = POLY ? min(leaf, s) : opSmoothUnion(leaf, s, 0.1);
  }
  float tip = length(p - vec3(0.0, H + 0.1, 0.0)) - 0.12; // макушка
  leaf = min(leaf, tip);
  if (leaf < 0.4 && !CHEAP && !POLY) leaf += 0.04 * gnoise(PW / gs * 6.0);
  return vec2(min(d, leaf * 0.85) * gs, leaf * 0.85 < d ? 2.0 : 0.0);
}
