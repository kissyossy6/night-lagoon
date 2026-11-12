import { keepMusic, musicDataOf, showWithMusic } from '../projects/music-json';
import { getVenue } from '../venues';
import { SHOW_DURATION } from '../show/song';
import { SAMPLES, sampleSummaries } from '../projects/samples';
import { isSampleId, lastProject, moveInOldAutosave, projectStore, type ProjectStore } from '../projects/store';
import type { ProjectSummary } from '../projects/types';

/**
 * The first page (index.html, docs/projects-plan.md):
 *   start screen → プロジェクト一覧 (#projects) → a project opens in the editor.
 * Nothing 3D runs here; the background is a still of the lagoon (public/home-bg.jpg).
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

const editorUrl = (id: string) => `/edit.html?project=${encodeURIComponent(id)}`;
const playerUrl = (id: string) => `/play.html?project=${encodeURIComponent(id)}`;

let store: ProjectStore;
let mine: ProjectSummary[] = [];

// ---------------------------------------------------------------- screens

function route() {
  const list = location.hash === '#projects';
  $('start').hidden = list;
  $('list').hidden = !list;
  if (list) void refresh();
}
window.addEventListener('hashchange', route);
$('open-list').addEventListener('click', () => (location.hash = '#projects'));
$('to-start').addEventListener('click', () => (location.hash = ''));

// ------------------------------------------------------------------ list

function len(sec?: number) {
  const s = Math.round(sec ?? SHOW_DURATION);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ago(iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'たった今';
  if (m < 60) return `${m} 分前`;
  if (m < 60 * 24) return `${Math.round(m / 60)} 時間前`;
  if (m < 60 * 24 * 14) return `${Math.round(m / 1440)} 日前`;
  const d = new Date(t);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
const venueName = (id?: string) => getVenue(id).name;

function thumb(p: ProjectSummary) {
  return h('div', { class: 'thumb' }, p.thumb ? h('img', { src: p.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'none' }, '開くと絵が付きます'));
}

function card(p: ProjectSummary) {
  const sample = !!p.sample;
  const open = h(
    'button',
    { class: 'open', 'aria-label': sample ? `見本「${p.name}」から作る` : `「${p.name}」をエディタで開く` },
    thumb(p),
    h(
      'div',
      { class: 'meta' },
      h('span', { class: 'name', title: p.name }, p.name),
      sample ? h('span', { class: 'desc' }, p.description ?? '') : h('span', { class: 'info' }, `${venueName(p.venue)}・${len(p.duration)}・${ago(p.updated)}に更新`),
    ),
  );
  open.addEventListener('click', () => (sample ? newDialog(p.id) : (location.href = editorUrl(p.id))));
  const el = h('article', { class: 'card' }, open);
  if (sample) el.append(h('span', { class: 'badge' }, '見本'));
  const more = h('button', { class: 'more', 'aria-label': `「${p.name}」のその他の操作`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '⋯');
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    openMenu(more, p);
  });
  el.append(more);
  return el;
}

async function refresh() {
  try {
    mine = await store.list();
  } catch (err) {
    toast(`一覧を読めませんでした：${msg(err)}`);
    mine = [];
  }
  $('mine').replaceChildren(...mine.map(card));
  $('empty').hidden = mine.length > 0;
  $('samples').replaceChildren(...sampleSummaries().map(card));
}

// --------------------------------------------------------------- ⋯ menu

const menu = $('card-menu');
let menuFor: HTMLElement | null = null;
function closeMenu() {
  menu.hidden = true;
  menuFor?.setAttribute('aria-expanded', 'false');
  menuFor = null;
}
document.addEventListener('click', (e) => {
  if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !menu.hidden) {
    const back = menuFor;
    closeMenu();
    back?.focus();
  }
});
window.addEventListener('resize', closeMenu);

function openMenu(anchor: HTMLElement, p: ProjectSummary) {
  if (menuFor === anchor) return closeMenu();
  closeMenu();
  const item = (label: string, fn: () => void, cls = '') => {
    const b = h('button', { role: 'menuitem', class: cls }, label);
    b.addEventListener('click', () => {
      closeMenu();
      fn();
    });
    return b;
  };
  const items: HTMLElement[] = [];
  if (p.sample) {
    items.push(item('この見本から作る', () => newDialog(p.id)), item('▶ 再生だけ見る', () => (location.href = playerUrl(p.id))));
  } else {
    items.push(
      item('エディタで開く', () => (location.href = editorUrl(p.id))),
      item('▶ 本番で再生', () => (location.href = playerUrl(p.id))),
      h('hr'),
      item('名前を変える', () => renameDialog(p)),
      item('複製', () => void duplicate(p)),
      item('JSON を書き出す', () => void exportJson(p)),
    );
    if (store.kind === 'disk') items.push(item('見本にする', () => promoteDialog(p)), item('Finder で表示', () => void store.reveal?.(p.id)));
    items.push(h('hr'), item('削除', () => deleteDialog(p), 'danger'));
  }
  menu.replaceChildren(...items);
  menu.hidden = false;
  menuFor = anchor;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  const below = r.bottom + 4 + hgt < innerHeight;
  menu.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + scrollX}px`;
  menu.style.top = `${(below ? r.bottom + 4 : r.top - hgt - 4) + scrollY}px`;
  (menu.querySelector('button') as HTMLButtonElement | null)?.focus();
}

// --------------------------------------------------------------- dialogs

const dlg = $<HTMLDialogElement>('dlg');
interface Action {
  label: string;
  kind?: 'primary' | 'danger';
  run?: () => Promise<void> | void;
}
/** One dialog for all: title, body, buttons. The last action is the default (Enter). */
function dialog(title: string, body: Node[], actions: Action[], extra?: Node) {
  $('dlg-title').textContent = title;
  $('dlg-body').replaceChildren(...body);
  $('dlg-error').hidden = true;
  const row = $('dlg-actions');
  row.replaceChildren();
  if (extra) row.append(extra);
  for (const [i, a] of actions.entries()) {
    const b = h('button', { type: i === actions.length - 1 ? 'submit' : 'button', class: a.kind ?? '' }, a.label);
    b.addEventListener('click', async (e) => {
      e.preventDefault();
      if (!a.run) return dlg.close();
      for (const x of row.querySelectorAll('button')) x.disabled = true;
      try {
        await a.run();
        dlg.close();
      } catch (err) {
        $('dlg-error').textContent = msg(err);
        $('dlg-error').hidden = false;
      } finally {
        for (const x of row.querySelectorAll('button')) x.disabled = false;
      }
    });
    row.append(b);
  }
  dlg.showModal();
  const first = dlg.querySelector<HTMLInputElement>('input[type="text"]');
  if (first) {
    first.focus();
    first.select();
  }
}
const cancel: Action = { label: 'やめる' };
function nameField(value: string, label = '名前') {
  const input = h('input', { type: 'text', value, maxlength: '80', required: '', spellcheck: 'false' }) as HTMLInputElement;
  return { input, field: h('label', { class: 'field' }, label, input) };
}
const nameOf = (input: HTMLInputElement) => {
  const v = input.value.trim();
  if (!v) throw new Error('名前を入れてください');
  return v;
};

/** 新規: a name and where to start (empty, or one of the samples). */
function newDialog(preselect?: string) {
  const sample = SAMPLES.find((s) => s.id === preselect);
  const { input, field } = nameField(sample ? `${sample.name} のコピー` : '新しいプロジェクト');
  const thumbs = new Map(sampleSummaries().map((s) => [s.id, s.thumb]));
  const opt = (value: string, label: string, sub: string, img?: string) => {
    const radio = h('input', { type: 'radio', name: 'from', value }) as HTMLInputElement;
    radio.checked = value === (preselect ?? 'empty');
    radio.addEventListener('change', () => {
      // follow the pick in the name while it is still a default one
      if (/のコピー$|^新しいプロジェクト$/.test(input.value)) input.value = value === 'empty' ? '新しいプロジェクト' : `${label} のコピー`;
    });
    return h('label', { class: 'choice' }, radio, h('span', { class: 'mini' }, ...(img ? [h('img', { src: img, alt: '' })] : [])), h('span', {}, label, h('small', {}, sub)));
  };
  const from = h(
    'fieldset',
    {},
    h('legend', {}, 'はじめかた'),
    opt('empty', '空のショー', 'キューの無い状態から'),
    ...SAMPLES.map((s) => opt(s.id, s.name, s.description ?? '見本', thumbs.get(s.id))),
  );
  // the empty show can start on your own music (docs/music-plan.md); the samples keep theirs
  const musicInput = h('input', { type: 'file', accept: 'audio/*' }) as HTMLInputElement;
  const musicField = h('label', { class: 'field' }, '曲（空のショーだけ。あとからエディタでも選べます）', musicInput);
  const draftBox = h('input', { type: 'checkbox', checked: '' }) as HTMLInputElement;
  const draftField = h('label', { class: 'check' }, draftBox, ' 曲に合わせて振付の下書きを作る（あとで直せます）');
  const syncMusic = () => {
    const empty = ((from.querySelector('input:checked') as HTMLInputElement | null)?.value ?? 'empty') === 'empty';
    musicInput.disabled = !empty || store.kind !== 'disk';
    musicField.style.opacity = musicInput.disabled ? '0.45' : '';
    draftBox.disabled = musicInput.disabled || !musicInput.files?.length;
    draftField.style.opacity = draftBox.disabled ? '0.45' : '';
  };
  from.addEventListener('change', syncMusic);
  musicInput.addEventListener('change', syncMusic);
  syncMusic();
  const play = sample ? h('a', { href: playerUrl(sample.id), class: 'left' }, '▶ 再生だけ見る') : undefined;
  dialog(
    '新規プロジェクト',
    [field, from, musicField, draftField],
    [
      cancel,
      {
        label: '作ってエディタで開く',
        kind: 'primary',
        run: async () => {
          const name = nameOf(input);
          const pick = (from.querySelector('input:checked') as HTMLInputElement | null)?.value ?? 'empty';
          const s = SAMPLES.find((x) => x.id === pick);
          const file = !s && !musicInput.disabled ? musicInput.files?.[0] : undefined;
          // read the music before making anything: a file that does not decode stops here
          const own = file ? await readMusic(file) : null;
          const doc = s
            ? await store.create({ name, from: s.id, show: s.show ?? null, generate: s.show ? undefined : s.generate })
            : await store.create({ name, generate: 'empty' });
          if (file && own) {
            const stored = await store.saveMusic(doc.id, file, file.name);
            doc.show = { title: name, bpm: own.bpm, beatsPerBar: 4, offset: own.offset, duration: own.duration, cues: [], music: { file: stored, name: file.name, duration: own.duration } };
            delete doc.generate;
            await store.save(doc);
          }
          location.href = editorUrl(doc.id) + (file && own && draftBox.checked ? '&draft=1' : '');
        },
      },
    ],
    play,
  );
}

/** A picked audio file's length, and its beat when one is found (else 120 BPM from 0 s). */
async function readMusic(file: File): Promise<{ duration: number; bpm: number; offset: number }> {
  let buf: AudioBuffer;
  try {
    buf = await new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 44100 }).decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(`この曲は読めませんでした：${file.name}`);
  }
  const { analyseMusic, estimateTempo } = await import('../audio/analysis');
  const tempo = estimateTempo(analyseMusic(buf).onsets);
  return { duration: Math.round(buf.duration * 100) / 100, bpm: tempo?.bpm ?? 120, offset: tempo?.offset ?? 0 };
}

function renameDialog(p: ProjectSummary) {
  const { input, field } = nameField(p.name);
  dialog('名前を変える', [field], [
    cancel,
    {
      label: '変える',
      kind: 'primary',
      run: async () => {
        const doc = await store.get(p.id);
        doc.name = nameOf(input);
        if (doc.show) doc.show.title = doc.name;
        await store.save(doc);
        await refresh();
      },
    },
  ]);
}

async function duplicate(p: ProjectSummary) {
  try {
    await store.duplicate(p.id, `${p.name} のコピー`);
    await refresh();
    toast(`「${p.name} のコピー」を作りました`);
  } catch (err) {
    toast(`複製できませんでした：${msg(err)}`);
  }
}

function promoteDialog(p: ProjectSummary) {
  const { input, field } = nameField(p.name, '見本の名前');
  dialog(
    '見本にする',
    [h('p', {}, '今の状態を写して、見本の一覧に足します（元のプロジェクトはそのまま）。見本は projects/sample-… に置かれ、git に入ります。個人的な内容が無いか確かめてください'), field],
    [
      cancel,
      {
        label: '見本にする',
        kind: 'primary',
        run: async () => {
          await store.promote(p.id, nameOf(input));
          toast('見本にしました（一覧の再読み込みで見本に出ます）');
          setTimeout(() => location.reload(), 600);
        },
      },
    ],
  );
}

function deleteDialog(p: ProjectSummary) {
  const how =
    store.kind === 'disk'
      ? 'projects/.trash/ に移します。Finder からフォルダを戻せば元に戻ります'
      : 'このブラウザから消えます。元に戻せません。残すなら先に JSON を書き出してください';
  dialog(`「${p.name}」を削除`, [h('p', {}, how)], [
    cancel,
    {
      label: '削除する',
      kind: 'danger',
      run: async () => {
        await store.trash(p.id);
        await refresh();
        toast(`「${p.name}」を削除しました`);
      },
    },
  ]);
}

// ------------------------------------------------------------ JSON in/out

async function exportJson(p: ProjectSummary) {
  const doc = await store.get(p.id);
  if (!doc.show) {
    toast('まだ演出が作られていません。一度エディタで開いてから書き出してください');
    return;
  }
  // a show on its own music carries it (src/projects/music-json.ts)
  const { out, note } = doc.show.music ? await showWithMusic(doc.show, p.id) : { out: doc.show, note: '' };
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `${p.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (note) toast(`JSON を書き出しました${note}`);
}

$('import-btn').addEventListener('click', () => $('import-input').click());
$<HTMLInputElement>('import-input').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const { normaliseShow } = await import('../editor/model');
    const raw = JSON.parse(await file.text());
    const show = normaliseShow(raw);
    const name = show.title && show.title !== '新しいショー' ? show.title : file.name.replace(/\.json$/i, '');
    // the music the file carries goes into the new project's folder
    const carried = musicDataOf(raw);
    if (carried) delete show.music;
    const doc = await store.create({ name, show: { ...show, title: name } });
    let note = '';
    if (carried) {
      try {
        const music = await keepMusic(carried, (blob, n) => store.saveMusic(doc.id, blob, n), show.duration);
        await store.save({ ...doc, show: { ...doc.show!, music } });
        note = `。曲「${carried.name}」も入れました`;
      } catch (err) {
        note = `。曲「${carried.name}」は入れられませんでした（${msg(err)}）`;
      }
    }
    await refresh();
    toast(`「${doc.name}」を読み込みました（${show.cues.length} キュー）${note}`);
  } catch (err) {
    toast(`読み込めませんでした：${msg(err)}`);
  }
});

$('new-btn').addEventListener('click', () => newDialog());
$('empty-new').addEventListener('click', () => newDialog());

// ------------------------------------------------------------------ misc

let toastTimer = 0;
function toast(text: string) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}
const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ------------------------------------------------------------------ start

store = await projectStore();
if (store.kind === 'browser') {
  $('store-note').textContent = '開発サーバーなしで開いているため、プロジェクトはこのブラウザの中に保存しています（npm run dev で開くと projects/ フォルダに保存します）';
  $('store-note').hidden = false;
}
const moved = await moveInOldAutosave(store);
if (moved) toast('前のエディタの自動保存を「エディタの演出（引っ越し）」として移しました');

// the start screen offers to go straight back to the last project
const last = lastProject();
if (last && !isSampleId(last)) {
  store
    .list()
    .then((all) => {
      const p = all.find((x) => x.id === last);
      if (!p) return;
      const a = h('a', { href: editorUrl(p.id) }, `前回のつづき：${p.name}`);
      $('start-note').replaceChildren(a);
    })
    .catch(() => {});
}
route();
(window as unknown as { __home: unknown }).__home = { store: () => store, refresh, mine: () => mine };
