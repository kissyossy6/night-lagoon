import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { uFaceCamera } from '../core/billboard';
import type { ShowRuntime } from '../show/runtime';

/**
 * Stereo 180° frames for Apple Vision Pro: one half-equirectangular image
 * per eye (Apple Projected Media Profile, HalfEquirectangular), like a VR180
 * camera with two fixed lenses at the seat.
 *
 * Each eye is drawn as five cube faces from the eye position (front, left,
 * right, up, down; the back is never seen), and the faces are resampled into
 * the eye's equirectangular image. Bloom and tone mapping run after that, on
 * the whole eye, so they have no face seams.
 *
 * Image u runs from 90° left to 90° right, v from straight up to straight
 * down; the centre looks level toward the stage.
 */

export interface Vr180Options {
  /** Pixels per eye, square (180° × 180°). */
  eye: number;
  /** Eye distance (m). */
  ipd?: number;
  /** Face size relative to the eye size that samples the centre 1:1. */
  supersample?: number;
  /**
   * Bloom works on a fixed angular scale: its image is this many pixels
   * across 180°, whatever the eye size, so a halo covers the same angle at
   * every export resolution. 4800 matches the player (about 50° on ~1350 px).
   */
  bloomPixels?: number;
}

export type Eye = 'left' | 'right';

const ASSEMBLE_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ASSEMBLE_FS = /* glsl */ `
precision highp float;
uniform sampler2D tFace;
uniform mat4 uFaceViewProj;
uniform vec3 uFaceDir;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
varying vec2 vUv;
void main() {
  float lon = (vUv.x - 0.5) * 3.14159265;
  float lat = (vUv.y - 0.5) * 3.14159265;
  vec3 d = cos(lat) * sin(lon) * uRight + sin(lat) * uUp + cos(lat) * cos(lon) * uFwd;
  // the face whose axis is closest owns the pixel
  float own = dot(d, uFaceDir);
  float best = max(max(dot(d, uFwd), abs(dot(d, uRight))), abs(dot(d, uUp)));
  if (own < best - 1e-6) discard;
  vec4 c = uFaceViewProj * vec4(d, 0.0);
  if (c.w <= 0.0) discard;
  vec2 uv = c.xy / c.w * 0.5 + 0.5;
  gl_FragColor = texture2D(tFace, uv);
}`;

// as in stage.ts (HIGHLIGHT_FS): bright coloured light whitens before tone mapping
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

/** Bloom that ignores the composer's size and keeps its own. */
class FixedBloomPass extends UnrealBloomPass {
  constructor(
    private px: number,
    strength: number,
    radius: number,
    threshold: number,
  ) {
    super(new THREE.Vector2(px, px), strength, radius, threshold);
  }
  setSize() {
    super.setSize(this.px, this.px);
  }
}

export class Vr180 {
  readonly eyeSize: number;
  readonly faceSize: number;
  private ipd: number;
  private faceRT: THREE.WebGLRenderTarget;
  private composer: EffectComposer;
  private assemble: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private cam = new THREE.PerspectiveCamera(90, 1, 0.1, 3000);
  private outRT: THREE.WebGLRenderTarget;
  private flip: THREE.ShaderMaterial;
  /**
   * The last eye drawn: RGBA, 8 bit, sRGB, top row first. Read back from a
   * render target, not the canvas: a canvas this large can silently get a
   * smaller drawing buffer when GPU memory runs short.
   */
  readonly pixels: Uint8Array<ArrayBuffer>;
  /** Milliseconds of the last renderEye, split by stage. */
  timing = { faces: 0, post: 0 };

  constructor(
    private rt: ShowRuntime,
    opts: Vr180Options,
  ) {
    const W = opts.eye;
    this.eyeSize = W;
    this.ipd = opts.ipd ?? 0.064;
    // at the face centre a pixel spans 2/N rad; the eye image spans pi/W
    this.faceSize = Math.ceil(((W * 2) / Math.PI) * (opts.supersample ?? 1.15));
    const N = this.faceSize;
    // a face a few pixels wider than 90°, so bilinear taps at the seams stay inside it
    this.cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(1 + 4 / N));
    this.cam.updateProjectionMatrix();
    this.faceRT = new THREE.WebGLRenderTarget(N, N, { type: THREE.HalfFloatType, depthBuffer: true });

    const r = rt.stage.renderer;
    const eyeRT = new THREE.WebGLRenderTarget(W, W, { type: THREE.HalfFloatType, depthBuffer: false });
    this.composer = new EffectComposer(r, eyeRT);
    this.composer.setPixelRatio(1);
    this.composer.setSize(W, W);
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.6 } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: HIGHLIGHT_FS,
      }),
    );
    const b = rt.stage.bloom;
    this.composer.addPass(new FixedBloomPass(opts.bloomPixels ?? 4800, b.strength, b.radius, b.threshold));
    this.composer.addPass(new OutputPass());

    this.assemble = new THREE.ShaderMaterial({
      uniforms: {
        tFace: { value: this.faceRT.texture },
        uFaceViewProj: { value: new THREE.Matrix4() },
        uFaceDir: { value: new THREE.Vector3() },
        uRight: { value: new THREE.Vector3() },
        uUp: { value: new THREE.Vector3() },
        uFwd: { value: new THREE.Vector3() },
      },
      vertexShader: ASSEMBLE_VS,
      fragmentShader: ASSEMBLE_FS,
      depthTest: false,
      depthWrite: false,
    });
    this.outRT = new THREE.WebGLRenderTarget(W, W, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.pixels = new Uint8Array(W * W * 4);
    // GL rows run bottom up; flipped here, the read-back is top row first
    this.flip = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: ASSEMBLE_VS,
      fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vec2(vUv.x, 1.0 - vUv.y)); }',
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.assemble);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * Draw one eye at show time t (after rt.advance(t)) into 'pixels'. 'yaw' turns the view centre
   * (radians, 0 = toward -z, the stage, from the seat).
   */
  renderEye(t: number, eye: Eye, seat: THREE.Vector3, yaw = 0) {
    const r = this.rt.stage.renderer;
    const scene = this.rt.stage.scene;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
    const pos = seat.clone().addScaledVector(right, (eye === 'left' ? -0.5 : 0.5) * this.ipd);
    const N = this.faceSize;
    const u = this.assemble.uniforms;
    u.uRight.value.copy(right);
    u.uUp.value.copy(up);
    u.uFwd.value.copy(fwd);

    const t0 = performance.now();
    uFaceCamera.value = 1;
    const cam = this.cam;
    cam.position.copy(pos);
    this.rt.aim(t, cam, N / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2), new THREE.Vector2(N, N));
    const reflection = this.rt.stage.water.getRenderTarget();
    const reflectionSize = [reflection.width, reflection.height];
    reflection.setSize(Math.round(N / 2), Math.round(N / 2));

    const eyeRT = this.composer.readBuffer;
    r.setRenderTarget(eyeRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    const faces: [THREE.Vector3, THREE.Vector3][] = [
      [fwd, up],
      [right, up],
      [right.clone().negate(), up],
      [up, fwd.clone().negate()],
      [up.clone().negate(), fwd],
    ];
    const toneMapping = r.toneMapping;
    r.toneMapping = THREE.NoToneMapping;
    for (const [dir, faceUp] of faces) {
      cam.up.copy(faceUp);
      cam.lookAt(pos.clone().add(dir));
      cam.updateMatrixWorld();
      r.setRenderTarget(this.faceRT);
      r.clear();
      r.render(scene, cam);
      u.uFaceViewProj.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      u.uFaceDir.value.copy(dir);
      r.setRenderTarget(eyeRT);
      // each face adds its part of the eye image
      r.autoClear = false;
      r.render(this.quadScene, this.quadCam);
      r.autoClear = true;
    }
    r.toneMapping = toneMapping;
    uFaceCamera.value = 0;
    reflection.setSize(reflectionSize[0], reflectionSize[1]);
    // a one-pixel readback waits for the GPU (gl.finish does not, under ANGLE)
    const px = new Uint16Array(4);
    r.readRenderTargetPixels(eyeRT, 0, 0, 1, 1, px);
    const t1 = performance.now();

    this.composer.renderToScreen = false;
    this.composer.render();
    this.flip.uniforms.tSrc.value = this.composer.readBuffer.texture;
    this.quad.material = this.flip;
    r.setRenderTarget(this.outRT);
    r.render(this.quadScene, this.quadCam);
    this.quad.material = this.assemble;
    r.readRenderTargetPixels(this.outRT, 0, 0, this.eyeSize, this.eyeSize, this.pixels);
    r.setRenderTarget(null);
    this.timing = { faces: t1 - t0, post: performance.now() - t1 };
  }

  dispose() {
    this.faceRT.dispose();
    this.outRT.dispose();
    this.flip.dispose();
    this.composer.dispose();
    this.assemble.dispose();
  }
}
