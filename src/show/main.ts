import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LightingMode } from '../core/nozzles';
import { decodeFile, loadBackground, loadMusicUrl } from '../audio/background';
import { projectionScreen } from '../screen/screen';
import { analyseMusic } from '../audio/analysis';
import { mixSplash, renderSplash } from '../audio/splash';
import { DEFAULT_LEVELS, LEVEL_MAX, OUTPUT_CEILING, SOUND_LAYERS, type SoundLayer } from '../audio/levels';
import { limit } from '../audio/limit';
import { renderPyro } from '../audio/pyro';
import { buildPyroTest } from './pyrotest';
import { exportVideo } from '../export/video';
import { exportVr180, vr180BytesPerSecond, vr180Projector } from '../export/vr180-video';
import { ANGLES, ANGLE_NAMES, applyView, directShow, screenOpening, useVenueAngles, viewAt, type AngleName } from './cameras';
import { getVenue } from '../venues';
import { parseGraphics } from './graphics';
import { buildShow, extendToMusic, variantOf } from './choreography';
import { setCurves } from './cues';
import { ShowClock } from './clock';
import type { Quality } from './layout';
import { ShowRuntime } from './runtime';
import { Scope } from './scope';
import { SHOW_DURATION } from './song';
import { sectionSpans, spanAt } from './sections';
import { TEST_SHOW } from './test-show';
import type { ShowFile } from './types';
import { lastProject, musicUrl, projectStore, isSampleId } from '../projects/store';
import type { ProjectDoc } from '../projects/types';

/** The editor's single autosave from before projects (read only for ?show=edited when no project was opened yet). */
const EDITOR_STORE_KEY = 'water-show-editor:v1';

/**
 * Show player (play.html).
 * URL: ?project=<id>&t=42&shot=1&light=real|ideal&quality=high|medium|low&cam=<angle>|auto|free&show=test|edited|fantasia|hanabi|pyrotest
 *   project  play this project (docs/projects-plan.md); a sample's id plays the sample
 *   show=edited  the project last opened in the editor
 *   t     start (or, with shot, freeze) at this time
 *   shot  hide the UI, set window.__ready once rendered
 *   perf  time 60 frames, report window.__perf (ms/frame)
 *   venue play the show in another venue (built-in or made in venue.html)
 */

const q = new URLSearchParams(location.search);
const shot = q.has('shot');

// the project to play, read before anything is built
const projectId = q.get('project') ?? (q.get('show') === 'edited' ? lastProject() : null);
let project: ProjectDoc | null = null;
if (projectId) {
  try {
    project = await (await projectStore()).get(projectId);
  } catch (err) {
    console.error(err);
  }
}
// ?venue=<id>: the show placed in another venue (venue.html's 3Dで見る);
// the camera angles become that venue's seats
const venueId = q.get('venue');
if (venueId) useVenueAngles(getVenue(venueId));
if (shot) document.body.classList.add('shot');

// ---------------------------------------------------------------- screen
// a still frame must be complete, so screenshots render the projector every call
const still = shot && !q.has('perf');
const screen = projectionScreen({ width: Number(q.get('pw') ?? 1536), height: Number(q.get('ph') ?? 288), every: still ? 1 : 2 });

// --------------------------------------------------------------- quality
interface Tier {
  quality: Quality;
  pixelRatio: number;
  reflection: number;
}
const TIERS: Record<Quality, Tier> = {
  high: { quality: 'high', pixelRatio: Math.min(window.devicePixelRatio, 1.5), reflection: 0.5 },
  medium: { quality: 'medium', pixelRatio: 0.85, reflection: 0.5 },
  low: { quality: 'low', pixelRatio: 0.6, reflection: 0.35 },
  // stage 7 H1: exports only (three times the drops, a full-size reflection)
  export: { quality: 'export', pixelRatio: 1, reflection: 1 },
};
const fixedQuality = q.get('quality') as Quality | null;
let tier = TIERS[fixedQuality ?? 'high'];

const rt = new ShowRuntime(document.getElementById('stage')!, screen, tier.quality, shot ? 1 : tier.pixelRatio);
if (!shot) rt.stage.setResolution(tier.pixelRatio, tier.reflection);
rt.setLighting((q.get('light') as LightingMode) ?? 'real');
// stage 7's water looks: on by default, ?gfx=off for the old look (show/graphics.ts)
if (q.has('gfx')) rt.setGraphics(parseGraphics(q.get('gfx')));

function loadShow(): ShowFile {
  const file = loadShowFile();
  return venueId ? { ...file, venue: venueId } : file;
}
function loadShowFile(): ShowFile {
  if (project) {
    if (project.show) return extendToMusic(project.show, music ?? undefined) ?? project.show;
    if (project.generate === 'empty') return { title: project.name, bpm: 120, beatsPerBar: 4, offset: 0, duration: 180, cues: [] };
    return { ...buildShow(music ?? undefined, variantOf(project.generate ?? 'lagoon')), title: project.name };
  }
  if (q.get('show') === 'test') return TEST_SHOW;
  // the fireworks test shots of stage 2 (src/show/pyrotest.ts)
  if (q.get('show') === 'pyrotest') return buildPyroTest();
  // ?show=edited plays what the timeline editor autosaved
  if (q.get('show') === 'edited') {
    try {
      const s = localStorage.getItem(EDITOR_STORE_KEY);
      if (s) {
        const saved = JSON.parse(s) as ShowFile;
        // saved before the music grew to its real ending: take the new ending
        return extendToMusic(saved, music ?? undefined) ?? saved;
      }
    } catch {
      /* fall back to the built-in show */
    }
  }
  // ?show=fantasia / hanabi play those versions (choreography.ts SHOW_VARIANTS)
  return buildShow(music ?? undefined, variantOf(q.get('show')));
}
/** Waveform analysis of the music once it is loaded (src/audio/analysis.ts). */
let music: ReturnType<typeof analyseMusic> | null = null;
rt.setShow(loadShow());
/** The show's length: its file's (a project on its own music runs that music's length, docs/music-plan.md). */
const showLength = () => rt.file.duration;
/**
 * The music under the show: the project's own (ShowFile.music), else the
 * shared recording (public/music/background.*) cut to the built-in length.
 */
function loadShowMusic(ctx: BaseAudioContext) {
  const own = rt.file.music;
  if (own && project) return loadMusicUrl(musicUrl(project.id, own.file), own.name, ctx, showLength());
  return loadBackground(ctx, SHOW_DURATION);
}
// the start screen and the tab name say which version is open (SHOW_VARIANTS' title, or the saved file's)
{
  const title = project?.name || rt.file.title || 'Night Lagoon';
  document.title = title;
  const h1 = document.querySelector('#start h1');
  if (h1) h1.textContent = title;
  const len = `${Math.floor(rt.file.duration / 60)}:${String(Math.round(rt.file.duration % 60)).padStart(2, '0')}`;
  const desc = document.getElementById('start-desc');
  if (desc) desc.textContent = project?.description ?? `${rt.venue.name}・${len}`;
  // back to where it was opened from: the project's editor, or the list (samples, ?show=)
  const ownProject = project && !isSampleId(project.id) ? project.id : null;
  for (const id of ['start-back', 'edit-link']) {
    const a = document.getElementById(id) as HTMLAnchorElement | null;
    if (!a) continue;
    a.href = ownProject ? `/edit.html?project=${encodeURIComponent(ownProject)}` : '/#projects';
    a.textContent = ownProject ? '← エディタに戻る' : '← プロジェクト一覧';
    // opened from that editor (its ▶ 本番で再生): go back to its tab, not a second editor on the same project
    a.addEventListener('click', (e) => {
      try {
        const ed = window.opener as Window | null;
        if (ownProject && ed && !ed.closed && ed.location.pathname === '/edit.html' && new URLSearchParams(ed.location.search).get('project') === ownProject) {
          e.preventDefault();
          ed.focus();
          window.close();
        }
      } catch {
        /* another page: follow the link */
      }
    });
  }
  const kind = document.getElementById('start-kind');
  if (kind) kind.textContent = project?.sample ? '見本' : '本番再生';
}

/** Analyse the music and rebuild the show so the water follows it. */
function followMusic(buffer: AudioBuffer) {
  music = analyseMusic(buffer);
  scope.setAudio(buffer, music.onsets);
  setCurves(music.curves);
  rt.setShow(loadShow());
  syncLength();
  labelSections();
  shots = directShow(music, { screenOpening: screenOpening(rt.file) });
  updateSplash();
}

// ---------------------------------------------------------- water sound
// The splash of the water, rendered from the cues (src/audio/splash.ts) and
// played in step with the music; the 水音 button turns it on and off.
let splashOn = true;
function updateSplash() {
  const m = clock.music;
  if (!m || shot) return;
  const t0 = performance.now();
  const buf = renderSplash(rt.show, rt.layout, showLength(), m.sampleRate, music?.curves.level);
  clock.setLayer(buf);
  console.info(`water sound rendered in ${(performance.now() - t0).toFixed(0)} ms`);
  // the fireworks, heard from the audience seat (src/audio/pyro.ts)
  const seat = rt.venue.seats.find((s) => s.id === 'audience') ?? rt.venue.seats[0];
  clock.setPyro(rt.show.bursts.length ? renderPyro(rt.show.bursts, seat.pos, showLength(), m.sampleRate) : null);
}
function setSplash(on: boolean) {
  splashOn = on;
  clock.setLayerLevel(on ? 1 : 0);
  splashBtn.setAttribute('aria-pressed', String(on));
  try {
    localStorage.setItem('water-show-splash', on ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
}

// ---------------------------------------------------------------- camera
// fixed angles (cameras.ts), the automatic camera work, or free orbiting
const cam = rt.stage.camera;
type CamMode = AngleName | 'auto' | 'free';
const CAM_MODES: CamMode[] = [...ANGLE_NAMES, 'auto', 'free'];
const CAM_LABEL = (m: CamMode) => (m === 'auto' ? 'おまかせ' : m === 'free' ? '自由' : ANGLES[m].label);
let camMode: CamMode = 'audience';
/** The automatic camera's shots; replanned once the music is analysed. */
let shots = directShow(null, { screenOpening: screenOpening(rt.file) });
const controls = new OrbitControls(cam, rt.stage.renderer.domElement);
controls.target.copy(applyView(cam, ANGLES.audience));
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495; // stay above the water
controls.enabled = false;
controls.update();

// ----------------------------------------------------------------- clock
const clock = new ShowClock(showLength());
if (q.has('t')) clock.seek(Number(q.get('t')));

declare global {
  interface Window {
    __ready?: boolean;
    __perf?: number;
    __rt?: ShowRuntime;
    __clock?: ShowClock;
  }
}
window.__rt = rt;
window.__clock = clock;

// --------------------------------------------------------- auto quality
// Design doc: drop one tier when the last 60 frames average over 20 ms.
const frameTimes: number[] = [];
let autoQuality = !fixedQuality;
function watchPerformance(dt: number) {
  if (!autoQuality || !clock.playing) return;
  frameTimes.push(dt * 1000);
  if (frameTimes.length < 60) return;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  frameTimes.length = 0;
  if (avg > 20 && tier.quality !== 'low') {
    tier = tier.quality === 'high' ? TIERS.medium : TIERS.low;
    applyTier();
    status(`描画が重いため品質を「${tier.quality === 'medium' ? '中' : '低'}」に下げました（平均 ${avg.toFixed(0)} ms）`);
  }
}
function applyTier() {
  rt.build(tier.quality);
  rt.stage.setResolution(tier.pixelRatio, tier.reflection);
}

// ------------------------------------------------------------------ loop
let last = performance.now();
function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  watchPerformance(dt);
  const t = clock.time();
  // only the free camera runs the orbit controls: their keep-above-the-water
  // limit would lift the fixed angles that look up at the jets to the height
  // of what they look at
  if (camMode === 'auto') applyView(cam, viewAt(shots, t));
  else if (camMode === 'free') controls.update();
  rt.render(t);
  updateBar(t);
  scope.drawOverview(t, showLength());
  if (!scopeEl.hidden) scope.draw(t, rt.show, rt.layout);
}

// screenshots and timings follow the music too: analyse it before rendering
const prepared =
  shot && !q.get('music')
    ? loadShowMusic(new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }))
        .then((m) => m && followMusic(m.buffer))
        .catch((err) => console.error(err))
    : Promise.resolve();

void prepared.then(start);
function start() {
  if (q.has('perf')) {
    const gl = rt.stage.renderer.getContext();
    const px = new Uint8Array(4);
    let t = clock.time();
    for (let i = 0; i < 10; i++) rt.render(t);
    const t0 = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) {
      t += 1 / 60;
      rt.render(t);
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
    // a video on the screen must have its frame before the still is taken
    void rt
      .prepare(clock.time())
      .catch((err) => console.error(err))
      .then(() => requestAnimationFrame(tick));
  } else {
    rt.stage.renderer.setAnimationLoop(frame);
  }
}

// -------------------------------------------------------------------- UI
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const bar = $<HTMLDivElement>('bar');
const seek = $<HTMLInputElement>('seek');
// the range follows the show's length (play.html carries a placeholder)
function syncLength() {
  clock.duration = showLength();
  seek.max = String(showLength());
  for (const id of ['export-from', 'export-to']) $<HTMLInputElement>(id).max = String(showLength());
  $('export-all').textContent = fmt(showLength());
}
const playBtn = $<HTMLButtonElement>('play');
const timeEl = $<HTMLSpanElement>('time');
const statusEl = $<HTMLSpanElement>('status');
const nowSec = $<HTMLSpanElement>('now-sec');
const go = $<HTMLButtonElement>('go');

function status(msg: string) {
  statusEl.textContent = msg;
}

function pressed(group: string, value: string) {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`#${group} button`)) {
    b.setAttribute('aria-pressed', String(b.dataset.v === value));
  }
  if (group === 'cam') $('cam-now').textContent = CAM_LABEL(value as CamMode);
  if (group === 'light' || group === 'quality') {
    const on = (g: string) => document.querySelector<HTMLButtonElement>(`#${g} button[aria-pressed="true"]`)?.textContent ?? '';
    $('view-now').textContent = `${on('light')}・${on('quality')}`;
  }
}

// the camera and view menus: one open at a time, closed by a pick, Esc or a click elsewhere
const menus = [['cam-open', 'cam'], ['view-open', 'view'], ['vol-open', 'vol']] as const;
function openMenu(id: string | null) {
  for (const [btn, pop] of menus) {
    $(pop).hidden = pop !== id;
    $(btn).setAttribute('aria-expanded', String(pop === id));
  }
}
for (const [btn, pop] of menus) $(btn).onclick = () => openMenu($(pop).hidden ? pop : null);
document.addEventListener('pointerdown', (e) => {
  if (!(e.target instanceof Element) || !e.target.closest('.menu')) openMenu(null);
});
const menuOpen = () => menus.some(([, pop]) => !$(pop).hidden);

function setCamera(mode: CamMode) {
  if (!CAM_MODES.includes(mode)) mode = 'audience';
  camMode = mode;
  controls.enabled = mode === 'free';
  // free orbiting starts from wherever the camera is now
  if (mode === 'auto') controls.target.copy(applyView(cam, viewAt(shots, clock.time())));
  else if (mode !== 'free') controls.target.copy(applyView(cam, ANGLES[mode]));
  else {
    const dir = cam.getWorldDirection(new THREE.Vector3());
    controls.target.copy(cam.position).addScaledVector(dir, 60);
    controls.update();
  }
  pressed('cam', mode);
}
// a seat that keeps its width (the fireworks seats) widens or narrows its fov
// with the window; the stage has already set the new aspect
window.addEventListener('resize', () => {
  if (camMode !== 'auto' && camMode !== 'free' && ANGLES[camMode].fitWidth) applyView(cam, ANGLES[camMode]);
});

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
let seeking = false;
function updateBar(t: number) {
  if (!seeking) seek.value = String(t);
  timeEl.textContent = `${fmt(t)} / ${fmt(showLength())}`;
  const sec = spanAt(sectionSpans(rt.file, showLength()), t);
  if (nowSec.textContent !== (sec?.name ?? '')) {
    nowSec.textContent = sec?.name ?? '';
    nowSec.style.setProperty('--sec', sec?.color ?? 'transparent');
  }
  playBtn.textContent = clock.playing ? '❚❚' : '▶';
  playBtn.setAttribute('aria-label', clock.playing ? '一時停止' : '再生');
}

const seekWrap = $<HTMLDivElement>('seek-wrap');
/** Label the seek bar with the show file's sections (src/show/sections.ts). */
function labelSections() {
  for (const el of seekWrap.querySelectorAll('.sec')) el.remove();
  const spans = sectionSpans(rt.file, showLength());
  for (const s of spans) {
    const el = document.createElement('span');
    el.className = 'sec';
    el.style.left = `${(s.from / showLength()) * 100}%`;
    // a label never runs into the next section's
    el.style.width = `${((s.to - s.from) / showLength()) * 100}%`;
    el.textContent = s.name;
    el.title = s.name;
    seekWrap.appendChild(el);
  }
  scope.sectionStarts = spans.map((s) => s.from);
  fitSectionLabels();
}
/** A section too short for its name shows the name a row higher, whole, instead of cut. */
function fitSectionLabels() {
  for (const el of seekWrap.querySelectorAll<HTMLElement>('.sec')) {
    el.classList.remove('up');
    if (el.scrollWidth > el.clientWidth + 1) el.classList.add('up');
  }
}
addEventListener('resize', fitSectionLabels);

// waveform scope (scope.ts): the music over what the stage does, to judge sync
const scopeEl = $<HTMLCanvasElement>('scope');
const waveBtn = $<HTMLButtonElement>('wave');
const scope = new Scope(scopeEl, $<HTMLCanvasElement>('overview'), (t) => clock.seek(t), () => clock.time());
labelSections();
function showScope(on: boolean) {
  scopeEl.hidden = !on;
  waveBtn.setAttribute('aria-pressed', String(on));
  try {
    localStorage.setItem('water-show-scope', on ? '1' : '0');
  } catch {
    /* per-viewer convenience only */
  }
}
waveBtn.onclick = () => showScope(scopeEl.hidden);
const splashBtn = $<HTMLButtonElement>('splash');
splashBtn.onclick = () => setSplash(!splashOn);
// each sound's level (src/audio/levels.ts): sliders in the 音量 menu, kept per viewer
// v2: 100% became the MIX balance (2026-11-03); levels saved before meant something else
const LEVELS_KEY = 'water-show-levels-v2';
const levelInputs = new Map<SoundLayer, HTMLInputElement>();
function setLevel(layer: SoundLayer, v: number, save = true) {
  clock.setLevel(layer, v);
  const input = levelInputs.get(layer);
  if (input) {
    input.value = String(v);
    (input.nextElementSibling as HTMLOutputElement).value = `${Math.round(v * 100)}%`;
  }
  if (!save) return;
  try {
    localStorage.setItem(LEVELS_KEY, JSON.stringify(Object.fromEntries(SOUND_LAYERS.map(({ id }) => [id, clock.level(id)]))));
  } catch {
    /* per-viewer convenience only */
  }
}
for (const { id, label } of SOUND_LAYERS) {
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', min: '0', max: String(LEVEL_MAX), step: '0.05' });
  input.setAttribute('aria-label', `${label}の音量`);
  input.oninput = () => setLevel(id, Number(input.value));
  const row = document.createElement('label');
  row.append(label, input, document.createElement('output'));
  $('vol-rows').append(row);
  levelInputs.set(id, input);
}
$('vol-reset').onclick = () => SOUND_LAYERS.forEach(({ id }) => setLevel(id, DEFAULT_LEVELS[id]));
{
  let saved: Partial<Record<SoundLayer, number>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}');
  } catch {
    /* start from the defaults */
  }
  for (const { id } of SOUND_LAYERS) {
    const v = Number(saved[id]);
    setLevel(id, Number.isFinite(v) ? Math.min(LEVEL_MAX, Math.max(0, v)) : DEFAULT_LEVELS[id], false);
  }
}
try {
  setSplash(localStorage.getItem('water-show-splash') !== '0');
} catch {
  setSplash(true);
}
try {
  showScope(localStorage.getItem('water-show-scope') === '1');
} catch {
  /* closed by default */
}

function togglePlay() {
  if (clock.playing) clock.pause();
  else void clock.play();
}
playBtn.onclick = togglePlay;
seek.oninput = () => {
  seeking = true;
  clock.seek(Number(seek.value));
};
seek.onchange = () => (seeking = false);

for (const b of document.querySelectorAll<HTMLButtonElement>('#light button')) {
  b.onclick = () => {
    rt.setLighting(b.dataset.v as LightingMode);
    pressed('light', b.dataset.v!);
  };
}
pressed('light', rt.lightingMode);
const camGroup = $<HTMLSpanElement>('cam');
CAM_MODES.forEach((m, i) => {
  const b = document.createElement('button');
  b.dataset.v = m;
  b.textContent = CAM_LABEL(m);
  // keys 1-9 and 0 for the first ten
  if (i < 10) {
    const key = document.createElement('kbd');
    key.textContent = String((i + 1) % 10);
    b.appendChild(key);
  }
  b.onclick = () => {
    setCamera(m);
    openMenu(null);
  };
  camGroup.appendChild(b);
});
setCamera((q.get('cam') as CamMode | null) ?? 'audience');
// ?view=x,y,z,tx,ty,tz[,fov]: a fixed camera for comparison shots (stage 7,
// matching a reference video's angle)
const viewArg = q.get('view')?.split(',').map(Number);
if (viewArg && viewArg.length >= 6 && viewArg.every(Number.isFinite)) {
  camMode = 'audience';
  controls.enabled = false;
  const [x, y, z, tx, ty, tz, fov] = viewArg;
  controls.target.copy(applyView(cam, { pos: [x, y, z], target: [tx, ty, tz], fov: fov ?? 45 }));
}
for (const b of document.querySelectorAll<HTMLButtonElement>('#quality button')) {
  b.onclick = () => {
    const v = b.dataset.v!;
    autoQuality = v === 'auto';
    tier = TIERS[autoQuality ? 'high' : (v as Quality)];
    applyTier();
    status('');
    pressed('quality', v);
  };
}
pressed('quality', fixedQuality ?? 'auto');

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (!exportBox.hidden) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  } else if (/^Digit[0-9]$/.test(e.code)) {
    const m = CAM_MODES[(Number(e.code.slice(5)) + 9) % 10];
    if (m) setCamera(m);
  } else if (e.code === 'ArrowRight') clock.seek(clock.time() + 5);
  else if (e.code === 'ArrowLeft') clock.seek(clock.time() - 5);
  else if (e.code === 'KeyW') showScope(scopeEl.hidden);
  else if (e.code === 'KeyS') setSplash(!splashOn);
  else if (e.code === 'Escape') openMenu(null);
  else if (e.code === 'KeyL') {
    const next: LightingMode = rt.lightingMode === 'real' ? 'ideal' : 'real';
    rt.setLighting(next);
    pressed('light', next);
  }
});

// hide the bar while the show plays and the pointer rests
let idleTimer = 0;
function wake() {
  bar.classList.remove('idle');
  clearTimeout(idleTimer);
  // the bar stays up while the waveform is open: it is watched during playback
  idleTimer = window.setTimeout(() => clock.playing && scopeEl.hidden && !menuOpen() && bar.classList.add('idle'), 2500);
}
window.addEventListener('pointermove', wake);
window.addEventListener('keydown', wake);
clock.onEnd = () => {
  bar.classList.remove('idle');
  status('おしまい');
};

// ------------------------------------------------------------------ music
// Background music: public/music/background.mp3 (or .m4a/.ogg/.wav), or a
// file picked on the start screen. ?music=score / ?music=original still
// generate the two composed scores.
if (!shot) {
  const ready = () => {
    go.disabled = false;
    go.textContent = '▶ 再生';
  };
  const generated = q.get('music');
  if (generated === 'score' || generated === 'original') {
    const t0 = performance.now();
    (generated === 'original' ? import('../audio/original-score') : import('../audio/score'))
      .then((m) => m.renderScore())
      .then((buffer) => {
        clock.setBuffer(buffer, new AudioContext());
        updateSplash();
        $('start-status').textContent = `音楽の準備ができました（${((performance.now() - t0) / 1000).toFixed(1)} 秒）`;
      })
      .catch((err) => {
        console.error(err);
        $('start-status').textContent = '音楽を生成できませんでした。無音で再生します';
      })
      .finally(ready);
  } else {
    const ctx = new AudioContext();
    loadShowMusic(ctx)
      .then((m) => {
        if (m) {
          clock.setBuffer(m.buffer, ctx);
          followMusic(m.buffer);
          $('start-status').textContent = `音楽：${m.name}（波形に合わせました）`;
        } else {
          $('start-status').textContent = '音楽なし（ファイルを選ぶか public/music/background.mp3 を置く）';
        }
      })
      .catch((err) => {
        console.error(err);
        $('start-status').textContent = '音楽を読み込めませんでした。無音で再生します';
      })
      .finally(ready);
    $<HTMLInputElement>('music-file').onchange = (ev) => {
      const file = (ev.target as HTMLInputElement).files?.[0];
      if (!file) return;
      $('start-status').textContent = `読み込み中：${file.name}`;
      decodeFile(file, ctx, showLength())
        .then((m) => {
          clock.setBuffer(m.buffer, ctx);
          followMusic(m.buffer);
          $('start-status').textContent = `音楽：${m.name}（波形に合わせました）`;
        })
        .catch((err) => {
          console.error(err);
          $('start-status').textContent = `読み込めませんでした：${file.name}`;
        });
    };
  }
}
go.onclick = () => {
  $('start').remove();
  void clock.play();
  wake();
};

// ------------------------------------------------------------ video export
// The show drawn frame by frame at a fixed size (src/export/video.ts), from
// one angle or with the automatic camera work, with the music. Or, for Apple
// Vision Pro, a stereo 180° movie from one seat (src/export/vr180-video.ts).
const exportBox = $<HTMLDivElement>('export');
const exportForm = $<HTMLFormElement>('export-form');
const angleSel = $<HTMLSelectElement>('export-angle');
const exportCancel = $<HTMLButtonElement>('export-cancel');
const exportGo = $<HTMLButtonElement>('export-go');
const exportProgress = $<HTMLProgressElement>('export-progress');
const exportState = $<HTMLParagraphElement>('export-state');
const exportError = $<HTMLParagraphElement>('export-error');
for (const n of ANGLE_NAMES) angleSel.add(new Option(ANGLES[n].label, n));
syncLength();
angleSel.add(new Option('今の視点（自由カメラ）', 'current'));
const field = (name: string) => exportForm.elements.namedItem(name) as RadioNodeList;
let exporting: AbortController | null = null;

declare global {
  interface Window {
    /** The last export, for scripts/export-check.mjs. */
    __export?: { bytes: number; frames: number; seconds: number; output?: string; error?: string };
  }
}

function exportSettings() {
  const [width, height] = $<HTMLSelectElement>('export-size').value.split('x').map(Number);
  const fps = Number($<HTMLSelectElement>('export-fps').value);
  let from = 0;
  let to = showLength();
  if (field('range').value === 'part') {
    from = Math.min(Math.max(Number($<HTMLInputElement>('export-from').value) || 0, 0), showLength() - 0.5);
    to = Math.min(Math.max(Number($<HTMLInputElement>('export-to').value) || 0, from + 0.5), showLength());
  }
  const vr = field('format').value === 'vr180';
  const eye = Number($<HTMLSelectElement>('export-eye').value);
  // a moving camera in a headset is a quick way to feel sick: 180° stays put
  // stage 7 H1: every export takes the export-only tier, a sharper
  // reflection and motion blur (no switch: improvements that change no show
  // content go into every version and every export)
  const hq = true;
  return { width, height, fps, from, to, auto: !vr && field('camera').value === 'auto', angle: angleSel.value, vr, eye, hq };
}

function updateExportNote() {
  const o = exportSettings();
  const frames = Math.round((o.to - o.from) * o.fps);
  const sound = clock.music
    ? `音楽${splashOn && clock.layerBuffer ? '＋水音' : ''}${clock.pyroBuffer ? '＋花火の音' : ''}つき`
    : '音楽なし（無音）';
  const light = rt.lightingMode === 'real' ? 'リアル' : '理想';
  exportError.hidden = true;
  exportForm.classList.toggle('vr', o.vr);
  if (o.vr && field('camera').value === 'auto') field('camera').value = 'fixed';
  if (o.vr) {
    // measured on this Mac (docs/vr180-analysis.md): seconds per frame, both eyes, plus the converter
    // measured without stage 7's export look; with it (×3 drops, 4 renders a
    // frame) a video took about 5 times as long, so the same is assumed here
    const perFrame = (o.eye > 4096 ? 1.0 : 0.24) * (o.hq ? 5 : 1);
    const gb = (vr180BytesPerSecond(o.eye) * (o.to - o.from)) / 1e9;
    $('export-note').textContent = `${fmt(o.from)}〜${fmt(o.to)}・${frames.toLocaleString()}コマ・${sound}・照明「${light}」。所要 約 ${fmt(frames * perFrame)}、ファイル 約 ${gb.toFixed(1)} GB（exports/visionpro/ に保存）。書き出し中はこのタブを開いたままにしてください`;
  } else {
    $('export-note').textContent = `${fmt(o.from)}〜${fmt(o.to)}・${frames.toLocaleString()}コマ・${sound}・照明「${light}」。1コマずつ描くので、ショーの長さより時間がかかります`;
  }
}
exportForm.addEventListener('input', updateExportNote);

function openExport() {
  clock.pause();
  field('camera').value = camMode === 'auto' ? 'auto' : 'fixed';
  angleSel.value = camMode === 'free' ? 'current' : camMode === 'auto' ? 'audience' : camMode;
  $('export-settings').hidden = false;
  $('export-run').hidden = true;
  $('export-done').hidden = true;
  exportGo.hidden = false;
  exportCancel.textContent = '閉じる';
  exportBox.hidden = false;
  updateExportNote();
}
$<HTMLButtonElement>('export-open').onclick = openExport;
exportCancel.onclick = () => {
  if (exporting) exporting.abort();
  else exportBox.hidden = true;
};
exportForm.onsubmit = (e) => {
  e.preventDefault();
  void runExport();
};

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

async function runExport() {
  const o = exportSettings();
  const view =
    o.angle === 'current'
      ? { pos: cam.position.toArray(), target: controls.target.toArray(), fov: cam.fov }
      : ANGLES[o.angle as AngleName];
  const camera = o.auto ? (t: number) => applyView(cam, viewAt(shots, t)) : () => applyView(cam, view);

  // take the stage over: no live loop, full quality, the video's size
  exporting = new AbortController();
  rt.stage.renderer.setAnimationLoop(null);
  const exportTier = o.hq ? 'export' : 'high';
  if (rt.qualityTier !== exportTier) rt.build(exportTier);
  screen.every = 1;
  // the 180° export draws into its own targets; the stage canvas stays as it is
  if (o.vr) screen.resize(...vr180Projector(o.eye));
  else rt.stage.setFixedSize([o.width, o.height]);
  rt.stage.setResolution(1, TIERS[exportTier].reflection === 1 ? 1 : 0.5);
  document.body.classList.add('exporting');
  $('export-settings').hidden = true;
  $('export-run').hidden = false;
  exportGo.hidden = true;
  exportCancel.textContent = '中止';
  exportProgress.value = 0;
  exportState.textContent = '準備中…';

  const t0 = performance.now();
  const elapsed = () => (performance.now() - t0) / 1000;
  const tag = o.auto ? 'auto' : o.angle;
  const name = `night-lagoon_${tag}_${rt.lightingMode}_${o.height}p${o.fps}_${Math.round(o.from)}-${Math.round(o.to)}s.mp4`;
  // each sound at the level the 音量 menu shows
  let music = clock.music ? mixSplash(clock.music, splashOn ? clock.layerBuffer : null, clock.gainOf('water'), clock.gainOf('music')) : null;
  if (music && clock.pyroBuffer) music = mixSplash(music, clock.pyroBuffer, clock.gainOf('pyro'));
  // never clipping, as the player's limiter does
  if (music) limit([music.getChannelData(0), music.getChannelData(1)], music.sampleRate, OUTPUT_CEILING);
  try {
    if (o.vr) {
      const seat = new THREE.Vector3(...view.pos);
      // level, toward the angle's target: the horizon must stay level in a headset
      const yaw = Math.atan2(-(view.target[0] - seat.x), -(view.target[2] - seat.z));
      const r = await exportVr180(rt, {
        ...o,
        blur: o.hq,
        seat,
        yaw,
        music,
        name: `night-lagoon_vr180_${tag}_${rt.lightingMode}_${o.eye}_${o.fps}fps_${Math.round(o.from)}-${Math.round(o.to)}s.mov`,
        signal: exporting.signal,
        onProgress({ rendered, converted, total }) {
          // drawing leads; the converter follows a little behind and finishes last
          exportProgress.value = (rendered + converted) / (2 * total);
          const done = Math.max(1, rendered);
          const left = rendered < total ? (elapsed() / done) * (total - rendered) : 0;
          exportState.textContent =
            rendered < total
              ? `描画 ${rendered.toLocaleString()} / ${total.toLocaleString()} コマ・変換 ${converted.toLocaleString()}・経過 ${fmt(elapsed())}・残り約 ${fmt(left)}`
              : `Vision Pro 用に変換中 ${converted.toLocaleString()} / ${total.toLocaleString()} コマ・経過 ${fmt(elapsed())}`;
        },
      });
      exportProgress.value = 1;
      window.__export = { bytes: r.bytes, frames: Math.round((o.to - o.from) * o.fps), seconds: elapsed(), output: r.output };
      exportState.textContent = `書き出しました：${r.output}（${(r.bytes / 1e9).toFixed(2)} GB・${fmt(elapsed())}）。AirDrop で Vision Pro に送ると、写真アプリで立体で見られます`;
      $('export-done').hidden = false;
      $<HTMLButtonElement>('export-reveal').onclick = r.reveal;
      return;
    }
    const blob = await exportVideo(rt, {
      ...o,
      blur: o.hq,
      camera,
      music,
      signal: exporting.signal,
      onProgress(done, total) {
        exportProgress.value = done / total;
        const left = (elapsed() / done) * (total - done);
        exportState.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} コマ・経過 ${fmt(elapsed())}・残り約 ${fmt(left)}`;
      },
    });
    download(blob, name);
    window.__export = { bytes: blob.size, frames: Math.round((o.to - o.from) * o.fps), seconds: elapsed() };
    exportState.textContent = `書き出しました：${name}（${(blob.size / 1e6).toFixed(1)} MB・${fmt(elapsed())}）`;
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    if (!aborted) console.error(err);
    exportState.textContent = aborted ? '中止しました' : '';
    exportError.hidden = aborted;
    exportError.textContent = `書き出せませんでした：${err instanceof Error ? err.message : String(err)}`;
    window.__export = { bytes: 0, frames: 0, seconds: elapsed(), error: String(err) };
  } finally {
    exporting = null;
    document.body.classList.remove('exporting');
    exportCancel.textContent = '閉じる';
    rt.stage.setFixedSize(null);
    screen.resize(Number(q.get('pw') ?? 1536), Number(q.get('ph') ?? 288));
    if (rt.qualityTier !== tier.quality) rt.build(tier.quality);
    screen.every = still ? 1 : 2;
    rt.stage.setResolution(shot ? 1 : tier.pixelRatio, tier.reflection);
    setCamera(camMode);
    if (!shot) rt.stage.renderer.setAnimationLoop(frame);
  }
}
