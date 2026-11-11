import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Stage } from '../core/stage';
import {
  LIGHT_MODEL,
  lightPositions,
  nozzleUniforms,
  type LightingMode,
  type NozzleSpec,
  type NozzleType,
} from '../core/nozzles';
import { NOZZLES } from '../fixtures';
import { createTechnique, JET_TECH_LABELS, MIST_TECH_LABELS, TECH_IDS, type TechId } from '../techniques';
import { makeProjectionTexture } from '../techniques/mist';
import type { Technique } from '../techniques/types';

/**
 * Nozzle lab: one fixture, one rendering technique, fixed camera presets.
 * URL: ?nozzle=vertical&tech=D&cam=audience&t=6.5&shot=1&light=real&color=%2300b4ff
 *   light real | ideal (see LightingMode); lm=<n> picks a raw model for experiments
 *   t     freeze the show clock at this time (deterministic screenshots)
 *   shot  hide UI, set window.__ready once rendered
 *   perf  time 120 frames and report window.__perf (ms/frame)
 */

type CamKind = 'audience' | 'close' | 'free';

const q = new URLSearchParams(location.search);
const state = {
  nozzle: (q.get('nozzle') ?? 'vertical') as NozzleType,
  tech: (q.get('tech') ?? 'D') as TechId,
  cam: (q.get('cam') ?? 'audience') as CamKind,
  color: q.get('color') ?? NOZZLES.vertical.color.toString(),
  lightModel: q.has('lm') ? Number(q.get('lm')) : q.has('light') ? LIGHT_MODEL[q.get('light') as LightingMode] : -1,
  frozen: q.has('t'),
  time: Number(q.get('t') ?? 0),
};
const shot = q.has('shot');
if (shot) document.body.classList.add('shot');

const stage = new Stage(document.body, { pixelRatio: shot ? 1 : undefined });
const controls = new OrbitControls(stage.camera, stage.renderer.domElement);
controls.enableDamping = true;
const image = makeProjectionTexture();

let tech: Technique | null = null;
let spec: NozzleSpec;

function cameraPreset(s: NozzleSpec, kind: CamKind) {
  const H = s.height;
  const D = Math.max(30, H * 1.3 + 14);
  const lift = s.type === 'ring' ? 7 : 3;
  if (kind === 'close') {
    return { pos: new THREE.Vector3(D * 0.32, 1.6, D * 0.36), target: new THREE.Vector3(0, H * 0.42, 0), fov: 62 };
  }
  const fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan((H * 0.66) / D)), 28, 60);
  return { pos: new THREE.Vector3(0, lift, D), target: new THREE.Vector3(0, H * 0.48, 0), fov };
}

function applyCamera() {
  if (state.cam === 'free') return;
  const c = cameraPreset(spec, state.cam);
  stage.camera.position.copy(c.pos);
  stage.camera.fov = c.fov;
  stage.camera.updateProjectionMatrix();
  controls.target.copy(c.target);
  stage.camera.lookAt(c.target);
  controls.update();
}

function build() {
  if (tech) {
    stage.scene.remove(tech.object);
    tech.dispose();
  }
  spec = { ...NOZZLES[state.nozzle], color: state.color };
  const u = nozzleUniforms(spec);
  if (state.lightModel >= 0) u.uLightModel.value = state.lightModel;
  tech = createTechnique(state.tech, spec, u, image);
  if (state.lightModel >= 0) u.uLightModel.value = state.lightModel;
  stage.scene.add(tech.object);
  const lightCol = new THREE.Color(spec.color);
  stage.setPools(spec.type === 'mist' ? [] : lightPositions(spec), lightCol, spec.intensity);
  applyCamera();
}

// ---------------------------------------------------------------- UI
function buildUi() {
  const ui = document.getElementById('ui')!;
  const sel = (label: string, opts: [string, string][], value: string, on: (v: string) => void) => {
    const l = document.createElement('label');
    l.textContent = label;
    const s = document.createElement('select');
    for (const [v, t] of opts) s.add(new Option(t, v, false, v === value));
    s.onchange = () => on(s.value);
    ui.append(l, s);
    return s;
  };
  const techOpts = () =>
    TECH_IDS.map((id) => [id, `${id}: ${(state.nozzle === 'mist' ? MIST_TECH_LABELS : JET_TECH_LABELS)[id]}`] as [string, string]);
  let techSel: HTMLSelectElement;
  sel(
    'ノズル',
    (Object.keys(NOZZLES) as NozzleType[]).map((k) => [k, k]),
    state.nozzle,
    (v) => {
      state.nozzle = v as NozzleType;
      techSel.innerHTML = '';
      for (const [id, t] of techOpts()) techSel.add(new Option(t, id, false, id === state.tech));
      build();
    },
  );
  techSel = sel('描画', techOpts(), state.tech, (v) => {
    state.tech = v as TechId;
    build();
  });
  sel('カメラ', [['audience', '客席'], ['close', '近く'], ['free', '自由']], state.cam, (v) => {
    state.cam = v as CamKind;
    applyCamera();
  });
  sel(
    '色',
    [
      ['#00b4ff', 'シアン'],
      ['#1e3cff', '青'],
      ['#3cff5a', '緑'],
      ['#c03cff', '紫'],
      ['#ff3000', '赤橙'],
      ['#ff7a00', 'オレンジ'],
      ['#ffffff', '白'],
    ],
    state.color,
    (v) => {
      state.color = v;
      build();
    },
  );
  sel(
    '照明',
    [
      ['-1', '方式の既定'],
      ['4', 'リアル（機材どおり）'],
      ['1', '理想（見栄え優先）'],
      ['0', '実験: 設計書（単葉HG）'],
      ['2', '実験: LEDリング（圧縮なし）'],
      ['3', '実験: ノズル内光源（層流）'],
    ],
    String(state.lightModel),
    (v) => {
      state.lightModel = Number(v);
      build();
    },
  );
  const l = document.createElement('label');
  l.textContent = '再生';
  const b = document.createElement('button');
  b.textContent = state.frozen ? '▶' : '❚❚';
  b.onclick = () => {
    state.frozen = !state.frozen;
    b.textContent = state.frozen ? '▶' : '❚❚';
  };
  ui.append(l, b);
}

if (!shot) buildUi();
build();

// ---------------------------------------------------------------- loop
const stats = document.getElementById('stats')!;
let last = performance.now();
let frames = 0;
let acc = 0;
const viewport = new THREE.Vector2();

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!state.frozen) state.time += dt;
  controls.update();
  stage.viewport().clone();
  viewport.copy(stage.viewport());
  tech!.update({ time: state.time, pxPerMetre: stage.pxPerMetre(), viewport, camera: stage.camera });
  stage.render(state.time);
  frames++;
  acc += dt;
  if (acc > 0.5) {
    stats.textContent = `${(frames / acc).toFixed(0)} fps · t=${state.time.toFixed(2)}s`;
    frames = 0;
    acc = 0;
  }
}

declare global {
  interface Window {
    __ready?: boolean;
    __perf?: number;
  }
}

if (q.has('perf')) {
  // time N synchronous frames (readPixels forces the GPU to finish)
  const gl = stage.renderer.getContext();
  const px = new Uint8Array(4);
  for (let i = 0; i < 10; i++) frame(performance.now());
  const t0 = performance.now();
  const N = 60;
  for (let i = 0; i < N; i++) {
    state.time += 1 / 60;
    frame(performance.now());
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  }
  window.__perf = (performance.now() - t0) / N;
  window.__ready = true;
} else if (shot) {
  let n = 0;
  const tick = (now: number) => {
    frame(now);
    if (++n >= 3) window.__ready = true;
    else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
} else {
  stage.renderer.setAnimationLoop(frame);
}
