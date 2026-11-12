import type { NozzleType } from '../core/nozzles';
import { resolveTarget } from '../show/cues';
import type { Layout } from '../show/layout';
import type { Cue } from '../show/types';

/**
 * 動きの型 (dev-plan C7): the moves a show is made of — fan out, cross, sway,
 * run from the end, a wave — as buttons, so nobody has to know the macros
 * (src/show/cues.ts) and their arguments to use them. A button puts one cue
 * of that move on the beat nearest the playhead, on the selected cue's
 * fixtures (or the fixtures the move suits), and selects it: the inspector's
 * マクロ section then tunes it as before.
 */

export interface Move {
  id: string;
  /** The button. */
  ja: string;
  /** What it does, in a line (the button's tooltip). */
  note: string;
  /** Turns heads: only for fixtures whose heads move (whips, fans). */
  head?: boolean;
  /** Opens a flower: only for flowers (ring jets). */
  ring?: boolean;
  /** Moves only heads or colours: water is turned on with it when the fixtures are dark there. */
  needsWater?: boolean;
  cue: () => Omit<Cue, 't' | 'target'>;
}

export const MOVES: Move[] = [
  { id: 'fan', ja: '扇に開く', note: '左から右へ角度を割り振って、扇の形に開く（2秒）', head: true, cue: () => ({ macro: 'spread', args: { from: -40, to: 40, dur: 2 }, set: { pressure: 0.8 } }) },
  { id: 'cross', ja: '交差', note: '左右の水が真ん中で交わる（2秒）', head: true, cue: () => ({ macro: 'spread', args: { from: 40, to: -40, dur: 2 }, set: { pressure: 0.8 } }) },
  { id: 'sway', ja: '左右に揺れる', note: 'みんなの首が一緒に左右へ揺れる（8秒）', head: true, needsWater: true, cue: () => ({ macro: 'sway', args: { amp: 30, period: 2, cycles: 4 } }) },
  { id: 'ripple', ja: '揺れが伝わる', note: '首の揺れが、端から1台ずつ遅れて伝わる（8秒）', head: true, needsWater: true, cue: () => ({ macro: 'sway', args: { amp: 30, period: 2, cycles: 4 }, stagger: 0.1 }) },
  { id: 'chase', ja: '端から走る', note: '端から1台ずつ順に噴いて走る', cue: () => ({ macro: 'chase', args: { speed: 12, hold: 0.35, laps: 1 } }) },
  { id: 'burst', ja: '中から広がる', note: '真ん中から外へ、順に噴いて戻る', cue: () => ({ macro: 'pulse', args: { level: 1, hold: 0.6 }, stagger: 0.06, order: 'center' }) },
  { id: 'wave', ja: '波', note: '高さの上下が、端から波のように伝わる（4秒）', cue: () => ({ macro: 'wave', args: { base: 0.55, amp: 0.3, period: 2, cycles: 2 }, stagger: 0.08 }) },
  { id: 'hit', ja: 'ひと吹き', note: 'みんなで一度だけ強く噴いて戻る（拍に合わせる一打）', cue: () => ({ macro: 'pulse', args: { level: 1, hold: 0.3 } }) },
  { id: 'bloom', ja: '花が開く', note: '花の噴水が外へ開く（2秒）', ring: true, cue: () => ({ macro: 'bloom', args: { to: 25, dur: 2 }, set: { pressure: 0.8 } }) },
  { id: 'follow', ja: '音に合わせる', note: '曲の音量に合わせて高さが動く（8秒）', cue: () => ({ macro: 'follow', args: { curve: 'level', min: 0.2, max: 0.8, dur: 8 } }) },
  { id: 'rainbow', ja: '虹', note: '並び順に色を割り振って虹にする', needsWater: true, cue: () => ({ macro: 'rainbow', args: { hue: 0, span: 1 } }) },
];

/** The nozzle kinds a target aims at (screens and projector zones left out). */
function kindsOf(target: string, l: Layout): NozzleType[] {
  return [...new Set(resolveTarget(target, l).filter((i) => i < l.fixtures.length).map((i) => l.fixtures[i].type))];
}

/** Why a move cannot go on these fixtures, or null. */
export function cannot(m: Move, target: string, l: Layout): string | null {
  const kinds = kindsOf(target, l);
  if (!kinds.length) return '水の機材ではありません';
  // a head that turns (Fixture.turns: the whips and the lagoon's fans, not the garden's fixed fan)
  if (m.head && !resolveTarget(target, l).some((i) => i < l.fixtures.length && l.fixtures[i].turns)) return '首の動く機材（ウィップ・ファン）で使えます';
  if (m.ring && !kinds.includes('ring')) return '花（フラワー）で使えます';
  return null;
}

/**
 * Where a move goes: the selected cue's fixtures when it suits them, else the
 * venue's first group it suits (whips for heads, flowers for blooms, the grid
 * for the rest). The reason when nothing in the venue suits it.
 */
export function moveTarget(m: Move, selected: Cue | undefined, l: Layout): { target: string } | { why: string } {
  if (selected && !selected.fire && !selected.clip) {
    const why = cannot(m, selected.target, l);
    if (!why) return { target: selected.target };
  }
  const groups = Object.keys(l.groups).filter((g) => l.groups[g].length && l.groups[g].every((i) => i < l.fixtures.length));
  const prefer = m.ring ? ['flower'] : m.head ? ['whip', 'fan'] : ['grid'];
  const order = [...prefer.filter((g) => groups.includes(g)), ...groups.filter((g) => !prefer.includes(g))];
  for (const g of order) if (!cannot(m, g, l)) return { target: g };
  return { why: m.ring ? 'この会場に花（フラワー）がありません' : m.head ? 'この会場に首の動く機材（ウィップ・ファン）がありません' : 'この会場に水の機材がありません' };
}
