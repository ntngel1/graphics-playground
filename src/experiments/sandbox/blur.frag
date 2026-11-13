// Разделимый гауссов blur (13 выборок с шагом 2 текселя + линейная фильтрация); uDir — (1,0) или (0,1).
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform vec2 uDir;

void main() {
  vec2 tx = uDir / uSrcSize * 2.0;
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float w = exp(-float(i * i) / 18.0);
    s += texture(uSrc, vUv + tx * float(i)).rgb * w;
    wsum += w;
  }
  fragColor = vec4(s / wsum, 1.0);
}
