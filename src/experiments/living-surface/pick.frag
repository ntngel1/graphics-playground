// 1×1 «pick»: uv точки поверхности под курсором, пока кнопка зажата.
// rg — uv сейчас, ba — uv на прошлом кадре (из прошлого состояния этого же ping-pong буфера);
// -1 — мимо / не рисуем. Читается шагом симуляции как источник кисти.
#include "surface.glsl"
#include <camera>

uniform sampler2D uPickPrev;
uniform int uMaxSteps;

void main() {
  vec4 prev = texture(uPickPrev, vec2(0.5));
  vec4 o = vec4(-1.0);
  if (uMouse.z > 0.5) {
    vec2 frag = uMouse.xy / uResolution * uScreen; // uMouse пересчитан в px 1×1 таргета → обратно в px экрана
    vec3 rd = cameraRay(frag, uScreen, uCamPos, uCamTarget, FOV);
    vec2 m = marchSurface(uCamPos, rd, 40.0, uMaxSteps);
    if (m.x < 40.0) {
      vec3 p = uCamPos + rd * m.x;
      if (scene(p).y > 0.5) o = vec4(brushUv(p), prev.x >= 0.0 ? prev.xy : vec2(-1.0));
    }
  }
  fragColor = o;
}
