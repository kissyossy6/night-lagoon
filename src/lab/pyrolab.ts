import * as THREE from 'three';
import { afterglow, type Burst } from '../pyro/schedule';
import { buildShow } from '../show/choreography';
import { QUALITY_SCALE, type Quality } from '../show/layout';
import { ShowRuntime, type ScreenContent } from '../show/runtime';
import { BEATS_PER_BAR, BPM } from '../show/song';
import type { Cue, Fire, ShowFile } from '../show/types';
import { ANGLES } from '../show/cameras';
import { SHELLS, SKY_GLOW } from '../pyro/shells';
import type { CoredBurst, PyroLab } from '../techniques/fireworks';

/**
 * 花火の比べ場 (pyrolab.html): the seven ideas of the reference-page report
 * (docs/reports/hanabi-reference.html) side by side with the show. Two
 * runtimes draw the same time: the left one exactly as the show does now
 * (since 2026-11-08 with ideas 1, 4, 5, 6, 7 and 2 at a tenth), the right
 * one as the buttons set it, starting from the show's look. The buttons
 * only change the right-hand runtime (Fireworks.setLab, a cored or
 * differently burning copy of the bursts, its stage's film switch).
 *
 * URL: ?scene=kiku10&on=life,halo&glow=tenth|full|off&t=9.4&cam=sky|near&view=split|single&shot=1&quality=high
 *   on    the ideas on, on the right: life core halo sparks willow grain (missing: as the show)
 *   glow  idea 2 on the right: a tenth (the show), full (the lab's first try), off
 *   t     stop at this time (s, the scene's own clock)
 *   shot  hide the buttons; window.__ready once drawn (for screenshots)
 */

type IdeaId = 'life' | 'flash' | 'core' | 'halo' | 'sparks' | 'willow' | 'grain';
type GlowMode = 'tenth' | 'full' | 'off';
const GLOW_LABEL: Record<GlowMode, string> = { tenth: '1割', full: '強い', off: 'なし' };
/** The show's look (2026-11-08): what the right starts from and 本番と同じ returns to. */
const SHOW_ON: IdeaId[] = ['life', 'halo', 'sparks', 'willow', 'grain'];
const IDEAS: { id: IdeaId; label: string; note: string }[] = [
  { id: 'life', label: '星ごとの寿命', note: '1粒ずつ燃える長さが ±12%、最後にちらつく' },
  { id: 'flash', label: '開いた瞬間の光', note: '空を星の色で照らす：1割（本番）→ 強い（比べ場の最初の②、白い玉も小さく）→ なし' },
  { id: 'core', label: '芯', note: '菊・牡丹に内側の星の輪を足す（比べ場だけ。本番の玉は変えない）' },
  { id: 'halo', label: '星の光の輪', note: '星1粒ずつに柔らかいにじみ' },
  { id: 'sparks', label: '火の粉', note: '打ち上げと柳からこぼれる金の粒' },
  { id: 'willow', label: '柳を長く', note: '柳の燃える時間 4.5 → 5.75 秒（比べ場だけ）' },
  { id: 'grain', label: 'ノイズと周辺減光', note: '画面全体の細かい粒と、角を少し暗く（比べ場だけ）' },
];
const MARK = ['①', '②', '③', '④', '⑤', '⑥', '⑦'];

const W = { red: '#ff3000', green: '#3cff6a', blue: '#3a6cff', gold: '#ffb050', silver: '#e8ecff', pink: '#ff5fd0', purple: '#c03cff', cyan: '#00b4ff' };
const LAND = '@奥の陸 中央';
const BARGE = 'pyro:奥の台[1-1]';

interface Scene {
  id: string;
  label: string;
  /** Fire cues on an empty show, or a stretch of a version. */
  cues?: { t: number; target: string; fire: Fire }[];
  version?: { id: 'hanabi'; from: number; to: number };
}

const SCENES: Scene[] = [
  { id: 'kiku10', label: '10号 菊（銀）', cues: [{ t: 7.5, target: LAND, fire: { shell: 'kiku', size: 10, colors: [W.silver] } }] },
  { id: 'kiku7', label: '7号 菊（赤）— 芯を見るのに向く', cues: [{ t: 7, target: LAND, fire: { shell: 'kiku', size: 7, colors: [W.red] } }] },
  { id: 'yanagi7', label: '7号 柳（金）', cues: [{ t: 7, target: LAND, fire: { shell: 'yanagi', size: 7, colors: [W.gold] } }] },
  { id: 'botan4', label: '4号 牡丹（緑）', cues: [{ t: 5, target: BARGE, fire: { shell: 'botan', size: 4, colors: [W.green] } }] },
  {
    id: 'mix',
    label: 'いろいろ続けて（菊・柳・牡丹・変化）',
    cues: [
      { t: 6, target: LAND, fire: { shell: 'kiku', size: 5, colors: [W.pink] } },
      { t: 7.2, target: BARGE, fire: { shell: 'botan', size: 4, colors: [W.blue] } },
      { t: 8.6, target: LAND, fire: { shell: 'yanagi', size: 6, colors: [W.gold] } },
      { t: 10, target: LAND, fire: { shell: 'kiku', size: 7, colors: [W.red, W.green, W.silver] } },
    ],
  },
  { id: 'final', label: '花火版 最後の登りと和音（3:20〜）', version: { id: 'hanabi', from: 199.6, to: 213 } },
  { id: 'gold', label: '花火版 金の柳（2:49〜）', version: { id: 'hanabi', from: 168.6, to: 181 } },
];

const q = new URLSearchParams(location.search);
const shot = q.has('shot');
if (shot) document.body.classList.add('shot');
const quality = (q.get('quality') as Quality) ?? 'high';

// no water screen in the lab: a black projector
const blank = (): ScreenContent => ({
  texture: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1),
  render() {},
  averageColor: () => [0, 0, 0],
});
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewA = $('viewA');
const viewB = $('viewB');
const views = $('views');
/** Left: the show as it is. Right: with the ideas. */
const rtA = new ShowRuntime(viewA, blank(), quality, shot ? 1 : undefined);
const rtB = new ShowRuntime(viewB, blank(), quality, shot ? 1 : undefined);
rtA.setLighting('real');
rtB.setLighting('real');

// ------------------------------------------------------------- state
const on = new Set<IdeaId>(q.has('on') ? (q.get('on') ?? '').split(',').filter((x): x is IdeaId => IDEAS.some((i) => i.id === x) && x !== 'flash') : SHOW_ON);
let glowMode: GlowMode = (['tenth', 'full', 'off'] as const).find((g) => g === q.get('glow')) ?? 'tenth';
let scene = SCENES.find((s) => s.id === q.get('scene')) ?? SCENES[0];
let cam = q.get('cam') === 'near' ? 'near' : 'sky';
let split = q.get('view') !== 'single';
let from = 0;
let to = 10;
/** The first burst of the scene: the clock reads from it. */
let first = 0;
let base: Burst[] = [];
let t = 0;
let playing = !shot && !q.has('t');
let speed = 1;
let loop = true;

const linear = (hex: string): [number, number, number] => {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

function loadScene() {
  let file: ShowFile;
  if (scene.version) {
    file = buildShow(undefined, scene.version.id);
  } else {
    const cues: Cue[] = scene.cues!.map((c) => ({ t: c.t, target: c.target, fire: c.fire, label: '' }));
    file = { title: '花火の比べ場', bpm: BPM, beatsPerBar: BEATS_PER_BAR, offset: 0, duration: 60, cues };
  }
  rtA.setShow(file);
  rtB.setShow(file);
  base = rtB.show.bursts;
  if (scene.version) {
    from = scene.version.from;
    to = scene.version.to;
    const inside = base.filter((b) => b.tBurst >= from && b.tBurst <= to);
    first = inside.length ? Math.min(...inside.map((b) => b.tBurst)) : from;
  } else {
    from = Math.max(0, Math.min(...base.map((b) => b.tLaunch)) - 0.4);
    first = Math.min(...base.map((b) => b.tBurst));
  }
  applyBursts();
  loadRange();
  seek.min = String(from);
  if (t < from || t > to) t = from;
}

/** The right-hand bursts with ideas 3 and 6 (copies; the left keeps the show's). */
function applyBursts() {
  const gold = linear(W.gold);
  const bursts: CoredBurst[] = base.map((b) => {
    const out: CoredBurst = { ...b };
    // the show's willow burns 5.75 s now; without ⑥ the right shows the old 4.5
    // (a cue with its own Fire.burn, like the 花火版's gold willow, keeps it)
    if (b.shell === 'yanagi' && b.burn === SHELLS.yanagi.burn) out.burn = on.has('willow') ? SHELLS.yanagi.burn : 4.5;
    if (on.has('core') && (b.shell === 'kiku' || b.shell === 'botan') && b.parent === undefined) {
      // gold in a coloured shell, cyan in a silver or gold one
      const c0 = b.colors[0];
      const pale = Math.min(c0[0], c0[1], c0[2]) > 0.5 || (c0[0] > 0.9 && c0[1] > 0.3 && c0[2] < 0.2);
      out.core = { frac: 0.3, ratio: 0.42, color: pale ? linear(W.cyan) : gold };
    }
    return out;
  });
  rtB.fireworks.setBursts(bursts, QUALITY_SCALE[rtB.qualityTier]);
  rtB.smoke.setBursts(bursts);
}

/** A single-shell scene ends after its smoke; ⑥ makes a willow scene longer. */
function loadRange() {
  if (scene.version) return;
  const longest = Math.max(...base.map((b) => b.tBurst + afterglow(b)));
  to = longest + 2.5;
  seek.max = String(to);
}

function applyIdeas() {
  const lab: PyroLab = {
    life: on.has('life'),
    glow: glowMode !== 'off',
    flash: glowMode === 'full',
    glowGain: glowMode === 'full' ? 1 / SKY_GLOW : 1,
    halo: on.has('halo'),
    sparks: on.has('sparks'),
  };
  rtB.fireworks.setLab(lab);
  rtB.stage.setFilm(on.has('grain'));
  applyBursts();
  loadRange();
  seek.max = String(to);
  for (const b of list.querySelectorAll<HTMLButtonElement>('.idea')) {
    const id = b.dataset.id as IdeaId;
    const isOn = id === 'flash' ? glowMode !== 'off' : on.has(id);
    b.classList.toggle('on', isOn);
    b.setAttribute('aria-pressed', String(isOn));
    if (id === 'flash') b.querySelector('.v')!.textContent = `：${GLOW_LABEL[glowMode]}`;
  }
  const same = glowMode === 'tenth' && on.size === SHOW_ON.length && SHOW_ON.every((i) => on.has(i));
  const ids = IDEAS.map((i, k) => (i.id === 'flash' ? `${MARK[k]}${GLOW_LABEL[glowMode]}` : on.has(i.id) ? MARK[k] : '')).join(' ').replace(/ +/g, ' ').trim();
  $('tagB').innerHTML = same ? '変えた（今は本番と同じ＝左と同じ）' : `変えた：<b>${ids}</b>`;
  $('show').classList.toggle('on', same);
  $('none').classList.toggle('on', on.size === 0 && glowMode === 'off');
  $('every').classList.toggle('on', on.size === IDEAS.length - 1 && glowMode === 'full');
  writeUrl();
}

function aimCamera() {
  for (const rt of [rtA, rtB]) {
    const c = rt.stage.camera;
    const v = ANGLES.sky;
    c.position.set(...v.pos);
    if (cam === 'near') {
      const b = base.find((x) => x.tBurst >= first - 0.01) ?? base[0];
      c.lookAt(0, (b ? b.center[1] : 200) - 10, b ? b.center[2] : -260);
      c.fov = 30;
    } else {
      c.lookAt(...v.target);
      c.fov = v.fov;
    }
    c.updateProjectionMatrix();
  }
}

/** Under the bar, half the width each (or the whole for one view). */
function layout() {
  views.classList.toggle('single', !split);
  views.style.top = shot ? '0px' : `${$('top').offsetHeight}px`;
  for (const [rt, el] of [
    [rtA, viewA],
    [rtB, viewB],
  ] as const) {
    if (el.clientWidth > 0) rt.stage.setFixedSize([el.clientWidth, el.clientHeight]);
  }
}

function writeUrl() {
  if (shot) return;
  const p = new URLSearchParams();
  p.set('scene', scene.id);
  p.set('on', [...on].join(','));
  if (glowMode !== 'tenth') p.set('glow', glowMode);
  if (cam !== 'sky') p.set('cam', cam);
  if (!split) p.set('view', 'single');
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

// ------------------------------------------------------------- UI
const list = $('list');
const seek = $<HTMLInputElement>('seek');
const playBtn = $<HTMLButtonElement>('play');
const sceneSel = $<HTMLSelectElement>('scene');

IDEAS.forEach((idea, k) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'idea';
  b.dataset.id = idea.id;
  b.title = `${MARK[k]} ${idea.note}（キー ${k + 1}）`;
  b.innerHTML = `<span class="n">${MARK[k]}</span>${idea.label}${idea.id === 'flash' ? '<span class="v"></span>' : ''}`;
  b.addEventListener('click', () => toggle(idea.id));
  list.appendChild(b);
});
function toggle(id: IdeaId) {
  if (id === 'flash') glowMode = glowMode === 'tenth' ? 'full' : glowMode === 'full' ? 'off' : 'tenth';
  else if (on.has(id)) on.delete(id);
  else on.add(id);
  applyIdeas();
}
$('show').addEventListener('click', () => {
  on.clear();
  SHOW_ON.forEach((i) => on.add(i));
  glowMode = 'tenth';
  applyIdeas();
});
$('none').addEventListener('click', () => {
  on.clear();
  glowMode = 'off';
  applyIdeas();
});
$('every').addEventListener('click', () => {
  IDEAS.forEach((i) => i.id !== 'flash' && on.add(i.id));
  glowMode = 'full';
  applyIdeas();
});

for (const s of SCENES) sceneSel.add(new Option(s.label, s.id, false, s === scene));
sceneSel.addEventListener('change', () => {
  scene = SCENES.find((s) => s.id === sceneSel.value)!;
  t = -1;
  loadScene();
  t = from;
  aimCamera();
  writeUrl();
});
const camSel = $<HTMLSelectElement>('cam');
camSel.value = cam;
camSel.addEventListener('change', () => {
  cam = camSel.value;
  aimCamera();
  writeUrl();
});
const layoutSel = $<HTMLSelectElement>('layout');
layoutSel.value = split ? 'split' : 'single';
layoutSel.addEventListener('change', () => {
  split = layoutSel.value === 'split';
  layout();
  writeUrl();
});
const setPlaying = (p: boolean) => {
  playing = p;
  playBtn.textContent = p ? '❚❚ 止める' : '▶ 再生';
  playBtn.classList.toggle('on', p);
};
playBtn.addEventListener('click', () => setPlaying(!playing));
$('restart').addEventListener('click', () => {
  t = from;
  setPlaying(true);
});
const step = (d: number) => {
  setPlaying(false);
  t = Math.min(to, Math.max(from, t + d));
};
$('back').addEventListener('click', () => step(-1 / 30));
$('fwd').addEventListener('click', () => step(1 / 30));
seek.addEventListener('input', () => {
  setPlaying(false);
  t = Number(seek.value);
});
$<HTMLSelectElement>('speed').addEventListener('change', (e) => (speed = Number((e.target as HTMLSelectElement).value)));
$<HTMLInputElement>('loop').addEventListener('change', (e) => (loop = (e.target as HTMLInputElement).checked));
$('side').addEventListener('click', () => {
  const s = window.screen;
  const w = Math.round(s.availWidth / 2);
  window.open('/docs/reference/hanabi-photoreal-simple.html', 'hanabi-ref', `popup,width=${w},height=${s.availHeight},left=${w},top=0`);
});
addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.key === ' ') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === 'ArrowLeft') step(-1 / 30);
  else if (e.key === 'ArrowRight') step(1 / 30);
  else if (/^[1-7]$/.test(e.key)) toggle(IDEAS[Number(e.key) - 1].id);
});
addEventListener('resize', layout);

// ------------------------------------------------------------- loop
const clock = $('clock');
const stat = $('stat');
const times: number[] = [];
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (playing) {
    t += dt * speed;
    if (t > to) {
      if (loop) t = from;
      else {
        t = to;
        setPlaying(false);
      }
    }
  }
  draw();
  times.push(dt * 1000);
  if (times.length > 60) times.shift();
  const ms = times.reduce((a, b) => a + b, 0) / times.length;
  stat.textContent = `1コマ ${ms.toFixed(1)} ms（${Math.round(1000 / ms)} コマ/秒）${split ? '・2画面ぶん' : ''}`;
}
function draw() {
  if (split) rtA.render(t);
  rtB.render(t);
  seek.value = String(t);
  const rel = t - first;
  clock.textContent = `${t.toFixed(2)} 秒（開いて ${rel >= 0 ? '+' : '−'}${Math.abs(rel).toFixed(2)}）`;
}

loadScene();
applyIdeas();
aimCamera();
layout();
if (q.has('t')) t = Number(q.get('t'));
setPlaying(playing);

declare global {
  interface Window {
    __ready?: boolean;
    __lab?: { rt: ShowRuntime; rtA: ShowRuntime; set(time: number): void; ideas(ids: string[], glow?: string): void; scene(id: string): void; first(): number; draw(): void };
  }
}
window.__lab = {
  rt: rtB,
  rtA,
  set(time: number) {
    setPlaying(false);
    t = time;
    draw();
  },
  ideas(ids: string[], glow = 'tenth') {
    on.clear();
    ids.forEach((i) => i !== 'flash' && on.add(i as IdeaId));
    glowMode = glow as GlowMode;
    applyIdeas();
  },
  scene(id: string) {
    sceneSel.value = id;
    sceneSel.dispatchEvent(new Event('change'));
  },
  first: () => first,
  draw,
};
if (shot) {
  draw();
  requestAnimationFrame(() => (window.__ready = true));
} else requestAnimationFrame(frame);
