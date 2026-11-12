import * as THREE from 'three';
import { BILLBOARD_GLSL, uFaceCamera } from '../core/billboard';
import { HISTORY_GLSL, RATE, type ParamHistory } from './history';
import { drawScale, type Fixture, type Layout } from './layout';

/**
 * Lit haze over the stage (docs/video-review.md R2).
 *
 * Spray and drifting mist hang in the air around every running fountain and
 * scatter its LED ring light, so in the real show the air over the lagoon
 * glows in the scene colour, and the big shots light the sky. This is not a
 * new light: each fixture's own colour, scattered by the mist it has made.
 *
 * One soft camera-facing sprite per fixture, centred on its water. Brightness
 * follows the pressure averaged over the last few seconds, because mist builds
 * up and drifts away more slowly than the jet itself.
 */

const HAZE_VS = /* glsl */ `
${HISTORY_GLSL}
${BILLBOARD_GLSL}
attribute float aFix;
attribute vec3 aOrigin;
attribute vec4 aShape; // height at full pressure, half-width, gain, upright (1 = ignore tilt)
attribute float aSize; // drawn size (layout.ts drawScale), 1 for every lagoon fixture
uniform float uTime;
uniform float uGain;
#ifdef PYRO
uniform vec3 uPyro;
#endif
varying vec3 vCol;
varying vec2 vUv;
varying float vSeed;
void main() {
  int f = int(aFix);
  // mist lingers: weight the recent past, newest strongest
  float p = 0.0;
  float wsum = 0.0;
  for (int i = 0; i < 6; i++) {
    float w = exp(-float(i) * 0.45);
    p += histAt(uHistA, f, uTime - float(i) * 0.6).x * w;
    wsum += w;
  }
  p /= wsum;
  vec4 a = histAt(uHistA, f, uTime);
  vec4 b = histAt(uHistB, f, uTime);
  float h = aShape.x * max(p, 0.0);
  // head direction (pan toward +x, tilt toward +z), as in PHYSICS headDir
  vec3 dir = vec3(sin(a.y), cos(a.y), 0.0);
  dir = vec3(dir.x, dir.y * cos(a.z), dir.y * sin(a.z));
  dir = mix(dir, vec3(0.0, 1.0, 0.0), aShape.w);
  dir.y = max(dir.y, 0.35);
  vec3 centre = aOrigin + normalize(dir) * h * 0.45;
#ifdef SIZED
  vec2 half_ = vec2(aShape.y + h * 0.22, h * 0.6 + 1.5 * aSize);
  float hMin = 0.05 * aSize;
#else
  vec2 half_ = vec2(aShape.y + h * 0.22, h * 0.6 + 1.5);
  float hMin = 0.05;
#endif
  vec3 right, up_;
  spriteAxes(centre, right, up_);
  vec3 wp = centre + right * position.x * half_.x * 2.0 + vec3(0.0, 1.0, 0.0) * position.y * half_.y * 2.0;
  vUv = position.xy * 2.0;
  vSeed = aFix * 0.618;
  vCol = b.rgb * b.a * smoothstep(0.0, 0.25, p) * (0.4 + 0.6 * p) * aShape.z * uGain;
#ifdef PYRO
  // fireworks overhead light the same mist
  vCol += uPyro * smoothstep(0.0, 0.25, p) * aShape.z;
#endif
  gl_Position = h < hMin ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const HAZE_FS = /* glsl */ `
uniform float uTime;
varying vec3 vCol;
varying vec2 vUv;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  // soft vertical cloud, a little denser low down where the spray falls back
  float r2 = vUv.x * vUv.x + vUv.y * vUv.y;
  // falls to zero inside the quad so no edge shows
  float a = pow(max(1.0 - r2, 0.0), 2.0) * exp(-r2 * 1.2) * (1.0 - 0.35 * vUv.y);
  vec2 q = vUv * vec2(1.3, 2.2) + vec2(vSeed, -uTime * 0.05);
  a *= 0.75 + 0.5 * (vnoise(q * 1.5) * 0.65 + vnoise(q * 3.7) * 0.35);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

/** Haze per fixture type: how wide the mist hangs and how much light it returns. */
function shape(fx: Fixture): [number, number] {
  const s = fx.spec;
  switch (fx.type) {
    case 'vertical':
      return [2.5, 0.018];
    case 'oscillating':
      return [3, 0.05];
    case 'fan':
      return [6, 0.05];
    case 'ring':
      return [5 + s.p[0], 0.06];
    case 'shooter':
      // geysers throw a heavy mist plume that lights the sky
      return s.height > 40 ? [10, 0.06] : [2.5, 0.025];
    default:
      return [3, 0.01];
  }
}

export class Haze {
  readonly object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(layout: Layout, history: ParamHistory, uTime: THREE.IUniform, uKNow: THREE.IUniform) {
    const n = layout.fixtures.length;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const fix = new Float32Array(n);
    const origin = new Float32Array(n * 3);
    const shapes = new Float32Array(n * 4);
    const sizes = new Float32Array(n);
    for (const fx of layout.fixtures) {
      const [w, gain] = shape(fx);
      // the haze leans with the head only where the head turns (Fixture.turns)
      const upright = fx.turns ? 0 : 1;
      fix[fx.index] = fx.index;
      origin.set(fx.position, fx.index * 3);
      const L = drawScale(fx.spec.height).size;
      shapes.set([fx.spec.height, w * L, gain, upright], fx.index * 4);
      sizes[fx.index] = L;
    }
    g.setAttribute('aFix', new THREE.InstancedBufferAttribute(fix, 1));
    g.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origin, 3));
    g.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 4));
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(sizes, 1));
    g.instanceCount = n;
    this.mat = new THREE.ShaderMaterial({
      // small fixtures' sizes are compiled in only where there are some (the lagoon's shader is unchanged)
      defines: sizes.some((L) => L < 1) ? { SIZED: '' } : {},
      uniforms: {
        uHistA: { value: history.texA },
        uHistB: { value: history.texB },
        uHistRate: { value: RATE },
        uKNow: uKNow,
        uTime: uTime,
        uGain: { value: 1 },
        uPyro: { value: new THREE.Vector3() },
        uFaceCamera,
      },
      vertexShader: HAZE_VS,
      fragmentShader: HAZE_FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Mesh(g, this.mat);
    this.object.frustumCulled = false;
    // behind the water so the jets draw over it
    this.object.renderOrder = 0;
  }

  /** Light the fireworks throw on the mist (linear colour, 0 without fireworks). */
  setPyro(v: THREE.Vector3, on = true) {
    // compiled in only for shows with fireworks (the haze of the others stays exactly as it was)
    if (on !== 'PYRO' in this.mat.defines) {
      if (on) this.mat.defines.PYRO = '';
      else delete this.mat.defines.PYRO;
      this.mat.needsUpdate = true;
    }
    (this.mat.uniforms.uPyro.value as THREE.Vector3).copy(v);
  }

  set gain(v: number) {
    this.mat.uniforms.uGain.value = v;
  }

  dispose() {
    this.object.geometry.dispose();
    this.mat.dispose();
  }
}
