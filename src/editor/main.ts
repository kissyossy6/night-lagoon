import type { LightingMode } from '../core/nozzles';
import { analyseMusic, estimateTempo, type MusicFeatures } from '../audio/analysis';
import { MAIN_SHOW, SHOW_VARIANTS, buildShow, extendToMusic, type ShowVariant } from '../show/choreography';
import { SHOW_DURATION } from '../show/song';
import { setCurves } from '../show/cues';
import type { Quality } from '../show/layout';
import { sectionSpans, spanAt } from '../show/sections';
import type { ShowFile } from '../show/types';
import { setupControlExport } from './control-export';
import { Inspector } from './inspector';
import { barBeatLabel, clockLabel, clone, cueLabel, emptyShow, encodeTime, normaliseShow, secPerBar, secPerBeat, snapToBeat, startOf, useVenue, LANES, LAYOUT, laneOf } from './model';
import { compileShow, resolveTarget, CHANNELS, type CompiledShow } from '../show/cues';
import { resolveTubes } from '../pyro/schedule';
import { checkShow, pictureMap, type Check } from '../show/checks';
import { EditorView, TABS, folderOfLane, type TabId } from './view';
import { WarningsPanel } from './warnings';
import { getVenue, loadMyVenues, VENUE_DOCS } from '../venues';
import { cueReach } from '../venues/cues';
import { Preview } from './preview';
import { EditorState, MAX_HISTORY } from './state';
import { Timeline } from './timeline';
import { Transport } from './transport';
import { isSampleId, musicUrl, projectStore, setLastProject, type ProjectStore } from '../projects/store';
import type { ProjectDoc } from '../projects/types';

/**
 * Timeline editor (edit.html): preview on top, timeline below, inspector on
 * the right. Every edit hot-reloads the show into the preview.
 *
 * URL: ?project=<id> edits that project (docs/projects-plan.md) and saves it
 *   there. Without it the editor is a scratch pad for checks (scripts/): it
 *   keeps the old single autosave in this browser; ?fresh ignores that.
 *   &t=42 (start time)
 */

const STORE_KEY = 'water-show-editor:v1';
const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ----------------------------------------------------------------- project

const projectId = q.get('project');
let project: ProjectDoc | null = null;
let store: ProjectStore | null = null;
if (projectId) {
  try {
    if (isSampleId(projectId)) throw new Error('見本はそのまま編集できません。一覧で「この見本から作る」を選んでください');
    store = await projectStore();
    project = await store.get(projectId);
    setLastProject(projectId);
  } catch (err) {
    alert(`プロジェクトを開けませんでした：${err instanceof Error ? err.message : err}`);
    location.replace('/#projects');
    await new Promise(() => {}); // stop here while the page goes
  }
}
/** While the project has no show yet: the version to generate once the music is analysed. */
const generate = project && !project.show ? (project.generate ?? 'lagoon') : null;

// ---------------------------------------------------------------- document

function loadAutosave(): ShowFile | null {
  if (project) {
    try {
      return project.show ? normaliseShow(project.show) : null;
    } catch {
      return null;
    }
  }
  if (q.has('fresh')) return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? normaliseShow(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const autosave = loadAutosave();
// an autosave from before the music grew to its real ending gets the new ending
const extended = autosave ? extendToMusic(autosave) : null;
const restored = extended ?? autosave;
function firstShow(): ShowFile {
  if (restored) return restored;
  if (generate === 'empty') return emptyShow();
  if (generate) return buildShow(undefined, generate);
  return MAIN_SHOW;
}
const state = new EditorState(firstShow());
// the project's name is the show's title (the player, the exports' file names)
if (project) state.file.title = project.name;
// what the show was before any edit, the venue left out: once the music is
// analysed the show is rebuilt only if nothing but the venue changed meanwhile
const withoutVenue = (f: ShowFile) => JSON.stringify({ ...f, venue: undefined });
const openedAs = withoutVenue(state.file);

// the venue the editor works in follows the file's `venue` (switching, undo,
// loading a file); registered before the timeline so it lays out the new lanes
useVenue(getVenue(state.file.venue));
state.on((e) => {
  if (e.kind === 'file') useVenue(getVenue(state.file.venue));
});
const transport = new Transport(state.file.duration);
// tabs, folders, S/M: how the page is looked at (not in the show file)
const view = new EditorView();

// ----------------------------------------------------------------- preview

const quality = (q.get('quality') as Quality) ?? 'medium';
($('quality-sel') as HTMLSelectElement).value = quality;
const preview = new Preview($('preview'), quality, Number(q.get('pr') ?? 0.75));
// the 3D draws the show without the folders S/M leave out (view.filter)
preview.setShow(view.filter(state.file));

let applyTimer = 0;
function scheduleApply(delay: number) {
  clearTimeout(applyTimer);
  applyTimer = window.setTimeout(() => {
    preview.setShow(view.filter(state.file));
    updatePreviewTag();
  }, delay);
}

let saveTimer = 0;
let unsaved = false;
/** Saves one after another, so an older one never lands after a newer one. */
let saving: Promise<boolean> = Promise.resolve(true);
function saveNow(): Promise<boolean> {
  clearTimeout(saveTimer);
  saving = saving.then(saveOnce);
  return saving;
}
async function saveOnce(): Promise<boolean> {
  if (project && store) {
    if (!unsaved) return true;
    unsaved = false;
    const doc: ProjectDoc = { ...project, show: state.file };
    delete doc.generate;
    setStatus('save-status', '保存中…');
    try {
      await store.save(doc);
      project = doc;
      setStatus('save-status', '自動保存済み', 'ok');
      return true;
    } catch (err) {
      unsaved = true;
      setStatus('save-status', '保存できません', 'warn');
      toast(`保存できませんでした：${err instanceof Error ? err.message : err}`);
      return false;
    }
  }
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state.file));
    setStatus('save-status', '自動保存済み（確認用）', 'ok');
    return true;
  } catch {
    setStatus('save-status', '自動保存できません', 'warn');
    return false;
  }
}
function scheduleSave() {
  unsaved = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveNow(), project ? 800 : 400);
}
// leaving with an edit not yet written: the browser asks first
window.addEventListener('beforeunload', (e) => {
  if (project && unsaved) {
    void saveNow();
    e.preventDefault();
  }
});

state.on((e) => {
  if (e.kind !== 'file') return;
  // the inspector's タイトル is the project's name
  if (project && state.file.title.trim() && state.file.title !== project.name) {
    project = { ...project, name: state.file.title.trim() };
    showName();
  }
  transport.duration = state.file.duration;
  scheduleApply(e.live ? 100 : 0);
  scheduleSave();
  updateUndo();
});

// ---------------------------------------------------------------- timeline

const timeline = new Timeline($('timeline'), state, transport, view);

const actions = {
  duplicate() {
    const sel = state.selected();
    if (!sel.length) return;
    const f = state.file;
    const shift = secPerBar(f);
    const added: number[] = [];
    state.mutate(
      (file) => {
        for (const i of sel) {
          const c = clone(file.cues[i]);
          const t = startOf(c, file);
          c.t = encodeTime((Number.isFinite(t) ? t : 0) + shift, file);
          file.cues.push(c);
          added.push(file.cues.length - 1);
        }
      },
      { structural: true },
    );
    state.setSelection(added, added[0]);
    toast(`${added.length} 個のキューを 1 小節後に複製しました`);
  },
  remove() {
    const sel = state.selected();
    if (!sel.length) return;
    state.remove(sel);
    toast(`${sel.length} 個のキューを削除しました`);
  },
  playheadTime: () => transport.now(),
  snapTime: (t: number) => encodeTime(snapToBeat(t, state.file), state.file),
  seek: (t: number) => transport.seek(t),
  music: {
    blocked: () => (project && store && !isSampleId(project.id) ? null : 'プロジェクトとして開くと、曲を入れられます'),
    pick: (file: File) => void pickMusic(file),
    reset: () => resetMusic(),
    loaded: () => (transport.music === 'ready' ? transport.musicName : transport.music === 'loading' ? '読み込み中…' : 'なし'),
    tempo: () => musicTempo(),
  },
};

// the analysed music (declared before the inspector, which reads its beat)
let music: MusicFeatures | null = null;
let musicSettled = false;
/** The beat measured in the project's own music, once analysed (a hint for BPM and offset). */
let tempoOf: { music: MusicFeatures; tempo: ReturnType<typeof estimateTempo> } | null = null;
const inspector = new Inspector($('inspector'), state, actions);
// the music row says when the music has loaded (and its beat, once measured)
let musicShown = '';
transport.onChange(() => {
  const k = `${transport.music}|${transport.musicName}`;
  if (k === musicShown) return;
  musicShown = k;
  inspector.update();
});

// ------------------------------------------------------------------ header

function setStatus(id: string, text: string, kind: '' | 'ok' | 'warn' = '') {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`;
}

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2200);
}

function updateUndo() {
  ($('undo-btn') as HTMLButtonElement).disabled = !state.canUndo;
  ($('redo-btn') as HTMLButtonElement).disabled = !state.canRedo;
}
updateUndo();

function updatePreviewTag() {
  const err = preview.error ? `  ⚠ ${preview.error}` : '';
  const only = view.filterLabel();
  $('preview-tag').textContent = `${state.file.title} · ${state.file.cues.length} キュー · 反映 ${preview.compileMs.toFixed(0)} ms${only ? ` · ${only}` : ''}${err}`;
}
updatePreviewTag();

/** Undo; at the oldest kept step, say so if older steps were dropped (MAX_HISTORY). */
function undo() {
  state.undo();
  if (!state.canUndo && state.dropped > 0)
    toast(`ここより前には戻せません（元に戻せるのは直近 ${MAX_HISTORY} 回まで。それより前の ${state.dropped} 回分は消えています）`);
}
$('undo-btn').addEventListener('click', undo);
$('redo-btn').addEventListener('click', () => state.redo());
$('play-btn').addEventListener('click', () => transport.toggle());
$('home-btn').addEventListener('click', () => transport.seek(0));
$('cam-btn').addEventListener('click', () => preview.resetCamera());
// 本番で再生: the player reads the saved project, so save first. The window is
// opened at once (still inside the click) and pointed at the player after the save
$('show-btn').addEventListener('click', async () => {
  const light = $('light-seg').querySelector<HTMLButtonElement>('button.on')?.dataset.mode ?? 'real';
  const win = window.open('', 'water-show-play');
  const ok = await saveNow();
  if (!ok) {
    win?.close();
    toast('保存できないため本番画面に渡せません');
    return;
  }
  const url = project ? `/play.html?project=${encodeURIComponent(project.id)}&light=${light}` : `/play.html?show=edited&light=${light}`;
  if (win) win.location.href = url;
  else window.open(url, 'water-show-play');
});
($('mute-chk') as HTMLInputElement).addEventListener('change', (e) => transport.setMuted((e.target as HTMLInputElement).checked));
($('quality-sel') as HTMLSelectElement).addEventListener('change', (e) => {
  preview.setQuality((e.target as HTMLSelectElement).value as Quality);
  (e.target as HTMLElement).blur();
});
for (const b of $('light-seg').querySelectorAll<HTMLButtonElement>('button')) {
  b.addEventListener('click', () => {
    preview.setLighting(b.dataset.mode as LightingMode);
    for (const o of $('light-seg').querySelectorAll('button')) o.classList.toggle('on', o === b);
    b.blur();
  });
}
// buttons should not keep focus (Space must stay play/pause)
for (const b of document.querySelectorAll<HTMLButtonElement>('#bar button')) b.addEventListener('mouseup', () => b.blur());

transport.onChange(() => {
  $('play-btn').textContent = transport.playing ? '❚❚' : '▶';
  $('play-btn').classList.toggle('on', transport.playing);
  const m = transport.music;
  if (m === 'ready') setStatus('music-status', '♪ 音楽と同期', 'ok');
  else if (m === 'none') setStatus('music-status', '音楽なし', 'warn');
  else setStatus('music-status', '音楽を読み込み中…');
});

// ------------------------------------------------------------- file menu

const pop = $('file-pop');
// one 読み込む button a version (choreography.ts SHOW_VARIANTS), after 新規ショー
{
  const after = pop.querySelector('[data-act="new"]')!;
  const items = SHOW_VARIANTS.map((v) => {
    const b = document.createElement('button');
    b.dataset.act = 'variant';
    b.dataset.variant = v.id;
    const name = v.note ? `${v.short} (${v.note})` : v.short;
    // a space after a Latin name, none after a Japanese one
    b.textContent = `${name}${/[A-Za-z)]$/.test(name) ? ' ' : ''}で置き換える`;
    return b;
  });
  after.after(...items);
}
$('file-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  pop.hidden = !pop.hidden;
});
document.addEventListener('click', () => (pop.hidden = true));

function exportJson() {
  const blob = new Blob([JSON.stringify(state.file, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.file.title || 'show').replace(/[\\/:*?"<>|\s]+/g, '_')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('JSON を書き出しました');
}

pop.addEventListener('click', (e) => {
  const act = (e.target as HTMLElement).dataset.act;
  pop.hidden = true;
  e.stopPropagation();
  switch (act) {
    case 'new':
      state.load(project ? { ...emptyShow(state.file), title: project.name } : emptyShow(state.file));
      toast('空のショーにしました (元に戻す: ⌘/Ctrl+Z)');
      break;
    case 'duplicate':
      void duplicateProject();
      break;
    case 'variant': {
      // the built-in versions; the current document stays one undo away
      const id = ((e.target as HTMLElement).dataset.variant ?? 'lagoon') as ShowVariant;
      const label = SHOW_VARIANTS.find((v) => v.id === id)?.label ?? id;
      state.load(project ? { ...buildShow(music ?? undefined, id), title: project.name } : buildShow(music ?? undefined, id));
      toast(`${label} を読み込みました${music ? '（音楽の波形に合わせて生成）' : ''} (元に戻す: ⌘/Ctrl+Z)`);
      break;
    }
    case 'import':
      $('import-input').click();
      break;
    case 'export':
      exportJson();
      break;
  }
});

($('import-input') as HTMLInputElement).addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const show = normaliseShow(JSON.parse(await file.text()));
    state.load(project ? { ...show, title: project.name } : show);
    toast(`「${show.title}」を読み込みました (${show.cues.length} キュー)`);
  } catch (err) {
    toast(`読み込めませんでした: ${err instanceof Error ? err.message : err}`);
  }
});

// ---------------------------------------------------------- project header

const nameBtn = $<HTMLButtonElement>('project-name');
const backLink = $<HTMLAnchorElement>('back-link');
function showName() {
  nameBtn.textContent = project ? project.name : '確認用（プロジェクトなし）';
  nameBtn.disabled = !project;
  nameBtn.title = project ? 'クリックで名前を変える' : 'プロジェクトを開いていません。ここでの変更はこのブラウザの確認用の保存にだけ入ります';
  document.title = project ? `${project.name} — エディタ` : 'エディタ — Night Lagoon';
  $('dup-btn').textContent = project ? '複製して別のプロジェクトにする' : 'プロジェクトとして保存';
}
showName();

// the name: click to type a new one (Enter keeps it, Esc goes back)
nameBtn.addEventListener('click', () => {
  if (!project) return;
  const input = document.createElement('input');
  input.className = 'pname-input';
  input.value = project.name;
  input.maxLength = 80;
  input.setAttribute('aria-label', 'プロジェクトの名前');
  nameBtn.hidden = true;
  nameBtn.after(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.remove();
    nameBtn.hidden = false;
    nameBtn.focus();
    if (!keep || !project || !v || v === project.name) return;
    // through the document, so the inspector's タイトル follows (the file listener renames the project and saves)
    state.mutate((f) => (f.title = v));
    updatePreviewTag();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
});

// ← 一覧: save (and take the list's picture) before leaving
backLink.addEventListener('click', async (e) => {
  if (!project) return;
  e.preventDefault();
  await takeThumb();
  if (await saveNow()) location.href = backLink.href;
  else toast('保存できないため、まだ一覧に戻りません');
});

/** ファイル ▾ 複製: a copy of what is open becomes a new project, opened here. */
async function duplicateProject() {
  try {
    const s = store ?? (await projectStore());
    if (project) {
      if (!(await saveNow())) return;
      const copy = await s.duplicate(project.id, `${project.name} のコピー`);
      location.href = `/edit.html?project=${encodeURIComponent(copy.id)}`;
    } else {
      const name = state.file.title && state.file.title !== '新しいショー' ? state.file.title : '確認用から保存';
      const doc = await s.create({ name, show: { ...state.file, title: name } });
      location.href = `/edit.html?project=${encodeURIComponent(doc.id)}`;
    }
  } catch (err) {
    toast(`作れませんでした：${err instanceof Error ? err.message : err}`);
  }
}

// the list's picture: the 3D as it is now (taken only once something is on stage)
let thumbAt = 0;
/** Draw the 3D once more now (the canvas keeps no picture between frames) and keep it. */
function takeThumb(): Promise<boolean> {
  if (!project || !store || transport.now() < 5) return Promise.resolve(false);
  preview.invalidate();
  preview.frame(transport.now());
  return new Promise((ok) => captureThumb(ok));
}
function captureThumb(done: (ok: boolean) => void) {
  const src = preview.rt.stage.renderer.domElement;
  const W = 480;
  const H = 270;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g || !src.width || !src.height) return done(false);
  // fill 16:9 from the middle of the 3D
  const s = Math.max(W / src.width, H / src.height);
  const sw = W / s;
  const sh = H / s;
  g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, W, H);
  thumbAt = performance.now();
  c.toBlob(
    (b) => {
      if (!b || !project || !store) return done(false);
      store.saveThumb(project.id, b).then(
        () => done(true),
        () => done(false),
      );
    },
    'image/jpeg',
    0.82,
  );
}
// a new picture when playback stops, and every minute while it plays
transport.onChange(() => {
  if (!transport.playing && performance.now() - thumbAt > 5000) void takeThumb();
});
setInterval(() => {
  if (transport.playing && performance.now() - thumbAt > 60000) void takeThumb();
}, 15000);

// the same project open in two tabs: the later save would win, so say so
if (project && 'BroadcastChannel' in window) {
  const ch = new BroadcastChannel('water-show-projects');
  const me = Math.random().toString(36).slice(2);
  ch.onmessage = (e: MessageEvent<{ id: string; from: string; reply?: boolean }>) => {
    if (!project || e.data.id !== project.id || e.data.from === me) return;
    toast('このプロジェクトは別のタブのエディタでも開いています。どちらか一方を閉じてください（後から保存したほうが残ります）');
    if (!e.data.reply) ch.postMessage({ id: project.id, from: me, reply: true });
  };
  ch.postMessage({ id: project.id, from: me });
}

// ---------------------------------------------------------------- keyboard

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  if (t instanceof HTMLInputElement) return !['checkbox', 'range', 'color', 'button'].includes(t.type);
  return t.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    if (isTyping(e.target)) return;
    e.preventDefault();
    if (e.shiftKey) state.redo();
    else undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    if (isTyping(e.target)) return;
    e.preventDefault();
    state.redo();
    return;
  }
  if (isTyping(e.target)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    transport.toggle();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    actions.remove();
  } else if (mod && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    actions.duplicate();
  } else if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    state.setSelection(state.file.cues.map((_, i) => i), state.primary >= 0 ? state.primary : 0);
  } else if (e.key === 'Escape') {
    state.setSelection([], -1);
  } else if (e.key === 'Home') {
    transport.seek(0);
  } else if (e.key === 'End') {
    transport.seek(state.file.duration);
  } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.selection.size) {
    e.preventDefault();
    const f = state.file;
    const step = (e.altKey ? 0.05 : secPerBeat(f)) * (e.key === 'ArrowLeft' ? -1 : 1);
    state.mutate(
      (file) => {
        for (const i of state.selection) {
          const t = startOf(file.cues[i], file);
          if (Number.isFinite(t)) file.cues[i].t = encodeTime(Math.max(0, Math.round((t + step) * 1000) / 1000), file);
        }
      },
      { key: 'nudge', source: 'keys' },
    );
  } else if (e.key === '=' || e.key === '+') {
    timeline.zoomBy(1.25);
  } else if (e.key === '-') {
    timeline.zoomBy(0.8);
  }
});

// -------------------------------------------------------------- main loop

const clockBar = $('clock-bar');
const clockSec = $('clock-sec');
const chip = $('section-chip');
let lastClock = -1;
// a renamed or moved section shows in the chip even while paused
state.on(() => {
  lastClock = -1;
});

function frame() {
  let t = transport.now();
  if (transport.playing && t >= state.file.duration) {
    transport.pause();
    transport.seek(state.file.duration);
    t = state.file.duration;
  }
  preview.frame(t);
  timeline.tick(t, transport.playing);
  if (t !== lastClock) {
    lastClock = t;
    clockBar.textContent = barBeatLabel(t, state.file);
    clockSec.textContent = clockLabel(t);
    const s = spanAt(sectionSpans(state.file, state.file.duration), t);
    chip.textContent = s?.name ?? '';
    chip.style.setProperty('--sec', s?.color ?? 'var(--c-chip-bg)');
  }
}

if (q.has('t')) transport.seek(Number(q.get('t')));
preview.rt.stage.renderer.setAnimationLoop(frame);

// music: optional; the editor works silently without it. Once loaded its
// waveform is analysed, so 'follow' cues preview against the real music and
// the built-in show is rebuilt to follow it (unless an autosave was restored)
// the project's own music (docs/music-plan.md), else the shared recording
const musicKey = () => state.file.music?.file ?? '';
const musicSourceOf = () => {
  const m = state.file.music;
  return m && project ? { url: musicUrl(project.id, m.file), name: m.name } : null;
};
transport.musicSource = musicSourceOf();
let loadedMusic = musicKey();
void transport.loadMusic().then((m) => {
  if (m === 'none') toast('音楽が見つかりません — 無音のクロックで再生します');
  if (m !== 'ready' || !transport.audio) return;
  music = analyseMusic(transport.audio);
  setCurves(music.curves);
  timeline.setOnsets(music.onsets);
  const rebuild = (!restored && generate !== 'empty') || (extended && autosave);
  if (rebuild && withoutVenue(state.file) !== openedAs) {
    // edited while the music loaded: keep those edits, do not rebuild over them
    preview.setShow(view.filter(state.file));
    toast('音楽の読み込み中に編集があったので、音楽に合わせた作り直しはしていません');
    return;
  }
  // a venue chosen while the music loaded stays (the rebuilt show has none)
  const venue = state.file.venue;
  const inVenue = (f: ShowFile): ShowFile => {
    const g = { ...f };
    if (venue) g.venue = venue;
    else delete g.venue;
    return g;
  };
  if (!restored && generate !== 'empty') {
    const built = buildShow(music, generate ?? 'lagoon');
    state.load(inVenue(project ? { ...built, title: project.name } : built));
  }
  else if (extended && autosave) {
    // the new ending again, now following the music
    state.load(inVenue(extendToMusic(autosave, music) ?? state.file));
    saveNow();
  } else preview.setShow(view.filter(state.file));
}).finally(() => {
  musicSettled = true;
  inspector.update();
  if (loadedMusic !== musicKey()) void reloadMusic();
});

/** Make an audio file the project's music (docs/music-plan.md): kept in its folder, the show's length becomes the music's. */
async function pickMusic(file: File) {
  if (!project || !store) return;
  toast(`曲を読み込み中：${file.name}`);
  let length: number;
  try {
    const buf = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }).decodeAudioData(await file.arrayBuffer());
    length = Math.round(buf.duration * 100) / 100;
  } catch {
    toast(`この曲は読めませんでした：${file.name}`);
    return;
  }
  let stored: string;
  try {
    stored = await store.saveMusic(project.id, file, file.name);
  } catch (e) {
    toast(`曲を入れられませんでした：${e instanceof Error ? e.message : e}`);
    return;
  }
  state.mutate(
    (f) => {
      f.music = { file: stored, name: file.name, duration: length };
      f.duration = length;
    },
    { structural: true, source: 'music' },
  );
  // cues after the end stay (docs/music-plan.md 4.1): the warnings list them
  const past = state.file.cues.filter((c) => startOf(c, state.file) >= length).length;
  toast(`曲を「${file.name}」（${clockLabel(length)}）にしました。` + (past ? `曲の後ろにあるキューが ${past} あります（消していません。警告の一覧に出ます）。` : '') + '⌘Z で戻せます');
}

/** Back to the shared recording (Rhapsody in Blue) and its length. */
function resetMusic() {
  if (!state.file.music) return;
  state.mutate(
    (f) => {
      delete f.music;
      f.duration = SHOW_DURATION;
    },
    { structural: true, source: 'music' },
  );
  toast('曲を共通の曲（Rhapsody in Blue）に戻しました。⌘Z で戻せます');
}

// another music (picked, undone, redone, a file loaded): load and analyse it
state.on((e) => {
  if (e.kind === 'file' && musicSettled && musicKey() !== loadedMusic) void reloadMusic();
});
function musicTempo(): { bpm: number; offset: number } | null {
  if (!music || !state.file.music) return null;
  if (tempoOf?.music !== music) tempoOf = { music, tempo: estimateTempo(music.onsets) };
  return tempoOf.tempo;
}
async function reloadMusic() {
  loadedMusic = musicKey();
  transport.musicSource = musicSourceOf();
  musicSettled = false;
  const m = await transport.loadMusic();
  if (loadedMusic !== musicKey()) return; // changed again meanwhile: that load follows
  music = m === 'ready' && transport.audio ? analyseMusic(transport.audio) : null;
  setCurves(music?.curves ?? {});
  timeline.setOnsets(music?.onsets ?? []);
  preview.setShow(view.filter(state.file));
  musicSettled = true;
  inspector.update();
  if (m === 'none') toast('曲を読み込めませんでした — 無音で再生します');
}

// 会場 ▾: the venue this show plays in (docs/detailed-design.md 6.5), and
// the venue editor (venue.html) on it, in its own tab
const venueBtn = $('venue-btn');
const venuePop = $('venue-pop');
const venueId = () => state.file.venue ?? 'lagoon';
const showVenueName = () => (venueBtn.textContent = `会場：${getVenue(state.file.venue).name} ▾`);
showVenueName();
state.on((e) => {
  if (e.kind === 'file') showVenueName();
});
function switchVenue(id: string) {
  if (id === venueId()) return;
  const before = getVenue(state.file.venue);
  const after = getVenue(id);
  state.mutate(
    (f) => {
      // the lagoon is the default: leave the field out, as in the built-in shows
      if (id === 'lagoon') delete f.venue;
      else f.venue = id;
    },
    { structural: true, source: 'venue' },
  );
  const r = cueReach(state.file, before, after);
  toast(
    `会場を「${after.name}」にしました（前：${before.name}）。` +
      (r.none || r.part ? `動かないキュー ${r.none}・一部だけ ${r.part}（${r.all} のうち）。` : 'どのキューも前と同じ数の台を狙えます。') +
      '⌘Z で戻せます',
  );
}
venueBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const was = venuePop.hidden;
  document.querySelectorAll<HTMLElement>('.menu-pop').forEach((m) => (m.hidden = true));
  if (!was) return;
  const cur = venueId();
  const item = (id: string, name: string) => {
    const b = document.createElement('button');
    b.textContent = name;
    if (id === cur) b.className = 'cur';
    b.addEventListener('click', () => switchVenue(id));
    return b;
  };
  const sub = (text: string) => Object.assign(document.createElement('div'), { className: 'sub', textContent: text });
  const mine = loadMyVenues();
  const edit = document.createElement('button');
  edit.textContent = 'この会場を編集 ↗';
  edit.id = 'venue-link';
  edit.addEventListener('click', () => window.open(`/venue.html?venue=${encodeURIComponent(venueId())}`, 'water-show-venue'));
  venuePop.replaceChildren(
    sub('この演出を流す会場'),
    ...VENUE_DOCS.map((d) => item(d.id, d.name)),
    sub('自分の会場（この端末）'),
    ...(mine.length ? mine.map((d) => item(d.id, d.name)) : [sub('まだありません')]),
    document.createElement('hr'),
    edit,
  );
  venuePop.hidden = false;
});
venuePop.addEventListener('click', () => (venuePop.hidden = true));
document.addEventListener('click', () => (venuePop.hidden = true));

// 書き出し ▾: the exports for real equipment, from the show the preview draws
setupControlExport({
  show() {
    // S/M leave folders out of the 3D only: the exports get the whole show
    if (view.filtering) {
      try {
        return { show: compileShow(state.file, preview.rt.layout), layout: preview.rt.layout };
      } catch {
        return null;
      }
    }
    // an edit not yet applied to the preview goes in first
    if (preview.rt.file !== state.file) {
      clearTimeout(applyTimer);
      preview.setShow(state.file);
      updatePreviewTag();
    }
    return preview.error ? null : { show: preview.rt.show, layout: preview.rt.layout };
  },
  now: () => transport.now(),
  busy: () => (musicSettled ? (preview.error ? `ショーにエラーがあります：${preview.error}` : null) : '音楽を解析中…（「音に合わせる」キューの値が決まるまで待ちます）'),
});

// 書き出し ▾ also leads to the video exports, which live in the player
{
  const pop = $('cx-pop');
  const video = document.createElement('button');
  video.textContent = '動画・Vision Pro 180°（本番画面で）↗';
  video.title = '自動保存したショーを本番画面で開きます。下のバーの「動画を書き出す」から';
  video.addEventListener('click', () => $('show-btn').click());
  pop.append(document.createElement('hr'), video);
}

if (extended) {
  unsaved = true;
  void saveNow();
  toast('曲が最後まで延びたので、自動保存のショーの 2:56 以降を新しいラストにしました（それより前はそのまま）');
} else if (restored && !project) toast(`自動保存から復元しました (ファイル › ${SHOW_VARIANTS.map((v) => v.short).join(' / ')} で初期状態へ)`);

// --------------------------------------------- work-area tabs (6c) and folders

const tabsEl = $('ws-tabs');
/** Folders the venue has (a tab for a folder it lacks is not shown). */
const venueFolders = () => new Set(LANES.map((_, l) => folderOfLane(l)).filter((f) => f));
function renderTabs() {
  const has = venueFolders();
  if (TABS.find((t) => t.id === view.tab)?.needs && !has.has(TABS.find((t) => t.id === view.tab)!.needs!)) view.setTab('all');
  const items: HTMLElement[] = TABS.filter((t) => !t.needs || has.has(t.needs)).map((t) => {
    const b = document.createElement('button');
    b.className = `tab${t.id === view.tab ? ' on' : ''}`;
    b.textContent = t.name;
    b.dataset.tab = t.id;
    b.setAttribute('role', 'tab');
    b.title =
      t.id === 'all' ? '全部のフォルダをたたんだ要約から。重なりと密度を合わせる'
      : t.id === 'light' ? '色と明るさを作る：色や明るさを変えないキューは薄く出す'
      : `${t.name}のフォルダを開く`;
    b.addEventListener('click', () => switchTab(t.id));
    b.addEventListener('mouseup', () => b.blur());
    return b;
  });
  const right = document.createElement('div');
  right.className = 'right';
  const only = view.filterLabel();
  if (only) right.append(Object.assign(document.createElement('span'), { className: 'filter', textContent: only }));
  const reset = document.createElement('button');
  reset.className = 'link';
  reset.textContent = 'このタブを最初の見方に戻す';
  reset.title = '開いたフォルダ・S/M・3D の視点を、このタブの最初の状態に戻す（演出は変わりません）';
  reset.addEventListener('click', () => {
    view.resetTab();
    applyTabCamera();
  });
  right.append(reset);
  tabsEl.replaceChildren(...items, right);
}

/** The current tab's camera for this venue: its own, or the tab's seat, or leave it. */
function applyTabCamera() {
  const v = venueId();
  const own = view.cam(v);
  const seat = view.def.seat ? preview.seat(view.def.seat) : null;
  if (own) preview.setCamera(own);
  else if (seat) preview.setCamera(seat);
}
function switchTab(id: TabId) {
  if (id === view.tab) return;
  view.saveCam(venueId(), preview.getCamera());
  view.setTab(id);
  applyTabCamera();
}
// a camera the user moved belongs to the tab it was moved in
preview.controls.addEventListener('end', () => view.saveCam(venueId(), preview.getCamera()));
preview.onVenue = () => {
  const own = view.cam(venueId());
  if (own) preview.setCamera(own);
};
view.on((c) => {
  if (c === 'tab' || c === 'filter') {
    scheduleApply(0);
    renderTabs();
  }
});
state.on((e) => {
  if (e.kind === 'file' && e.structural) renderTabs();
});
renderTabs();
applyTabCamera();

// ------------------------------------------- right column: キュー｜警告 (C5)

const paneBtns = [...document.querySelectorAll<HTMLButtonElement>('.side-tabs button')];
function showPane(p: 'cue' | 'warn') {
  for (const b of paneBtns) b.classList.toggle('on', b.dataset.pane === p);
  $('inspector').hidden = p !== 'cue';
  $('warnings').hidden = p !== 'warn';
}
for (const b of paneBtns) {
  b.addEventListener('click', () => showPane(b.dataset.pane as 'cue' | 'warn'));
  b.addEventListener('mouseup', () => b.blur());
}
function goToCue(i: number) {
  const cue = state.file.cues[i];
  if (!cue) return;
  state.setSelection([i], i);
  timeline.reveal(i);
  const t = startOf(cue, state.file);
  if (Number.isFinite(t)) transport.seek(t);
}
const warnings = new WarningsPanel(
  $('warnings'),
  state,
  {
    go: goToCue,
    open: (i) => {
      goToCue(i);
      showPane('cue');
    },
  },
  (n) => ($('warn-n').textContent = n ? String(n) : ''),
);

/** The whole show compiled for the editor's own use (checks, picking), kept fresh. */
let full: CompiledShow | null = null;
let lastChecks: Check[] = [];
let checkTimer = 0;
function runChecks() {
  try {
    full = compileShow(state.file, LAYOUT);
  } catch {
    full = null;
    return;
  }
  // where the projector's picture lands: the 警告 list and the projector's lane
  const picture = pictureMap(full, LAYOUT);
  const list: Check[] = checkShow(full, LAYOUT, picture);
  // cues aiming at nothing in this venue
  state.file.cues.forEach((c, i) => {
    if (LANES[laneOf(c)]?.missing) list.push({ source: i, level: 'caution', kind: 'missing', text: '' });
  });
  lastChecks = list;
  warnings.update(list);
  timeline.setChecks(list);
  timeline.setPicture(picture);
}
state.on((e) => {
  if (e.kind !== 'file') return;
  clearTimeout(checkTimer);
  checkTimer = window.setTimeout(runChecks, e.live ? 300 : 60);
});
runChecks();

// ------------------------------------------------ click a fountain in the 3D (C4)

const pickTag = $('pick-tag');
let pickTimer = 0;
let downAt: { x: number; y: number; ms: number } | null = null;
const canvas3d = preview.rt.stage.renderer.domElement;
canvas3d.addEventListener('pointerdown', (e) => {
  downAt = e.button === 0 ? { x: e.clientX, y: e.clientY, ms: performance.now() } : null;
});
canvas3d.addEventListener('pointerup', (e) => {
  const d = downAt;
  downAt = null;
  // a click, not a camera drag
  if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.ms > 500) return;
  if (!full) runChecks();
  if (!full) return;
  const t = transport.now();
  const fx = preview.pick(e.clientX, e.clientY, full, t);
  pickTag.hidden = true;
  if (fx < 0) return;
  // the cue that last started on this fixture
  let src = -1;
  let start = -Infinity;
  for (let ch = 0; ch < CHANNELS.length; ch++) {
    for (const seg of full.tracks[fx * CHANNELS.length + ch]) {
      if (seg.start > t) break;
      if (seg.start >= start) {
        start = seg.start;
        src = seg.source;
      }
    }
  }
  const fixture = preview.rt.layout.fixtures[fx];
  const sameGroup = preview.rt.layout.fixtures.filter((f) => f.group === fixture.group);
  const lane = LANES.findIndex((l) => l.group === fixture.group);
  const name = `${LANES[lane]?.name ?? fixture.group} ${sameGroup.indexOf(fixture) + 1}番`;
  if (src >= 0) {
    picked = { fx, cue: src };
    if (e.shiftKey) state.setSelection([...state.selection, src], src);
    else state.setSelection([src], src);
    timeline.reveal(src);
  } else if (lane >= 0) {
    timeline.laneRect(lane);
    picked = null;
    state.setSelection([], -1);
    lit = { fixtures: [fx], tubes: [] };
    updateOutline();
  }
  const cue = src >= 0 ? state.file.cues[src] : null;
  pickTag.replaceChildren(
    name,
    Object.assign(document.createElement('span'), {
      textContent: cue ? `  ← #${src} ${cue.macro ? '∿ ' : ''}${cueLabel(cue)}（${clockLabel(startOf(cue, state.file))}〜）` : '  今は動かしているキューなし',
    }),
  );
  const r = $('preview').getBoundingClientRect();
  pickTag.style.left = `${Math.min(r.width - 320, e.clientX - r.left + 14)}px`;
  pickTag.style.top = `${Math.max(4, e.clientY - r.top - 30)}px`;
  pickTag.hidden = false;
  clearTimeout(pickTimer);
  pickTimer = window.setTimeout(() => (pickTag.hidden = true), 4000);
});

// ------------------------------------------- selection outline in the 3D

/** A fixture clicked in the 3D: the active one of its cue's fixtures. */
let picked: { fx: number; cue: number } | null = null;
/** Outlined without a cue: a lane whose name was clicked, or a fixture no cue drives now. */
let lit: { fixtures: number[]; tubes: number[] } | null = null;
function lightLane(group: string) {
  const L = preview.rt.layout;
  lit = { fixtures: L.fixtures.filter((f) => f.group === group).map((f) => f.index), tubes: group === 'pyro' ? L.tubes.map((t) => t.index) : [] };
}
preview.outlineShow = () => full;
function updateOutline() {
  const L = preview.rt.layout;
  const f = state.file;
  const act = new Set<number>();
  const oth = new Set<number>();
  const tAct = new Set<number>();
  const tOth = new Set<number>();
  const of = (i: number) => {
    const c = f.cues[i];
    if (!c) return { fx: [] as number[], tubes: [] as number[] };
    try {
      return c.fire ? { fx: [], tubes: resolveTubes(c.target, L) } : { fx: resolveTarget(c.target, L), tubes: [] };
    } catch {
      return { fx: [], tubes: [] };
    }
  };
  if (picked && !state.selection.has(picked.cue)) picked = null;
  for (const i of state.selected()) {
    const r = of(i);
    const primary = i === state.primary;
    for (const x of r.fx) (primary && (!picked || picked.fx === x) ? act : oth).add(x);
    for (const x of r.tubes) (primary ? tAct : tOth).add(x);
  }
  if (lit) {
    for (const x of lit.fixtures) act.add(x);
    for (const x of lit.tubes) tAct.add(x);
  }
  for (const x of act) oth.delete(x);
  for (const x of tAct) tOth.delete(x);
  preview.outline.set({ active: [...act], others: [...oth], tubesActive: [...tAct], tubesOthers: [...tOth] });
  preview.invalidate();
}
state.on((e) => {
  // choosing cues ends a lane's outline
  if (e.kind === 'selection' && state.selection.size) lit = null;
  updateOutline();
});
timeline.onLaneHead = (l) => {
  state.setSelection([], -1);
  lightLane(LANES[l].group);
  updateOutline();
};
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && lit) {
    lit = null;
    updateOutline();
  }
});

// --------------------------------------------------------- test / debug hooks

declare global {
  interface Window {
    __editorReady?: boolean;
    __editor?: {
      state: EditorState;
      timeline: Timeline;
      transport: Transport;
      preview: Preview;
      lanes: () => typeof LANES;
      laneOf: typeof laneOf;
      view: EditorView;
      checks: () => Check[];
      project: () => ProjectDoc | null;
      takeThumb: () => Promise<boolean>;
      saveNow: () => Promise<boolean>;
    };
  }
}
window.__editor = { state, timeline, transport, preview, lanes: () => LANES, laneOf, view, checks: () => lastChecks, project: () => project, takeThumb, saveNow };
let readyFrames = 0;
const markReady = () => {
  if (++readyFrames >= 3) window.__editorReady = true;
  else requestAnimationFrame(markReady);
};
requestAnimationFrame(markReady);
