import { CH, CHANNELS, HEAD_MAX_DEG_S, LED_COLOR_FADE_S, LED_FADE_OUT_S, cueTime, evaluate, screenAt, type CompiledShow } from './cues';
import { zonesOfScreen, type Layout } from './layout';
import { MIST_LINGER } from './projector';
import type { PyroWarning } from '../pyro/schedule';

/**
 * Where a show does not play as written (docs/dev-plan.md C5, detailed
 * design 7): the editor's 警告 list and the marks on the cue blocks.
 *
 * Nothing here changes the show. It only reads what compileShow already
 * decided (the head moves it slowed, the light fades it lengthened, the
 * fireworks' safety checks) and adds one check of its own: a pump that
 * cannot lift the water to the written height before the cue lowers it again.
 *
 * Levels:
 *   danger  危ない — the fireworks' safety distances (red)
 *   caution 書いたとおりに動かない — slowed, or the water does not get there (yellow)
 *   info    お知らせ — adjusted on purpose (the LED fades, 2026-10-26)
 */

export type CheckLevel = 'danger' | 'caution' | 'info';
export type CheckKind = 'pyro' | 'head' | 'water' | 'led' | 'missing' | 'past' | 'nomist' | 'linger';

export interface Check {
  /** Cue index in the show file. */
  source: number;
  level: CheckLevel;
  kind: CheckKind;
  /** One line about this cue (shown in the list and the cue's tooltip). */
  text: string;
}

/** What each kind means, once, at the top of its group in the list. */
export const CHECK_KINDS: Record<CheckKind, { level: CheckLevel; title: string; note: string }> = {
  pyro: { level: 'danger', title: '花火の保安距離・傾き', note: '目安で、実際の許可の代わりにはなりません' },
  head: { level: 'caution', title: '首振りが速すぎる', note: `上限 ${HEAD_MAX_DEG_S}°/秒に落として動きます。長さを延ばすと書いたとおりになります` },
  water: { level: 'caution', title: '水が上がりきらない', note: 'ポンプが全開になる前に下げています（ポンプ約1秒＋水が上がる時間）' },
  missing: { level: 'caution', title: 'この会場で動かない', note: 'この会場に、狙う台がありません' },
  past: { level: 'caution', title: '曲の後ろにある', note: '曲（ショーの長さ）が終わった後の時刻にあるので、流れません。前へ動かすか、要らなければ消してください。曲を替えても消さずに残しています' },
  nomist: { level: 'info', title: '霧の無い所に映している', note: 'プロジェクターが映している間、この区画には霧がありません。映像は奥の物や空に当たります。わざとでなければ、その区画の明るさを 0 に' },
  linger: { level: 'info', title: '霧を下げた後も映している', note: '下げた後に残る霧（約3秒）に映像が残ります。わざとならよい。像を先に消すなら、霧を下げる前にプロジェクターを 0 に' },
  led: { level: 'info', title: '光の変化を、LED の速さに合わせた', note: `色は ${LED_COLOR_FADE_S} 秒、消えるのは ${LED_FADE_OUT_S} 秒かけて変わります（パッと変えない、2026-10-26 の決定）` },
};

/**
 * Variable-speed pumps (grid, whip) take about a second from off to full
 * (OASE, .claude/skills/fountain-physics 5). Valves (flower, fan) and air
 * shooters (chaser, geyser) throw the water at full speed at once, so a short
 * shot still reaches its height and is not checked.
 */
export const PUMP_RAMP_S = 1;
const PUMPED = new Set(['vertical', 'oscillating']);
/** Rise of less than this (pressure 0..1) is a ripple, not a lift. */
const MIN_RISE = 0.3;
/** Lowering by less than this is not "lowering again". */
const MIN_DROP = 0.2;
/** Time to 90 % of the apex over the time to the apex (fountain-physics 1: 1.06 / 1.55 s). */
const NINETY = 0.68;
/** Slack before calling it late (s). */
const SLACK = 0.25;

/** Seconds from a pump starting to rise until the water stands at 90 % of `height` (m). */
export function waterReach(rise: number, dur: number, height: number): number {
  return Math.max(dur, PUMP_RAMP_S * rise) + NINETY * Math.sqrt((2 * height) / 9.81);
}

/** `picture`: the picture map when the caller has it already (the editor draws it too). */
export function checkShow(show: CompiledShow, layout: Layout, picture?: PictureMap): Check[] {
  const out: Check[] = [];
  // fireworks: one line per cue, its worst problem
  const byCue = new Map<number, PyroWarning[]>();
  for (const w of show.pyroWarnings) byCue.set(w.source, [...(byCue.get(w.source) ?? []), w]);
  for (const [source, ws] of byCue) {
    const red = ws.filter((w) => w.level === 'danger');
    const w = (red.length ? red : ws).reduce((a, b) => (b.have < a.have ? b : a));
    out.push({ source, level: red.length ? 'danger' : 'caution', kind: 'pyro', text: pyroText(w, ws.length) });
  }
  for (const source of show.limited) out.push({ source, level: 'caution', kind: 'head', text: '書いた長さより遅れて着く' });
  // after the music's end (a shorter song picked, docs/music-plan.md)
  const end = show.file.duration;
  show.file.cues.forEach((c, source) => {
    const t = cueTime(c.t, show.file);
    if (Number.isFinite(t) && t >= end) out.push({ source, level: 'caution', kind: 'past', text: `${t.toFixed(1)} 秒（曲は ${end.toFixed(1)} 秒まで）` });
  });

  // pumps: the water has not reached the height when the cue lowers it
  const late = new Map<number, { n: number; short: number }>();
  const nCh = CHANNELS.length;
  layout.fixtures.forEach((fx, f) => {
    if (!PUMPED.has(fx.type)) return;
    const segs = show.tracks[f * nCh + CH.pressure];
    for (let i = 0; i + 1 < segs.length; i++) {
      const s = segs[i];
      const n = segs[i + 1];
      const rise = s.to - s.from;
      if (rise < MIN_RISE || n.to > s.to - MIN_DROP) continue;
      const reach = s.start + waterReach(rise, s.dur, fx.spec.height * s.to);
      if (n.start >= reach - SLACK) continue;
      const e = late.get(s.source) ?? { n: 0, short: 0 };
      e.n++;
      e.short = Math.max(e.short, reach - n.start);
      late.set(s.source, e);
    }
  });
  for (const [source, e] of late) out.push({ source, level: 'caution', kind: 'water', text: `あと ${e.short.toFixed(1)} 秒要る（${e.n} 台）` });

  for (const source of show.ledSlowed) out.push({ source, level: 'info', kind: 'led', text: '' });
  out.push(...pictureChecks(picture ?? pictureMap(show, layout), layout));
  return out;
}

// ------------------------------------------------------------ the projector

/** Where the picture lands at one moment, per zone of the projector. */
export const PICTURE = { off: 0, shown: 1, linger: 2, nomist: 3 } as const;
export type PictureState = (typeof PICTURE)[keyof typeof PICTURE];
/** Seconds between samples of the picture map. */
export const PICTURE_STEP = 0.1;
/** A zone at least this bright is projecting. */
const PICTURE_ON = 0.05;
const MIST_ON = 0.01;

export interface PictureMap {
  step: number;
  /** One row per zone of the projector: a PICTURE state per sample. */
  zones: Uint8Array[];
  /** Per zone and sample, the cue that made the state (the projector's or the lowering screen's), or -1. */
  sources: Int32Array[];
}

/** Mist in a screen at t, as the player draws it (runtime.ts mistAt). */
function mistLevel(show: CompiledShow, channel: number, t: number): number {
  let m = evaluate(show, channel, CH.pressure, t);
  const n = Math.round(MIST_LINGER / 0.25);
  for (let k = 1; k <= n; k++) m = Math.max(m, evaluate(show, channel, CH.pressure, t - k * 0.25) * Math.exp(-(k * 0.25) / 1.5));
  return m;
}

/** The segment of a track playing at t, or undefined. */
function segAt(show: CompiledShow, channel: number, ch: number, t: number) {
  const segs = show.tracks[channel * CHANNELS.length + ch];
  let found;
  for (const s of segs) {
    if (s.start > t) break;
    found = s;
  }
  return found;
}

/**
 * Where the projector's picture lands, sampled through the show: on mist
 * (shown), on mist whose screen has been lowered (linger), or with no mist
 * in the zone while the projector runs (nomist; it runs while any screen
 * has mist). The timeline draws it under the projector's lane.
 */
export function pictureMap(show: CompiledShow, layout: Layout): PictureMap {
  const zones = layout.projector;
  const n = Math.max(0, Math.ceil(show.file.duration / PICTURE_STEP) + 1);
  const map: PictureMap = { step: PICTURE_STEP, zones: zones.map(() => new Uint8Array(n)), sources: zones.map(() => new Int32Array(n).fill(-1)) };
  if (!zones.length) return map;
  const inZone = zones.map((z) => layout.screens.filter((u) => zonesOfScreen(zones, u).some((x) => x.index === z.index)));
  const lim = show.file.cues.length;
  for (let i = 0; i < n; i++) {
    const t = i * PICTURE_STEP;
    const level = new Map(layout.screens.map((u) => [u, mistLevel(show, u.index, t)]));
    const running = [...level.values()].some((m) => m > MIST_ON);
    if (!running) continue;
    // nothing chosen to show yet (a show on its own music before its first clip): the picture is black
    if (screenAt(show, t).blank) continue;
    zones.forEach((z, k) => {
      if (evaluate(show, z.index, CH.intensity, t) < PICTURE_ON) return;
      const here = inZone[k].filter((u) => level.get(u)! > MIST_ON);
      const own = segAt(show, z.index, CH.intensity, t)?.source ?? -1;
      if (!here.length) {
        map.zones[k][i] = PICTURE.nomist;
        map.sources[k][i] = own < lim ? own : -1;
        return;
      }
      // every screen with mist here has been told to go down: what is lit is what is left
      const up = here.filter((u) => evaluate(show, u.index, CH.pressure, t) > 1e-3);
      if (up.length) map.zones[k][i] = PICTURE.shown;
      else {
        map.zones[k][i] = PICTURE.linger;
        // the cue that lowered the screen (the last one to go down)
        const down = here.map((u) => segAt(show, u.index, CH.pressure, t)).filter((s) => s !== undefined).sort((a, b) => b.start - a.start)[0];
        map.sources[k][i] = down && down.source < lim ? down.source : -1;
      }
    });
  }
  return map;
}

/** Zone names for lines and tips: 左・中央・右 for three, else numbers. */
export function zoneName(k: number, n: number): string {
  if (n === 1) return '';
  if (n === 3) return ['左', '中央', '右'][k];
  return `区画${k + 1}`;
}

/** One line per cue for runs of nomist / linger (shorter than a quarter second are let go). */
function pictureChecks(map: PictureMap, layout: Layout): Check[] {
  const n = layout.projector.length;
  // seconds per zone; a line says the longest (the zones run side by side)
  const runs = new Map<string, { source: number; kind: CheckKind; secs: Map<number, number>; zones: Set<number> }>();
  map.zones.forEach((row, k) => {
    let i = 0;
    while (i < row.length) {
      const st = row[i];
      if (st !== PICTURE.nomist && st !== PICTURE.linger) {
        i++;
        continue;
      }
      let j = i;
      while (j < row.length && row[j] === st && map.sources[k][j] === map.sources[k][i]) j++;
      const secs = (j - i) * map.step;
      const source = map.sources[k][i];
      if (secs >= 0.25 && source >= 0) {
        const kind: CheckKind = st === PICTURE.nomist ? 'nomist' : 'linger';
        const key = `${kind}|${source}`;
        const r = runs.get(key) ?? { source, kind, secs: new Map<number, number>(), zones: new Set<number>() };
        r.secs.set(k, (r.secs.get(k) ?? 0) + secs);
        r.zones.add(k);
        runs.set(key, r);
      }
      i = j;
    }
  });
  return [...runs.values()].map((r) => {
    const where = n > 1 && r.zones.size < n ? [...r.zones].sort().map((k) => zoneName(k, n)).join('・') + 'の区画、' : '';
    return { source: r.source, level: 'info' as const, kind: r.kind, text: `${where}${Math.max(...r.secs.values()).toFixed(1)} 秒` };
  });
}

function pyroText(w: PyroWarning, n: number): string {
  const tubes = n > 1 ? `（${n} 本）` : '';
  switch (w.kind) {
    case 'tube':
      return `保安距離 ${Math.round(w.need)} m に、${Math.round(w.have)} m${tubes}`;
    case 'burst':
      return `開く位置の真下が客席から ${Math.round(w.have)} m（要 ${Math.round(w.need)} m）${tubes}`;
    case 'toward':
      return `客席の側へ傾いている（${Math.round(w.have)}°）`;
    case 'steep':
      return `傾きが大きい（${Math.round(w.have)}°）`;
  }
}
