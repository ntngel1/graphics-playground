// Нормаль по SDF (тетраэдр, 4 вызова map).
// Конвенция: до #include объявите в шейдере `float map(vec3 p)`.

vec3 calcNormal(vec3 p, float eps) {
  const vec2 k = vec2(1, -1);
  return normalize(k.xyy * map(p + k.xyy * eps) + k.yyx * map(p + k.yyx * eps) +
                   k.yxy * map(p + k.yxy * eps) + k.xxx * map(p + k.xxx * eps));
}
vec3 calcNormal(vec3 p) { return calcNormal(p, 0.0005); }
