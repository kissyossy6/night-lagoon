import * as THREE from 'three';
import type { ShowRuntime } from '../show/runtime';

/**
 * Motion blur for exports (stage 7, H1): one video frame is the average of
 * N renders spread over the shutter, as a film camera's exposure is. The
 * picture is a function of show time only, so each sub-frame is exact.
 *
 * Each render lands on the canvas (tone-mapped, sRGB); it is copied into a
 * texture and added, in linear light, into a float target; the average goes
 * back to the canvas for the encoder.
 */

/** Renders per frame and the shutter (fraction of a frame) the export uses. */
export const BLUR_SAMPLES = 4;
export const BLUR_SHUTTER = 0.5;

const VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const ADD_FS = /* glsl */ `
uniform sampler2D tFrame;
uniform float uWeight;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tFrame, vUv).rgb;
  gl_FragColor = vec4(pow(c, vec3(2.2)) * uWeight, 1.0);
}`;

const OUT_FS = /* glsl */ `
uniform sampler2D tSum;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSum, vUv).rgb;
  gl_FragColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;

export class FrameBlend {
  private frame: THREE.FramebufferTexture;
  private sum: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: THREE.Mesh;
  private add: THREE.ShaderMaterial;
  private out: THREE.ShaderMaterial;
  private origin = new THREE.Vector2(0, 0);

  constructor(
    private renderer: THREE.WebGLRenderer,
    width: number,
    height: number,
  ) {
    this.frame = new THREE.FramebufferTexture(width, height);
    this.sum = new THREE.WebGLRenderTarget(width, height, { type: THREE.FloatType, depthBuffer: false });
    this.add = new THREE.ShaderMaterial({
      uniforms: { tFrame: { value: this.frame }, uWeight: { value: 1 } },
      vertexShader: VS,
      fragmentShader: ADD_FS,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.out = new THREE.ShaderMaterial({
      uniforms: { tSum: { value: this.sum.texture } },
      vertexShader: VS,
      fragmentShader: OUT_FS,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.add);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /**
   * Draw show time t with the shutter open around it: N renders at
   * t + (k + 0.5) / N · shutter − shutter / 2, in frames of 1 / fps.
   */
  render(rt: ShowRuntime, t: number, fps: number, samples = BLUR_SAMPLES, shutter = BLUR_SHUTTER) {
    const r = this.renderer;
    const open = shutter / fps;
    const clear = r.getClearColor(new THREE.Color());
    const alpha = r.getClearAlpha();
    for (let k = 0; k < samples; k++) {
      rt.render(t + ((k + 0.5) / samples) * open - open / 2);
      r.setRenderTarget(null);
      r.copyFramebufferToTexture(this.frame, this.origin);
      r.setRenderTarget(this.sum);
      if (k === 0) {
        r.setClearColor(0x000000, 0);
        r.clear(true, false, false);
      }
      this.add.uniforms.uWeight.value = 1 / samples;
      this.quad.material = this.add;
      // add on top of what is there
      const auto = r.autoClear;
      r.autoClear = false;
      r.render(this.scene, this.cam);
      r.autoClear = auto;
    }
    r.setRenderTarget(null);
    r.setClearColor(clear, alpha);
    this.quad.material = this.out;
    r.render(this.scene, this.cam);
  }

  dispose() {
    this.frame.dispose();
    this.sum.dispose();
    this.add.dispose();
    this.out.dispose();
  }
}
