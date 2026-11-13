// Камера: базис lookAt и луч через пиксель. Обычно cameraRay(gl_FragCoord.xy, uResolution, uCamPos, uCamTarget, 45.0).

mat3 lookAt(vec3 ro, vec3 ta, float roll) {
  vec3 w = normalize(ta - ro);
  vec3 u = normalize(cross(w, vec3(sin(roll), cos(roll), 0.0)));
  return mat3(u, cross(u, w), w);
}

// fovY — вертикальный угол обзора в градусах
vec3 cameraRay(vec2 fragCoord, vec2 res, vec3 ro, vec3 ta, float fovY) {
  vec2 p = (2.0 * fragCoord - res) / res.y;
  float f = 1.0 / tan(radians(fovY) * 0.5);
  return lookAt(ro, ta, 0.0) * normalize(vec3(p, f));
}
