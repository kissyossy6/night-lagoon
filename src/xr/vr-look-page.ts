import * as THREE from 'three';
import { analyseMusic } from '../audio/analysis';
import { loadBackground } from '../audio/background';
import type { LightingMode } from '../core/nozzles';
import { projectionScreen } from '../screen/screen';
import { ANGLES } from '../show/cameras';
import { buildShow, variantOf } from '../show/choreography';
import { setCurves } from '../show/cues';
import { GRAPHICS_OFF, parseGraphics } from '../show/graphics';
import type { Quality } from '../show/layout';
import { ShowRuntime } from '../show/runtime';
import { SHOW_DURATION } from '../show/song';
import { ResolutionGovernor } from './resolution';
import { StereoView, VR_LOOK, type Eye, type VrLook } from './stereo';

/**
 * 46d 段階 1a（docs/walkaround-plan.md）：VR の描き方を、このMac で両目ぶん描いて測る試し台。
 * WebXR はまだ使わない（Mac のブラウザでは実機の代わりにならない）。左右の目を横に並べて描く。
 * 音は出さない（曲は解析にだけ使う）。
 *
 *   tools/vr-look.html?t=178.6&show=lagoon|fantasia|hanabi
 *     &quality=vr      ShowRuntime の画質（vr・low・high…）
 *     &scale=0.6       片目 1920×1824（Vision Pro の仮の値）に掛ける倍率
 *     &refl=off|0.25   水面の映り込み（既定 0.25＝目の 1/4 の解像度、off＝描かない）
 *     &bloom=384       ブルームの一辺（px）、0 でなし
 *     &hl=0            明るい色が白むのを省く
 *     &shared=0        目ごとに水の準備・描画・仕上げを別々に（既定は両目まとめて）
 *     &gfx=off         段階7 の描き方の足し（既定は vr のとき切、ほかは今のまま）
 *     &perf=1          60 コマを描いて window.__perf（ms／コマ、両目ぶん）。&pipe=1 で毎コマ待たずに流す
 *     &prof=1 / &gpu=1 内訳（gpu はタイマーのクエリ。Apple の GPU では描くたびに挟むと膨らむので目安にならない）
 *     &hide=4,4.2      シーンの部品（とその子）を隠す
 *     &shot=1          1コマ描いて window.__ready（撮る用）。&s=0.7 でその大きさの段で撮る
 *     &run=196,210     その間を毎秒 90 コマで流し、1コマずつの時間と描いた大きさを window.__info.run に。
 *                      &auto=1 で重い所だけ自動で大きさを下げる（resolution.ts）、&budget=5（ms）。
 *                      &laps=2 で同じ所を2回流す（2回目は覚えた重い所で先に下がる）
 */

const q = new URLSearchParams(location.search);
const logEl = document.getElementById('log')!;
const log = (s: string) => (logEl.textContent = s);

const quality = (q.get('quality') as Quality) ?? 'vr';
const scale = Number(q.get('scale') ?? 0.6);
const W = Math.round(1920 * scale);
const H = Math.round(1824 * scale);
const look: VrLook = {
  reflection: q.has('refl') ? (q.get('refl') === 'off' ? 'off' : Number(q.get('refl'))) : VR_LOOK.reflection,
  bloom: q.has('bloom') ? Number(q.get('bloom')) : VR_LOOK.bloom,
  highlight: q.get('hl') !== '0',
  shared: q.has('shared') ? q.get('shared') !== '0' : VR_LOOK.shared,
};

// the projector's picture: a new one every 'every' frames (the player: every 2nd at 60;
// here 90 frames a second, so every 3rd is still 30 pictures a second). ?every=1 for shots
const screen = projectionScreen({ width: 768, height: 144, every: Number(q.get('every') ?? (q.has('shot') ? 1 : 3)) });
const rt = new ShowRuntime(document.getElementById('stage')!, screen, quality, 1);
rt.setLighting((q.get('light') as LightingMode) ?? 'real');
if (q.has('gfx')) rt.setGraphics(parseGraphics(q.get('gfx')));
else if (quality === 'vr') rt.setGraphics({ ...GRAPHICS_OFF });
if (q.get('scenery') === '0') rt.setScenery(false);
if (q.get('fixtures') === '0') rt.setFixtures(false);
rt.stage.renderer.setPixelRatio(1);
rt.stage.setFixedSize([2 * W, H]);

// the seat, both eyes 32 mm either side, looking level at the stage centre
const seatView = ANGLES.audience;
const seat = new THREE.Vector3(...seatView.pos);
const target = new THREE.Vector3(seatView.target[0], seat.y, seatView.target[2]);
const fwd = target.clone().sub(seat).normalize();
const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
const eyes: Eye[] = [-1, 1].map((side, k) => {
  // roughly a Vision Pro eye: about 100° across
  const camera = new THREE.PerspectiveCamera(90, W / H, 0.1, 3000);
  camera.position.copy(seat).addScaledVector(right, side * 0.032);
  camera.lookAt(camera.position.clone().add(fwd));
  camera.updateMatrixWorld();
  return { camera, viewport: new THREE.Vector4(k * W, 0, W, H) };
});

for (const k of (q.get('skip') ?? '').split(',').filter(Boolean)) StereoView.skip.add(k);
const view = new StereoView(rt, { width: W, height: H, look });
// ?offscreen=1: both eyes into a render target, as into a headset's framebuffer (WebXR), not
// the page's canvas (which keeps its picture and smooths edges, at a cost a headset does not pay).
// For shots the target is copied to the canvas once at the end.
const outRT = q.has('offscreen') ? new THREE.WebGLRenderTarget(2 * W, H, { depthBuffer: false }) : null;
const view2 = new THREE.Vector2(W, H);
// ?only=advance|aim: for timing, only the frame's own work, or that and the eyes' set-up
const only = q.get('only');
const draw = (time: number) => {
  if (only === 'advance') rt.advance(time);
  else if (only === 'aim') {
    rt.advance(time);
    for (const e of eyes) rt.aim(time, e.camera, (H / 2) * e.camera.projectionMatrix.elements[5], view2);
  } else view.render(time, eyes, outRT);
};

declare global {
  interface Window {
    __ready?: boolean;
    __perf?: number;
    __info?: Record<string, unknown>;
  }
}

const ready = loadBackground(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }), SHOW_DURATION).then((m) => {
  const features = m?.buffer ? analyseMusic(m.buffer) : undefined;
  if (features) setCurves(features.curves);
  rt.setShow(buildShow(features, variantOf(q.get('show'))));
});

void ready.then(async () => {
  let t = Number(q.get('t') ?? 63);
  await rt.prepare(t);
  const gl = rt.stage.renderer.getContext();
  const px = new Uint8Array(4);
  // for finding what costs: ?hide=3,7 hides those children of the scene (window.__info.parts lists them)
  const parts = rt.stage.scene.children;
  // '4.2' is the third child of the fifth part
  for (const path of (q.get('hide') ?? '').split(',').filter(Boolean)) {
    let o: THREE.Object3D = rt.stage.scene;
    for (const k of path.split('.')) o = o.children[Number(k)];
    // a layer no camera sees: advance() sets some parts visible again every frame, layers it leaves alone
    o.traverse((c) => c.layers.set(31));
  }
  window.__info = {
    quality,
    eye: [W, H],
    look,
    parts: parts.map((o, i) => `${i}:${o.type}${o.name ? `(${o.name})` : ''}${'material' in o && o.material ? `[${(o.material as THREE.Material).type}]` : ''}/${o.children.length}`),
  };
  if (q.has('fade')) {
    // the mirror switched off and on again at a fixed show time: the left eye's lower stage at
    // chosen frames, side by side, into window.__info.strip (a PNG data URL)
    const pick = [0, 1, 7, 14, 21, 27, 28, 29, 36, 43, 50, 56];
    const c = rt.stage.renderer.domElement;
    const cw = Math.round(W * 0.8);
    const ch = Math.round(H * 0.28);
    const strip = document.createElement('canvas');
    strip.width = cw * 6;
    strip.height = ch * 2;
    const g = strip.getContext('2d')!;
    let n = 0;
    for (let i = 0; i <= 56; i++) {
      // frame 1..27: going off; 28..: coming back
      view.mirror = !(i >= 1 && i < 28);
      if (i === 0) for (let k = 0; k < 40; k++) draw(t);
      draw(t);
      if (pick.includes(i)) {
        g.drawImage(c, W * 0.1, H * 0.42, cw, ch, (n % 6) * cw, Math.floor(n / 6) * ch, cw, ch);
        g.fillStyle = '#fff';
        g.font = '22px sans-serif';
        g.fillText(`${i}: ${Math.round(view.mirrorAmount * 100)}%`, (n % 6) * cw + 8, Math.floor(n / 6) * ch + 26);
        n++;
      }
    }
    window.__info = { ...window.__info, parts: undefined, strip: strip.toDataURL('image/png') };
  } else if (q.has('run')) {
    // play a stretch at 90 frames a second and keep each frame's time and scale
    const [from, to] = q.get('run')!.split(',').map(Number);
    const budget = Number(q.get('budget') ?? 5);
    const gov = q.has('auto') ? new ResolutionGovernor({ budget }) : null;
    const laps = Number(q.get('laps') ?? 1);
    const frames: { t: number; ms: number; scale: number; mirror: boolean; lap: number }[] = [];
    for (let lap = 0; lap < laps; lap++) {
      t = from;
      await rt.prepare(t);
      for (let i = 0; i < 10; i++) draw(t);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      // frames go in groups with one wait for the GPU at the end of each; a frame's time is its
      // group's mean (the gaps inside a group are uneven: the waiting frame takes what the others
      // queued). Each wait lets the GPU run dry once, which a headset's loop does not do, so the
      // groups are long enough (12 frames, 0.13 s) for that to add little
      const G = Number(q.get('group') ?? 12);
      for (; t < to; ) {
        const start = performance.now();
        const group: { t: number; scale: number; mirror: boolean }[] = [];
        for (let k = 0; k < G && t < to; k++, t += 1 / 90) {
          view.scale = gov ? gov.scale : 1;
          view.mirror = gov ? gov.mirror : true;
          group.push({ t, scale: view.scale, mirror: view.mirror });
          draw(t);
        }
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const ms = (performance.now() - start) / group.length;
        for (const g of group) {
          frames.push({ t: g.t, ms, scale: g.scale, mirror: g.mirror, lap });
          gov?.frame(ms, g.t);
        }
      }
    }
    // the last lap, by the half second: mean time and scale, and how many frames went over
    const lastLap = frames.filter((f) => f.lap === laps - 1);
    const bins = new Map<number, { ms: number[]; scale: number[]; noMirror: number }>();
    for (const f of lastLap) {
      const k = Math.floor(f.t * 2) / 2;
      const b = bins.get(k) ?? { ms: [], scale: [], noMirror: 0 };
      b.ms.push(f.ms);
      b.scale.push(f.scale);
      if (!f.mirror) b.noMirror++;
      bins.set(k, b);
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    window.__info = {
      ...window.__info,
      parts: undefined,
      budget,
      auto: !!gov,
      over: lastLap.filter((f) => f.ms > budget).length,
      frames: lastLap.length,
      meanMs: +mean(lastLap.map((f) => f.ms)).toFixed(2),
      meanScale: +mean(lastLap.map((f) => f.scale)).toFixed(3),
      run: [...bins].map(([k, b]) => [k, +mean(b.ms).toFixed(2), +mean(b.scale).toFixed(2), b.ms.filter((m) => m > budget).length, b.noMirror]),
      noMirror: lastLap.filter((f) => !f.mirror).length,
    };
    window.__perf = window.__info.meanMs as number;
  } else if (q.has('gpu')) {
    // GPU time of every draw, summed by the part of the scene it belongs to (timer queries);
    // draws outside the scene (the water's GPU sums, the post passes) by their material
    const gl2 = gl as WebGL2RenderingContext;
    const ext = gl2.getExtension('EXT_disjoint_timer_query_webgl2');
    if (!ext) throw new Error('EXT_disjoint_timer_query_webgl2 がありません');
    const r = rt.stage.renderer;
    const top = (o: THREE.Object3D) => {
      let p = o;
      while (p.parent && p.parent !== rt.stage.scene) p = p.parent;
      if (p.parent !== rt.stage.scene) return null;
      return `${rt.stage.scene.children.indexOf(p)}:${p.name || p.type}`;
    };
    const pending: [WebGLQuery, string][] = [];
    const sum: Record<string, number> = {};
    let measuring = false;
    const drawBuffer = r.renderBufferDirect.bind(r);
    r.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if (!measuring) return drawBuffer(camera, scene, geometry, material, object, group);
      const label = top(object) ?? `off:${material.name || material.type}${(material as THREE.ShaderMaterial).fragmentShader?.length ?? ''}`;
      const qy = gl2.createQuery()!;
      gl2.beginQuery(ext.TIME_ELAPSED_EXT, qy);
      drawBuffer(camera, scene, geometry, material, object, group);
      gl2.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push([qy, label]);
    };
    for (let i = 0; i < 10; i++) draw(t);
    const N = 30;
    measuring = true;
    for (let i = 0; i < N; i++) draw((t += 1 / 90));
    measuring = false;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let tries = 0; pending.length && tries < 200; tries++) {
      await new Promise((ok) => setTimeout(ok, 10));
      while (pending.length && gl2.getQueryParameter(pending[0][0], gl2.QUERY_RESULT_AVAILABLE)) {
        const [qy, label] = pending.shift()!;
        sum[label] = (sum[label] ?? 0) + gl2.getQueryParameter(qy, gl2.QUERY_RESULT) / 1e6 / N;
        gl2.deleteQuery(qy);
      }
    }
    const total = Object.values(sum).reduce((a, b) => a + b, 0);
    window.__perf = total;
    window.__info = { ...window.__info, parts: undefined, gpu: Object.fromEntries(Object.entries(sum).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(3)])), total: +total.toFixed(2), disjoint: gl2.getParameter(ext.GPU_DISJOINT_EXT) };
    log(JSON.stringify(window.__info, null, 1));
  } else if (q.has('prof')) {
    // where the time goes: the frame's own work, then the eyes' set-up, then everything
    const N = 30;
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const time = (f: () => void) => {
      for (let i = 0; i < 5; i++) f();
      sync();
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        t += 1 / 90;
        f();
        sync();
      }
      return (performance.now() - t0) / N;
    };
    const ppm = (c: THREE.PerspectiveCamera) => (H / 2) * c.projectionMatrix.elements[5];
    const advance = time(() => rt.advance(t));
    const aim = time(() => {
      rt.advance(t);
      for (const e of eyes) rt.aim(t, e.camera, ppm(e.camera), view2);
    });
    const all = time(() => draw(t));
    // the CPU's part: the same calls without waiting for the GPU (each call returns once queued)
    const cpu = (f: () => void) => {
      const t0 = performance.now();
      for (let i = 0; i < N; i++) {
        t += 1 / 90;
        f();
      }
      const ms = (performance.now() - t0) / N;
      sync();
      return ms;
    };
    const advanceCpu = cpu(() => rt.advance(t));
    const aimCpu = cpu(() => {
      rt.advance(t);
      for (const e of eyes) rt.aim(t, e.camera, ppm(e.camera), view2);
    });
    const allCpu = cpu(() => draw(t));
    window.__perf = all;
    window.__info = { ...window.__info, advance, aim2: aim - advance, draw: all - aim, advanceCpu, aimCpu, allCpu, parts: undefined };
    log(JSON.stringify(window.__info));
  } else if (q.has('perf')) {
    for (let i = 0; i < 10; i++) draw(t);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const N = 60;
    const t0 = performance.now();
    // ?pipe=1: wait for the GPU only at the end, as a headset's frame loop would (the CPU
    // queues the next frame while the GPU draws this one); otherwise wait every frame
    const pipe = q.has('pipe');
    for (let i = 0; i < N; i++) {
      t += 1 / 90;
      draw(t);
      if (!pipe) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    }
    if (pipe) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    window.__perf = (performance.now() - t0) / N;
    log(`${quality} ${W}×${H}×2 ${JSON.stringify(look)}: ${window.__perf.toFixed(2)} ms/コマ`);
  } else {
    if (q.has('s')) view.scale = Number(q.get('s'));
    draw(t);
    draw(t);
    if (outRT) {
      // show what went to the target: blit it onto the canvas
      const r = rt.stage.renderer;
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
          // a plain copy: the post's last pass already wrote sRGB values
          uniforms: { tSrc: { value: outRT.texture } },
          vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
          fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }',
        }));
      const sc = new THREE.Scene();
      sc.add(quad);
      r.setRenderTarget(null);
      r.setViewport(0, 0, 2 * W, H);
      const tm = r.toneMapping;
      r.toneMapping = THREE.NoToneMapping;
      r.render(sc, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
      r.toneMapping = tm;
    }
    log(`${quality} ${W}×${H}×2 t=${t}`);
  }
  window.__ready = true;
});
