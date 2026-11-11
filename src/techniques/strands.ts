import * as THREE from 'three';
import { GLSL_ALL } from '../core/glsl';
import type { NozzleUniforms } from '../core/nozzles';
import { coverageBlend } from './particles';
import type { FrameInfo, Technique } from './types';

/**
 * Strands: a jet at one instant is the curve {drop(t - a) : a in [0, life]}
 * (a streakline). Each strand samples that curve along age and is drawn as a
 * camera-facing ribbon, so the water is continuous instead of a set of dots.
 * Its random parameters drift smoothly with birth time, so strands wobble.
 *
 * In "column" mode only the coherent part is drawn, shaded as a tube with a
 * flow texture that moves with the water (texture coordinate = birth time).
 */
const STRAND_VS = /* glsl */ `
${GLSL_ALL}
attribute float aSeg;
attribute float aSide;
attribute float aId;
uniform float uSeg;
uniform float uLife;
uniform float uPx;
uniform vec2  uViewport;
uniform float uCover;
uniform float uWidth;
uniform float uColumn;
uniform float uCoreBias;
uniform float uDrift;
uniform float uAerWiden;
varying vec3 vCol;
varying float vA;
varying float vSide;
varying float vTb;
varying float vCoh;
varying float vAer;

Drop strandDrop(float age) {
  float tb = uTime - age;
  vec4 fixedR = rnd4(uint(aId) * 31u + 7u);
  vec4 sm = smooth4(aId, tb * uDrift);
  vec4 r;
  r.x = fixedR.x;
  r.y = clamp(fixedR.y + (sm.y - 0.5) * 0.12, 0.0, 1.0);
  r.z = clamp(fixedR.z + (sm.z - 0.5) * 0.3, 0.0, 1.0);
  r.w = fixedR.w + (sm.w - 0.5) * 0.25;
  vec4 k4 = smooth4(aId + 5000.0, tb * uDrift * 1.7) - 0.5;
  vec3 kick = normalize(k4.xyz + 1e-4);
  return drop(r, kick, age, uCoreBias);
}

void main() {
  float s = aSeg / uSeg;
  float age = uLife * s * s * 0.85 + uLife * s * 0.15; // denser near the nozzle
  float eps = uLife / uSeg * 0.5;
  Drop d = strandDrop(age);
  Drop dn = strandDrop(age + eps);
  vec3 p = d.p;
  p.y = max(p.y, 0.0);
  vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.0);
  vec4 cn = projectionMatrix * viewMatrix * vec4(dn.p, 1.0);
  vec2 sp = c.xy / c.w * 0.5 * uViewport;
  vec2 tng = cn.xy / cn.w * 0.5 * uViewport - sp;
  tng = length(tng) > 1e-4 ? normalize(tng) : vec2(0.0, 1.0);
  vec2 nrm = vec2(-tng.y, tng.x);

  // width: nozzle bore, then the spray cloud grows after break-up
  float after = max(age - d.tBreak, 0.0);
  float wW = uWidth * (0.6 + 0.4 * d.press) + uTurb * length(d.v) * after * 0.5 + after * 0.15
           + uAerWiden * uAer * uSpread * distance(d.p, d.base) * 1.2;
  float wPx = wW * uPx / max(c.w, 0.1);
  float wDraw = max(wPx, 1.3);
  float cov = uCover * min(wPx / 1.3, 1.0) * uWidth / wW;
  float alive = d.alive * step(0.0, d.p.y + 0.05);
  if (uColumn > 0.5) {
    // the column dissolves over a short distance after break-up
    alive *= 1.0 - smoothstep(0.0, 0.25, after);
    cov = uCover * min(wPx / 1.3, 1.0);
  }
  cov *= smoothstep(0.0, 0.05, age);
  sp += nrm * aSide * wDraw * 0.5;
  gl_Position = vec4(sp / (0.5 * uViewport) * c.w, c.z, c.w);
  vCol = shadeDrop(d, cameraPosition);
  vA = cov * alive;
  vSide = aSide;
  vTb = uTime - age;
  vCoh = d.coh;
  vAer = uAer;
}`;

export const STRAND_FS = /* glsl */ `
uniform float uColumn;
varying float vAer;
varying vec3 vCol;
varying float vA;
varying float vSide;
varying float vTb;
varying float vCoh;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float u = vSide;
  float a;
  vec3 col = vCol;
  if (uColumn > 0.5) {
    // tube: optical thickness ~ chord length, bright rims (Fresnel / bubbles
    // at the surface), and a flow texture advected with the water
    float chord = sqrt(max(1.0 - u * u, 0.0));
    float rim = pow(1.0 - chord, 2.0);
    float flow = vnoise(vec2(vTb * 26.0, u * 2.5)) * 0.6 + vnoise(vec2(vTb * 63.0, u * 6.0)) * 0.4;
    float body = mix(0.55, 1.0, vAer) * chord;
    // the glassy rim belongs to clear water; foam has none, so a white
    // column reads as a soft body rather than a tube
    float glass = 1.0 - 0.7 * vAer;
    a = clamp(body * mix(0.75, 1.15, flow) + rim * 0.35 * glass, 0.0, 1.0);
    col *= mix(0.8, 1.25, flow) + rim * 0.6 * glass;
  } else {
    a = 1.0 - u * u;
  }
  a *= vA;
  // see particles.ts: transparent water blocks only part of the background,
  // and unlit water hardly any of it
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float lit = mix(0.15, 1.0, smoothstep(0.0, 0.2, lum));
  gl_FragColor = vec4(col * a, a * 0.35 * lit);
}`;

export interface StrandOptions {
  strands: number;
  segments: number;
  life: number;
  cover: number;
  width: number;
  column?: boolean;
  coreBias?: number;
  drift?: number;
  /** Widen the ribbon as aerated water bulks up (off when spray carries the bulk). */
  aerWiden?: boolean;
}

export class StrandTechnique implements Technique {
  object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(nozzle: NozzleUniforms, o: StrandOptions) {
    const S = o.segments;
    const seg = new Float32Array((S + 1) * 2);
    const side = new Float32Array((S + 1) * 2);
    for (let i = 0; i <= S; i++) {
      seg[i * 2] = i;
      seg[i * 2 + 1] = i;
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
    }
    const index: number[] = [];
    for (let i = 0; i < S; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((S + 1) * 2 * 3), 3));
    g.setAttribute('aSeg', new THREE.BufferAttribute(seg, 1));
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    g.setIndex(index);
    const ids = new Float32Array(o.strands).map((_, i) => i);
    g.setAttribute('aId', new THREE.InstancedBufferAttribute(ids, 1));
    g.instanceCount = o.strands;

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...nozzle,
        uSeg: { value: S },
        uLife: { value: o.life },
        uPx: { value: 1000 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uCover: { value: o.cover },
        uWidth: { value: o.width },
        uColumn: { value: o.column ? 1 : 0 },
        uCoreBias: { value: o.coreBias ?? 0.6 },
        uDrift: { value: o.drift ?? 0.8 },
        uAerWiden: { value: o.aerWiden === false ? 0 : 1 },
      },
      vertexShader: STRAND_VS,
      fragmentShader: STRAND_FS,
      side: THREE.DoubleSide,
    });
    coverageBlend(this.mat);
    this.object = new THREE.Mesh(g, this.mat);
    this.object.frustumCulled = false;
  }

  update(f: FrameInfo) {
    const u = this.mat.uniforms;
    u.uTime.value = f.time;
    u.uPx.value = f.pxPerMetre;
    u.uViewport.value.copy(f.viewport);
  }

  dispose() {
    this.object.geometry.dispose();
    this.mat.dispose();
  }
}
