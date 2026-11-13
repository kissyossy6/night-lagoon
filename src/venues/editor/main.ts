import { KINDS, kind } from '../../fixtures';
import { buildShow, SHOW_VARIANTS, type ShowVariant } from '../../show/choreography';
import type { ShowFile } from '../../show/types';
import { isSampleId, lastProject, projectStore } from '../../projects/store';
import { cueReach, type CueReach } from '../cues';
import { VENUE_DOCS, buildVenue, deleteMyVenue, getVenue, loadMyVenues, newVenueId, saveMyVenue, PART_NAMES, type Part, type PartKind, type VenueDoc } from '../index';
import { DENSITY, SCENE_SIZE, crowdPeople, focusOf, groundAt, lineFrame, onLand, venuePeople } from '../landscape';
import { isSceneryPart, isWaterPart, placed } from '../parts';
import { checkVenue, DISCLAIMER, LEVEL_NAMES, pyroLimits, RULE_NAMES, type Finding } from '../rules';
import type { ScaleTier, Venue, WaterShape } from '../types';
import { SNAP, TopView, type Selection, type Tool } from './view';

/**
 * The venue editor (venue.html, docs/detailed-design.md 6.2): a venue file
 * of parts (src/venues/parts.ts) seen from above. Built-in venues are read
 * only — the first change makes a copy of one's own, kept in this browser
 * (src/venues/store.ts) and written out as JSON from the 会場 menu.
 */

const LAST_KEY = 'water-show-venue-last';
/** The project last opened in the timeline editor (src/projects/store.ts): its show is counted too, and 3Dで見る plays it. */
const lastId = lastProject();
let lastShow: { label: string; file: ShowFile } | null = null;
if (lastId && !isSampleId(lastId)) {
  projectStore()
    .then((s) => s.get(lastId))
    .then((p) => {
      if (!p.show) return;
      lastShow = { label: p.name, file: p.show };
      renderCues();
    })
    .catch(() => {
      /* the built-in shows only */
    });
}

type Pt = [number, number];
type WaterPart = Extract<Part, { group: string }>;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------- state
let doc: VenueDoc;
let builtIn = false;
let venue: Venue;
let findings: Finding[] = [];
let sel: Selection = { part: null, fixture: null };
let tool: Tool = 'select';
let placeKind = 'grid';
const undoStack: string[] = [];
const redoStack: string[] = [];

const WATER_KINDS = Object.values(KINDS).filter((k) => k.folder === 'water');
const SCALES: [ScaleTier, string][] = [
  ['desk', '机'],
  ['garden', '庭'],
  ['plaza', '広場'],
  ['lagoon', '湖'],
];
const WATER_NAMES: Record<WaterShape['kind'], string> = {
  infinite: '果てなし',
  rect: '長方形',
  circle: '円',
  strip: '帯',
  roundedRect: '角の丸い長方形',
};

// ------------------------------------------------------------ elements
function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of kids) if (c) el.append(c);
  return el;
}
/** replaceChildren, leaving out the nulls of optional rows. */
function fill(el: HTMLElement, ...kids: (Node | string | null | false)[]) {
  el.replaceChildren(...kids.filter((k): k is Node | string => !!k));
}
const unit = (s: string) => h('span', { class: 'unit' }, s);
function row(label: string, ...controls: (Node | null)[]) {
  return h('div', { class: 'row' }, h('label', {}, label), h('div', { class: 'pair' }, ...controls));
}
/** A number field; a change is one undo step. */
function num(value: number, set: (v: number) => void, opts: { int?: boolean; min?: number; step?: number; title?: string } = {}) {
  const el = h('input', { class: 'num', type: 'number', value: String(round(value)), step: String(opts.step ?? 'any'), title: opts.title ?? '' });
  el.addEventListener('change', () => {
    let v = Number(el.value);
    if (!Number.isFinite(v) || el.value.trim() === '') return void (el.value = String(round(value)));
    if (opts.int) v = Math.round(v);
    if (opts.min != null) v = Math.max(opts.min, v);
    commit(() => set(v));
  });
  return el;
}
function txt(value: string, set: (v: string) => void, opts: { list?: string; placeholder?: string } = {}) {
  const el = h('input', { class: 'txt', type: 'text', value, placeholder: opts.placeholder ?? '' });
  if (opts.list) el.setAttribute('list', opts.list);
  el.addEventListener('change', () => commit(() => set(el.value.trim())));
  return el;
}
function choice<T extends string>(options: [T, string][], value: T, set: (v: T) => void) {
  const el = h('select', { class: 'inp' });
  for (const [v, label] of options) el.add(new Option(label, v, v === value, v === value));
  el.addEventListener('change', () => commit(() => set(el.value as T)));
  return el;
}
function xz(label: string, p: Pt, set: (p: Pt) => void) {
  return row(label, unit('x'), num(p[0], (v) => set([v, p[1]])), unit('z'), num(p[1], (v) => set([p[0], v])));
}
const round = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (v: number) => (v < 10 ? v.toLocaleString('ja-JP', { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('ja-JP'));

let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}

// --------------------------------------------------------- open / save
function open(id: string | null, fit = true) {
  const mine = loadMyVenues();
  const m = id ? mine.find((d) => d.id === id) : undefined;
  const b = id ? VENUE_DOCS.find((d) => d.id === id) : undefined;
  const d = m ?? b ?? VENUE_DOCS.find((x) => x.id === 'lagoon')!;
  doc = structuredClone(d);
  builtIn = !m;
  undoStack.length = 0;
  redoStack.length = 0;
  sel = { part: null, fixture: null };
  // 1台を置く starts with the venue's first water kind (a desk tank's, not the lagoon's grid)
  const first = doc.parts.find(isWaterPart);
  if (first) placeKind = $<HTMLSelectElement>('place-kind').value = first.fixture;
  remember();
  rebuild();
  renderAll();
  if (fit) view.fit();
}

function remember() {
  history.replaceState(null, '', `?venue=${encodeURIComponent(doc.id)}`);
  try {
    localStorage.setItem(LAST_KEY, doc.id);
  } catch {
    /* only a convenience */
  }
}

/** The first change to a built-in venue makes a copy of one's own. */
function ensureOwn() {
  if (!builtIn) return;
  const from = doc.name;
  doc = structuredClone(doc);
  doc.id = newVenueId();
  doc.name = `${from}の写し`;
  builtIn = false;
  saveMyVenue(doc);
  remember();
  toast(`組み込みの会場は直せないので、写し「${doc.name}」を作りました`);
}

function save() {
  if (!builtIn) saveMyVenue(doc);
}

function rebuild() {
  const errors: Finding[] = [];
  try {
    venue = buildVenue(doc);
  } catch (e) {
    errors.push({ rule: 'build', level: 'stop', text: e instanceof Error ? e.message : String(e) });
  }
  findings = [...errors, ...(venue && !errors.length ? checkVenue(doc, venue) : [])];
}

/** One undo step: copy a built-in first, keep the file as it was, change it. */
function commit(change: (d: VenueDoc) => void) {
  ensureOwn();
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  change(doc);
  clampSel();
  rebuild();
  save();
  renderAll();
}

function undo(from: string[], to: string[]) {
  const s = from.pop();
  if (!s) return;
  to.push(JSON.stringify(doc));
  doc = JSON.parse(s);
  clampSel();
  rebuild();
  save();
  renderAll();
}

function clampSel() {
  if (sel.part != null && !doc.parts[sel.part]) sel = { part: null, fixture: null };
  const p = sel.part != null ? doc.parts[sel.part] : null;
  if (p && sel.fixture != null && (!('count' in p) || sel.fixture >= p.count)) sel.fixture = null;
}

// --------------------------------------------------------------- facts
/** Each part's first index in its group / screen group, and its count. */
function targets(): { target: string; count: number }[] {
  const next: Record<string, number> = {};
  return doc.parts.map((p) => {
    if (isWaterPart(p)) {
      const n = placed(p).length;
      const a = next[p.group] ?? 0;
      next[p.group] = a + n;
      return { target: n ? `${p.group}[${a}-${a + n - 1}]` : `${p.group}（0台）`, count: n };
    }
    if (p.kind === 'screen') {
      const a = next[`#${p.fixture}`] ?? 0;
      next[`#${p.fixture}`] = a + 1;
      return { target: `${p.fixture}[${a}-${a}]`, count: 1 };
    }
    if (p.kind === 'pyro') return { target: `pyro:${p.site}`, count: p.tubes };
    if (p.kind === 'projector') return { target: 'projector', count: 1 };
    if (p.kind === 'crowd') return { target: '', count: peopleOf(p, doc.parts.indexOf(p)).length };
    return { target: '', count: 0 };
  });
}

function partName(p: Part) {
  if (p.kind === 'shore' && !p.name) return !p.from || !p.to ? '縁ぜんぶ' : '';
  return p.kind === 'pyro' ? p.site : (p.name ?? '');
}

/** Everyone of a crowd part (the 3D leaves out those over the water, and those in a camera's view of the show). */
function peopleOf(p: Extract<Part, { kind: 'crowd' }>, n: number) {
  return crowdPeople({ ...p, seed: n }, 0, [0, 0]);
}

function partColour(p: Part) {
  if (isWaterPart(p) || p.kind === 'screen') return KINDS[p.fixture]?.lane.accent ?? 'var(--c-text-dim)';
  if (p.kind === 'projector') return kind('projector').lane.accent;
  if (p.kind === 'pyro') return kind('pyro').lane.accent;
  return 'var(--c-vn-seat)';
}

function groupOf(p: Part) {
  if (isWaterPart(p)) return p.group;
  if (isSceneryPart(p)) return '景色';
  return p.kind === 'screen' || p.kind === 'projector' ? '水幕' : p.kind === 'pyro' ? '花火' : '客席';
}

/** The group a new fixture of this kind joins: the first group of that kind, else a new one. */
function groupFor(kindId: string, except?: number) {
  const same = doc.parts.find((q, k) => k !== except && isWaterPart(q) && q.fixture === kindId) as WaterPart | undefined;
  if (same) return same.group;
  let name = kindId;
  for (let k = 2; doc.parts.some((q) => isWaterPart(q) && q.group === name); k++) name = `${kindId}${k}`;
  return name;
}

// -------------------------------------------------------------- render
function renderAll() {
  renderBar();
  renderVenueFields();
  renderParts();
  renderPartFields();
  renderFixtureFields();
  renderWarnings();
  renderFooter();
  view.draw();
}

function renderBar() {
  $('venue-title').textContent = doc.name;
  $('venue-tag').textContent = builtIn ? '組み込み・直すと写しを作る' : '';
  $('save-status').textContent = builtIn ? '' : 'この端末に保存済み';
  const stops = findings.filter((f) => f.level === 'stop').length;
  const v3d = $<HTMLButtonElement>('view3d-btn');
  v3d.disabled = stops > 0;
  v3d.title = stops ? `「止める」の警告が ${stops} つあります。直してから 3D で見られます` : 'この会場で本番画面を開く（エディタの演出があればそれを、なければ Rhapsody in Blue）';
  $<HTMLButtonElement>('undo-btn').disabled = !undoStack.length;
  $<HTMLButtonElement>('redo-btn').disabled = !redoStack.length;
  $('snap-hint').textContent = `吸い付き ${SNAP[doc.scale] >= 0.1 ? `${SNAP[doc.scale]} m` : `${SNAP[doc.scale] * 100} cm`}・15°（Alt で外す）`;
  $('vn-hint').textContent =
    tool === 'place'
      ? 'クリック：選んだ機材を1台置く　Esc：選ぶ・動かすに戻る'
      : 'ドラッグ：部品を動かす　□：端・中心　○：半径・幅　選んだ部品の台をクリック → その1台をドラッグ：ずらす　Delete：外す・消す　右ドラッグ：見る位置　ホイール：拡大';
}

function renderVenueFields() {
  const box = $('venue-fields');
  const w = doc.water;
  const scale = h('div', { class: 'seg' });
  for (const [v, label] of SCALES) {
    scale.append(h('button', { class: v === doc.scale ? 'on' : '', onclick: () => commit((d) => (d.scale = v)) }, label));
  }
  const dims: HTMLElement[] = [];
  if (w.kind === 'rect' || w.kind === 'strip' || w.kind === 'roundedRect') {
    dims.push(row('大きさ', unit('幅'), num(w.width, (v) => ((doc.water as typeof w).width = v), { min: 0.01 }), unit('奥'), num(w.depth, (v) => ((doc.water as typeof w).depth = v), { min: 0.01 })));
  }
  if (w.kind === 'roundedRect') dims.push(row('角の半径', num(w.radius, (v) => ((doc.water as typeof w).radius = v), { min: 0 }), unit('m')));
  if (w.kind === 'circle') dims.push(row('半径', num(w.radius, (v) => ((doc.water as typeof w).radius = v), { min: 0.01 }), unit('m')));
  fill(box, 
    h('h2', {}, '会場'),
    row('名前', txt(doc.name, (v) => (doc.name = v || '名前のない会場'))),
    row('規模', scale),
    row('水面', choice(Object.entries(WATER_NAMES) as [WaterShape['kind'], string][], w.kind, (k) => (doc.water = waterOf(k)))),
    ...dims,
    doc.scale === 'desk' || doc.scale === 'garden'
      ? h('p', { class: 'vn-note' }, '小さい規模の水の動き（表面張力で玉になる・細い柱が崩れるなど）は、まだ実物に合わせていません。3D は大きな噴水の動きを縮めたものです。')
      : null,
  );
}

/** A water shape of this kind around what stands on the water. */
function waterOf(k: WaterShape['kind']): WaterShape {
  const pts = venue ? venue.groups.flatMap((g) => g.positions) : [];
  const x = Math.max(1, ...pts.map((p) => Math.abs(p[0]))) * 2.4;
  const z = Math.max(1, ...pts.map((p) => Math.abs(p[2]))) * 2.4;
  const r = (v: number) => Math.ceil(v / SNAP[doc.scale]) * SNAP[doc.scale];
  switch (k) {
    case 'infinite':
      return { kind: 'infinite' };
    case 'circle':
      return { kind: 'circle', radius: r(Math.max(x, z) / 2) };
    case 'roundedRect':
      return { kind: 'roundedRect', width: r(x), depth: r(z), radius: r(Math.min(x, z) / 6) };
    default:
      return { kind: k, width: r(x), depth: r(z) };
  }
}

function renderParts() {
  const ul = $('parts-list');
  const tg = targets();
  const marks = new Map<number, Finding['level']>();
  const order = { stop: 0, danger: 1, note: 2 };
  for (const f of findings) if (f.part != null && (!marks.has(f.part) || order[f.level] < order[marks.get(f.part)!])) marks.set(f.part, f.level);
  const fixtures = venue ? venue.groups.reduce((a, g) => a + g.positions.length, 0) : 0;
  $('parts-count').textContent = `${doc.parts.length}個・${fixtures}台`;
  const items: HTMLElement[] = [];
  let last: string | null = null;
  doc.parts.forEach((p, n) => {
    const g = groupOf(p);
    if (g !== last) {
      const total = isWaterPart(p) ? (venue?.groups.find((x) => x.name === g)?.positions.length ?? 0) : null;
      items.push(h('li', { class: 'grp' }, h('span', {}, g), h('span', {}, total != null ? `${total}台` : '')));
      last = g;
    }
    const m = marks.get(n);
    items.push(
      h(
        'li',
        { class: n === sel.part ? 'on' : '', onclick: () => select({ part: n, fixture: null }), title: tg[n].target },
        h('span', { class: 'sw', style: `background:${partColour(p)}` }),
        // the list's kind column is narrow: the projector as 映写
        h('span', { class: 'k', title: PART_NAMES[p.kind] }, p.kind === 'projector' ? '映写' : PART_NAMES[p.kind]),
        h('span', { class: 'nm' }, partName(p) || h('span', { class: 'unit' }, '名前なし'), m ? h('span', { class: `mk vn-dot ${m}` }) : null),
        h('span', { class: 'n' }, tg[n].count ? String(tg[n].count) : ''),
      ),
    );
  });
  fill(ul, ...items);
}

function renderPartFields() {
  const box = $('part-fields');
  const n = sel.part;
  const p = n != null ? doc.parts[n] : null;
  if (n == null || !p) {
    fill(box, h('h2', {}, '部品'), h('p', { class: 'vn-none' }, '図か左の一覧で部品を選ぶと、ここで値を直せます。'));
    return;
  }
  const P = <K extends PartKind>(_k: K) => doc.parts[n] as Extract<Part, { kind: K }>;
  const target = targets()[n].target;
  const fields: (HTMLElement | null)[] = [];
  if (isWaterPart(p)) {
    fields.push(row('名前', txt(p.name ?? '', (v) => (v ? ((doc.parts[n] as WaterPart).name = v) : delete (doc.parts[n] as WaterPart).name), { placeholder: '名前なし（@名前 で使える）' })));
    fields.push(
      row(
        '機材',
        choice(
          WATER_KINDS.map((k) => [k.id, k.label] as [string, string]),
          p.fixture,
          (v) => {
            const q = doc.parts[n] as WaterPart;
            const shared = doc.parts.some((o, k) => k !== n && isWaterPart(o) && o.group === q.group);
            q.fixture = v;
            // a group holds one kind: leave a shared group for one of the new kind
            if (shared || doc.parts.some((o, k) => k !== n && isWaterPart(o) && o.group === q.group && o.fixture !== v)) q.group = groupFor(v, n);
          },
        ),
      ),
    );
    const groups = [...new Set(doc.parts.filter(isWaterPart).map((q) => q.group))];
    fields.push(row('グループ', txt(p.group, (v) => v && ((doc.parts[n] as WaterPart).group = v), { list: 'vn-groups' }), h('datalist', { id: 'vn-groups' }, ...groups.map((g) => h('option', { value: g })))));
    if (p.kind !== 'single') fields.push(row('台数', num(p.count, (v) => setCount(n, v), { int: true, min: 1 }), unit('台')));
  }
  switch (p.kind) {
    case 'line':
    case 'band':
      fields.push(xz('始め', p.from, (v) => (P(p.kind).from = v)), xz('終わり', p.to, (v) => (P(p.kind).to = v)));
      if (p.kind === 'band') fields.push(row('千鳥の幅', num(p.pitch, (v) => (P('band').pitch = v), { min: 0, title: '1台おきに、この半分だけ後ろへ下がる' }), unit('m')));
      break;
    case 'arc':
      fields.push(xz('中心', p.center, (v) => (P('arc').center = v)), row('半径', num(p.radius, (v) => (P('arc').radius = v), { min: 0.01 }), unit('m')));
      fields.push(row('角度', unit('始'), num(p.a0, (v) => (P('arc').a0 = v)), unit('終'), num(p.a1, (v) => (P('arc').a1 = v)), unit('°')));
      fields.push(h('p', { class: 'vn-note' }, '0° は右、90° は客席の方。両端に1台ずつ置きます。'));
      break;
    case 'ring':
      fields.push(xz('中心', p.center, (v) => (P('ring').center = v)), row('半径', num(p.radius, (v) => (P('ring').radius = v), { min: 0.01 }), unit('m')));
      fields.push(row('1台目', num(p.a0 ?? 0, (v) => (P('ring').a0 = v)), unit('°（0° は右）')));
      break;
    case 'single':
      fields.push(xz('位置', p.at, (v) => (P('single').at = v)));
      break;
    case 'screen':
      fields.push(
        row(
          '名前',
          txt(p.name ?? '', (v) => {
            // the projector names the screens it lights: follow a rename
            const old = P('screen').name;
            if (v) P('screen').name = v;
            else delete P('screen').name;
            for (const q of doc.parts) if (q.kind === 'projector' && q.covers && old !== undefined) q.covers = q.covers.map((c) => (c === old ? v : c)).filter(Boolean);
          }),
        ),
      );
      fields.push(row('種類', choice([['screen', '横長の幕'], ['mound', '山（丸い霧）']], p.fixture, (v) => (P('screen').fixture = v))));
      fields.push(xz('中心', p.center, (v) => (P('screen').center = v)));
      fields.push(row('大きさ', unit('幅'), num(p.width, (v) => (P('screen').width = v), { min: 0.01 }), unit('高'), num(p.height, (v) => (P('screen').height = v), { min: 0.01 })));
      break;
    case 'projector': {
      fields.push(row('名前', txt(p.name ?? '', (v) => (v ? (P('projector').name = v) : delete P('projector').name))));
      fields.push(xz('位置', p.at, (v) => (P('projector').at = v)));
      fields.push(row('高さ', num(p.height, (v) => (P('projector').height = v)), unit('m')));
      fields.push(xz('向ける点', p.aim, (v) => (P('projector').aim = v)));
      // the screens it lights, by name (all when none is chosen yet)
      const screens = doc.parts.map((q, k) => ({ q, k })).filter((x) => x.q.kind === 'screen') as { q: Extract<Part, { kind: 'screen' }>; k: number }[];
      const lit = (name: string | undefined) => !p.covers || (name !== undefined && p.covers.includes(name));
      const boxes = screens.map(({ q, k }, j) => {
        const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
        box.checked = lit(q.name);
        box.addEventListener('change', () =>
          commit((d) => {
            const pj = d.parts[n] as Extract<Part, { kind: 'projector' }>;
            const all = d.parts.filter((x) => x.kind === 'screen') as Extract<Part, { kind: 'screen' }>[];
            // a screen with no name gets one, so the projector can name it
            all.forEach((s, i) => (s.name ??= `水幕${i + 1}`));
            const now = new Set(pj.covers ?? all.map((s) => s.name!));
            const name = (d.parts[k] as Extract<Part, { kind: 'screen' }>).name!;
            if (box.checked) now.add(name);
            else now.delete(name);
            pj.covers = all.map((s) => s.name!).filter((x) => now.has(x));
          }),
        );
        return h('label', { class: 'vn-chk' }, box, ` ${q.name ?? `水幕${j + 1}（名前なし）`}`);
      });
      fields.push(row('当てる水幕', h('div', { class: 'vn-chks' }, ...(boxes.length ? boxes : [h('span', { class: 'vn-note' }, '水幕がありません')]))));
      fields.push(h('p', { class: 'vn-note' }, '水幕の後ろから客席へ向けて映します（背面投影）。区画（左・中央・右）は、当てる山の列に合わせて自動で分かれます。'));
      break;
    }
    case 'pyro':
      fields.push(row('名前', txt(p.site, (v) => v && (P('pyro').site = v))));
      fields.push(row('置き場', choice([['barge', '水上の台'], ['land', '陸']], p.on, (v) => (P('pyro').on = v))));
      fields.push(row('筒の数', num(p.tubes, (v) => (P('pyro').tubes = v), { int: true, min: 1 }), unit('本')));
      fields.push(xz('始め', p.from, (v) => (P('pyro').from = v)), xz('終わり', p.to, (v) => (P('pyro').to = v)));
      fields.push(row('筒の高さ', num(p.height, (v) => (P('pyro').height = v)), unit('m')));
      {
        const lim = venue ? pyroLimits(doc, venue).get(n) : undefined;
        fields.push(
          h(
            'p',
            { class: 'vn-note' },
            lim
              ? lim.size
                ? `ここから打てるのは ${lim.size}号まで（客席まで ${Math.round(lim.distance)} m、保安距離から）。`
                : `客席まで ${Math.round(lim.distance)} m。保安距離が足りず、打てる玉がありません。`
              : '客席がないので、打てる大きさを出せません。',
          ),
        );
      }
      break;
    case 'seats':
      fields.push(row('名前', txt(p.name ?? '', (v) => (v ? (P('seats').name = v) : delete P('seats').name))));
      fields.push(xz('始め', p.from, (v) => (P('seats').from = v)), xz('終わり', p.to, (v) => (P('seats').to = v)));
      fields.push(h('p', { class: 'vn-note' }, '客席の一番前の線。花火の保安距離と飛沫の判定に使います。'));
      break;
    case 'shore': {
      fields.push(row('名前', txt(p.name ?? '', (v) => (v ? (P('shore').name = v) : delete P('shore').name))));
      const rim = !p.from || !p.to;
      const shape = h('div', { class: 'seg' });
      const toRim = () =>
        commit(() => {
          delete P('shore').from;
          delete P('shore').to;
        });
      const toLine = () => commit(() => Object.assign(P('shore'), defaultShoreLine()));
      shape.append(
        h('button', { class: rim ? 'on' : '', disabled: doc.water.kind === 'infinite', title: doc.water.kind === 'infinite' ? '水面が「果てなし」なので縁がありません' : '', onclick: () => (rim ? undefined : toRim()) }, '水面の縁ぜんぶ'),
        h('button', { class: rim ? '' : 'on', onclick: () => (rim ? toLine() : undefined) }, '線で引く'),
      );
      fields.push(row('形', shape));
      if (!rim) {
        fields.push(xz('始め', p.from!, (v) => (P('shore').from = v)), xz('終わり', p.to!, (v) => (P('shore').to = v)));
        fields.push(
          row(
            '陸の側',
            h('button', {
              class: 'btn',
              onclick: () =>
                commit(() => {
                  const q = P('shore');
                  [q.from, q.to] = [q.to, q.from];
                }),
              title: '始めと終わりを入れ替える',
            }, '反対にする'),
          ),
        );
      }
      fields.push(row('高さ', num(p.height, (v) => (P('shore').height = v), { min: 0.005, title: '水面から岸の上まで' }), unit('m（水面から）')));
      fields.push(row('舗装の幅', num(p.width, (v) => (P('shore').width = v), { min: 0 }), unit('m')));
      fields.push(
        h(
          'p',
          { class: 'vn-note' },
          rim
            ? '水面の縁をぐるりと囲む岸。舗装（縁石・歩道）の向こうは、地平線まで地面が続きます。'
            : '線の右側（図で左から右へ引くと下側＝客席の側）が陸です。図の細い目盛りが陸の側。舗装の向こうは、地平線まで地面が続きます。',
        ),
      );
      break;
    }
    case 'rail': {
      fields.push(row('名前', txt(p.name ?? '', (v) => (v ? (P('rail').name = v) : delete P('rail').name))));
      fields.push(xz('始め', p.from, (v) => (P('rail').from = v)), xz('終わり', p.to, (v) => (P('rail').to = v)));
      fields.push(row('高さ', num(p.height, (v) => (P('rail').height = v), { min: 0.01, title: '立っている地面から上の手すりまで' }), unit('m')));
      fields.push(row('柱の間隔', num(p.spacing, (v) => (P('rail').spacing = v), { min: 0.01 }), unit('m')));
      const g = groundAt(venue?.scenery, doc.water, (p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2);
      fields.push(h('p', { class: 'vn-note' }, g !== null ? `岸の上（水面から ${fmt(g)} m）に立ちます。` : '足元に岸がありません（水面の高さに立ちます）。'));
      break;
    }
    case 'crowd': {
      fields.push(row('名前', txt(p.name ?? '', (v) => (v ? (P('crowd').name = v) : delete P('crowd').name))));
      const pose = h('div', { class: 'seg' });
      for (const [v, label] of [['stand', '立つ'], ['sit', '座る']] as const) {
        pose.append(
          h('button', {
            class: p.pose === v ? 'on' : '',
            onclick: () =>
              commit(() => {
                const c = P('crowd');
                // the usual density goes with the pose, unless it was set by hand
                if (c.density === DENSITY[c.pose]) c.density = DENSITY[v];
                c.pose = v;
              }),
          }, label),
        );
      }
      fields.push(row('姿勢', pose));
      fields.push(xz('始め', p.from, (v) => (P('crowd').from = v)), xz('終わり', p.to, (v) => (P('crowd').to = v)));
      fields.push(row('奥行き', num(p.depth, (v) => (P('crowd').depth = v), { min: 0.01, title: '始めと終わりの線から後ろへ' }), unit('m')));
      fields.push(row('密度', num(p.density, (v) => (P('crowd').density = v), { min: 0.01, title: `立つ ${DENSITY.stand}・座る ${DENSITY.sit} 人/m² がふつう` }), unit('人/m²')));
      const all = peopleOf(p, n);
      const dry = all.filter((q) => onLand(venue?.scenery, doc.water, q.x, q.z)).length;
      fields.push(
        h(
          'p',
          { class: 'vn-note' },
          `${all.length.toLocaleString('ja-JP')} 人${dry < all.length ? `（水の上の ${all.length - dry} 人は描きません）` : ''}。線の右側（図で左から右へ引くと下側）に並び、機材の方を向きます。人は実物の大きさ（大人 1.5〜1.9 m、子ども 1〜1.35 m）。席（カメラ）からショーを塞ぐ人は、そのカメラでは描きません。`,
        ),
      );
      if (doc.scale === 'desk') fields.push(h('p', { class: 'vn-note' }, '机の会場の人も実物の大きさです（人形ではありません）。机の見本の会場には、人を置いていません。'));
      break;
    }
  }
  if (p.note) fields.push(h('p', { class: 'vn-note' }, p.note));
  const move = (dir: -1 | 1) =>
    commit((d) => {
      const k = n + dir;
      [d.parts[n], d.parts[k]] = [d.parts[k], d.parts[n]];
      sel = { part: k, fixture: null };
    });
  fields.push(
    h(
      'div',
      { class: 'vn-acts' },
      h('button', { class: 'btn', disabled: n === 0, onclick: () => move(-1), title: '順番は、同じグループの中の番号の振り方に効きます' }, '↑ 前へ'),
      h('button', { class: 'btn', disabled: n === doc.parts.length - 1, onclick: () => move(1), title: '順番は、同じグループの中の番号の振り方に効きます' }, '↓ 後へ'),
      h('button', { class: 'btn danger', onclick: () => removePart(n) }, '部品を消す'),
    ),
  );
  fill(box, h('h2', {}, `${PART_NAMES[p.kind]}「${partName(p) || '名前なし'}」`, h('small', {}, target)), ...fields);
}

function setCount(n: number, v: number) {
  const p = doc.parts[n] as WaterPart & { count: number };
  p.count = v;
  if (p.skip) p.skip = p.skip.filter((i) => i < v);
  if (p.nudge) p.nudge = p.nudge.filter((x) => x.i < v);
  if (p.skip && !p.skip.length) delete p.skip;
  if (p.nudge && !p.nudge.length) delete p.nudge;
}

function renderFixtureFields() {
  const box = $('fixture-fields');
  const n = sel.part;
  const p = n != null ? doc.parts[n] : null;
  if (n == null || !p || !isWaterPart(p) || p.kind === 'single') {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const skips = p.skip ?? [];
  const kids: (HTMLElement | null)[] = [];
  const i = sel.fixture;
  if (i != null) {
    const skipped = skips.includes(i);
    const before = Array.from({ length: i }, (_, k) => k).filter((k) => !skips.includes(k)).length;
    const first = Number(/\[(\d+)-/.exec(targets()[n].target)?.[1] ?? 0);
    const by = p.nudge?.find((x) => x.i === i)?.by ?? [0, 0];
    kids.push(h('h2', {}, '選んだ1台', h('small', {}, skipped ? `${i + 1}台目（外してある）` : `${i + 1}台目 = ${p.group}[${first + before}]`)));
    kids.push(row('ずらす', unit('x'), num(by[0], (v) => setNudge(n, i, [v, by[1]])), unit('z'), num(by[1], (v) => setNudge(n, i, [by[0], v]))));
    kids.push(
      h(
        'div',
        { class: 'vn-acts' },
        h('button', { class: 'btn', onclick: () => toggleSkip(n, i) }, skipped ? 'この1台を戻す' : 'この1台を外す'),
        h('button', { class: 'btn', disabled: !by[0] && !by[1], onclick: () => setNudge(n, i, [0, 0]) }, 'ずらしを戻す'),
      ),
    );
  } else {
    kids.push(h('h2', {}, '1台ずつ'), h('p', { class: 'vn-none' }, '図で、この部品の台をクリックすると1台を選べます。'));
  }
  kids.push(
    h('p', { class: 'vn-note' }, skips.length ? `外した台：${skips.length}台` : '外した台：なし'),
    skips.length ? h('div', { class: 'vn-skips' }, ...skips.map((k) => h('button', { class: 'btn', onclick: () => toggleSkip(n, k), title: 'クリックで戻す' }, `${k + 1}台目 戻す`))) : null,
    h('p', { class: 'vn-note' }, '外すと、その後ろの台の番号が1つずつ詰まります。番号で書いたキュー（grid[10-20] など）が指す台も変わります。'),
  );
  fill(box, ...kids);
}

function toggleSkip(n: number, i: number) {
  commit((d) => {
    const p = d.parts[n] as WaterPart;
    const s = new Set(p.skip ?? []);
    if (s.has(i)) s.delete(i);
    else s.add(i);
    if (s.size) p.skip = [...s].sort((a, b) => a - b);
    else delete p.skip;
  });
}

function setNudge(n: number, i: number, by: Pt) {
  commit((d) => {
    const p = d.parts[n] as WaterPart;
    const rest = (p.nudge ?? []).filter((x) => x.i !== i);
    if (by[0] || by[1]) rest.push({ i, by });
    rest.sort((a, b) => a.i - b.i);
    if (rest.length) p.nudge = rest;
    else delete p.nudge;
  });
}

function removePart(n: number) {
  commit((d) => {
    d.parts.splice(n, 1);
    sel = { part: null, fixture: null };
  });
}

function renderWarnings() {
  const box = $('warn-list');
  const count = (l: Finding['level']) => findings.filter((f) => f.level === l).length;
  const kids: HTMLElement[] = [h('h2', {}, '警告', h('small', {}, `${LEVEL_NAMES.stop} ${count('stop')}・${LEVEL_NAMES.danger} ${count('danger')}・${LEVEL_NAMES.note} ${count('note')}`))];
  if (!findings.length) kids.push(h('p', { class: 'vn-none' }, '警告はありません。'));
  for (const f of findings) {
    kids.push(
      h(
        'div',
        { class: `vn-warn${f.part != null ? ' go' : ''}`, onclick: () => f.part != null && select({ part: f.part, fixture: null }) },
        h('span', { class: `vn-dot ${f.level}`, title: LEVEL_NAMES[f.level] }),
        h('div', {}, h('b', { class: 'vn-rule' }, RULE_NAMES[f.rule]), f.text),
      ),
    );
  }
  const stops = count('stop');
  if (stops) kids.splice(1, 0, h('p', { class: 'vn-stop' }, `「止める」があるあいだは 3D で見られません（${stops} つ）。`));
  kids.push(h('p', { class: 'vn-note' }, DISCLAIMER));
  fill(box, ...kids);
}

function renderFooter() {
  const v = venue;
  const fixtures = v ? v.groups.reduce((a, g) => a + g.positions.length, 0) : 0;
  let flow = 0;
  let spray = 0;
  for (const g of v?.groups ?? []) {
    const k = kind(g.kind);
    flow += k.place.flow * g.positions.length;
    spray += (k.nozzle?.spray ?? 0) * g.positions.length;
  }
  for (const s of v?.screens ?? []) flow += kind(s.group).place.flow * (kind(s.group).place.flowPer === 'metre' ? s.width : 1);
  const tubes = v ? v.pyro.reduce((a, s) => a + s.tubes.length, 0) : 0;
  fill($('vn-foot'), 
    h('span', {}, '水の機材 ', h('b', {}, `${fixtures}台`)),
    h('span', {}, '水幕 ', h('b', {}, `${v?.screens.length ?? 0}枚`)),
    h('span', {}, '花火の筒 ', h('b', {}, `${tubes}本`)),
    h('span', { title: '機材の種類の表（src/fixtures/）の仮の流量から' }, 'ポンプ ', h('b', {}, `${fmt(flow)} L/s`)),
    h('span', { title: '3D の飛沫の粒（画質「高」）' }, '飛沫の粒 ', h('b', {}, fmt(spray))),
    v?.scenery?.crowds.length
      ? h('span', { title: '景色の客（水の上の人は数えない）' }, '客 ', h('b', {}, `${venuePeople(v.scenery, doc.water, focusOf(v.groups.flatMap((g) => g.positions.map((q) => [q[0], q[2]] as Pt)))).length.toLocaleString('ja-JP')}人`))
      : null,
    h('span', { class: 'spacer' }),
    cuesMenu,
  );
  renderCues();
}

// ------------------------------------------- 動かないキュー (dev-plan B4)
const SHOW_LABELS: Record<ShowVariant, string> = { lagoon: 'Rhapsody in Blue', fantasia: 'ファンタジア', hanabi: '花火版' };
let builtShows: { label: string; file: ShowFile }[] | null = null;

/** The shows counted: the three versions, and what the timeline editor autosaved. */
function countedShows(): { label: string; file: ShowFile }[] {
  builtShows ??= SHOW_VARIANTS.map((v) => ({ label: SHOW_LABELS[v.id], file: buildShow(undefined, v.id) }));
  return lastShow ? [...builtShows, lastShow] : [...builtShows];
}

const cuesBtn = h('button', { class: 'btn vn-cues-btn', title: '演出をこの会場で流したとき、狙う台が見つからないキューの数' });
const cuesPop = h('div', { class: 'menu-pop up vn-cues-pop', hidden: true });
const cuesMenu = h('div', { class: 'menu vn-cues' }, cuesBtn, cuesPop);
cuesBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const was = cuesPop.hidden;
  document.querySelectorAll<HTMLElement>('.menu-pop').forEach((m) => (m.hidden = true));
  cuesPop.hidden = !was;
});
cuesPop.addEventListener('click', (e) => e.stopPropagation());

function renderCues() {
  if (!venue) {
    fill(cuesBtn, '動かないキュー —');
    return;
  }
  const rows = countedShows().map((s) => {
    const own = getVenue(s.file.venue);
    return { ...s, own, r: cueReach(s.file, own, venue) };
  });
  const num = (r: CueReach) => h('b', { class: r.none ? 'bad' : '' }, String(r.none));
  const any = rows.some((x) => x.r.none || x.r.part);
  // the button names the built-in versions; the last project is in the list it opens
  const shown = rows.filter((x) => x !== rows[builtShows?.length ?? rows.length]);
  fill(cuesBtn,
    '動かないキュー　',
    ...(any
      ? shown.flatMap((x, i) => [i ? '・' : '', `${x.label} `, num(x.r), `／${x.r.all}`])
      : ['なし']),
    ' ▴',
  );
  const cell = (v: string | number, cls = '') => h('span', { class: cls }, String(v));
  const owns = [...new Set(rows.map((x) => x.own.name))];
  const lists: HTMLElement[] = [];
  const seen = new Set<string>();
  rows.forEach((x, k) => {
    const fresh = x.r.reasons.filter((r) => !seen.has(`${r.target}\n${r.why}`));
    for (const r of x.r.reasons) seen.add(`${r.target}\n${r.why}`);
    for (const r of fresh.slice(0, k === 0 ? 6 : 3))
      lists.push(h('div', { class: 'vn-cues-why' }, h('code', {}, r.target), cell(r.why), cell(k ? `${r.n}（${x.label}）` : String(r.n), 'n')));
  });
  fill(cuesPop,
    h('div', { class: 'vn-cues-head' }, `この会場で流すと（演出は${owns.join('・')}用）`),
    h('div', { class: 'vn-cues-row th' }, cell(''), cell('動かない'), cell('一部だけ'), cell('全部')),
    ...rows.map((x) =>
      h('div', { class: 'vn-cues-row' }, cell(x.own.name === owns[0] ? x.label : `${x.label}（${x.own.name}用）`), cell(x.r.none, x.r.none ? 'bad' : ''), cell(x.r.part), cell(x.r.all)),
    ),
    lists.length ? h('div', { class: 'vn-cues-sub' }, '動かない理由（多い順）') : null,
    ...lists,
    h('p', { class: 'vn-note' }, any
      ? '一部だけ＝狙った台の一部しか無い（外した台・番号の端）。本番画面は、動かないキューを飛ばして流れます。'
      : 'どのキューも、演出の会場と同じ数の台を狙えます。'),
  );
}

// ---------------------------------------------------------- selection
function select(s: Selection) {
  sel = s;
  clampSel();
  // new water parts and 1台を置く take the kind of the part last selected
  const p = sel.part != null ? doc.parts[sel.part] : null;
  if (p && isWaterPart(p)) placeKind = placeSel.value = p.fixture;
  renderParts();
  renderPartFields();
  renderFixtureFields();
  view.draw();
}

// ----------------------------------------------------------- new parts
function addPart(k: PartKind) {
  const [cx, cz] = view.centre();
  const size: Record<ScaleTier, number> = { desk: 0.4, garden: 2, plaza: 16, lagoon: 60 };
  const L = size[doc.scale];
  const s = SNAP[doc.scale];
  const r = (v: number) => Math.round(Math.round(v / s) * s * 1e6) / 1e6;
  const fixture = placeKind;
  const water = { group: groupFor(fixture), fixture };
  const nth = doc.parts.filter((p) => p.kind === k).length + 1;
  const name = `${PART_NAMES[k]}${nth}`;
  let p: Part;
  switch (k) {
    case 'line':
      p = { kind: 'line', name, ...water, count: 8, from: [r(cx - L / 2), cz], to: [r(cx + L / 2), cz] };
      break;
    case 'band':
      p = { kind: 'band', name, ...water, count: 16, from: [r(cx - L / 2), cz], to: [r(cx + L / 2), cz], pitch: r(L / 20) || s };
      break;
    case 'arc':
      p = { kind: 'arc', name, ...water, count: 10, center: [cx, cz], radius: r(L / 3) || s, a0: 30, a1: 150 };
      break;
    case 'ring':
      p = { kind: 'ring', name, ...water, count: 12, center: [cx, cz], radius: r(L / 5) || s, a0: 0 };
      break;
    case 'single':
      p = { kind: 'single', ...water, at: [cx, cz] };
      break;
    case 'screen':
      p = { kind: 'screen', name, fixture: 'screen', center: [cx, r(cz - L / 4)], width: r(L * 0.8), height: r(L / 6) || s };
      break;
    case 'projector': {
      // one per venue: choose the one there is
      const there = doc.parts.findIndex((q) => q.kind === 'projector');
      if (there >= 0) {
        sel = { part: there, fixture: null };
        renderAll();
        toast('プロジェクターは1台です。今のものを選びました');
        return;
      }
      // behind the first screen, facing it (rear projection), else behind the middle
      const sc = doc.parts.find((q) => q.kind === 'screen') as Extract<Part, { kind: 'screen' }> | undefined;
      const aim: Pt = sc ? [sc.center[0], sc.center[1]] : [cx, r(cz - L / 4)];
      p = { kind: 'projector', name: 'プロジェクター', at: [aim[0], r(aim[1] - L * 0.66) || aim[1] - s], height: r(L / 40) || s, aim };
      break;
    }
    case 'pyro':
      p = { kind: 'pyro', site: `花火の台${nth}`, on: 'barge', tubes: 5, from: [r(cx - L / 3), r(cz - L)], to: [r(cx + L / 3), r(cz - L)], height: 1 };
      break;
    case 'seats':
      p = { kind: 'seats', name: '客席', from: [r(cx - L / 2), r(cz + L / 2)], to: [r(cx + L / 2), r(cz + L / 2)] };
      break;
    case 'shore': {
      const z = SCENE_SIZE[doc.scale];
      p = doc.water.kind === 'infinite' ? { kind: 'shore', ...defaultShoreLine(), height: z.shoreHeight, width: z.shoreWidth } : { kind: 'shore', height: z.shoreHeight, width: z.shoreWidth };
      break;
    }
    case 'rail': {
      // along the front of the seats (or the first bank), a little behind it
      const [from, to] = frontLine();
      const { n } = lineFrame(from, to);
      const off = Math.max(s, SCENE_SIZE[doc.scale].shoreWidth * 0.05);
      const push = (q: Pt): Pt => [r(q[0] + n[0] * off), r(q[1] + n[1] * off)];
      p = { kind: 'rail', name, from: push(from), to: push(to), height: SCENE_SIZE[doc.scale].railHeight, spacing: SCENE_SIZE[doc.scale].railSpacing };
      break;
    }
    case 'crowd': {
      const [from, to] = frontLine();
      const { n } = lineFrame(from, to);
      const off = Math.max(s, SCENE_SIZE[doc.scale].shoreWidth * 0.15);
      const push = (q: Pt): Pt => [r(q[0] + n[0] * off), r(q[1] + n[1] * off)];
      p = { kind: 'crowd', name, from: push(from), to: push(to), depth: SCENE_SIZE[doc.scale].crowdDepth, density: DENSITY.stand, pose: 'stand' };
      if (doc.scale === 'desk') toast('人は実物の大きさです（机の会場でも人形ではありません）');
      break;
    }
  }
  commit((d) => {
    d.parts.push(p);
    sel = { part: d.parts.length - 1, fixture: null };
  });
}

/** Where new rails and crowds line up: the seats' front line, else a line across the view. */
function frontLine(): [Pt, Pt] {
  const seats = doc.parts.find((q) => q.kind === 'seats') as Extract<Part, { kind: 'seats' }> | undefined;
  if (seats) return [seats.from, seats.to];
  const d = defaultShoreLine();
  return [d.from, d.to];
}

/** A straight bank for this venue: along the seats' front line, else across the view below its middle. */
function defaultShoreLine(): { from: Pt; to: Pt } {
  const seats = doc.parts.find((q) => q.kind === 'seats') as Extract<Part, { kind: 'seats' }> | undefined;
  if (seats) return { from: [...seats.from], to: [...seats.to] };
  const [cx, cz] = view.centre();
  const L = { desk: 0.4, garden: 2, plaza: 16, lagoon: 60 }[doc.scale];
  return { from: [cx - L, cz + L / 2], to: [cx + L, cz + L / 2] };
}

function place(at: Pt) {
  commit((d) => {
    d.parts.push({ kind: 'single', group: groupFor(placeKind), fixture: placeKind, at });
    sel = { part: d.parts.length - 1, fixture: null };
  });
}

// ---------------------------------------------------------------- view
const view = new TopView($<HTMLCanvasElement>('vn-canvas'), {
  doc: () => doc,
  selection: () => sel,
  findings: () => findings,
  select,
  begin() {
    ensureOwn();
    undoStack.push(JSON.stringify(doc));
    redoStack.length = 0;
    return true;
  },
  live(change) {
    change(doc);
    rebuild();
    renderFooter();
    view.draw();
  },
  end() {
    save();
    renderAll();
  },
  place,
  tool: () => tool,
  pyroLimit: (n) => (venue ? (pyroLimits(doc, venue).get(n)?.size ?? null) : null),
  venue: () => venue,
});

// ---------------------------------------------------------------- menus
function menu(btnId: string, popId: string, build: (pop: HTMLElement) => void) {
  const btn = $(btnId);
  const pop = $(popId);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const was = pop.hidden;
    document.querySelectorAll<HTMLElement>('.menu-pop').forEach((m) => (m.hidden = true));
    if (was) {
      build(pop);
      pop.hidden = false;
    }
  });
  pop.addEventListener('click', () => (pop.hidden = true));
}
document.addEventListener('click', () => document.querySelectorAll<HTMLElement>('.menu-pop').forEach((m) => (m.hidden = true)));

menu('venue-btn', 'venue-pop', (pop) => {
  const item = (label: string, act: () => void, cur = false) => h('button', { class: cur ? 'cur' : '', onclick: act }, label);
  const mine = loadMyVenues();
  fill(pop, 
    h('div', { class: 'sub' }, '組み込み'),
    ...VENUE_DOCS.map((d) => item(d.name, () => open(d.id), d.id === doc.id)),
    h('div', { class: 'sub' }, '自分の会場（この端末）'),
    ...(mine.length ? mine.map((d) => item(d.name, () => open(d.id), d.id === doc.id)) : [h('div', { class: 'sub' }, 'まだありません')]),
    h('hr'),
    item('新しい会場', newVenue),
    item('この会場を写す', copyVenue),
    h('hr'),
    item('JSON を書き出す', exportJson),
    item('JSON を読み込む…', () => $('import-input').click()),
    ...(builtIn ? [] : [h('hr'), item('この会場を消す…', removeVenue)]),
  );
});

menu('add-btn', 'add-pop', (pop) => {
  const kinds: [PartKind, string][] = [
    ['line', '列（まっすぐ等間隔）'],
    ['band', '帯（2列の千鳥）'],
    ['arc', '弧'],
    ['ring', '円'],
    ['single', '1台'],
    ['screen', '水幕'],
    ['projector', 'プロジェクター（水幕の映像）'],
    ['pyro', '花火の台'],
    ['seats', '客席'],
  ];
  const scenery: [PartKind, string][] = [
    ['shore', '岸（護岸・歩道・地面）'],
    ['rail', '手すり・柵'],
    ['crowd', '客（人の群れ）'],
  ];
  fill(pop, 
    h('div', { class: 'sub' }, `水の部品の機材：${kind(placeKind).label}（図の左上で選ぶ）`),
    ...kinds.map(([k, label]) => h('button', { onclick: () => addPart(k) }, label)),
    h('div', { class: 'sub' }, '景色（描くだけ。キューでは動かない）'),
    ...scenery.map(([k, label]) => h('button', { onclick: () => addPart(k) }, label)),
  );
});

function newVenue() {
  const d: VenueDoc = {
    id: newVenueId(),
    name: '新しい会場',
    scale: 'garden',
    water: { kind: 'rect', width: 3, depth: 2 },
    parts: [{ kind: 'seats', name: '正面', from: [-2, 2], to: [2, 2] }],
  };
  saveMyVenue(d);
  open(d.id);
}

function copyVenue() {
  const d = structuredClone(doc);
  d.id = newVenueId();
  d.name = `${doc.name}の写し`;
  saveMyVenue(d);
  open(d.id, false);
  toast(`写し「${d.name}」を作りました`);
}

function exportJson() {
  const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${doc.id}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${doc.id}.json を書き出しました。src/venues/builtin/ に置くと組み込みの会場になります`);
}

$<HTMLInputElement>('import-input').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text()) as VenueDoc;
    if (!d || !Array.isArray(d.parts) || !d.water || !d.scale) throw new Error('会場のファイルではありません（parts・water・scale が要ります）');
    buildVenue(d);
    if (!d.id || VENUE_DOCS.some((x) => x.id === d.id) || loadMyVenues().some((x) => x.id === d.id)) d.id = newVenueId();
    d.name ||= file.name.replace(/\.json$/, '');
    saveMyVenue(d);
    open(d.id);
    toast(`「${d.name}」を読み込みました`);
  } catch (err) {
    toast(`読み込めませんでした：${err instanceof Error ? err.message : String(err)}`);
  }
});

function removeVenue() {
  if (!confirm(`「${doc.name}」を消します。この端末から消え、元に戻せません。`)) return;
  deleteMyVenue(doc.id);
  open('lagoon');
}

// ---------------------------------------------------------------- tools
const placeSel = $<HTMLSelectElement>('place-kind');
for (const k of WATER_KINDS) placeSel.add(new Option(k.label, k.id));
placeSel.value = placeKind;
placeSel.addEventListener('change', () => (placeKind = placeSel.value));
function setTool(t: Tool) {
  tool = t;
  document.querySelectorAll<HTMLButtonElement>('#tool-seg button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  renderBar();
}
document.querySelectorAll<HTMLButtonElement>('#tool-seg button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));

$('undo-btn').addEventListener('click', () => undo(undoStack, redoStack));
$('redo-btn').addEventListener('click', () => undo(redoStack, undoStack));
$('zoom-in').addEventListener('click', () => view.zoom(1.25));
$('zoom-out').addEventListener('click', () => view.zoom(0.8));
$('zoom-fit').addEventListener('click', () => view.fit(true));
// opened from the editor (会場 ▾ › この会場を編集): go back to that window
// instead of opening a second editor on the same autosave
$('back-btn').addEventListener('click', () => {
  const opener = window.opener as Window | null;
  if (opener && !opener.closed && opener.location.pathname.endsWith('/edit.html')) {
    opener.focus();
    window.close();
  } else location.href = '/edit.html';
});
$('view3d-btn').addEventListener('click', () => {
  const project = lastId && !isSampleId(lastId) ? `&project=${encodeURIComponent(lastId)}` : '';
  window.open(`/play.html?venue=${encodeURIComponent(doc.id)}${project}`, 'water-show-3d');
});

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    if (e.shiftKey) undo(redoStack, undoStack);
    else undo(undoStack, redoStack);
    return;
  }
  if (typing) return;
  if (e.key === 'Escape') {
    if (tool !== 'select') setTool('select');
    else select({ part: null, fixture: null });
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.part != null) {
    e.preventDefault();
    const p = doc.parts[sel.part];
    if (sel.fixture != null && isWaterPart(p) && p.kind !== 'single') toggleSkip(sel.part, sel.fixture);
    else removePart(sel.part);
  }
});

// ---------------------------------------------------------------- start
const asked = new URLSearchParams(location.search).get('venue');
let last: string | null = null;
try {
  last = localStorage.getItem(LAST_KEY);
} catch {
  /* start from the lagoon */
}
open(asked ?? last ?? 'lagoon');
(window as unknown as { __venueEditor: unknown }).__venueEditor = { doc: () => doc, sel: () => sel, findings: () => findings, venue: () => venue, open, view, builtIn: () => builtIn, undoDepth: () => undoStack.length };
