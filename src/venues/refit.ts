import type { NozzleType } from '../core/nozzles';
import { resolveTubes } from '../pyro/schedule';
import { CH, compileShow, cueTime, evaluate, resolveTarget } from '../show/cues';
import { buildLayout, type Layout } from '../show/layout';
import type { Cue, ShowFile } from '../show/types';
import type { Venue } from './types';

/**
 * 会場に合わせて組み替える (the fit-to-venue skill, made automatic): a show
 * written for one venue, played in another, keeps its times, colours, dark
 * and valleys (the music is the same) and changes only who plays each part.
 *
 * Each cue that finds fewer fixtures in the new venue than in its own is
 * aimed again:
 *   - at the group of the same name, or, when the venue has none, at the
 *     nearest kind (flower → fan → whip → grid …, the one closest in number);
 *   - at the fixtures standing where the old ones stood, by place, not by
 *     number: left stays left, the front row stays the front row. An axis the
 *     new group has no extent on (the desk's one line has no depth) is left
 *     out, so the lake's middle band becomes the whole line, not nothing.
 * A stand-in plays only while the group it borrows is quiet in the original
 * show: the chasers' shots go to the grid between the grid's own moves, not
 * over them (their 'off' would cut the grid's own water, and one group plays
 * one part at a time). Stand-in cues that would land on a busy group are left
 * as they were, doing nothing here.
 * Cues that already work are left as written. Cues with nothing to stand in
 * for them (the water screens, the projector, fireworks without tubes) are
 * left too: they do nothing here and come back if the venue is changed back.
 */

export interface RefitReport {
  /** Cues aimed again. */
  changed: number;
  /** Cues that do nothing in the new venue, before and after. */
  noneBefore: number;
  noneAfter: number;
  /** Which group took over which, and how many cues each. */
  swaps: { from: string; to: string; n: number }[];
  /** Cues left doing nothing because nothing here can stand in, by group. */
  left: { group: string; n: number }[];
  /** Stand-in cues left out because the group they borrow is busy then. */
  busy: number;
  /** Cues that only moved heads, left out on stand-ins whose heads do not move. */
  headOnly: number;
}

/** The nearest kinds of water, best first (src/core/nozzles.ts TYPE_ID). */
const NEAR: Record<NozzleType, NozzleType[]> = {
  vertical: ['vertical', 'shooter', 'ring', 'fan', 'oscillating'],
  shooter: ['shooter', 'vertical', 'ring', 'fan', 'oscillating'],
  oscillating: ['oscillating', 'fan', 'vertical', 'shooter', 'ring'],
  fan: ['fan', 'oscillating', 'ring', 'vertical', 'shooter'],
  ring: ['ring', 'fan', 'oscillating', 'vertical', 'shooter'],
  mist: ['mist'],
};

/** Macros that only move heads (src/show/cues.ts), unless told to move another channel. */
const HEAD_MACROS = new Set(['sway', 'spread', 'lean', 'bloom']);

/**
 * A cue for a stand-in whose head does not move (Fixture.turns false): what
 * leans or turns is left out — a fixed jet cannot lean, so the movement has
 * no meaning there (since 2026-11-12 the simulator also keeps a fixed jet
 * upright whatever pan / tilt it is given; before that it drew an arc no
 * real pump on the desk can make). Null when nothing but the movement was in it.
 */
export function withoutHead(c: Cue): Cue | null {
  const set = c.set ? { ...c.set } : undefined;
  if (set) {
    delete set.pan;
    delete set.tilt;
  }
  const moves = c.macro && HEAD_MACROS.has(c.macro) && ['pan', 'tilt', undefined].includes(c.args?.param as string | undefined);
  if (moves || !c.macro) {
    if (!set || !Object.keys(set).length) return null;
    const { macro: _m, args: _a, ...rest } = c;
    return { ...rest, set };
  }
  return set ? { ...c, set } : c;
}

const count = (c: Cue, l: Layout) => (c.fire ? resolveTubes(c.target, l) : resolveTarget(c.target, l)).length;

/** A group's nozzles (not its screens or projector zones), or null. */
function nozzleGroup(l: Layout, name: string): number[] | null {
  const g = l.groups[name];
  if (!g || !g.length || g.some((i) => i >= l.fixtures.length)) return null;
  return g;
}

/** The plain parts of a target: '@名前' opened up through the venue's selections. */
function plainParts(target: string, l: Layout, depth = 0): string[] {
  const out: string[] = [];
  for (const part of target.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.startsWith('@')) {
      const named = l.selections[part.slice(1)];
      if (named !== undefined && depth < 4) out.push(...plainParts(named, l, depth + 1));
    } else out.push(part);
  }
  return out;
}

/** 'grid[0-15:2]' → the group and the places in it it picks. */
function readPart(part: string, l: Layout): { group: string; at: number[] } | null {
  const m = /^([a-zA-Z]+)(?:\[(\d+)-(\d+)(?::(\d+))?\])?$/.exec(part);
  if (!m) return null;
  const g = l.groups[m[1]];
  if (!g) return null;
  if (m[2] === undefined) return { group: m[1], at: g.map((_, i) => i) };
  const at: number[] = [];
  const step = Math.max(1, Number(m[4] ?? 1));
  for (let i = Number(m[2]); i <= Math.min(Number(m[3]), g.length - 1); i += step) at.push(i);
  return { group: m[1], at };
}

/** Places in a group → the shortest target: 'g', 'g[a-b]', 'g[a-b:s]' or runs joined by ','. */
export function writePart(group: string, at: number[], size: number): string {
  const s = [...new Set(at)].sort((a, b) => a - b);
  if (s.length === size) return group;
  if (s.length === 1) return `${group}[${s[0]}-${s[0]}]`;
  const step = s[1] - s[0];
  if (s.every((v, i) => i === 0 || v - s[i - 1] === step)) return step === 1 ? `${group}[${s[0]}-${s[s.length - 1]}]` : `${group}[${s[0]}-${s[s.length - 1]}:${step}]`;
  const runs: string[] = [];
  let a = s[0];
  for (let i = 1; i <= s.length; i++) {
    if (i < s.length && s[i] === s[i - 1] + 1) continue;
    runs.push(`${group}[${a}-${s[i - 1]}]`);
    if (i < s.length) a = s[i];
  }
  return runs.join(',');
}

/** The places in `to` standing where the picked places of `from` stand (see the top). */
export function mapPlaces(fromPos: [number, number, number][], picked: number[], toPos: [number, number, number][]): number[] {
  if (!toPos.length || !picked.length) return [];
  if (toPos.length === 1) return [0];
  // x across, z in depth, each by rank in its group (-1 the first, 1 the
  // last): rows that stand unevenly or zigzag still match back to back,
  // middle to middle, front to front
  const spread = (ps: [number, number, number][], k: number) => Math.max(...ps.map((p) => p[k])) - Math.min(...ps.map((p) => p[k]));
  const axes = [0, 2].filter((k) => spread(fromPos, k) > 1e-6 && spread(toPos, k) > 1e-6);
  const ranked = (ps: [number, number, number][]) => {
    const cols = axes.map((k) => {
      const v = ps.map((p) => p[k]);
      return v.map((x) => {
        let below = 0;
        let same = 0;
        for (const y of v) {
          if (y < x - 1e-6) below++;
          else if (Math.abs(y - x) <= 1e-6) same++;
        }
        return v.length > 1 ? ((below + (same - 1) / 2) / (v.length - 1)) * 2 - 1 : 0;
      });
    });
    return ps.map((_, i) => cols.map((c) => c[i]));
  };
  const A = ranked(fromPos);
  const B = ranked(toPos);
  const d2 = (x: number[], y: number[]) => x.reduce((s, v, i) => s + (v - y[i]) ** 2, 0);
  const pick = new Set(picked);
  const out: number[] = [];
  B.forEach((q, j) => {
    let all = Infinity;
    let mine = Infinity;
    A.forEach((p, i) => {
      const d = d2(p, q);
      if (d < all) all = d;
      if (pick.has(i) && d < mine) mine = d;
    });
    if (mine <= all + 1e-9) out.push(j);
  });
  if (out.length) return out;
  // nothing stood nearest: the one nearest the middle of what was picked
  const mid = axes.map((_, k) => picked.reduce((s, i) => s + A[i][k], 0) / picked.length);
  let best = 0;
  B.forEach((q, j) => {
    if (d2(q, mid) < d2(B[best], mid)) best = j;
  });
  return [best];
}

/** The group of `to` that plays a part of `from`'s group, or null. */
function standIn(name: string, from: Layout, to: Layout): string | null {
  if (nozzleGroup(to, name)) return name;
  const g = nozzleGroup(from, name);
  if (!g) return null;
  const kinds = NEAR[from.fixtures[g[0]].type] ?? [];
  const cands = Object.keys(to.groups)
    .map((n) => ({ n, g: nozzleGroup(to, n) }))
    .filter((c): c is { n: string; g: number[] } => c.g !== null);
  for (const k of kinds) {
    const same = cands.filter((c) => to.fixtures[c.g[0]].type === k);
    if (!same.length) continue;
    same.sort((x, y) => Math.abs(Math.log(x.g.length / g.length)) - Math.abs(Math.log(y.g.length / g.length)) || x.n.localeCompare(y.n));
    return same[0].n;
  }
  return null;
}

/** The show's cues aimed again for `to` (the file itself is not changed). */
export function refitCues(file: ShowFile, fromVenue: Venue, toVenue: Venue): { cues: Cue[]; report: RefitReport } {
  const from = buildLayout(fromVenue, 'low');
  const to = buildLayout(toVenue, 'low');
  const swaps = new Map<string, number>();
  const left = new Map<string, number>();
  const stand = new Map<string, string | null>();
  const standFor = (g: string) => {
    if (!stand.has(g)) stand.set(g, standIn(g, from, to));
    return stand.get(g)!;
  };
  // when each place of a group of the new venue sprays in the original show,
  // every 0.1 s: the group's own water there (the original's fixtures of
  // that name, each counted at the place it maps to)
  const STEP = 0.1;
  // a low floor of water under it is a background the stand-in plays over
  // (the lake's chasers fly over a low grid); above this the place is busy
  const BUSY = 0.3;
  let compiled: ReturnType<typeof compileShow> | null = null;
  const busyMap = new Map<string, Uint8Array[]>();
  const busyOf = (g: string) => {
    let m = busyMap.get(g);
    if (m) return m;
    const dst = to.groups[g];
    m = dst.map(() => new Uint8Array(Math.ceil(file.duration / STEP) + 2));
    const src = nozzleGroup(from, g);
    if (src) {
      compiled ??= compileShow(file, from);
      const srcPos = src.map((i) => from.fixtures[i].position);
      const dstPos = dst.map((i) => to.fixtures[i].position);
      src.forEach((fi, i) => {
        const owners = mapPlaces(srcPos, [i], dstPos);
        for (let k = 0; k < m![0].length; k++) {
          if (evaluate(compiled!, fi, CH.pressure, k * STEP) > BUSY) for (const j of owners) m![j][k] = 1;
        }
      });
    }
    busyMap.set(g, m);
    return m;
  };
  const busyBetween = (g: string, places: number[], t0: number, t1: number) => {
    const m = busyOf(g);
    for (const j of places) {
      const line = m[j];
      for (let k = Math.max(0, Math.floor(t0 / STEP)); k <= Math.min(line.length - 1, Math.ceil(t1 / STEP)); k++) if (line[k]) return true;
    }
    return false;
  };
  let busy = 0;
  let headOnly = 0;
  let changed = 0;
  let noneBefore = 0;
  let noneAfter = 0;
  const cues = file.cues.map((c) => {
    const want = count(c, from);
    const got = count(c, to);
    if (want && !got) noneBefore++;
    if (!want || got >= want || c.fire) {
      if (want && !got) noneAfter++;
      return c;
    }
    // per group of the new venue: the places to aim at
    const aims = new Map<string, number[]>();
    const lost: string[] = [];
    const took: string[] = [];
    for (const part of plainParts(c.target, from)) {
      const r = readPart(part, from);
      if (!r || !r.at.length) continue;
      const dest = standFor(r.group);
      const src = nozzleGroup(from, r.group);
      if (!dest || !src) {
        lost.push(r.group);
        continue;
      }
      const dst = to.groups[dest];
      const places = mapPlaces(
        src.map((i) => from.fixtures[i].position),
        r.at,
        dst.map((i) => to.fixtures[i].position),
      );
      if (dest !== r.group) {
        const t0 = cueTime(c.t, file);
        if (busyBetween(dest, places, t0, t0 + Math.max(c.dur ?? 0, 0.5))) {
          lost.push('');
          busy++;
          continue;
        }
      }
      aims.set(dest, [...(aims.get(dest) ?? []), ...places]);
      if (dest !== r.group) took.push(`${r.group}\n${dest}`);
    }
    if (!aims.size) {
      for (const g of new Set(lost)) if (g) left.set(g, (left.get(g) ?? 0) + 1);
      if (!got) noneAfter++;
      return c;
    }
    const target = [...aims].map(([g, at]) => writePart(g, at, to.groups[g].length)).join(',');
    if (target === c.target) return c;
    // a stand-in that cannot lean takes only the water and the light
    const fixed = [...aims.keys()].some((g) => !to.fixtures[to.groups[g][0]].turns && !plainParts(c.target, from).some((p) => readPart(p, from)?.group === g));
    const body = fixed ? withoutHead(c) : c;
    if (!body) {
      headOnly++;
      if (!got) noneAfter++;
      return c;
    }
    changed++;
    for (const k of new Set(took)) swaps.set(k, (swaps.get(k) ?? 0) + 1);
    return { ...body, target };
  });
  return {
    cues,
    report: {
      changed,
      noneBefore,
      noneAfter,
      swaps: [...swaps].map(([k, n]) => ({ from: k.split('\n')[0], to: k.split('\n')[1], n })).sort((x, y) => y.n - x.n),
      left: [...left].map(([group, n]) => ({ group, n })).sort((x, y) => y.n - x.n),
      busy,
      headOnly,
    },
  };
}
