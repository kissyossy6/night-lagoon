import * as THREE from 'three';
import { GLSL_ALL } from '../core/glsl';
import type { NozzleUniforms } from '../core/nozzles';
import type { FrameInfo, Technique } from './types';

/** Premultiplied "over": water both scatters light and hides what is behind it. */
export function coverageBlend(m: THREE.ShaderMaterial) {
  m.transparent = true;
  m.depthWrite = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
}

const PARTICLE_HEAD = /* glsl */ `
attribute float aId;
attribute float aKind;   // 0 drop, 1 mist
uniform float uN;
uniform float uLife;
uniform float uPx;       // pixels per metre at 1 m
uniform vec2  uViewport;
uniform float uShutter;
uniform float uCover;
uniform float uMistCover;
uniform float uDropSize;
uniform float uMistSize;
uniform float uCohCover; // coverage multiplier for drops still inside the column (0 = hide)
uniform float uMistBias;
uniform float uMistFadeIn;

// Particle slots are recycled with period uLife and a per-slot phase, so
// births are uniform in time and every cycle draws new randoms.
float slotAge(out uint seed) {
  if (uType == 1) {
    // shooters fire short shots: spend every slot inside the last two shots
    // instead of wasting most of them on the silent part of the cycle
    float f = aId / uN * 2.0;
    float back = floor(f);
    float shot = floor((uTime - uP.z) / uP.x) - back;
    float tb = shot * uP.x + uP.z + fract(f) * uP.y;
    seed = uint(aId) * 9781u + uint(int(shot) + 1000) * 6271u + 17u;
    float age = uTime - tb;
    return age < 0.0 ? 1e4 : age;
  }
  float x = uTime + aId / uN * uLife;
  float cyc = floor(x / uLife);
  seed = uint(aId) * 9781u + uint(int(cyc) + 1000) * 6271u + 17u;
  return x - cyc * uLife;
}
`;

// ---------------------------------------------------------------- A: points
const POINTS_VS = /* glsl */ `
${GLSL_ALL}
${PARTICLE_HEAD}
varying vec3 vCol;
varying vec2 vDir;
varying float vStretch;
void main() {
  uint seed;
  float age = slotAge(seed);
  vec4 r = rnd4(seed);
  bool mist = aKind > 0.5;
  Drop d = drop(r, kickDir(seed), age, mist ? 3.0 : 0.6);
  vec4 mv = viewMatrix * vec4(d.p, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec4 clip2 = projectionMatrix * viewMatrix * vec4(d.p + d.v * uShutter, 1.0);
  vec2 sv = (clip2.xy / clip2.w - clip.xy / clip.w) * 0.5 * uViewport;
  float depth = max(-mv.z, 0.1);
  float sizeW = mist ? uMistSize * (0.4 + age * 0.5) : uDropSize;
  float px = sizeW * uPx / depth;
  float len = length(sv);
  float stretch = mist ? 1.0 : clamp((len + px) / max(px, 1.0), 1.0, 14.0);
  vDir = len > 1e-3 ? sv / len : vec2(0.0, 1.0);
  vStretch = stretch;
  gl_PointSize = clamp(max(px, 1.5) * stretch, 1.5, 96.0);
  float a = mist ? uMistCover * (1.0 - smoothstep(uLife * 0.5, uLife, age)) : uCover;
  vCol = shadeDrop(d, cameraPosition) * a * d.alive;
  gl_Position = d.alive > 0.5 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
}`;

const POINTS_FS = /* glsl */ `
varying vec3 vCol;
varying vec2 vDir;
varying float vStretch;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  q.y = -q.y;
  vec2 a = vec2(dot(q, vDir), dot(q, vec2(-vDir.y, vDir.x)) * vStretch);
  float r2 = dot(a, a);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(vCol * exp(-r2 * 3.0), 1.0);
}`;

// --------------------------------------------------------------- B: streaks
const STREAK_VS = /* glsl */ `
${GLSL_ALL}
${PARTICLE_HEAD}
attribute vec2 corner;  // x: 0 tail .. 1 head, y: -1 .. 1 across
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
varying float vMist;
void main() {
  uint seed;
  float age = slotAge(seed);
  vec4 r = rnd4(seed);
  bool mist = aKind > 0.5;
  vec3 kick = kickDir(seed);
  float bias = mist ? uMistBias : 0.6;
  Drop d = drop(r, kick, age, bias);
  Drop d0 = drop(r, kick, max(age - uShutter, 0.0), bias);
  bool hide = d.alive < 0.5 || (uCohCover <= 0.0 && d.coh > 0.5);
  vec4 c1 = projectionMatrix * viewMatrix * vec4(d.p, 1.0);
  vec4 c0 = projectionMatrix * viewMatrix * vec4(d0.p, 1.0);
  if (mist) c0 = c1;
  vec2 s1 = c1.xy / c1.w * 0.5 * uViewport;
  vec2 s0 = c0.xy / c0.w * 0.5 * uViewport;
  vec2 dir = s1 - s0;
  float len = length(dir);
  dir = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float sizeW = mist ? uMistSize * (0.5 + age * 0.6) : uDropSize * mix(0.5, 1.4, d.core);
  float wPx = sizeW * uPx / max(c1.w, 0.1);
  float wDraw = max(wPx, 1.2);
  // energy-conserving coverage: sub-pixel drops get fainter, not bigger,
  // and motion blur spreads one drop over its streak
  float cov = (mist ? uMistCover : uCover) * min(wPx / 1.2, 1.0) * wDraw / (len + wDraw);
  if (mist) cov *= smoothstep(0.0, uMistFadeIn, age) * (1.0 - smoothstep(uLife * 0.45, uLife, age));
  if (d.coh > 0.5) cov *= uCohCover;
  vec2 sp = mix(s0, s1, corner.x) + dir * (corner.x * 2.0 - 1.0) * wDraw * 0.5 + nrm * corner.y * wDraw * 0.5;
  vec4 c = mix(c0, c1, corner.x);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = shadeDrop(d, cameraPosition);
  vA = cov;
  vUv = vec2(corner.x * 2.0 - 1.0, corner.y);
  vSeed = float(seed % 9973u);
  vMist = mist ? 1.0 : 0.0;
}`;

export const STREAK_FS = /* glsl */ `
uniform float uTime;
uniform float uCloudy;
uniform float uSparkle;
uniform float uOcclude;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
varying float vMist;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float a;
  if (vMist > 0.5) {
    float r2 = dot(vUv, vUv);
    a = exp(-r2 * 3.0);
    if (uCloudy > 0.5) {
      vec2 p = vUv * 1.6 + vSeed;
      float n = vnoise(p * 1.7) * 0.6 + vnoise(p * 3.9) * 0.3 + vnoise(p * 8.1) * 0.1;
      a *= smoothstep(0.25, 0.85, n) * 1.8;
    }
  } else {
    a = 1.0 - vUv.y * vUv.y;
  }
  a *= vA;
  vec3 col = vCol;
  if (uSparkle > 0.0 && vMist < 0.5) {
    float s = step(0.985, h(vec2(vSeed, floor(uTime * 24.0))));
    col *= 1.0 + s * uSparkle;
  }
  // water is mostly transparent: it scatters light (colour) but blocks only
  // part of what is behind it (alpha). Drops far larger than the wavelength
  // send most of the light they intercept on forward, so unlit water lets the
  // background through and only lit water reads as solid (as mist.ts does):
  // a dark drop or mist sprite must not cut a black hole in the lit haze
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float lit = mix(0.15, 1.0, smoothstep(0.0, 0.2, lum));
  gl_FragColor = vec4(col * a, a * (vMist > 0.5 ? 0.8 : uOcclude) * lit);
}`;

export interface ParticleOptions {
  mode: 'points' | 'streaks';
  count: number;
  mistFraction: number;
  life: number;
  cover: number;
  mistCover: number;
  dropSize: number;
  mistSize: number;
  shutter: number;
  additive?: boolean;
  /** Coverage of drops still inside the coherent column (default 1, 0 hides them). */
  cohCover?: number;
  mistFadeIn?: number;
  cloudy?: boolean;
  sparkle?: number;
  mistBias?: number;
}

export class ParticleTechnique implements Technique {
  object: THREE.Object3D;
  private mat: THREE.ShaderMaterial;

  constructor(nozzle: NozzleUniforms, o: ParticleOptions) {
    const n = o.count;
    const ids = new Float32Array(n);
    const kinds = new Float32Array(n);
    const nMist = Math.round(n * o.mistFraction);
    for (let i = 0; i < n; i++) {
      ids[i] = i;
      // interleave so mist slots are spread uniformly in phase
      kinds[i] = nMist > 0 && i % Math.max(1, Math.round(n / nMist)) === 0 ? 1 : 0;
    }
    const uniforms = {
      ...nozzle,
      uN: { value: n },
      uLife: { value: o.life },
      uPx: { value: 1000 },
      uViewport: { value: new THREE.Vector2(1, 1) },
      uShutter: { value: o.shutter },
      uCover: { value: o.cover },
      uMistCover: { value: o.mistCover },
      uDropSize: { value: o.dropSize },
      uMistSize: { value: o.mistSize },
      uCohCover: { value: o.cohCover ?? 1 },
      uMistFadeIn: { value: o.mistFadeIn ?? 0.4 },
      uCloudy: { value: o.cloudy ? 1 : 0 },
      uSparkle: { value: o.sparkle ?? 0 },
      uOcclude: { value: 0.35 },
      uMistBias: { value: o.mistBias ?? 3.0 },
    };

    if (o.mode === 'points') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('aId', new THREE.BufferAttribute(ids, 1));
      g.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
      this.mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: POINTS_VS,
        fragmentShader: POINTS_FS,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.object = new THREE.Points(g, this.mat);
    } else {
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
      g.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
      g.instanceCount = n;
      this.mat = new THREE.ShaderMaterial({ uniforms, vertexShader: STREAK_VS, fragmentShader: STREAK_FS });
      if (o.additive) {
        this.mat.transparent = true;
        this.mat.depthWrite = false;
        this.mat.blending = THREE.AdditiveBlending;
      } else {
        coverageBlend(this.mat);
      }
      this.object = new THREE.Mesh(g, this.mat);
    }
    this.object.frustumCulled = false;
  }

  update(f: FrameInfo) {
    const u = this.mat.uniforms;
    u.uTime.value = f.time;
    u.uPx.value = f.pxPerMetre;
    u.uViewport.value.copy(f.viewport);
  }

  dispose() {
    (this.object as THREE.Mesh).geometry.dispose();
    this.mat.dispose();
  }
}
