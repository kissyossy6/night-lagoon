import { cueTime, resolveTarget } from '../show/cues';
import { zoneName } from '../show/checks';
import { buildLayout, type Layout } from '../show/layout';
import { LAGOON, type LaneStyle, type Venue } from '../venues';
import { DEFAULT_FIRE, KINDS, WATER_PARAMS, lanesOf, type FixtureKind, type ParamDef } from '../fixtures';
import { JAZZ, RHAPSODY, SECTIONS, barToSeconds } from '../show/song';
import { normaliseSections } from '../show/sections';
import { MINE, SHELLS, SHELL_NAMES, sizeRow } from '../pyro/shells';
import { fireBurn, resolveTubes } from '../pyro/schedule';
import type { Clip, Cue, Ease, Fire, FirePattern, MacroName, Order, ParamKey, SceneName, ShellName, ShowFile, VideoFit } from '../show/types';

/**
 * Editor-side helpers over the show data model: lanes, timing grid, block
 * extents and labels. Pure functions; no DOM.
 */

/*
 * The venue the editor works in (docs/detailed-design.md 6.5): the show
 * file's `venue`, the lagoon when it has none. useVenue() rebuilds these from
 * another venue; importers see the new values (live bindings).
 */
let VENUE: Venue = LAGOON;
const countCache = new Map<string, number>();

/** Group layout (group membership does not depend on the quality tier). */
export let LAYOUT: Layout = buildLayout(LAGOON, 'low');

/** One editor lane per fixture group, named and coloured by its kind (src/fixtures/). */
export type LaneDef = LaneStyle & { kind: string; missing?: boolean };

/** The venue's own lanes. */
let BASE_LANES: LaneDef[] = lanesOf(LAGOON);

/**
 * Cues whose target finds no lane in this venue (a group it does not have)
 * go to this grey lane at the bottom, so switching venues never hides them.
 */
const MISSING_LANE: LaneDef = { group: '', kind: '', name: 'この会場に無い', base: '#3a3a3e', accent: '#8a8a90', missing: true };

/** The lanes shown: the venue's, then MISSING_LANE while some cue needs it. */
export let LANES: LaneDef[] = [...BASE_LANES];

/** The kind of fixture a lane holds; unknown lanes are plain water. */
export const kindOfLane = (lane: number): FixtureKind => KINDS[LANES[lane]?.kind] ?? KINDS.grid;

/** Named target ranges, for the inspector's target presets and block labels. */
export let TARGET_PRESETS: { target: string; name: string }[] = LAGOON.selections.map((v) => ({ target: v.target, name: v.name }));
let PRESET_NAME = new Map(TARGET_PRESETS.map((p) => [p.target, p.name]));

/** The venue the editor works in now. */
export const currentVenue = () => VENUE;

/** Work in another venue; false when it is the one already in use. */
export function useVenue(v: Venue): boolean {
  if (v === VENUE) return false;
  VENUE = v;
  LAYOUT = buildLayout(v, 'low');
  BASE_LANES = lanesOf(v);
  LANES = [...BASE_LANES];
  TARGET_PRESETS = v.selections.map((x) => ({ target: x.target, name: x.name }));
  PRESET_NAME = new Map(TARGET_PRESETS.map((p) => [p.target, p.name]));
  countCache.clear();
  return true;
}

/** Show MISSING_LANE exactly while some cue of the file has no lane of the venue. */
export function syncMissingLane(file: ShowFile) {
  const need = file.cues.some((c) => baseLaneOf(c) < 0);
  if (need !== (LANES.length > BASE_LANES.length)) LANES = need ? [...BASE_LANES, MISSING_LANE] : [...BASE_LANES];
}

export const MACROS: { name: MacroName; ja: string }[] = [
  { name: 'wave', ja: '波 (値が上下に揺れる)' },
  { name: 'sway', ja: '首振り (パンが左右に揺れる)' },
  { name: 'pulse', ja: 'パルス (短く噴いて戻る)' },
  { name: 'chase', ja: 'チェイス (順番に噴く)' },
  { name: 'bloom', ja: '開花 (チルトを開く)' },
  { name: 'rainbow', ja: '虹 (色相を並べる)' },
  { name: 'spread', ja: '隊形 (並び順に角度を割り振る: 扇・交差)' },
  { name: 'lean', ja: '傾け (全員が同じ角度へ倒して戻る)' },
  { name: 'follow', ja: '追従 (音楽の音量に合わせて動く)' },
];

export interface ArgDef {
  key: string;
  ja: string;
  def: number | string;
  step?: number;
  options?: string[];
}

/** Macro arguments and their defaults (mirrors expand() in show/cues.ts). */
export const MACRO_ARGS: Record<MacroName, ArgDef[]> = {
  wave: [
    { key: 'param', ja: '対象', def: 'pressure', options: ['pressure', 'pan', 'tilt'] },
    { key: 'base', ja: '中心値', def: 0.6, step: 0.05 },
    { key: 'amp', ja: '振幅', def: 0.3, step: 0.05 },
    { key: 'period', ja: '周期 秒', def: 2, step: 0.25 },
    { key: 'cycles', ja: '回数', def: 2, step: 1 },
    { key: 'dur', ja: '長さ 秒', def: '周期×回数', step: 0.25 },
  ],
  sway: [
    { key: 'param', ja: '対象', def: 'pan', options: ['pan', 'tilt', 'pressure'] },
    { key: 'base', ja: '中心値', def: 0, step: 1 },
    { key: 'amp', ja: '振幅', def: 40, step: 1 },
    { key: 'period', ja: '周期 秒', def: 2, step: 0.25 },
    { key: 'cycles', ja: '回数', def: 2, step: 1 },
    { key: 'dur', ja: '長さ 秒', def: '周期×回数', step: 0.25 },
  ],
  pulse: [
    { key: 'level', ja: '高さ', def: 1, step: 0.05 },
    { key: 'hold', ja: '保持 秒', def: 0.3, step: 0.05 },
    { key: 'rest', ja: '戻り値', def: 0, step: 0.05 },
    { key: 'attack', ja: '立上り 秒', def: 0.05, step: 0.01 },
    { key: 'release', ja: '減衰 秒', def: 0.15, step: 0.01 },
  ],
  chase: [
    { key: 'speed', ja: '速さ 台/秒', def: 12, step: 1 },
    { key: 'hold', ja: '保持 秒', def: 0.35, step: 0.05 },
    { key: 'laps', ja: '周回', def: 1, step: 1 },
    { key: 'level', ja: '高さ', def: 1, step: 0.05 },
    { key: 'rest', ja: '戻り値', def: 0, step: 0.05 },
  ],
  bloom: [
    { key: 'to', ja: 'チルト°', def: 25, step: 1 },
    { key: 'dur', ja: '長さ 秒', def: 2, step: 0.25 },
  ],
  rainbow: [
    { key: 'hue', ja: '開始色相', def: 0, step: 0.05 },
    { key: 'span', ja: '色相幅', def: 1, step: 0.05 },
  ],
  spread: [
    { key: 'param', ja: '対象', def: 'pan', options: ['pan', 'tilt'] },
    { key: 'from', ja: '先頭の角度°', def: -45, step: 1 },
    { key: 'to', ja: '末尾の角度°', def: 45, step: 1 },
    { key: 'dur', ja: '長さ 秒', def: 2, step: 0.25 },
  ],
  follow: [
    { key: 'curve', ja: '音量', def: 'level', options: ['level', 'low', 'mid', 'high'] },
    { key: 'param', ja: '対象', def: 'pressure', options: ['pressure', 'intensity'] },
    { key: 'min', ja: '最小', def: 0.2, step: 0.05 },
    { key: 'max', ja: '最大', def: 0.8, step: 0.05 },
    { key: 'dur', ja: '長さ 秒', def: 8, step: 0.5 },
    { key: 'step', ja: '刻み 秒', def: 0.25, step: 0.05 },
  ],
  lean: [
    { key: 'param', ja: '対象', def: 'pan', options: ['pan', 'tilt'] },
    { key: 'angle', ja: '角度°', def: 40, step: 1 },
    { key: 'dur', ja: '動く時間 秒', def: 1.5, step: 0.25 },
    { key: 'hold', ja: '保持 秒', def: 1, step: 0.25 },
    { key: 'back', ja: '戻り角度° (stay で戻らない)', def: 0, step: 1 },
  ],
};

export type { ParamDef };

/** The values a water cue sets (the fixture table's, src/fixtures/water.ts). */
export const PARAMS: ParamDef[] = WATER_PARAMS;

export const EASES: { v: Ease; ja: string }[] = [
  { v: 'linear', ja: '直線' },
  { v: 'in', ja: 'イーズイン' },
  { v: 'out', ja: 'イーズアウト' },
  { v: 'inOut', ja: 'イーズインアウト' },
  { v: 'step', ja: 'ステップ (即時)' },
];

export const ORDERS: { v: Order; ja: string }[] = [
  { v: 'index', ja: '番号順' },
  { v: 'reverse', ja: '逆順' },
  { v: 'center', ja: '中央から' },
  { v: 'edges', ja: '両端から' },
  { v: 'random', ja: 'ランダム' },
];

/** Projection scenes a water-screen cue can play (src/screen/projection.ts). */
export const SCENES: { v: SceneName; ja: string; short: string }[] = [
  { v: 'intro', ja: 'イントロ — 夜空とオーロラ', short: 'イントロ' },
  { v: 'awakening', ja: '目覚め — 光の流れ', short: '目覚め' },
  { v: 'theme', ja: 'テーマ — 色の面と波', short: 'テーマ' },
  { v: 'story', ja: '物語 — 紙の船と月', short: '船' },
  { v: 'build', ja: 'ビルド — 放射する光', short: 'ビルド' },
  { v: 'finale', ja: 'フィナーレ — 虹', short: '虹' },
  { v: 'coda', ja: 'コーダ — 日の出', short: '日の出' },
  { v: 'rhapsody', ja: 'ラプソディ — 青地に白い線の街 (ファンタジア風)', short: '街' },
  { v: 'jazz', ja: '夜の窓 — 3つの山に灯る窓 (ファンタジア風)', short: '窓' },
];

/** How a video fills the 7.7:1 screen. */
export const FITS: { v: VideoFit; ja: string }[] = [
  { v: 'cover', ja: '横いっぱい (上下を切る)' },
  { v: 'contain', ja: '全体を映す (左右は黒)' },
  { v: 'stretch', ja: '引き伸ばす' },
];

/** Length (s) of a scene, as drawn for its song section. */
export function sceneLength(scene: SceneName): number {
  if (scene === 'rhapsody') return RHAPSODY.length;
  if (scene === 'jazz') return JAZZ.length;
  const s = SECTIONS.find((x) => x.name === scene);
  return s ? barToSeconds(s.to) - barToSeconds(s.from) : 0;
}


/** Shell kinds for the inspector, in the order of the requirements (A1). */
export const SHELL_OPTIONS: { v: ShellName; ja: string }[] = SHELL_NAMES.map((v) => ({ v, ja: SHELLS[v].ja }));

/** Fire.pattern, as the inspector names them ('' = every tube the same). */
export const PATTERN_OPTIONS: { v: FirePattern | ''; ja: string }[] = [
  { v: '', ja: 'なし (全部同じ)' },
  { v: 'fan', ja: '扇' },
  { v: 'v', ja: 'V字' },
  { v: 'x', ja: 'X字 (交差)' },
  { v: 'sweep-lr', ja: '順に振る 左→右' },
  { v: 'sweep-rl', ja: '順に振る 右→左' },
  { v: 'sweep-out', ja: '順に振る 中央から外' },
];

/** A new fireworks cue: one 5号 菊, from the middle of the tubes. */
export { DEFAULT_FIRE };

/** Seconds from the launch to the burst (the cue's t): drawn before the block. */
export function leadOf(cue: Cue): number {
  return cue.fire ? sizeRow(fireSize(cue.fire)).rise : 0;
}

function fireSize(f: Fire): number {
  return f.shell === 'mine' ? Math.min(MINE.maxSize, Math.max(MINE.minSize, f.size)) : Math.min(10, Math.max(2.5, Number(f.size) || 2.5));
}

function fireSpan(f: Fire): number {
  const kind = SHELLS[f.shell] ?? SHELLS.kiku;
  const count = Math.max(1, Math.round(f.count ?? (f.shell === 'mine' ? MINE.count : 1)));
  return (count - 1) * Math.max(0.02, f.interval ?? 0.25) + fireBurn(f, kind.burn) + (f.shell === 'senrin' ? 1.5 : 0);
}

/** Water channels or tubes a cue's target names. */
export function targetCountOf(cue: Cue): number {
  return cue.fire ? resolveTubes(cue.target, LAYOUT).length : targetCount(cue.target);
}

/** Lanes whose cues can switch the projected picture. */
export const isScreenLane = (lane: number) => kindOfLane(lane).cue.sections.includes('clip');

// ------------------------------------------------------------------ timing

type Timing = Pick<ShowFile, 'bpm' | 'beatsPerBar' | 'offset'>;

export const secPerBeat = (f: Timing) => 60 / f.bpm;
export const secPerBar = (f: Timing) => secPerBeat(f) * f.beatsPerBar;

/** Seconds of a cue's t, or NaN if it cannot be parsed. */
export function startOf(cue: Cue, f: Timing): number {
  const t = cueTime(cue.t, f);
  return Number.isFinite(t) ? t : NaN;
}

export function snapToBeat(t: number, f: Timing): number {
  const spb = secPerBeat(f);
  return f.offset + Math.round((t - f.offset) / spb) * spb;
}

/** "bar:beat" when t is on the beat grid, else seconds (ms precision). */
export function encodeTime(t: number, f: Timing): number | string {
  const spb = secPerBeat(f);
  const b = (t - f.offset) / spb;
  const rb = Math.round(b);
  if (rb >= 0 && Math.abs(b - rb) < 1e-6) {
    return `${Math.floor(rb / f.beatsPerBar) + 1}:${(rb % f.beatsPerBar) + 1}`;
  }
  return Math.round(t * 1000) / 1000;
}

/** Display form "bar:beat.xx" for any time. */
export function barBeatLabel(t: number, f: Timing): string {
  const b = Math.max(0, (t - f.offset) / secPerBeat(f));
  const bar = Math.floor(b / f.beatsPerBar) + 1;
  const beat = b - (bar - 1) * f.beatsPerBar + 1;
  return `${bar}:${Math.floor(beat)}`;
}

export function clockLabel(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

/** Parse the inspector's t field: "bar:beat" or seconds. */
export function parseTimeInput(s: string): number | string | null {
  const v = s.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Number(v);
  if (/^\d+:\d+(\.\d+)?$/.test(v)) {
    const [bar, beat] = v.split(':').map(Number);
    return bar >= 1 && beat >= 1 ? v : null;
  }
  return null;
}

// ------------------------------------------------------------- cue extents

/** Index of the lane a cue lives in (the first group its target names), or -1. */
export function laneOf(cue: Cue): number {
  const l = baseLaneOf(cue);
  return l < 0 && LANES.length > BASE_LANES.length ? BASE_LANES.length : l;
}

function baseLaneOf(cue: Cue): number {
  let first = String(cue.target ?? '').split(',')[0].trim();
  // a named selection ('@前列') lives in the lane of the group it names
  for (let k = 0; first.startsWith('@') && k < 4; k++) first = (LAYOUT.selections[first.slice(1)] ?? '').split(',')[0].trim();
  const m = /^([a-zA-Z]+)/.exec(first);
  return m ? BASE_LANES.findIndex((l) => l.group === m[1]) : -1;
}

export function targetCount(target: string): number {
  let n = countCache.get(target);
  if (n === undefined) {
    n = resolveTarget(String(target ?? ''), LAYOUT).length;
    countCache.set(target, n);
  }
  return n;
}

function maxRank(n: number, order: Order | undefined): number {
  if (n <= 1) return 0;
  return order === 'center' || order === 'edges' ? (n - 1) / 2 : n - 1;
}

const num = (v: number | string | undefined, d: number) => {
  const x = v === undefined || v === '' ? d : Number(v);
  return Number.isFinite(x) ? x : d;
};

/** Seconds of stagger spread across the target. */
export function spreadOf(cue: Cue): number {
  if (cue.fire) return 0;
  return Math.max(0, cue.stagger ?? 0) * maxRank(targetCount(cue.target), cue.order);
}

/** Main duration of a cue (without stagger spread), estimated from args for macros. */
export function bodyOf(cue: Cue): number {
  if (cue.fire) return fireSpan(cue.fire);
  const a = cue.args ?? {};
  switch (cue.macro) {
    case 'wave':
    case 'sway':
      return num(a.dur, num(a.period, 2) * num(a.cycles, 2));
    case 'pulse':
      return num(a.hold, 0.3) + num(a.release, 0.15);
    case 'chase': {
      const n = targetCount(cue.target);
      return (n * num(a.laps, 1)) / Math.max(0.01, num(a.speed, 12)) + num(a.hold, 0.35) + 0.2;
    }
    case 'bloom':
    case 'spread':
      return num(a.dur, 2);
    case 'follow':
      return num(a.dur, 8);
    case 'lean':
      return a.back === 'stay' ? num(a.dur, 1.5) : num(a.dur, 1.5) * 2 + num(a.hold, 1);
    default:
      return Math.max(0, cue.dur ?? 0);
  }
}

/** Seconds from the cue's start to the end of its last fixture's motion. */
export function spanOf(cue: Cue): number {
  // chase walks the target on its own clock and ignores stagger
  return bodyOf(cue) + (cue.macro === 'chase' ? 0 : spreadOf(cue));
}

/** What the right-edge drag edits for this cue. */
export type DurField = { kind: 'dur' } | { kind: 'arg'; key: string; extra: number } | null;
export function durField(cue: Cue): DurField {
  if (cue.fire) return null;
  switch (cue.macro) {
    case 'wave':
    case 'sway':
    case 'bloom':
    case 'spread':
    case 'follow':
      return { kind: 'arg', key: 'dur', extra: 0 };
    case 'lean':
      return { kind: 'arg', key: 'hold', extra: num(cue.args?.dur, 1.5) * 2 };
    case 'pulse':
      return { kind: 'arg', key: 'hold', extra: num(cue.args?.release, 0.15) };
    case 'chase':
      return null;
    default:
      return { kind: 'dur' };
  }
}

// ------------------------------------------------------------------ labels

const fmt = (v: number) => String(Math.round(v * 100) / 100).replace(/^0\./, '.').replace(/^-0\./, '-.');

export function cueLabel(cue: Cue): string {
  if (cue.label) return cue.label;
  if (cue.fire) return fireLabel(cue.fire);
  let main: string;
  if (cue.macro) {
    main = cue.macro;
  } else {
    const s = cue.set ?? {};
    const parts: string[] = [];
    if (s.pressure !== undefined) parts.push(`pressure ${fmt(s.pressure)}`);
    if (s.pan !== undefined) parts.push(`pan ${fmt(s.pan)}`);
    if (s.tilt !== undefined) parts.push(`tilt ${fmt(s.tilt)}`);
    if (s.color !== undefined) parts.push('color');
    if (s.intensity !== undefined) parts.push(`int ${fmt(s.intensity)}`);
    if (cue.clip) parts.push(clipLabel(cue.clip));
    main = parts.join(' · ') || '(空)';
  }
  // the projector's cues say which zone they light (左・中央・右, or 全部)
  if (/^projector\b/.test(String(cue.target ?? '')) && LAYOUT.projector.length > 1) {
    const mine = new Set(resolveTarget(cue.target, LAYOUT));
    const zones = LAYOUT.projector.map((z, k) => (mine.has(z.index) ? zoneName(k, LAYOUT.projector.length) : '')).filter(Boolean);
    main = `${zones.length === LAYOUT.projector.length ? '全部' : zones.join('・')}  ${main}`;
  }
  return main;
}

function fireLabel(f: Fire): string {
  const name = SHELLS[f.shell]?.ja ?? f.shell;
  const n = f.count ?? (f.shell === 'mine' ? MINE.count : 1);
  return `${name} ${fmt(fireSize(f)).replace(/^\./, '0.')}号${n > 1 ? ` ×${n}` : ''}`;
}

function clipLabel(clip: Clip): string {
  if (clip.scene === 'sync') return '映像 時刻どおり';
  if (clip.scene === 'video') return `動画 ${String(clip.src ?? '').replace(/^.*\//, '') || '(未選択)'}`;
  return `映像 ${SCENES.find((x) => x.v === clip.scene)?.short ?? clip.scene}`;
}

/** Short name for the target when it is not just the lane's whole group. */
export function targetSuffix(cue: Cue): string {
  const lane = laneOf(cue);
  const t = String(cue.target ?? '').replace(/\s+/g, '');
  if (lane >= 0 && t === LANES[lane].group) return '';
  return PRESET_NAME.get(t) ?? t;
}

export function targetName(target: string): string {
  return PRESET_NAME.get(target.replace(/\s+/g, '')) ?? target;
}

/** Fill colours of a block: one colour, or a hue gradient for rainbow. */
export function cueColors(cue: Cue, lane: number): string[] {
  if (cue.macro === 'rainbow') {
    const h0 = num(cue.args?.hue, 0);
    const span = num(cue.args?.span, 1);
    return [0, 0.25, 0.5, 0.75, 1].map((k) => `hsl(${(((h0 + span * k) % 1) + 1) % 1 * 360}, 85%, 48%)`);
  }
  const fc = cue.fire?.colors?.filter((x) => /^#[0-9a-f]{6}$/i.test(x));
  if (fc?.length) return fc;
  const c = cue.set?.color;
  if (c && /^#[0-9a-f]{6}$/i.test(c)) return [c];
  return [LANES[Math.max(0, lane)].base];
}

/** Perceived luminance 0..1 of a #rrggbb colour. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return 0.5;
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// --------------------------------------------------------------- show files

export function emptyShow(base?: Partial<ShowFile>): ShowFile {
  return {
    title: '新しいショー',
    bpm: base?.bpm ?? 120,
    beatsPerBar: base?.beatsPerBar ?? 4,
    offset: base?.offset ?? 0,
    duration: base?.duration ?? 180,
    cues: [],
  };
}

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Validate and normalise an imported show file. Throws with a Japanese message. */
export function normaliseShow(x: unknown): ShowFile {
  if (!x || typeof x !== 'object') throw new Error('JSON がオブジェクトではありません');
  const o = x as Partial<ShowFile>;
  if (!Array.isArray(o.cues)) throw new Error('cues 配列がありません');
  for (const [i, c] of o.cues.entries()) {
    if (!c || typeof c !== 'object') throw new Error(`cues[${i}] がオブジェクトではありません`);
    if (typeof c.t !== 'number' && typeof c.t !== 'string') throw new Error(`cues[${i}].t がありません`);
    if (typeof c.target !== 'string') throw new Error(`cues[${i}].target がありません`);
  }
  return {
    title: typeof o.title === 'string' ? o.title : '無題',
    bpm: Number(o.bpm) > 0 ? Number(o.bpm) : 120,
    beatsPerBar: Number(o.beatsPerBar) > 0 ? Number(o.beatsPerBar) : 4,
    offset: Number(o.offset) || 0,
    duration: Number(o.duration) > 0 ? Number(o.duration) : 180,
    cues: o.cues as Cue[],
    // the venue it plays in (missing = the lagoon), kept across reloads and imports
    ...(typeof o.venue === 'string' && o.venue && o.venue !== 'lagoon' ? { venue: o.venue } : {}),
    ...(normaliseSections(o.sections) ? { sections: normaliseSections(o.sections) } : {}),
  };
}
