import { EASES, MACROS, MACRO_ARGS, ORDERS, PARAMS, PATTERN_OPTIONS, SCENES } from '../../editor/model';
import { SHELLS } from '../../pyro/shells';
import type { PyroWarning } from '../../pyro/schedule';
import type { Clip, Cue, Fire } from '../../show/types';

/**
 * Cues and fireworks in plain Japanese, for the tables people read (the cue
 * sheet D6, the firing table D5). The names are the editor's own
 * (src/editor/model.ts), so a table says what the inspector says.
 */

/** Short name: the part before ' (' ('波 (値が上下に揺れる)' -> '波'). */
const short = (ja: string) => ja.replace(/\s*\(.*$/, '');
const paramJa = (k: string) => short(PARAMS.find((p) => p.key === k)?.ja ?? k).replace(/°$/, '');

/**
 * Named colours of the shows' palettes (src/show/choreography.ts, hanabi.ts);
 * a colour gets the nearest name.
 */
const NAMED: [string, string][] = [
  ['赤', '#ff3000'],
  ['橙', '#ff7a00'],
  ['金', '#ffb050'],
  ['黄', '#ffe000'],
  ['緑', '#3cff5a'],
  ['シアン', '#00b4ff'],
  ['青', '#1e3cff'],
  ['紫', '#c03cff'],
  ['マゼンタ', '#ff2fb0'],
  ['ピンク', '#ff4fd0'],
  ['銀', '#e8ecff'],
  ['白', '#ffffff'],
];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);

export function colorName(hex: string): string {
  const c = rgb(hex);
  let best = NAMED[0][0];
  let d = Infinity;
  for (const [name, h] of NAMED) {
    const e = rgb(h).reduce((s, v, i) => s + (v - c[i]) ** 2, 0);
    if (e < d) {
      d = e;
      best = name;
    }
  }
  return best;
}

const deg = (v: number) => {
  const r = Math.round(v * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}°`;
};
const sec = (v: number) => `${Math.round(v * 1000) / 1000}秒`;

/** '牡丹 5号 赤→金 ×3・間隔 0.25秒・扇 40°・前後 −10°' */
export function fireText(f: Fire): string {
  const out = [`${SHELLS[f.shell]?.ja ?? f.shell} ${f.size}号 ${f.colors.map(colorName).join('→')}${(f.count ?? 1) > 1 ? ` ×${f.count}` : ''}`];
  if ((f.count ?? 1) > 1 && f.interval !== undefined) out.push(`間隔 ${sec(f.interval)}`);
  if (f.pattern) out.push(`${short(PATTERN_OPTIONS.find((p) => p.v === f.pattern)?.ja ?? f.pattern)} ${f.spread ?? 40}°`);
  if (f.angle) out.push(`左右 ${deg(f.angle)}`);
  if (f.tilt) out.push(`前後 ${deg(f.tilt)}`);
  return out.join('・');
}

/**
 * What a projector cue asks of the media server: the clip and where in it to
 * start ('クリップ「ビルド — 放射する光」だけ・2秒から', 'ショーの絵に戻す').
 */
export function mediaText(k: Clip): string {
  const from = k.from ? `・${sec(k.from)}から` : '・頭から';
  if (k.scene === 'sync') return 'ショーの絵に戻す（絵の時刻＝ショーの時刻）';
  if (k.scene === 'video') return `動画 ${k.src ?? ''}${from}${k.fit ? `・${k.fit}` : ''}`;
  return `クリップ「${SCENES.find((x) => x.v === k.scene)?.ja ?? k.scene}」${k.alone ? 'だけ' : ''}${from}`;
}

/**
 * What a cue does: '水圧 0.8・色 #ff4fa0（1.2秒・イーズインアウト）・時差 0.05秒 中央から'.
 * `clip: false` leaves the picture out (the cue sheet gives it its own column).
 */
export function cueText(c: Cue, opts: { clip?: boolean } = {}): string {
  const parts: string[] = [];
  if (c.fire) parts.push(fireText(c.fire));
  if (c.macro) {
    const defs = MACRO_ARGS[c.macro] ?? [];
    const args = Object.entries(c.args ?? {}).map(([k, v]) => {
      const label = defs.find((d) => d.key === k)?.ja.replace(/\s*\(.*$/, '') ?? k;
      const value = k === 'param' ? paramJa(String(v)) : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v);
      // '周期 秒' 2 -> '周期 2秒', '角度°' 40 -> '角度 40°'
      const unit = /^(.*?) ?(秒|台\/秒|°)$/.exec(label);
      return unit ? `${unit[1]} ${value}${unit[2]}` : `${label} ${value}`;
    });
    parts.push(`${short(MACROS.find((m) => m.name === c.macro)?.ja ?? c.macro)}${args.length ? `（${args.join('・')}）` : ''}`);
  }
  if (c.set) {
    const s = c.set;
    const sets: string[] = [];
    if (s.pressure !== undefined) sets.push(`水圧 ${s.pressure}`);
    if (s.pan !== undefined) sets.push(`パン ${deg(s.pan)}`);
    if (s.tilt !== undefined) sets.push(`チルト ${deg(s.tilt)}`);
    if (s.color !== undefined) sets.push(`色 ${s.color}`);
    if (s.intensity !== undefined) sets.push(`明るさ ${s.intensity}`);
    if (sets.length) parts.push(c.macro ? `＋${sets.join('・')}` : sets.join('・'));
  }
  if (c.clip && opts.clip !== false) {
    const k = c.clip;
    const from = k.from ? `（${sec(k.from)}から）` : '';
    parts.push(k.scene === 'video' ? `映像 ${k.src ?? ''}${from}` : k.scene === 'sync' ? '映像 ショーの時刻どおり' : `映像 ${SCENES.find((x) => x.v === k.scene)?.ja ?? k.scene}${from}`);
  }
  let text = parts.join('・') || (c.clip ? '（映像だけ）' : '（何もしない）');
  if (!c.macro && !c.fire && c.dur) text += `（${sec(c.dur)}${c.ease ? `・${short(EASES.find((e) => e.v === c.ease)?.ja ?? c.ease)}` : ''}）`;
  if (c.stagger) text += `・時差 ${sec(c.stagger)}${c.order && c.order !== 'index' ? ` ${ORDERS.find((o) => o.v === c.order)?.ja ?? c.order}` : ''}`;
  return text;
}

/** '危険：筒から客席まで 120 m（要 155 m）' */
export function warningText(w: PyroWarning): string {
  const lv = w.level === 'danger' ? '危険' : '注意';
  const m = (v: number) => `${Math.round(v)} m`;
  switch (w.kind) {
    case 'tube':
      return `${lv}：筒から客席まで ${m(w.have)}（要 ${m(w.need)}）`;
    case 'burst':
      return `${lv}：開く位置の真下から客席まで ${m(w.have)}（要 ${m(w.need)}）`;
    case 'toward':
      return `${lv}：客席側へ ${deg(w.have)} 傾いている`;
    case 'steep':
      return `${lv}：傾き ${deg(w.have)}（目安 ${deg(w.need)} まで）`;
  }
}
