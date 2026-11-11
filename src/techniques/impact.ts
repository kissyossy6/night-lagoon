import * as THREE from 'three';
import { HASH, LIGHT, PHYSICS } from '../core/glsl';
import { HISTORY_GLSL } from '../show/history';
import { drawScale, type Layout } from '../show/layout';
import { EVAL_VS, FIX_GLSL, PARTICLE_DRAW_VS, PW, SHUTTER, evalTarget, floatTex } from '../show/jetfield';
import { STREAK_FS } from './particles';

/**
 * Water hitting the water (stage 7, H2): where the fountains' water comes
 * down, the surface rings, splashes and turns white.
 *
 * Like the jets, this depends only on show time. Each fixture gets a set of
 * "impact samples" spread evenly over the water it has emitted (as the spray
 * slots are). For each, the GPU finds when and where that water came down
 * (the same ballistics the drops are drawn with: nozzle physics + the cue
 * history) and how fast. From the landing:
 *
 *   splash  a few drops thrown up and out, and for hard impacts a puff of
 *           mist; drawn with the spray's own streak shader
 *   ripple  a ring wave that runs out and dies away
 *   foam    a white patch that spreads and fades over a few seconds, lit by
 *           the light the water carried down
 *
 * Ripples and foam are painted, from above, into one float map over the
 * water (rgb foam light, a height). The water shader (core/stage.ts, IMPACT)
 * reads it: the height bends the reflection, the foam glows on the surface.
 *
 * Sizes follow the falling water: how much there is (the fixture's flow,
 * the pressure) and how fast it lands. Small fixtures (desk, garden) shrink
 * with layout.ts drawScale.
 */

/** How long foam stays after the water lands (s at full pressure), and the ripple's life. */
export const FOAM_LIFE = 3.0;
const RIPPLE_LIFE = 0.9;
/**
 * Two kinds of sample: splash samples live only as long as their drops fly
 * (SPLASH_LIFE), so they can be many; foam samples last the foam's life and
 * carry the mist puffs. Both paint ripples and foam.
 */
const SPLASH_LIFE = 1.0;
/** Elements per sample in the splash pass: drops of a splash sample, mist puffs (first MIST_PER) of a foam sample. */
const SPLASH_PER = 8;
/** Samples per spray drop of the fixture (at quality 'high'; the tiers scale it). */
const SPLASH_SHARE = 0.15;
const FOAM_SHARE = 0.06;
const MIST_PER = 2;

export interface ImpactOptions {
  /** Samples per fixture relative to its spray count (quality tiers scale it). */
  scale: number;
  /** Side of the top-down ripple / foam map (texels). */
  mapSize: number;
}

// --------------------------------------------------------------- landing
function impactEvalFS() {
  return /* glsl */ `
precision highp float;
precision highp int;
${HASH}
${PHYSICS}
${LIGHT}
${HISTORY_GLSL}
${FIX_GLSL}
uniform highp sampler2D uISlots; // fixture, slot, slots of this kind, span (negative: a splash sample)
layout(location = 0) out vec4 oPos; // landing position, seconds since landing
layout(location = 1) out vec4 oVel; // landing velocity, strength (0 = none)
layout(location = 2) out vec4 oCol; // light the water carried down, seed

void main() {
  oPos = vec4(0.0, 0.0, 0.0, -1.0);
  oVel = vec4(0.0);
  oCol = vec4(0.0);
  vec4 sl = texelFetch(uISlots, ivec2(gl_FragCoord.xy), 0);
  if (sl.z < 0.5) return;
  int f = int(sl.x);
  float k = sl.y;
  bool splash = sl.w < 0.0;
  float span = abs(sl.w);
  float life, span0;
  Fix fx = loadFix(f, life, span0);
  vec4 sz = texelFetch(uFix, ivec2(f, 6), 0);
  vec4 im = texelFetch(uFix, ivec2(f, 7), 0); // flow strength, ripple wavelength
  float mNow = histAt(uHistA, f, uTime).w;
  float phi = (k + 0.5) / sl.z;
  float n = floor(mNow / span - phi);
  float mb = (n + phi) * span;
  if (mb <= 0.0) return;
  float tb = birthTime(f, mb);
  float age = uTime - tb;
  if (age < 0.0) return;

  uint seed = uint(f) * 7919u + uint(k) * 104729u + uint(int(n) + 4096) * 6271u + (splash ? 999331u : 17u);
  vec4 r = rnd4(seed);
  // the big drops carry the water down: the core of the stream
  r.y = mix(0.45, 1.0, r.y);
  vec3 kick = kickDir(seed);
  float jet = min(floor(r.x * fx.jets), fx.jets - 1.0);
  vec3 base, dir;
  float press = nozzleAt(fx, f, tb, jet, base, dir);
  if (press < 0.02) return;
  // when it came down: the drop's height crosses the water (bisection)
  float hi = life * 1.6;
  Drop d = dropFrom(fx, base, dir, press, jet, r, kick, hi, 0.6);
  float yHi = d.p.y;
  if (yHi > 0.0) return;
  float lo = 0.0, yLo = base.y;
  for (int i = 0; i < 7; i++) {
    float mid = 0.5 * (lo + hi);
    d = dropFrom(fx, base, dir, press, jet, r, kick, mid, 0.6);
    if (d.p.y > 0.0) { lo = mid; yLo = d.p.y; } else { hi = mid; yHi = d.p.y; }
  }
  // the last step straight across
  float tLand = mix(lo, hi, clamp(yLo / max(yLo - yHi, 1e-6), 0.0, 1.0));
  float since = age - tLand;
  if (since < 0.0 || since > (splash ? ${SPLASH_LIFE.toFixed(2)} : ${FOAM_LIFE.toFixed(2)})) return;
  d = dropFrom(fx, base, dir, press, jet, r, kick, tLand, 0.6);
  // a still-coherent column lands as a body; spray that has broken up and
  // slowed lands softer
  float speed = length(d.v);
  float strength = im.x * (0.4 + 0.6 * press) * mix(0.6, 1.0, d.core);
  oPos = vec4(d.p.x, 0.0, d.p.z, since);
  oVel = vec4(d.v, strength);
  // the light the splash is seen by. Churned water has no colour of its
  // own: it is white, lit by what reaches the surface where it lands, the
  // little light the falling water still carries plus the glow the
  // fixture's lit water spreads over the surface round it. So it is white
  // with a trace of colour, bright where the water lands near its own
  // ring (a closing whip) and faint far out (the user, 2026-11-06)
  vec3 c = shade(d, fx, f);
  const vec3 Y = vec3(0.2126, 0.7152, 0.0722);
  vec3 tint = c / max(dot(c, vec3(0.3333)), 1e-4);
  // ...but water that lands at the foot of its own jet sits in the ring's
  // beam and shows its colour, the bright coloured spot at every nozzle
  // (docs/video-review.md R4)
  float far = smoothstep(0.5, 4.0, distance(d.p.xz, base.xz) / max(sz.x, 0.03));
  // a whip lands far from its ring, where the water it brings down is
  // dark; the churn there is still seen, faintly, by the light of the lit
  // water round it, while its fixture is lit (the user: a whip's splash
  // showed only as it closed, 2026-11-06)
  float lum = dot(c, Y) + mix(0.015, 0.06, far) * dot(lightAt(f, uTime), Y);
  // seed; a splash sample's is negative
  float sd = 0.02 + 0.97 * rnd(seed + 3u);
  // far out, the foam is lit only faintly: half as bright as at the foot
  // (less colour at the foot too: the user, 2026-11-08)
  oCol = vec4(mix(vec3(1.0), tint, mix(0.4, 0.08, far)) * lum * mix(0.8, 0.45, far), splash ? -sd : sd);
}
`;
}

// ---------------------------------------------------------------- splash
function splashEvalFS() {
  return /* glsl */ `
precision highp float;
precision highp int;
${HASH}
uniform highp sampler2D uIPos;
uniform highp sampler2D uIVel;
uniform highp sampler2D uICol;
uniform highp sampler2D uFix;
uniform highp sampler2D uISlots;
uniform vec3 uWind;
// 1 / samples scale: more samples (the export tier) draw finer, not brighter
uniform float uShare;
layout(location = 0) out vec4 oHead;
layout(location = 1) out vec4 oTail;
layout(location = 2) out vec4 oCol;

// a splash drop: thrown up, linear drag, gravity
float uWindL;
vec3 flight(vec3 p0, vec3 v0, float k, float t) {
  vec3 vT = vec3(0.0, -${(9.81).toFixed(2)}, 0.0) / k + uWind * 0.15 * uWindL / k;
  float e = exp(-k * t);
  return p0 + vT * t + (v0 - vT) * (1.0 - e) / k;
}

void main() {
  oHead = vec4(0.0);
  oTail = vec4(0.0);
  oCol = vec4(0.0);
  int i = int(gl_FragCoord.x) + int(gl_FragCoord.y) * ${PW};
  int parent = i / ${SPLASH_PER};
  int j = i - parent * ${SPLASH_PER};
  ivec2 pt = ivec2(parent % ${PW}, parent / ${PW});
  vec4 ip = texelFetch(uIPos, pt, 0);
  vec4 iv = texelFetch(uIVel, pt, 0);
  vec4 ic = texelFetch(uICol, pt, 0);
  float a = ip.w;
  if (a < 0.0 || iv.w <= 0.0) return;
  int f = int(texelFetch(uISlots, pt, 0).x);
  vec4 sz = texelFetch(uFix, ivec2(f, 6), 0);
  float L = sz.x;
  uWindL = L;
  bool splash = ic.w < 0.0;
  if (!splash && j >= ${MIST_PER}) return;
  uint seed = uint(parent) * 2654435761u + uint(j) * 97u + uint(abs(ic.w) * 65536.0);
  vec4 r = rnd4(seed);
  float speed = length(iv.xyz);
  vec2 run = length(iv.xz) > 1e-3 ? normalize(iv.xz) : vec2(0.0);
  float ang = 6.2831853 * r.x;
  vec2 side = vec2(cos(ang), sin(ang));
  if (!splash) {
    // mist thrown up by the hit: more for fast, heavy water
    float hard = (0.5 + 0.5 * smoothstep(3.0, 18.0, speed)) * min(iv.w, 2.0);
    float life = 1.4 + 1.4 * hard;
    if (hard < 0.02 || a > life) return;
    float up = (0.35 + 0.08 * speed) * sqrt(L) * (0.6 + 0.6 * r.y);
    // it rolls out from the landing, the way the water was going
    vec3 p = ip.xyz + vec3(side.x, 0.0, side.y) * r.z * 0.4 * L + vec3(run.x, 0.0, run.y) * 0.08 * speed * L * min(a, 1.0);
    p.y = up * (1.0 - exp(-a * 1.8)) / 1.8;
    p += uWind * 0.3 * a * L;
    float cov = 0.3 * uShare * hard * smoothstep(0.0, 0.15, a) * (1.0 - smoothstep(life * 0.3, life, a));
    float size = 0.75 * (0.8 + 0.1 * speed) * L * (0.6 + a * 0.9) * sqrt(sqrt(uShare));
    oHead = vec4(p, cov);
    oTail = vec4(p, size);
    // white water: the churn scatters every colour of the light it catches
    oCol = vec4(mix(ic.rgb, vec3(dot(ic.rgb, vec3(0.333))), 0.35) * 2.2, 1.0 + 0.5 * r.w);
    return;
  }
  // drops: a crown thrown up and out, faster for faster water
  float u = speed * (0.08 + 0.3 * r.y * r.y);
  float lean = 0.25 + 0.6 * r.z;
  vec3 v0 = vec3(side.x * lean, 1.0, side.y * lean) * u + vec3(run.x, 0.0, run.y) * speed * 0.12;
  float k = 0.6;
  vec3 p = flight(ip.xyz, v0, k, a);
  if (p.y < 0.0) return;
  vec3 tail = flight(ip.xyz, v0, k, max(a - ${SHUTTER.toFixed(5)}, 0.0));
  float cov = 0.5 * min(iv.w, 1.5) * sqrt(uShare);
  float size = 0.04 * sz.y * mix(0.6, 1.3, r.w);
  oHead = vec4(p, cov);
  oTail = vec4(tail, size);
  // the light at the foot of the jet: splash close to the ring is lit hard
  oCol = vec4(ic.rgb * 2.0, 0.5 * r.w);
  // (drops: a splash sample's elements)
}
`;
}

// ------------------------------------------------------ ripple / foam map
const MAP_VS = /* glsl */ `
attribute vec2 corner;
attribute vec2 aTexel;
uniform highp sampler2D uIPos;
uniform highp sampler2D uIVel;
uniform highp sampler2D uICol;
uniform highp sampler2D uISlots;
uniform highp sampler2D uFix;
uniform vec4 uBox; // x0, z0, width, depth
uniform float uShare;
varying vec2 vLocal;
varying float vAge;
varying float vR;
varying vec3 vFoam;
varying float vRing;
varying float vLambda;
varying float vSeed;
varying float vShare;
void main() {
  vShare = sqrt(uShare);
  ivec2 tx = ivec2(aTexel);
  vec4 ip = texelFetch(uIPos, tx, 0);
  vec4 iv = texelFetch(uIVel, tx, 0);
  if (ip.w < 0.0 || iv.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 ic = texelFetch(uICol, tx, 0);
  int f = int(texelFetch(uISlots, tx, 0).x);
  vec4 sz = texelFetch(uFix, ivec2(f, 6), 0);
  vec4 im = texelFetch(uFix, ivec2(f, 7), 0);
  float L = sz.x;
  float a = ip.w;
  float speed = length(iv.xyz);
  float lambda = im.y * (0.6 + 0.8 * fract(ic.w * 7.31));
  // deep-water ripples run at sqrt(g λ / 2π); capillary ones no slower than 0.23 m/s
  float c = max(sqrt(9.81 * lambda / 6.2831853), 0.23);
  float ringR = c * a + lambda * 0.5;
  float foamR = (0.3 + 0.03 * speed) * L * (1.0 + 0.6 * a) * (0.7 + 0.6 * iv.w);
  float R = max(a < ${RIPPLE_LIFE.toFixed(2)} ? ringR + lambda * 1.5 : 0.0, foamR);
  vec2 xz = ip.xz + corner * R;
  vec2 uv = (xz - uBox.xy) / uBox.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  vLocal = corner * R;
  vAge = a;
  vR = foamR;
  vRing = ringR;
  vLambda = lambda;
  vSeed = abs(ic.w);
  // foam: white water, lit by what the water brought down; fades over its life
  float fade = exp(-a / ${(FOAM_LIFE / 2.2).toFixed(3)}) * (1.0 - smoothstep(${(FOAM_LIFE * 0.6).toFixed(2)}, ${FOAM_LIFE.toFixed(2)}, a));
  // a splash sample is short-lived: it only adds the first foam and ripple
  vFoam = mix(ic.rgb, vec3(dot(ic.rgb, vec3(0.333))), 0.35) * iv.w * 2.5 * uShare * fade * smoothstep(0.0, 0.08, a + 0.02) * (ic.w < 0.0 ? 1.0 - smoothstep(${(SPLASH_LIFE * 0.5).toFixed(2)}, ${SPLASH_LIFE.toFixed(2)}, a) : 1.0);
}
`;

const MAP_FS = /* glsl */ `
precision highp float;
varying vec2 vLocal;
varying float vAge;
varying float vR;
varying vec3 vFoam;
varying float vRing;
varying float vLambda;
varying float vSeed;
varying float vShare;
void main() {
  float d = length(vLocal);
  // foam: a soft disc, denser in the middle
  float q = d / max(vR, 1e-4);
  float foam = exp(-q * q * 2.2) * (1.0 - smoothstep(0.8, 1.0, q));
  // ripple: a wave packet on the running ring, dying away
  float h = 0.0;
  if (vAge < ${RIPPLE_LIFE.toFixed(2)}) {
    float x = (d - vRing) / vLambda;
    float env = exp(-x * x * 1.6) * exp(-vAge / ${(RIPPLE_LIFE / 2.5).toFixed(3)});
    // broken into arcs: a real splash does not ring evenly all round
    float th = atan(vLocal.y, vLocal.x);
    float arcs = 0.25 + 0.75 * smoothstep(0.3, 0.9, 0.5 + 0.3 * sin(th * 3.0 + vSeed * 40.0) + 0.2 * sin(th * 7.0 - vSeed * 23.0));
    h = env * arcs * sin(6.2831853 * x + vSeed * 6.28) * vLambda * 0.03 * vShare;
  }
  gl_FragColor = vec4(vFoam * foam, h);
}
`;

export class Impact {
  /** Splash drops and mist, drawn with the jets. */
  readonly object: THREE.Mesh;
  /** Ripple height (a) and foam light (rgb) over the water, seen from above. */
  readonly map: THREE.WebGLRenderTarget;
  /** x0, z0, width, depth of the map (m). */
  readonly box = new THREE.Vector4();
  readonly samples: number;
  private evalRT: THREE.WebGLRenderTarget;
  private splashRT: THREE.WebGLRenderTarget;
  private evalMat: THREE.ShaderMaterial;
  private splashMat: THREE.ShaderMaterial;
  private mapMat: THREE.ShaderMaterial;
  private drawMat: THREE.ShaderMaterial;
  private scene = new THREE.Scene();
  private mapScene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;

  constructor(layout: Layout, shared: Record<string, THREE.IUniform>, defines: Record<string, string>, opts: ImpactOptions) {
    // samples: spread over the water emitted during one flight plus the
    // foam's life, so a sample's foam is gone before its slot comes round
    const slots: number[] = [];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const fx of layout.fixtures) {
      const nF = Math.max(6, Math.round(fx.spray * FOAM_SHARE * opts.scale));
      const nS = Math.max(8, Math.round(fx.spray * SPLASH_SHARE * opts.scale));
      for (let k = 0; k < nF; k++) slots.push(fx.index, k, nF, fx.slotSpan + FOAM_LIFE);
      for (let k = 0; k < nS; k++) slots.push(fx.index, k, nS, -(fx.slotSpan + SPLASH_LIFE));
      // where its water can come down: the head leans and the arcs throw
      // up to about twice the height out
      const reach = fx.type === 'vertical' || fx.type === 'ring' ? fx.spec.height * 0.6 + 2 * drawScale(fx.spec.height).size : fx.spec.height * 2.2;
      x0 = Math.min(x0, fx.position[0] - reach);
      x1 = Math.max(x1, fx.position[0] + reach);
      z0 = Math.min(z0, fx.position[2] - reach);
      z1 = Math.max(z1, fx.position[2] + reach);
    }
    this.samples = slots.length / 4;
    // each sample stands for less water when there are more of them
    const share = 1 / Math.max(opts.scale, 0.25);
    const IH = Math.max(1, Math.ceil(this.samples / PW));
    const slotData = new Float32Array(PW * IH * 4);
    slotData.set(slots);
    const slotTex = floatTex(slotData, PW, IH);
    // a square-texel map over the area the water can reach
    const w = Math.max(x1 - x0, 0.01);
    const dz = Math.max(z1 - z0, 0.01);
    this.box.set(x0, z0, w, dz);
    const aspect = w / dz;
    const mw = aspect >= 1 ? opts.mapSize : Math.max(64, Math.round(opts.mapSize * aspect));
    const mh = aspect >= 1 ? Math.max(64, Math.round(opts.mapSize / aspect)) : opts.mapSize;
    this.map = new THREE.WebGLRenderTarget(mw, mh, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    });

    this.evalRT = evalTarget(PW, IH);
    const SH = Math.ceil((this.samples * SPLASH_PER) / PW);
    this.splashRT = evalTarget(PW, SH);

    this.evalMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      defines: { ...defines },
      uniforms: { ...shared, uISlots: { value: slotTex } },
      vertexShader: EVAL_VS,
      fragmentShader: impactEvalFS(),
      depthTest: false,
      depthWrite: false,
    });
    const it = this.evalRT.textures;
    this.splashMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uIPos: { value: it[0] },
        uIVel: { value: it[1] },
        uICol: { value: it[2] },
        uFix: shared.uFix,
        uISlots: { value: slotTex },
        uWind: shared.uWind,
        uShare: { value: share },
      },
      vertexShader: EVAL_VS,
      fragmentShader: splashEvalFS(),
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.evalMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    // the map: one quad per sample, additive
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
    mg.setIndex([0, 1, 2, 2, 1, 3]);
    const tex = new Float32Array(this.samples * 2);
    for (let i = 0; i < this.samples; i++) {
      tex[i * 2] = i % PW;
      tex[i * 2 + 1] = Math.floor(i / PW);
    }
    mg.setAttribute('aTexel', new THREE.InstancedBufferAttribute(tex, 2));
    mg.instanceCount = this.samples;
    this.mapMat = new THREE.ShaderMaterial({
      uniforms: {
        uIPos: { value: it[0] },
        uIVel: { value: it[1] },
        uICol: { value: it[2] },
        uISlots: { value: slotTex },
        uFix: shared.uFix,
        uBox: { value: this.box },
        uShare: { value: share },
      },
      vertexShader: MAP_VS,
      fragmentShader: MAP_FS,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    const mapMesh = new THREE.Mesh(mg, this.mapMat);
    mapMesh.frustumCulled = false;
    this.mapScene.add(mapMesh);

    // splash drawing: the jets' streak particles
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    const nS = this.samples * SPLASH_PER;
    const st = new Float32Array(nS * 2);
    for (let i = 0; i < nS; i++) {
      st[i * 2] = i % PW;
      st[i * 2 + 1] = Math.floor(i / PW);
    }
    g.setAttribute('aTexel', new THREE.InstancedBufferAttribute(st, 2));
    g.instanceCount = nS;
    const s = this.splashRT.textures;
    this.drawMat = new THREE.ShaderMaterial({
      uniforms: {
        uHead: { value: s[0] },
        uTail: { value: s[1] },
        uCol: { value: s[2] },
        uPx: { value: 1000 },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uTime: shared.uTime,
        uCloudy: { value: 1 },
        uSparkle: { value: 3 },
        uOcclude: { value: 0.35 },
      },
      vertexShader: PARTICLE_DRAW_VS,
      fragmentShader: STREAK_FS,
    });
    // splash and its mist only add light: white water in front of a column
    // glows; unlit churn stacked up must not cut dark holes in it
    this.drawMat.transparent = true;
    this.drawMat.depthWrite = false;
    this.drawMat.blending = THREE.AdditiveBlending;
    this.object = new THREE.Mesh(g, this.drawMat);
    this.object.frustumCulled = false;
    this.object.renderOrder = 2;
  }

  /** After the jets' own evaluation: find the landings, throw the splash, paint the map. */
  update(renderer: THREE.WebGLRenderer, pxPerMetre: number, viewport: THREE.Vector2) {
    this.drawMat.uniforms.uPx.value = pxPerMetre;
    this.drawMat.uniforms.uViewport.value.copy(viewport);
    const prev = renderer.getRenderTarget();
    const clear = renderer.getClearColor(new THREE.Color());
    const alpha = renderer.getClearAlpha();
    this.quad.material = this.evalMat;
    renderer.setRenderTarget(this.evalRT);
    renderer.render(this.scene, this.cam);
    this.quad.material = this.splashMat;
    renderer.setRenderTarget(this.splashRT);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(this.map);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.render(this.mapScene, this.cam);
    renderer.setClearColor(clear, alpha);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.map.dispose();
    this.evalRT.dispose();
    this.splashRT.dispose();
    this.evalMat.dispose();
    this.splashMat.dispose();
    this.mapMat.dispose();
    this.drawMat.dispose();
    (this.object.geometry as THREE.BufferGeometry).dispose();
  }
}
