import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

export const MAX_POOL_LIGHTS = 32;
/** Lights high above the water (fireworks): few, far, and wide. */
export const MAX_SKY_LIGHTS = 8;

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FS = /* glsl */ `
varying vec3 vDir;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float y = vDir.y;
  vec3 zenith = vec3(0.0015, 0.003, 0.008);
  vec3 horizon = vec3(0.012, 0.016, 0.03);
  vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.5, y));
  // warm light pollution low on the horizon (park lights)
  col += vec3(0.018, 0.012, 0.010) * exp(-abs(y) * 28.0);
  // sparse stars
  vec2 g = vec2(atan(vDir.z, vDir.x) * 180.0, y * 260.0);
  vec2 cell = floor(g);
  float s = h21(cell);
  vec2 f = fract(g) - 0.5;
  col += step(0.996, s) * smoothstep(0.12, 0.0, length(f)) * 0.05 * smoothstep(0.05, 0.3, y);
  gl_FragColor = vec4(col, 1.0);
}`;

const WATER_VS = /* glsl */ `
uniform mat4 textureMatrix;
varying vec4 vUv;
varying vec3 vWorld;
void main() {
  vUv = textureMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const WATER_FS = /* glsl */ `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform vec3 uPoolPos[${MAX_POOL_LIGHTS}];
uniform vec3 uPoolCol[${MAX_POOL_LIGHTS}];
uniform int uPoolCount;
#ifdef PYRO_SKY
uniform vec3 uSkyPos[${MAX_SKY_LIGHTS}];
uniform vec3 uSkyCol[${MAX_SKY_LIGHTS}];
uniform int uSkyCount;
#endif
uniform float uRipple;
uniform vec3 uSkyHorizon;
#ifdef IMPACT
// water hitting the water (techniques/impact.ts): foam light rgb, ripple height a
uniform sampler2D uImpact;
uniform vec4 uImpactBox;
uniform vec2 uImpactTexel;
float foamNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
#endif
varying vec4 vUv;
varying vec3 vWorld;

vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  // a few directional wave trains (gentle lagoon chop)
  const int N = 6;
  vec2 dirs[N] = vec2[N](vec2(1.0, 0.2), vec2(-0.4, 1.0), vec2(0.7, -0.7), vec2(-1.0, -0.3), vec2(0.2, 1.0), vec2(0.9, 0.5));
  float freq[N] = float[N](0.9, 1.4, 2.3, 3.1, 4.7, 6.2);
  for (int i = 0; i < N; i++) {
    vec2 d = normalize(dirs[i]);
    float f = freq[i];
    float a = 0.035 / f;
    float ph = dot(d, p) * f + t * sqrt(9.81 * f) * 0.6;
    g += d * a * f * cos(ph);
  }
  return g;
}

#ifdef SURFACE
// fine chop (stage 7 H3): short wave trains that break a reflection into
// glints, as wind and the falling water roughen the lagoon near the jets
vec2 fineGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  const int N = 5;
  vec2 dirs[N] = vec2[N](vec2(0.8, 0.6), vec2(-0.7, 0.7), vec2(0.1, -1.0), vec2(-0.95, -0.2), vec2(0.6, -0.8));
  float freq[N] = float[N](9.0, 13.0, 19.0, 27.0, 38.0);
  for (int i = 0; i < N; i++) {
    vec2 d = normalize(dirs[i]);
    float f = freq[i];
    float ph = dot(d, p) * f + t * sqrt(9.81 * f) * 0.6 + float(i) * 1.7;
    g += d * (0.05 / f) * f * cos(ph);
  }
  return g;
}
// Fresnel reflectance of water (n = 1.333), unpolarised
float fresnelWater(float c) {
  float n = 1.333;
  float s2 = 1.0 - c * c;
  float ct = sqrt(max(1.0 - s2 / (n * n), 0.0));
  float rs = (c - n * ct) / (c + n * ct);
  float rp = (n * c - ct) / (n * c + ct);
  return 0.5 * (rs * rs + rp * rp);
}
#endif

void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec2 g = waveGrad(vWorld.xz, uTime) * uRipple;
#ifdef SURFACE
  float dist0 = length(vWorld - cameraPosition);
  // a pixel that covers many short waves sees their average: fade them out
  float foot = length(fwidth(vWorld.xz));
  g += fineGrad(vWorld.xz, uTime) * (1.0 - smoothstep(0.04, 0.25, foot));
#endif
#ifdef IMPACT
  vec2 iuv = (vWorld.xz - uImpactBox.xy) / uImpactBox.zw;
  vec4 imp = vec4(0.0);
  if (all(greaterThan(iuv, vec2(0.0))) && all(lessThan(iuv, vec2(1.0)))) {
    imp = texture2D(uImpact, iuv);
    float hx = texture2D(uImpact, iuv + vec2(uImpactTexel.x, 0.0)).a - texture2D(uImpact, iuv - vec2(uImpactTexel.x, 0.0)).a;
    float hz = texture2D(uImpact, iuv + vec2(0.0, uImpactTexel.y)).a - texture2D(uImpact, iuv - vec2(0.0, uImpactTexel.y)).a;
    g += vec2(hx, hz) / (2.0 * uImpactTexel * uImpactBox.zw);
  }
#endif
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  float cosT = max(dot(n, V), 0.0);
#ifdef SURFACE
  float fres = fresnelWater(cosT);
#else
  float fres = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
#endif
  // reflection, distorted by the ripples and smeared vertically: on a calm
  // lagoon each jet reflects as a long, nearly straight vertical streak
  // (show footage, docs/video-review.md R4), so sideways wobble is small
  vec4 uv = vUv;
#ifdef SURFACE
  // near water is seen from above and wobbles more; far off, at a grazing
  // angle, the lagoon is a sharper mirror
  float nearK = 1.0 - smoothstep(15.0, 140.0, dist0);
  uv.xy += vec2(n.x * mix(0.3, 0.6, nearK), n.z * 1.2) * uv.w * 0.06;
  float smear = 0.011 * mix(0.45, 1.0, nearK);
#else
  uv.xy += vec2(n.x * 0.3, n.z * 1.2) * uv.w * 0.06;
  const float smear = 0.011;
#endif
  vec3 refl = vec3(0.0);
  float wsum = 0.0;
  for (int i = -3; i <= 3; i++) {
    float w = exp(-float(i * i) * 0.25);
    vec4 u2 = uv + vec4(0.0, float(i) * smear * uv.w, 0.0, 0.0);
    refl += texture2DProj(tDiffuse, u2).rgb * w;
    wsum += w;
  }
  refl /= wsum;
  vec3 col = color + refl * fres;
  // light pools: underwater lights glowing through the surface
  vec3 pool = vec3(0.0);
  for (int i = 0; i < ${MAX_POOL_LIGHTS}; i++) {
    if (i >= uPoolCount) break;
    vec2 d = vWorld.xz - uPoolPos[i].xz;
    float r2 = dot(d, d);
    pool += uPoolCol[i] * (exp(-r2 / 0.8) * 0.9 + exp(-r2 / 9.0) * 0.12);
  }
  col += pool * (1.0 - fres);
#ifdef IMPACT
  // foam: white water on the surface, bubbly, hiding the reflection under it
  float fl = dot(imp.rgb, vec3(0.2126, 0.7152, 0.0722));
  if (fl > 1e-5) {
    vec2 fp = vWorld.xz / max(uImpactBox.w * uImpactTexel.y * 6.0, 1e-3);
    float bub = foamNoise(fp * 3.0 + uTime * 0.15) * 0.6 + foamNoise(fp * 7.3 - uTime * 0.1) * 0.4;
    float cover = clamp(fl * 4.0, 0.0, 1.0) * smoothstep(0.15, 0.75, bub + 0.25 * clamp(fl, 0.0, 1.0));
    col = col * (1.0 - cover * 0.7) + imp.rgb * mix(0.35, 1.0, bub) * 0.9;
  }
#endif
#ifdef PYRO_SKY
  // fireworks overhead light the lagoon's surface (their reflection comes
  // with the mirror above); irradiance falls with the cube of the distance
  // for light from above: h / r^3
  vec3 sky = vec3(0.0);
  for (int i = 0; i < ${MAX_SKY_LIGHTS}; i++) {
    if (i >= uSkyCount) break;
    vec3 d = uSkyPos[i] - vWorld;
    float r = length(d);
    sky += uSkyCol[i] * max(d.y, 0.0) / (r * r * r);
  }
  col += sky * 900.0 * (1.0 - fres);
#endif
  // aerial perspective: far water melts into the horizon sky
  float dist = length(vWorld - cameraPosition);
  col = mix(col, uSkyHorizon, 1.0 - exp(-dist / 450.0));
  gl_FragColor = vec4(col, 1.0);
}`;

// A show camera's response to very bright coloured light: the brightest
// channel saturates and the others catch up, so LED cores read white with the
// colour left in the halo (World of Color footage, docs/video-review.md R3).
// Runs on linear HDR before tone mapping; dim light keeps its colour.
const HIGHLIGHT_FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uAmount;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float m = max(c.r, max(c.g, c.b));
  float w = uAmount * smoothstep(0.35, 3.0, m);
  gl_FragColor = vec4(mix(c.rgb, vec3(m) * 0.85, w), c.a);
}`;

// Film grain and slightly darker corners over the finished picture (graphics
// switch 'film', report idea 7, docs/reports/hanabi-reference.html): in
// display space after the output pass, as a camera's picture; the grain
// moves with the show's time, 30 times a second, so a frame is always the
// same picture (seek, export).
const FILM_FS = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uFrame;
uniform float uAspect;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  vec2 d = (vUv - vec2(0.5, 0.55)) * vec2(uAspect, 1.0);
  float v = 1.0 - 0.22 * smoothstep(0.35, 1.05, length(d));
  float g = h(floor(gl_FragCoord.xy) + vec2(mod(uFrame * 37.0, 512.0), mod(uFrame * 61.0, 512.0)));
  gl_FragColor = vec4(c.rgb * v + (g - 0.5) * 0.035 + 0.004, c.a);
}`;

export interface StageOptions {
  bloom?: { strength: number; radius: number; threshold: number };
  exposure?: number;
  pixelRatio?: number;
  reflectionScale?: number;
  /** 0..1, how far bright coloured light whitens (camera response). */
  highlightWhite?: number;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  /** Graphics switch 'film': off (skipped) unless setFilm(true). */
  film: ShaderPass;
  water: Reflector;
  private waterUniforms: Record<string, THREE.IUniform>;

  constructor(container: HTMLElement, opts: StageOptions = {}) {
    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    r.setPixelRatio(opts.pixelRatio ?? Math.min(window.devicePixelRatio, 2));
    r.setSize(window.innerWidth, window.innerHeight);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = opts.exposure ?? 1.0;
    container.appendChild(r.domElement);
    this.renderer = r;

    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 3000);

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(1500, 32, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false }),
    );
    sky.renderOrder = -10;
    this.scene.add(sky);

    const rs = opts.reflectionScale ?? 0.5;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.water = new Reflector(new THREE.PlaneGeometry(4000, 4000), {
      textureWidth: Math.round(size.x * rs),
      textureHeight: Math.round(size.y * rs),
      clipBias: 0.0,
      color: 0x000000,
      multisample: 0,
      shader: {
        name: 'LagoonShader',
        uniforms: {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          uTime: { value: 0 },
          uPoolPos: { value: Array.from({ length: MAX_POOL_LIGHTS }, () => new THREE.Vector3()) },
          uPoolCol: { value: Array.from({ length: MAX_POOL_LIGHTS }, () => new THREE.Vector3()) },
          uPoolCount: { value: 0 },
          uSkyPos: { value: Array.from({ length: MAX_SKY_LIGHTS }, () => new THREE.Vector3()) },
          uSkyCol: { value: Array.from({ length: MAX_SKY_LIGHTS }, () => new THREE.Vector3()) },
          uSkyCount: { value: 0 },
          uRipple: { value: 1.0 },
          uSkyHorizon: { value: new THREE.Color(0.012 + 0.018, 0.016 + 0.012, 0.03 + 0.01) },
          uImpact: { value: null },
          uImpactBox: { value: new THREE.Vector4(0, 0, 1, 1) },
          uImpactTexel: { value: new THREE.Vector2(1, 1) },
        },
        vertexShader: WATER_VS,
        fragmentShader: WATER_FS,
      },
    });
    this.water.rotation.x = -Math.PI / 2;
    this.scene.add(this.water);
    const mat = this.water.material as THREE.ShaderMaterial;
    mat.uniforms.color.value = new THREE.Color(0.0015, 0.0025, 0.005);
    this.waterUniforms = mat.uniforms;

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    const b = opts.bloom ?? { strength: 0.55, radius: 0.55, threshold: 0.75 };
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), b.strength, b.radius, b.threshold);
    if (opts.highlightWhite) {
      this.composer.addPass(
        new ShaderPass({
          uniforms: { tDiffuse: { value: null }, uAmount: { value: opts.highlightWhite } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: HIGHLIGHT_FS,
        }),
      );
    }
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.film = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uFrame: { value: 0 }, uAspect: { value: 16 / 9 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FILM_FS,
    });
    this.film.enabled = false;
    this.film.uniforms.uAspect.value = window.innerWidth / window.innerHeight;
    this.composer.addPass(this.film);

    window.addEventListener('resize', () => this.resize());
  }

  private reflectionScale = 0.5;
  private fixed: [number, number] | null = null;

  /**
   * Render at a fixed size in pixels (video export), or follow the window
   * again (null). The canvas keeps its on-screen size and letterboxes.
   */
  setFixedSize(size: [number, number] | null) {
    this.fixed = size;
    this.resize();
  }

  resize() {
    const [w, h] = this.fixed ?? [window.innerWidth, window.innerHeight];
    this.renderer.setSize(w, h, !this.fixed);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.film.uniforms.uAspect.value = w / h;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rs = this.reflectionScale;
    this.water.getRenderTarget().setSize(Math.round(size.x * rs), Math.round(size.y * rs));
  }

  /** Render resolution (device pixels per CSS pixel) and reflection resolution. */
  setResolution(pixelRatio: number, reflectionScale: number) {
    this.reflectionScale = reflectionScale;
    this.renderer.setPixelRatio(pixelRatio);
    this.composer.setPixelRatio(pixelRatio);
    this.resize();
  }

  /** Pixels per metre at 1 m depth, for world-sized sprites. */
  pxPerMetre(): number {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    return size.y / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
  }

  viewport(): THREE.Vector2 {
    return this.renderer.getDrawingBufferSize(new THREE.Vector2());
  }

  /** Underwater glow pools; 'weights' scales each light (default 1). */
  setPools(pos: THREE.Vector3[], color: THREE.Color, intensity: number, weights?: number[]) {
    const n = Math.min(pos.length, MAX_POOL_LIGHTS);
    const scale = intensity * Math.min(1, 6 / Math.max(pos.length, 1)) * 0.6;
    for (let i = 0; i < n; i++) {
      const w = scale * (weights?.[i] ?? 1);
      (this.waterUniforms.uPoolPos.value as THREE.Vector3[])[i].copy(pos[i]);
      (this.waterUniforms.uPoolCol.value as THREE.Vector3[])[i].set(color.r * w, color.g * w, color.b * w);
    }
    this.waterUniforms.uPoolCount.value = n;
  }

  /** Fireworks' light on the water: positions and linear colour x strength. */
  setSkyLights(lights: { pos: THREE.Vector3; col: THREE.Vector3 }[], on = lights.length > 0) {
    // the term is compiled in only for shows with fireworks, so a show
    // without them draws with exactly the shader it always had
    const mat = this.water.material as THREE.ShaderMaterial;
    if (on !== 'PYRO_SKY' in (mat.defines ?? {})) {
      mat.defines = { ...(mat.defines ?? {}) };
      if (on) mat.defines.PYRO_SKY = '';
      else delete mat.defines.PYRO_SKY;
      mat.needsUpdate = true;
    }
    const n = Math.min(lights.length, MAX_SKY_LIGHTS);
    for (let i = 0; i < n; i++) {
      (this.waterUniforms.uSkyPos.value as THREE.Vector3[])[i].copy(lights[i].pos);
      (this.waterUniforms.uSkyCol.value as THREE.Vector3[])[i].copy(lights[i].col);
    }
    this.waterUniforms.uSkyCount.value = n;
  }

  /**
   * Water hitting the water (techniques/impact.ts): the ripple and foam map
   * and the area it covers, or null. Compiled into the water shader only
   * while there is one, so the water of the plain setting is unchanged.
   */
  setImpact(map: THREE.WebGLRenderTarget | null, box?: THREE.Vector4) {
    const mat = this.water.material as THREE.ShaderMaterial;
    const on = !!map;
    if (on !== 'IMPACT' in (mat.defines ?? {})) {
      mat.defines = { ...(mat.defines ?? {}) };
      if (on) mat.defines.IMPACT = '';
      else delete mat.defines.IMPACT;
      mat.needsUpdate = true;
    }
    if (map && box) {
      this.waterUniforms.uImpact.value = map.texture;
      (this.waterUniforms.uImpactBox.value as THREE.Vector4).copy(box);
      (this.waterUniforms.uImpactTexel.value as THREE.Vector2).set(1 / map.width, 1 / map.height);
    }
  }

  /** Stage 7 H3: fine chop, water's own Fresnel, a sharper far mirror. Off keeps the water as it was. */
  setSurface(on: boolean) {
    const mat = this.water.material as THREE.ShaderMaterial;
    if (on !== 'SURFACE' in (mat.defines ?? {})) {
      mat.defines = { ...(mat.defines ?? {}) };
      if (on) mat.defines.SURFACE = '';
      else delete mat.defines.SURFACE;
      mat.needsUpdate = true;
    }
  }

  /** Show time for the lagoon ripples. */
  /** Film grain and darker corners (graphics switch 'film'). */
  setFilm(on: boolean) {
    this.film.enabled = on;
  }

  setTime(t: number) {
    this.film.uniforms.uFrame.value = Math.floor(t * 30);
    this.waterUniforms.uTime.value = t;
  }

  render(t: number) {
    this.setTime(t);
    this.composer.render();
  }
}
