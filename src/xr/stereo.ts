import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { uFaceCamera } from '../core/billboard';
import type { ShowRuntime } from '../show/runtime';

/**
 * 46d（docs/walkaround-plan.md）：Vision Pro で歩き回るための、両目をその場で描く描き方。
 *
 * 本番画面・エディタ・動画・180° の書き出しは使わない（それぞれ今までどおり Stage の
 * composer で描く）。ここは画質 'vr' の ShowRuntime を受け取り、毎コマ advance(t) を1回、
 * 目ごとに aim → シーン → 後処理（白飛び・ブルーム・トーンマップ）を描く。水・色・振付・
 * 水幕・花火の描き方は ShowRuntime のものをそのまま使い、変えるのは量だけ：
 *
 *   reflection  水面の映り込み。'off' は鏡像を描かない（水面は光だまりと空の色だけ）。
 *               数字なら目の大きさに対する鏡像の解像度（目ごとにシーンをもう一度描く）
 *   bloom       ブルームの描画先の一辺（px、目の大きさによらず固定）。0 でブルームなし
 *   highlight   明るい色が白むカメラの反応（stage.ts の HIGHLIGHT_FS と同じ）。false で省く
 *
 * 目のカメラは呼ぶ側が置く（Mac の試しは席から左右に 32 mm、WebXR は XRView の行列）。
 */

export interface VrLook {
  reflection: 'off' | number;
  bloom: number;
  highlight: boolean;
  /**
   * true: the water is set up once for both eyes, from the point between them (64 mm apart, the
   * difference is near drops facing a hair differently), both eyes drawn side by side into one
   * picture and finished in one go. The GPU then keeps drawing instead of switching targets
   * between the eyes. Needs the eyes side by side in the target (as a headset's stereo layer).
   * false: each eye on its own (set up, drawn and finished separately).
   */
  shared: boolean;
}

/**
 * The VR look (docs/walkaround-plan.md「段階 1a の結果」). The water's mirror image at a quarter
 * of the eye's size: the owner asked for it (2026-11-13), about +1.2 ms for both eyes on this Mac.
 */
export const VR_LOOK: VrLook = { reflection: 0.25, bloom: 384, highlight: true, shared: true };

export interface Eye {
  camera: THREE.PerspectiveCamera;
  /** 書き出す先の中での位置（px）。null の target なら画面（canvas）の中。 */
  viewport: THREE.Vector4;
}

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

/** Bloom that keeps its own size whatever the picture's. */
class FixedBloomPass extends UnrealBloomPass {
  constructor(
    private px: number,
    private py: number,
    strength: number,
    radius: number,
    threshold: number,
  ) {
    super(new THREE.Vector2(px, py), strength, radius, threshold);
  }
  setSize() {
    super.setSize(this.px, this.py);
  }
}

/** Render targets for one drawing size: the scene's picture (with depth) and two to finish it in. */
interface Buffers {
  w: number;
  h: number;
  scene: THREE.WebGLRenderTarget;
  a: THREE.WebGLRenderTarget;
  b: THREE.WebGLRenderTarget;
}

export class StereoView {
  /** Only for timing which step costs what (tools/vr-look.html ?skip=post,clear,scene). */
  static skip = new Set<string>();
  /** The eye's full size in the target (px). */
  readonly width: number;
  readonly height: number;
  private passes: (ShaderPass | UnrealBloomPass | OutputPass)[] = [];
  private look: VrLook;
  /**
   * How much of the eye's size the scene is drawn at (1 = full). The finish stretches it to the
   * full eye, so a lower scale is a softer picture, not a smaller one. Set it every frame from
   * ResolutionGovernor (resolution.ts); each scale keeps its own targets, so changing back and
   * forth costs nothing after the first time.
   */
  scale = 1;
  /**
   * false: no water's mirror image even if the look has one (ResolutionGovernor's last step).
   * The mirror does not vanish or appear in one frame: it fades over FADE_FRAMES (the owner,
   * 2026-11-13; a whole water surface changing at once reads as a flicker in a headset).
   */
  mirror = true;
  /** How much of the mirror image is shown now, 0..1, easing toward 'mirror'. */
  mirrorAmount = 1;
  static readonly FADE_FRAMES = 27;
  private dimScene = new THREE.Scene();
  private dimCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private dimMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  private buffers = new Map<number, Buffers>();
  /** Milliseconds of the last render, for the page's timing. */
  timing = { eyes: 0 };

  constructor(
    private rt: ShowRuntime,
    opts: { width: number; height: number; look?: Partial<VrLook> },
  ) {
    this.width = opts.width;
    this.height = opts.height;
    this.look = { ...VR_LOOK, ...opts.look };
    if (this.look.highlight) {
      this.passes.push(
        new ShaderPass({
          uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.6 } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
          fragmentShader: HIGHLIGHT_FS,
        }),
      );
    }
    const b = rt.stage.bloom;
    const eyes = this.look.shared ? 2 : 1;
    if (this.look.bloom > 0) this.passes.push(new FixedBloomPass(eyes * this.look.bloom, this.look.bloom, b.strength, b.radius, b.threshold));
    this.passes.push(new OutputPass());
  }

  /** The targets for the current scale (made the first time it is used). */
  private targets(): Buffers {
    const s = Math.round(this.scale * 100) / 100;
    let t = this.buffers.get(s);
    if (!t) {
      const w = Math.round(this.width * s);
      const h = Math.round(this.height * s);
      // shared: one picture two eyes wide
      const pw = this.look.shared ? 2 * w : w;
      const half = { type: THREE.HalfFloatType, depthBuffer: false } as const;
      t = {
        w,
        h,
        scene: new THREE.WebGLRenderTarget(pw, h, { type: THREE.HalfFloatType, depthBuffer: true }),
        a: new THREE.WebGLRenderTarget(pw, h, half),
        b: new THREE.WebGLRenderTarget(pw, h, half),
      };
      this.buffers.set(s, t);
    }
    return t;
  }

  /**
   * Both eyes at show time t. 'target' null draws into the canvas (each eye at its viewport);
   * a render target (WebXR's framebuffer) works the same way.
   */
  render(t: number, eyes: Eye[], target: THREE.WebGLRenderTarget | null = null) {
    const rt = this.rt;
    const r = rt.stage.renderer;
    const water = rt.stage.water;
    const reflection = water.getRenderTarget();
    const reflectionSize = [reflection.width, reflection.height];
    const mirror = water.onBeforeRender;
    const t0 = performance.now();
    const buf = this.targets();
    rt.advance(t);
    uFaceCamera.value = 1;
    const look = this.look;
    // the mirror eases in and out rather than switching
    const want = look.reflection !== 'off' && this.mirror ? 1 : 0;
    const step = 1 / StereoView.FADE_FRAMES;
    this.mirrorAmount = want > this.mirrorAmount ? Math.min(want, this.mirrorAmount + step) : Math.max(want, this.mirrorAmount - step);
    if (look.reflection === 'off') this.mirrorAmount = 0;
    if (this.mirrorAmount <= 0) {
      // a black mirror once, then the water draws without its second pass
      r.setRenderTarget(reflection);
      r.setClearColor(0x000000, 1);
      if (!StereoView.skip.has('mirror')) r.clear();
      water.onBeforeRender = () => {};
    } else {
      const k = look.reflection as number;
      reflection.setSize(Math.max(16, Math.round(buf.w * k)), Math.max(16, Math.round(buf.h * k)));
      if (this.mirrorAmount < 1) {
        // fading: draw the mirror image, then darken it toward black before the water uses it
        const amount = this.mirrorAmount;
        water.onBeforeRender = (...a) => {
          mirror(...a);
          this.dim(reflection, 1 - amount);
        };
      }
    }
    const toneMapping = r.toneMapping;
    // drops are sized in the pixels they are drawn at
    const view = new THREE.Vector2(buf.w, buf.h);
    if (look.shared) {
      this.renderShared(t, eyes, target, view, buf);
      eyes = [];
    }
    for (const eye of eyes) {
      const cam = eye.camera;
      cam.updateMatrixWorld();
      // pixels per metre at 1 m from this eye's projection (works for WebXR's asymmetric frusta too)
      const pxPerMetre = (buf.h / 2) * cam.projectionMatrix.elements[5];
      rt.aim(t, cam, pxPerMetre, view);
      r.toneMapping = THREE.NoToneMapping;
      r.setRenderTarget(buf.scene);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(rt.stage.scene, cam);
      r.toneMapping = toneMapping;
      // post: from the scene's picture, out to this eye's place
      if (target === null) {
        r.setRenderTarget(null);
        r.setViewport(eye.viewport);
        r.setScissor(eye.viewport);
        r.setScissorTest(true);
      }
      this.renderPost(target, eye.viewport, buf);
      r.setScissorTest(false);
    }
    water.onBeforeRender = mirror;
    reflection.setSize(reflectionSize[0], reflectionSize[1]);
    uFaceCamera.value = 0;
    this.timing = { eyes: performance.now() - t0 };
  }

  /** Darken a render target toward black by 'k' (0 nothing, 1 black), keeping the current target. */
  private dim(target: THREE.WebGLRenderTarget, k: number) {
    const r = this.rt.stage.renderer;
    if (this.dimScene.children.length === 0) {
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.dimMat);
      quad.frustumCulled = false;
      this.dimScene.add(quad);
    }
    this.dimMat.opacity = k;
    const prev = r.getRenderTarget();
    const autoClear = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.render(this.dimScene, this.dimCam);
    r.setRenderTarget(prev);
    r.autoClear = autoClear;
  }

  private cyclops = new THREE.PerspectiveCamera();

  /** look.shared: the water set up once, both eyes into one picture, one finish. */
  private renderShared(t: number, eyes: Eye[], target: THREE.WebGLRenderTarget | null, view: THREE.Vector2, buf: Buffers) {
    const r = this.rt.stage.renderer;
    const [a, b] = eyes;
    a.camera.updateMatrixWorld();
    b.camera.updateMatrixWorld();
    const c = this.cyclops;
    c.copy(a.camera);
    c.position.lerpVectors(a.camera.position, b.camera.position, 0.5);
    c.updateMatrixWorld();
    this.rt.aim(t, c, (buf.h / 2) * a.camera.projectionMatrix.elements[5], view);
    const toneMapping = r.toneMapping;
    const autoClear = r.autoClear;
    r.toneMapping = THREE.NoToneMapping;
    const rtS = buf.scene;
    r.setRenderTarget(rtS);
    r.setClearColor(0x000000, 1);
    if (!StereoView.skip.has('clear')) r.clear();
    r.autoClear = false;
    eyes.forEach((e, k) => {
      rtS.viewport.set(k * buf.w, 0, buf.w, buf.h);
      rtS.scissor.copy(rtS.viewport);
      rtS.scissorTest = true;
      r.setRenderTarget(rtS);
      if (!StereoView.skip.has('scene')) r.render(this.rt.stage.scene, e.camera);
    });
    rtS.viewport.set(0, 0, 2 * buf.w, buf.h);
    rtS.scissor.copy(rtS.viewport);
    rtS.scissorTest = false;
    r.setRenderTarget(rtS);
    r.autoClear = autoClear;
    r.toneMapping = toneMapping;
    // the eyes side by side in the target: finish both in one go into the span they cover
    const v = a.viewport;
    const span = new THREE.Vector4(v.x, v.y, 2 * this.width, this.height);
    if (target === null) {
      r.setRenderTarget(null);
      r.setViewport(span);
      r.setScissor(span);
      r.setScissorTest(true);
    }
    if (!StereoView.skip.has('post')) this.renderPost(target, span, buf);
    r.setScissorTest(false);
  }

  /** The finishing passes, the last one writing to the eye's viewport (stretching the picture to it). */
  private renderPost(target: THREE.WebGLRenderTarget | null, viewport: THREE.Vector4, buf: Buffers) {
    const r = this.rt.stage.renderer;
    const passes = this.passes.filter((p) => p.enabled);
    let read = buf.scene;
    let write = buf.a;
    for (let i = 0; i < passes.length; i++) {
      const p = passes[i];
      const last = i === passes.length - 1;
      if (last) {
        p.renderToScreen = target === null;
        if (target) {
          target.viewport.copy(viewport);
          target.scissor.copy(viewport);
          target.scissorTest = true;
          p.render(r, target, read, 0, false);
          target.scissorTest = false;
        } else {
          r.setViewport(viewport);
          p.render(r, write, read, 0, false);
        }
      } else {
        p.renderToScreen = false;
        p.render(r, write, read, 0, false);
        // bloom draws on top of what it reads (needsSwap false); the others write a new picture
        if (p.needsSwap) {
          read = write;
          write = read === buf.a ? buf.b : buf.a;
        }
      }
    }
  }

  dispose() {
    for (const t of this.buffers.values()) {
      t.scene.dispose();
      t.a.dispose();
      t.b.dispose();
    }
    this.buffers.clear();
    for (const p of this.passes) p.dispose();
    this.dimMat.dispose();
  }
}
