import * as THREE from 'three';
import { BILLBOARD_GLSL, uFaceCamera } from '../core/billboard';
import { HASH } from '../core/glsl';
import type { Burst } from '../pyro/schedule';
import type { Vec3 } from '../venues';
import { MAX_PYRO_LIGHTS, type PyroLight } from './fireworks';

/**
 * Fireworks smoke (docs/detailed-design.md 3.6): a few soft cloud puffs
 * around each burst that drift with the wind, spread and thin out over 20-40
 * seconds. The smoke itself is nearly black; it shows where the fireworks
 * light it (the strongest few, from Fireworks.lights), so later shells light
 * up the smoke of the earlier ones. Like the stars, a puff's place and size
 * depend on the show time alone.
 */

/** Bursts whose smoke is drawn at most (the latest). */
const MAX_SMOKE = 96;
const PUFFS = 16;
/** Seconds the smoke of a burst hangs at most. */
const LIFE = 40;

const VS = /* glsl */ `
${HASH}
${BILLBOARD_GLSL}
uniform highp sampler2D uSmoke;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uLightPos[${MAX_PYRO_LIGHTS}];
uniform vec3 uLightCol[${MAX_PYRO_LIGHTS}];
uniform int uLightCount;
uniform float uDensity;
attribute vec2 aPuff; // slot, puff
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
void main() {
  vec4 a = texelFetch(uSmoke, ivec2(0, int(aPuff.x)), 0);
  vec4 b = texelFetch(uSmoke, ivec2(1, int(aPuff.x)), 0);
  float age = uTime - a.w;
  float radius = b.x;
  float life = b.z;
  if (age < 0.0 || age > life || aPuff.y >= b.w) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 r = rnd4(uint(b.y) * 31u + uint(aPuff.y) * 7u + 3u);
  vec4 r2 = rnd4(uint(b.y) * 57u + uint(aPuff.y) * 11u + 5u);
  // puffs fill the ball the stars burned through, a little more toward its middle
  vec3 dir = normalize(r.xyz - 0.5 + 1e-3) * pow(r.w, 0.6);
  float grow = min(age / 3.0, 1.0);
  vec3 c = a.xyz + dir * radius * (0.45 + 0.4 * grow) + uWind * age + vec3(0.0, 0.25 * age, 0.0);
  float half_ = radius * (0.28 + 0.14 * r2.x) * (0.55 + 0.45 * sqrt(grow)) + age * 0.9;
  vec3 right, up_;
  spriteAxes(c, right, up_);
  vec3 wp = c + (right * position.x + up_ * position.y) * half_ * 2.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  // forms as the stars burn, thins as it spreads, gone by its end
  float d = smoothstep(0.0, 1.5, age) * (1.0 - smoothstep(life * 0.35, life, age));
  d *= (radius * 0.4) / (half_ + 1.0);
  vA = clamp(d, 0.0, 1.0) * 0.7 * uDensity * (0.7 + 0.3 * r2.y);
  vec3 lit = vec3(0.004, 0.005, 0.008);
  for (int i = 0; i < ${MAX_PYRO_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 dl = uLightPos[i] - c;
    lit += uLightCol[i] * 20.0 / (dot(dl, dl) + 900.0);
  }
  vCol = lit;
  vUv = position.xy * 2.0;
  vSeed = r2.z * 40.0;
}`;

const FS = /* glsl */ `
uniform float uTime;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float r2 = dot(vUv, vUv);
  float a = pow(max(1.0 - r2, 0.0), 2.0);
  vec2 q = vUv * 1.6 + vec2(vSeed, uTime * 0.02);
  a *= 0.55 + 0.9 * (vnoise(q * 1.7) * 0.6 + vnoise(q * 4.1) * 0.4);
  a = clamp(a * vA, 0.0, 1.0);
  // premultiplied: the lit smoke adds its light and hides a little of what is behind
  gl_FragColor = vec4(vCol * a, a * 0.55);
}`;

export class Smoke {
  readonly object: THREE.Mesh;
  private bursts: Burst[] = [];
  private data = new Float32Array(2 * MAX_SMOKE * 4);
  private tex: THREE.DataTexture;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private written = '';

  constructor(wind: Vec3 = [1.5, 0, 0]) {
    this.tex = new THREE.DataTexture(this.data, 2, MAX_SMOKE, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const puffs = new Float32Array(MAX_SMOKE * PUFFS * 2);
    for (let s = 0, k = 0; s < MAX_SMOKE; s++) for (let j = 0; j < PUFFS; j++, k += 2) puffs.set([s, j], k);
    g.setAttribute('aPuff', new THREE.InstancedBufferAttribute(puffs, 2));
    g.instanceCount = 0;
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSmoke: { value: this.tex },
        uTime: { value: 0 },
        uWind: { value: new THREE.Vector3(...wind) },
        uLightPos: { value: Array.from({ length: MAX_PYRO_LIGHTS }, () => new THREE.Vector3()) },
        uLightCol: { value: Array.from({ length: MAX_PYRO_LIGHTS }, () => new THREE.Vector3()) },
        uLightCount: { value: 0 },
        uDensity: { value: 1 },
        uFaceCamera,
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.object = new THREE.Mesh(g, this.mat);
    this.object.frustumCulled = false;
    // over the stars: smoke in front of a later shell veils it
    this.object.renderOrder = 6;
    this.object.visible = false;
  }

  /** Bursts that leave smoke: the shells themselves, not a 千輪's small ones or a comet. */
  setBursts(bursts: Burst[]) {
    this.bursts = bursts.filter((b) => b.parent === undefined && b.shell !== 'comet');
    this.written = '';
    this.object.visible = false;
  }

  /** How thick the smoke is (1 = as chosen 2026-11-03, '×2' of shots/stage2/looks/decide.jpg). */
  set density(v: number) {
    this.mat.uniforms.uDensity.value = v;
  }

  advance(t: number, lights: PyroLight[]) {
    const u = this.mat.uniforms;
    u.uTime.value = t;
    // the latest bursts that opened in the last LIFE seconds
    const bs = this.bursts;
    let hi = bs.length;
    while (hi > 0 && bs[hi - 1].tBurst > t) hi--;
    let lo = hi;
    while (lo > 0 && bs[lo - 1].tBurst >= t - LIFE && hi - lo < MAX_SMOKE) lo--;
    const act = bs.slice(lo, hi);
    this.object.visible = act.length > 0;
    this.geo.instanceCount = act.length * PUFFS;
    const key = act.map((b) => b.id).join(',');
    if (key !== this.written) {
      this.written = key;
      act.forEach((b, s) => {
        // bigger shells leave more smoke, and it hangs longer
        const puffs = Math.min(PUFFS, Math.round(8 + b.size * 0.8));
        const life = 20 + 20 * ((b.seed % 997) / 997);
        this.data.set([...b.center, b.tBurst, b.radius, b.seed % 65521, life, puffs], s * 8);
      });
      this.tex.needsUpdate = true;
    }
    const n = Math.min(lights.length, MAX_PYRO_LIGHTS);
    for (let i = 0; i < n; i++) {
      (u.uLightPos.value as THREE.Vector3[])[i].copy(lights[i].pos);
      (u.uLightCol.value as THREE.Vector3[])[i].copy(lights[i].col);
    }
    u.uLightCount.value = n;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
