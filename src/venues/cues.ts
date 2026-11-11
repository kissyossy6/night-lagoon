import { resolveTubes } from '../pyro/schedule';
import { resolveTarget } from '../show/cues';
import { buildLayout, type Layout } from '../show/layout';
import type { Cue, ShowFile } from '../show/types';
import type { Venue } from './types';

/**
 * 動かないキュー (dev-plan B4, docs/detailed-design.md 6.5): a show is written
 * for one venue (its file's `venue`, missing = the lagoon). Played in another,
 * a cue whose target finds nothing there does nothing (動かない), one that
 * finds fewer fixtures or tubes than in its own venue moves only those
 * (一部だけ). The player skips what finds nothing; this only counts it.
 */

export interface CueReach {
  /** Cues that move something in the show's own venue. */
  all: number;
  /** Find nothing in the other venue. */
  none: number;
  /** Find fewer than in the show's own venue. */
  part: number;
  /** Why the 動かない ones find nothing, most first: the target and the reason. */
  reasons: { target: string; why: string; n: number }[];
}

/** The parts of a layout the targets are read from, made once per venue. */
const layouts = new WeakMap<Venue, Layout>();
function layoutOf(v: Venue): Layout {
  let l = layouts.get(v);
  if (!l) layouts.set(v, (l = buildLayout(v, 'low')));
  return l;
}

const count = (c: Cue, l: Layout) => (c.fire ? resolveTubes(c.target, l) : resolveTarget(c.target, l)).length;

/** Why a target finds nothing in a layout, in words (the first part that fails). */
export function whyNothing(c: Cue, l: Layout): string {
  for (const raw of String(c.target ?? '').split(',').map((s) => s.trim())) {
    if (raw.startsWith('@')) {
      if (l.selections[raw.slice(1)] === undefined) return '名前の付いた並びが無い';
      continue;
    }
    const m = /^([^[\],]+?)(?:\[(\d+)-(\d+)(?::(\d+))?\])?$/.exec(raw);
    if (!m) return '書き方が読めない';
    const g = c.fire ? l.pyroGroups[m[1]] : l.groups[m[1]];
    if (!g || !g.length) return c.fire ? '花火の台が無い' : 'グループが無い';
    if (m[2] !== undefined && Number(m[2]) >= g.length) return `番号が範囲の外（${g.length}${c.fire ? '本' : '台'}）`;
  }
  return '狙う台が無い';
}

/** How much of a show works in a venue. */
export function cueReach(file: ShowFile, own: Venue, other: Venue): CueReach {
  const a = layoutOf(own);
  const b = layoutOf(other);
  const out: CueReach = { all: 0, none: 0, part: 0, reasons: [] };
  const why = new Map<string, { target: string; why: string; n: number }>();
  for (const c of file.cues) {
    const want = count(c, a);
    if (!want) continue;
    out.all++;
    const got = own === other ? want : count(c, b);
    if (got >= want) continue;
    if (got > 0) {
      out.part++;
      continue;
    }
    out.none++;
    const w = whyNothing(c, b);
    const key = `${c.target}\n${w}`;
    const r = why.get(key) ?? { target: c.target, why: w, n: 0 };
    r.n++;
    why.set(key, r);
  }
  out.reasons = [...why.values()].sort((x, y) => y.n - x.n || x.target.localeCompare(y.target));
  return out;
}
