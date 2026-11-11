import * as THREE from 'three';
import { BILLBOARD_GLSL, uFaceCamera } from '../core/billboard';
import { HASH, NOZZLE_UNIFORMS } from '../core/glsl';
import type { NozzleSpec, NozzleUniforms } from '../core/nozzles';
import { coverageBlend } from './particles';
import type { FrameInfo, Technique } from './types';

/** Original abstract test image for the water screen (no third-party imagery). */
export function makeProjectionTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#1a0b5c');
  bg.addColorStop(0.55, '#3a1fb0');
  bg.addColorStop(1, '#ff3d8b');
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 512);
  const moon = g.createRadialGradient(640, 190, 10, 640, 190, 150);
  moon.addColorStop(0, 'rgba(255,240,200,1)');
  moon.addColorStop(0.45, 'rgba(255,200,120,0.9)');
  moon.addColorStop(1, 'rgba(255,120,80,0)');
  g.fillStyle = moon;
  g.fillRect(0, 0, 1024, 512);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(200,240,255,${0.3 + rand() * 0.7})`;
    g.beginPath();
    g.arc(rand() * 1024, rand() * 300, 1 + rand() * 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#05020f';
  g.beginPath();
  g.moveTo(0, 512);
  for (let x = 0; x <= 1024; x += 16) g.lineTo(x, 430 - Math.sin(x * 0.012) * 40 - Math.sin(x * 0.041) * 18);
  g.lineTo(1024, 512);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// hashing, PI and the fixture uniforms the mist shaders read
const MIST_HEAD = HASH + NOZZLE_UNIFORMS + 'uniform vec3 uWind;\n';

const MIST_COMMON = /* glsl */ `
uniform sampler2D uImage;
uniform vec3  uProjPos;
uniform float uProjI;
uniform float uWidthM;
uniform float uDepthM;
// the projected frame on the screen plane: centre x, width, height (height
// <= 0: the frame follows the mist as it rises). A mound of the three-mound
// screen shares the wide screen's frame, so it shows its own part of one
// panorama, as from fixed projectors
uniform float uImgX;
uniform float uImgW;
uniform float uImgH;
// 1: the top falls away toward the sides, a mound instead of a wall
uniform float uDome;
// how much mist there is (0..1): the curtain thins and sinks when the
// water whips stop, it does not shrink like a blind
uniform float uDens;
// projector behind the screen (rear projection): light passes through the
// mist toward the audience
uniform float uRear;
float moundTop(float x) {
  float u = (x - uOrigin.x) / (uWidthM * 0.5);
  return mix(1.0, 0.25 + 0.75 * sqrt(max(1.0 - u * u, 0.0)), uDome);
}
float hgM(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
// Light scattered toward the camera at p: projected image + underwater lights.
// lod blurs the image: thin, wispy mist cannot hold a sharp picture, only
// the dense core of the curtain can.
vec3 mistLight(vec3 p, vec3 camPos, float lod) {
  // perspective projection from the projector onto the screen plane, so
  // mist off the plane catches the image along the projector's rays
  vec3 rel = p - uProjPos;
  vec3 hit = uProjPos + rel * (uOrigin.z - uProjPos.z) / (rel.z - 1e-4 * sign(rel.z));
  float imgH = uImgH > 0.0 ? uImgH : uHeight;
  vec2 uv = vec2((hit.x - uImgX) / uImgW + 0.5, (hit.y - uOrigin.y) / (imgH * 0.95));
  vec3 img = textureLod(uImage, clamp(uv, 0.0, 1.0), lod).rgb;
  float inside = smoothstep(0.0, 0.04, uv.x) * smoothstep(1.0, 0.96, uv.x) * smoothstep(1.02, 0.9, uv.y);
  vec3 toP = normalize(p - uProjPos);
  vec3 toC = normalize(camPos - p);
  float c = dot(toP, toC);
  // front projection: back-scatter; rear projection: forward scatter, with
  // a soft hot spot where the projector shines straight at the viewer
  float phase = uRear > 0.5 ? mix(hgM(c, 0.35) * 4.0 * PI, 1.0, 0.6) : mix(hgM(c, 0.7), hgM(c, -0.35), 0.4) * 4.0 * PI;
  vec3 col = img * inside * uProjI * phase;
  col += uLightColor * uLightI * exp(-max(p.y - uOrigin.y, 0.0) / 2.5) * 0.6;
  // projector spill: light scattered through the mist from the rest of the
  // image, so the cloud keeps its shape where the picture is dark (in the
  // footage a lit mound reads as a whole glowing hill)
  col += uLightColor * uProjI * mix(0.18, 0.35, uDome) * inside;
  return col;
}
`;

// ---------------------------------------------------------- mist particles
const MIST_PARTICLE_VS = /* glsl */ `
${MIST_HEAD}
${MIST_COMMON}
${BILLBOARD_GLSL}
attribute vec2 corner;
attribute float aId;
uniform float uN;
uniform float uLife;
uniform float uSize;
uniform float uCover;
uniform float uEdgeOnly;
varying vec3 vCol;
varying float vA;
varying vec2 vUv;
varying float vSeed;
varying vec3 vWorld;
float gauss(float a, float b) { return sqrt(-2.0 * log(max(a, 1e-4))) * cos(6.2831853 * b); }
void main() {
  float x0 = uTime + aId / uN * uLife;
  float cyc = floor(x0 / uLife);
  float age = x0 - cyc * uLife;
  uint seed = uint(aId) * 9781u + uint(int(cyc) + 1000) * 6271u;
  vec4 r = rnd4(seed);
  vec4 r2 = rnd4(seed + 77u);
  float x = (r.x - 0.5) * uWidthM;
  // ragged top: the plume height wanders along the screen and in time
  float top = uHeight * (0.86 + 0.08 * sin(x * 0.21 + uTime * 0.35) + 0.06 * sin(x * 0.57 - uTime * 0.6)) * moundTop(uOrigin.x + x);
  float y = top * (1.0 - exp(-age / 1.0)) + r2.z * 0.6;
  float sig = 0.2 + 0.3 * age;
  vec3 p = uOrigin + vec3(x + gauss(r.y, r.w) * sig * 0.6 + uWind.x * age * 0.25,
                          y,
                          gauss(r2.x, r2.y) * (uDepthM * 0.25 + sig * 0.5));
  float size = uSize * (0.6 + age * 0.35);
  float fade = smoothstep(0.0, 0.6, age) * (1.0 - smoothstep(uLife * 0.6, uLife, age));
  // edge mode: only the ragged top and the foot of the screen, to break the
  // straight outline of a sheet
  if (uEdgeOnly > 0.5) fade *= max(1.0 - smoothstep(0.5, 3.0, y), smoothstep(top - 4.0, top - 0.5, y));
  vec3 sr, su;
  spriteAxes(p, sr, su);
  vWorld = p + (sr * corner.x + su * corner.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
  vCol = mistLight(p, cameraPosition, 4.5);
  vA = uCover * fade * uDens;
  vUv = corner;
  vSeed = float(seed % 997u);
}`;

const MIST_PARTICLE_FS = /* glsl */ `
${MIST_HEAD}
${MIST_COMMON}
uniform float uCloudy;
uniform float uAdditive;
uniform float uVertexLit;
varying vec3 vWorld;
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
  if (r2 > 1.0) discard;
  float a = exp(-r2 * 3.5);
  if (uCloudy > 0.5) {
    vec2 p = vUv * 1.7 + vSeed * 1.31;
    float n = vnoise(p * 1.6) * 0.55 + vnoise(p * 3.7) * 0.3 + vnoise(p * 8.3) * 0.15;
    a *= smoothstep(0.2, 0.8, n) * 1.7;
  }
  a *= vA;
  // the design-doc variant lights each sprite once at its centre; the
  // coverage variant samples the projection per pixel so the image stays sharp
  if (uAdditive > 0.5) gl_FragColor = vec4(vCol * a, 1.0);
  else {
    // unlit mist is thin and mostly transparent: let it hide the sky only
    // where it is actually lit
    vec3 c = uVertexLit > 0.5 ? vCol : mistLight(vWorld, cameraPosition, 2.0);
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    gl_FragColor = vec4(c * a, a * mix(0.15, 1.0, smoothstep(0.0, 0.25, lum)));
  }
}`;

// --------------------------------------------------------- noise sheet
const SHEET_VS = /* glsl */ `
varying vec3 vWorld;
varying vec2 vUv;
uniform float uBend;
void main() {
  vec3 p = position;
  p.z += uBend * (1.0 - pow(p.x / 15.0, 2.0)); // bowed toward the audience
  vec4 w = modelMatrix * vec4(p, 1.0);
  vWorld = w.xyz;
  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const SHEET_FS = /* glsl */ `
${MIST_HEAD}
${MIST_COMMON}
varying vec3 vWorld;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec2 q = vec2(vWorld.x, vWorld.y);
  float n1 = fbm(q * vec2(0.18, 0.12) + vec2(0.0, -uTime * 0.35));
  float n2 = fbm(q * vec2(0.35, 0.22) + vec2(uTime * 0.05, -uTime * 0.6) + 7.3);
  float dens = smoothstep(0.25, 0.8, n1 * 0.6 + n2 * 0.5);
  float top = uHeight * (0.86 + 0.08 * sin(q.x * 0.21 + uTime * 0.35)) * moundTop(q.x);
  float edge = smoothstep(top, top - 3.5, q.y) * smoothstep(uWidthM * 0.5, uWidthM * 0.5 - 3.0, abs(q.x - uOrigin.x));
  float a = clamp(dens * edge * 0.9 * uDens, 0.0, 1.0);
#ifdef FINE
  // the curtain is droplets: falling streaks of denser and thinner mist a
  // few centimetres to decimetres across, so the picture sits on grain
  // instead of a smooth plane, sharpest where the droplets are thickest
  // (stage 7 H4)
  float g1 = vnoise(q * vec2(6.0, 2.2) + vec2(0.0, uTime * 1.8));
  float g2 = vnoise(q * vec2(17.0, 7.0) + vec2(3.1, uTime * 3.2));
  float grain = g1 * 0.6 + g2 * 0.4;
  a = clamp(a * mix(0.5, 1.45, grain), 0.0, 1.0);
  vec3 col = mistLight(vWorld, cameraPosition, mix(3.0, 0.0, smoothstep(0.25, 0.7, a)));
  col *= mix(0.75, 1.25, g2);
#else
  vec3 col = mistLight(vWorld, cameraPosition, mix(4.0, 0.0, smoothstep(0.3, 0.85, a)));
#endif
  // fine droplets pass most light: unlit mist barely hides what is behind it
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(col * a, a * mix(0.2, 1.0, smoothstep(0.0, 0.3, lum)));
}`;

// --------------------------------------------------------- volume raymarch
const VOLUME_VS = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const VOLUME_FS = /* glsl */ `
${MIST_HEAD}
${MIST_COMMON}
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uSigma;
varying vec3 vWorld;
float h3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y);
  float b = mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p *= 2.02; a *= 0.5; } return s; }
float density(vec3 p) {
  vec3 l = p - uOrigin;
  float top = uHeight * (0.86 + 0.08 * sin(l.x * 0.21 + uTime * 0.35) + 0.06 * sin(l.x * 0.57 - uTime * 0.6));
  float sig = uDepthM * 0.25 + max(l.y, 0.0) * 0.03;
  float prof = exp(-l.z * l.z / (2.0 * sig * sig)) * uDepthM * 0.25 / sig;
  float vert = smoothstep(top + 1.0, top - 3.0, l.y) * smoothstep(-0.2, 0.6, l.y);
  float side = smoothstep(uWidthM * 0.5 + 1.0, uWidthM * 0.5 - 2.5, abs(l.x));
  float n = fbm3(l * vec3(0.22, 0.3, 0.5) + vec3(0.0, -uTime * 0.55, uTime * 0.1));
  return prof * vert * side * smoothstep(0.3, 0.75, n) * 1.6;
}
void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (uBoxMin - ro) * inv, t1 = (uBoxMax - ro) * inv;
  vec3 tmin = min(t0, t1), tmax = max(t0, t1);
  float tn = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float tf = min(min(tmax.x, tmax.y), tmax.z);
  const int STEPS = 72;
  float dt = (tf - tn) / float(STEPS);
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  float T = 1.0;
  vec3 L = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (tn + (float(i) + jitter) * dt);
    float d = density(p);
    if (d > 0.001) {
      float ext = d * uSigma;
      float a = 1.0 - exp(-ext * dt);
      L += T * a * mistLight(p, ro, 0.0);
      T *= 1.0 - a;
      if (T < 0.01) break;
    }
  }
  gl_FragColor = vec4(L, 1.0 - T);
}`;

export type MistMode = 'points-additive' | 'sheet' | 'cloud-sprites' | 'volume';

export class MistTechnique implements Technique {
  object: THREE.Mesh;
  private mat: THREE.ShaderMaterial;

  constructor(
    nozzle: NozzleUniforms,
    spec: NozzleSpec,
    mode: MistMode,
    image: THREE.Texture,
    opts: {
      count?: number;
      cover?: number;
      edgeOnly?: boolean;
      vertexLit?: boolean;
      /** Projected frame and projector, when they belong to a larger screen. */
      frame?: { centerX: number; width: number; height: number; projector: THREE.Vector3 };
      dome?: boolean;
      /** Projector behind the screen (the projector position must be behind too). */
      rear?: boolean;
      /** Stage 7 H4: fine droplets the picture sits on (sheet only); sprite size factor. */
      fine?: boolean;
      size?: number;
    } = {},
  ) {
    const W = spec.mist?.width ?? 30;
    const D = spec.mist?.depth ?? 2.5;
    const o = new THREE.Vector3(...spec.origin);
    const common = {
      ...nozzle,
      uImage: { value: image },
      uProjPos: { value: opts.frame?.projector.clone() ?? new THREE.Vector3(o.x, 3.0, o.z + 45) },
      uProjI: { value: 1.0 },
      uWidthM: { value: W },
      uDepthM: { value: D },
      uImgX: { value: opts.frame?.centerX ?? o.x },
      uImgW: { value: opts.frame?.width ?? W },
      uImgH: { value: opts.frame?.height ?? 0 },
      uDome: { value: opts.dome ? 1 : 0 },
      uDens: { value: 1 },
      uRear: { value: opts.rear ? 1 : 0 },
    };
    if (mode === 'sheet') {
      const g = new THREE.PlaneGeometry(W, spec.height * 1.15, 48, 24);
      g.translate(o.x, o.y + spec.height * 0.575, o.z);
      this.mat = new THREE.ShaderMaterial({
        uniforms: { ...common, uBend: { value: 1.5 } },
        defines: opts.fine ? { FINE: '' } : {},
        vertexShader: SHEET_VS,
        fragmentShader: SHEET_FS,
        side: THREE.DoubleSide,
      });
      coverageBlend(this.mat);
      this.object = new THREE.Mesh(g, this.mat);
    } else if (mode === 'volume') {
      const min = new THREE.Vector3(o.x - W / 2 - 1.5, o.y, o.z - D * 2 - 3);
      const max = new THREE.Vector3(o.x + W / 2 + 1.5, o.y + spec.height * 1.25, o.z + D * 2 + 3);
      const size = max.clone().sub(min);
      const g = new THREE.BoxGeometry(size.x, size.y, size.z);
      g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
      this.mat = new THREE.ShaderMaterial({
        uniforms: { ...common, uBoxMin: { value: min }, uBoxMax: { value: max }, uSigma: { value: 0.45 } },
        vertexShader: VOLUME_VS,
        fragmentShader: VOLUME_FS,
        side: THREE.BackSide,
      });
      coverageBlend(this.mat);
      this.object = new THREE.Mesh(g, this.mat);
    } else {
      const n = opts.count ?? (mode === 'cloud-sprites' ? 9000 : 16000);
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), 2));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      g.setAttribute('aId', new THREE.InstancedBufferAttribute(new Float32Array(n).map((_, i) => i), 1));
      g.instanceCount = n;
      const additive = mode === 'points-additive';
      this.mat = new THREE.ShaderMaterial({
        uniforms: {
          ...common,
          uN: { value: n },
          uLife: { value: 6.0 },
          uSize: { value: (additive ? 0.9 : 1.4) * (opts.size ?? 1) },
          uCover: { value: opts.cover ?? (additive ? 0.025 : 0.08) },
          uEdgeOnly: { value: opts.edgeOnly ? 1 : 0 },
          // edge sprites carry no image detail, so light them once per sprite
          uVertexLit: { value: opts.vertexLit ? 1 : 0 },
          uCloudy: { value: additive ? 0 : 1 },
          uAdditive: { value: additive ? 1 : 0 },
          uFaceCamera,
        },
        vertexShader: MIST_PARTICLE_VS,
        fragmentShader: MIST_PARTICLE_FS,
      });
      if (additive) {
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
    this.mat.uniforms.uTime.value = f.time;
  }

  /** Projector brightness (0 = off). */
  setProjection(level: number) {
    this.mat.uniforms.uProjI.value = level;
  }

  /** Amount of mist in the curtain (0..1). */
  setDensity(d: number) {
    this.mat.uniforms.uDens.value = d;
  }

  dispose() {
    this.object.geometry.dispose();
    this.mat.dispose();
  }
}
