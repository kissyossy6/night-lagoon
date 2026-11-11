import type * as THREE from 'three';

/**
 * How camera-facing sprites turn. A flat frame lines them up with the camera
 * (0). A 180° frame (src/export/vr180.ts) is drawn as several cube faces from
 * one point, and a sprite cut by a face seam must look the same on both
 * sides, so there each sprite turns toward the camera position instead (1).
 */
export const uFaceCamera: THREE.IUniform<number> = { value: 0 };

export const BILLBOARD_GLSL = /* glsl */ `
uniform float uFaceCamera;
void spriteAxes(vec3 p, out vec3 right, out vec3 up) {
  right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  if (uFaceCamera > 0.5) {
    vec3 f = normalize(cameraPosition - p);
    right = normalize(cross(vec3(0.0, 1.0, 0.0), f));
    up = cross(f, right);
  }
}`;
