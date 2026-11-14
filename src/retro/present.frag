// Вывод ретро-буфера на экран: целочисленное NEAREST-увеличение (k экранных px на пиксель буфера),
// в PS1-виде — квантование цвета с дизерингом Байера по пикселям буфера.
#include <retro>

uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform float uRetroK;   // экранных px на пиксель буфера (1 — обычный вид)
uniform int uLook;       // 0 обычный, 1 ps1
uniform float uPs1Bits;
uniform float uPs1Dither;

void main() {
  vec2 px = min(floor(gl_FragCoord.xy / uRetroK), uSrcSize - 1.0);
  vec3 c = texelFetch(uSrc, ivec2(px), 0).rgb;
  if (uLook == 1) c = retroQuantize(c, px, uPs1Bits, uPs1Dither);
  fragColor = vec4(c, 1.0);
}
