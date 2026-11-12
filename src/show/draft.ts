import { curveAt, type MusicFeatures, type Onset } from '../audio/analysis';
import type { Cue, ShowFile } from './types';

/**
 * A first draft of a show for any music and any venue (docs/music-plan.md 6):
 * the cues a person then edits, not a finished show. Built from the music's
 * analysis (loudness and onsets) and the groups the venue has, with the house
 * rules of .claude/skills/show-director (and project-api.md "decided"):
 *
 *   - start quietly: a few jets near the centre as points of light (the seed),
 *     and the water grows with the music instead of appearing on a beat
 *   - scenes follow the music's loudness; each has one colour and one accent
 *   - two peaks: a first one inside 40-85 % of the piece and the main one,
 *     the loudest scene after half way; the scene before the main peak holds
 *     back, and its last seconds go dark (cut 3 s early, the water takes that
 *     long to fall) so the peak reads as a peak
 *   - after the first peak, a valley
 *   - every group at once only in the main peak; the geyser is a reward that
 *     grows: 0.7 in the first peak, 1.0 on the last hit (its mist hangs for
 *     10 s and more, so not at the start of the main peak: it whitened it)
 *   - the end: the main peak's colours change every 2 s (one colour across
 *     everything), the last hit is white, then everything stops at once and
 *     the seed is left, as it began
 *
 * Only groups the venue has are used (grid, whip, fan, chaser, flower,
 * geyser), so the same draft works on the lake, the plaza, the garden or the
 * desk. Deterministic: the same music gives the same cues.
 */

export interface DraftInput {
  music: MusicFeatures;
  /** Its timing (bpm, offset, beatsPerBar) and length. */
  file: Pick<ShowFile, 'bpm' | 'beatsPerBar' | 'offset' | 'duration'>;
  /** The venue's groups: name -> fixture indices (Layout.groups). */
  groups: Record<string, number[]>;
}

/** A scene of the draft: a stretch of the music and how dense it is (1 quiet .. 5 everything). */
export interface DraftScene {
  from: number;
  to: number;
  energy: number;
  density: 1 | 2 | 3 | 4 | 5;
  role: 'start' | 'scene' | 'first-peak' | 'valley' | 'hold' | 'main-peak';
  color: string;
  accent: string;
}

const C = {
  deep: '#2433ff',
  blue: '#1f78ff',
  cyan: '#19d0ff',
  teal: '#14d9a6',
  purple: '#8a3cff',
  magenta: '#ff2f9e',
  gold: '#ffae2e',
  orange: '#ff6a1a',
  white: '#ffffff',
};
/** Ground colours by density, taken in turn so neighbours differ; one-song shows keep a narrow range. */
const GROUND: Record<number, string[]> = {
  1: [C.deep, C.blue, C.purple],
  2: [C.blue, C.cyan, C.teal],
  3: [C.cyan, C.purple, C.teal],
  4: [C.magenta, C.gold, C.purple],
  5: [C.gold],
};
/** The accent for a ground colour (chasers, geyser, the bloom). */
const ACCENT: Record<string, string> = {
  [C.deep]: C.cyan,
  [C.blue]: C.white,
  [C.purple]: C.gold,
  [C.cyan]: C.white,
  [C.teal]: C.gold,
  [C.magenta]: C.gold,
  [C.gold]: C.white,
};
/** The main peak: one colour across everything, changed every 2 s. */
const FINALE_TURNS = [C.gold, C.magenta, C.cyan, C.purple, C.orange, C.blue];

/** Seconds the water needs to fall: a cut is started this much early. */
const FALL = 3;
/** Water and valves need a moment to rise: hits are cued this much before the sound. */
const LEAD = 0.25;
/** The dark before the main peak (s): the seed alone, after the water has fallen. */
const DARK = 3;

const round = (t: number) => Math.round(t * 1000) / 1000;

export function draftScenes(inp: DraftInput): DraftScene[] {
  const { music, file } = inp;
  const end = file.duration;
  const level = music.curves.level;
  // loudness, smoothed over about 4 s, every half second
  const step = 0.5;
  const n = Math.max(1, Math.floor(end / step));
  const raw = Array.from({ length: n }, (_, i) => curveAt(level, i * step));
  const k = 4;
  const E = raw.map((_, i) => {
    let s = 0;
    let c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      s += raw[j];
      c++;
    }
    return s / c;
  });
  const mean = (a: number, b: number) => {
    const i0 = Math.max(0, Math.floor(a / step));
    const i1 = Math.min(n, Math.ceil(b / step));
    let s = 0;
    for (let i = i0; i < i1; i++) s += E[i];
    return i1 > i0 ? s / (i1 - i0) : 0;
  };
  // boundaries where the loudness changes most (6 s either side), 12 s apart at least
  const want = Math.max(2, Math.min(8, Math.round(end / 25)));
  const W = 6;
  const cand: { t: number; score: number }[] = [];
  for (let t = 10; t <= end - 10; t += step) cand.push({ t, score: Math.abs(mean(t, t + W) - mean(t - W, t)) });
  cand.sort((a, b) => b.score - a.score);
  const cuts: number[] = [];
  for (const c of cand) {
    if (cuts.length >= want - 1) break;
    if (cuts.every((x) => Math.abs(x - c.t) >= 12)) cuts.push(c.t);
  }
  cuts.sort((a, b) => a - b);
  // on the beat grid when there is one (a scene changes on a bar)
  const bar = (60 / file.bpm) * file.beatsPerBar;
  const onBar = (t: number) => file.offset + Math.round((t - file.offset) / bar) * bar;
  const edges = [0, ...cuts.map((t) => round(Math.min(end - 6, Math.max(6, onBar(t))))), end];
  const scenes: DraftScene[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    if (edges[i + 1] - edges[i] < 4) continue;
    scenes.push({ from: edges[i], to: edges[i + 1], energy: mean(edges[i], edges[i + 1]), density: 2, role: 'scene', color: C.blue, accent: C.white });
  }
  // fold a too-short last piece into the scene before
  if (scenes.length > 1 && scenes[scenes.length - 1].to - scenes[scenes.length - 1].from < 6) {
    const last = scenes.pop()!;
    scenes[scenes.length - 1].to = last.to;
  }
  scenes[scenes.length - 1].to = end;

  // density by loudness rank (1..3), then the structure on top
  const ranked = [...scenes].sort((a, b) => a.energy - b.energy);
  ranked.forEach((s, i) => (s.density = (1 + Math.floor((3 * i) / Math.max(1, ranked.length))) as 1 | 2 | 3));
  // only the opening (and a really quiet passage) is the seed alone; music with some body has the floor
  for (const s of scenes) if (s.density === 1 && s.energy >= 0.3) s.density = 2;
  const at = (s: DraftScene) => (s.from + s.to) / 2 / end;
  // the main peak: the loudest scene after half way (the last one when nothing stands out)
  const late = scenes.filter((s) => at(s) > 0.5);
  const main = late.reduce((a, b) => (b.energy > a.energy * 1.02 ? b : a), late[late.length - 1] ?? scenes[scenes.length - 1]);
  main.density = 5;
  main.role = 'main-peak';
  const iMain = scenes.indexOf(main);
  // the first peak: the loudest scene in 30-85 % before the main one, not right before it
  const first = scenes.filter((s, i) => i < iMain - 1 && at(s) >= 0.3 && at(s) <= 0.85).sort((a, b) => b.energy - a.energy)[0];
  if (first) {
    first.density = 4;
    first.role = 'first-peak';
    const after = scenes[scenes.indexOf(first) + 1];
    if (after && after !== main) {
      after.density = Math.min(after.density, 2) as 1 | 2;
      after.role = 'valley';
    }
  }
  // hold back before the main peak (a valley there already does)
  if (iMain > 0 && scenes[iMain - 1].role === 'scene' && scenes[iMain - 1] !== scenes[0]) {
    scenes[iMain - 1].density = Math.min(scenes[iMain - 1].density, 3) as 1 | 2 | 3;
    scenes[iMain - 1].role = 'hold';
  }
  // a quiet start, whatever the music
  if (scenes[0] !== main) {
    scenes[0].density = Math.min(scenes[0].density, 2) as 1 | 2;
    scenes[0].role = 'start';
  }
  // after the main peak (a coda), keep it low
  for (let i = iMain + 1; i < scenes.length; i++) scenes[i].density = Math.min(scenes[i].density, 2) as 1 | 2;
  // colours: in turn per density, so neighbours differ
  const used: Record<number, number> = {};
  let prev = '';
  for (const s of scenes) {
    const list = GROUND[s.density];
    let c = list[(used[s.density] = (used[s.density] ?? -1) + 1) % list.length];
    if (c === prev && list.length > 1) c = list[(used[s.density] = used[s.density] + 1) % list.length];
    s.color = c;
    s.accent = ACCENT[c] ?? C.white;
    prev = c;
  }
  return scenes;
}

/** The draft's cues. */
export function buildDraft(inp: DraftInput): Cue[] {
  const { music, file, groups } = inp;
  const end = file.duration;
  const has = (g: string) => (groups[g]?.length ?? 0) > 0;
  const count = (g: string) => groups[g]?.length ?? 0;
  const cues: Cue[] = [];
  const set = (t: number, target: string, s: Cue['set'], dur = 0, extra: Partial<Cue> = {}) => {
    if (t < 0 || t >= end) return;
    cues.push({ t: round(t), target, set: s, ...(dur ? { dur: round(dur) } : {}), ...extra });
  };
  const macro = (t: number, target: string, name: NonNullable<Cue['macro']>, args: Record<string, number | string>, extra: Partial<Cue> = {}) => {
    if (t < 0 || t >= end) return;
    cues.push({ t: round(t), target, macro: name, args, ...extra });
  };
  const scenes = draftScenes(inp);
  // the centre of the grid (the seed): a tenth of its jets, at least 2
  const gN = count('grid');
  const seedN = Math.max(2, Math.round(gN * 0.1));
  const g0 = Math.max(0, Math.floor((gN - seedN) / 2));
  const seed = gN ? `grid[${g0}-${Math.min(gN - 1, g0 + seedN - 1)}]` : '';
  const bar = (60 / file.bpm) * file.beatsPerBar;
  const phrase = Math.max(6, Math.min(12, bar * 4));
  const strong = (a: number, b: number, min: number, gap: number) => {
    const out: Onset[] = [];
    for (const o of music.onsets) {
      if (o.t < a || o.t >= b || o.strength < min) continue;
      if (out.length && o.t - out[out.length - 1].t < gap) {
        if (o.strength > out[out.length - 1].strength) out[out.length - 1] = o;
        continue;
      }
      out.push(o);
    }
    return out;
  };
  const start = music.onsets[0]?.t ?? 0;
  const main = scenes.find((s) => s.role === 'main-peak')!;
  // the geyser's mist hangs for 10 s and more: the first peak (0.7) and the last hit (1.0), nothing between
  const geyserLevels = [0.7, 1];

  // the seed: points of light at the centre before the music builds (the bookend)
  if (seed) {
    set(0, 'grid', { pressure: 0, intensity: 0.9, color: scenes[0].color });
    set(Math.max(0, start - 0.5), seed, { pressure: 0.04, intensity: 0.9 }, 1.5, { ease: 'out' });
  }

  for (const s of scenes) {
    const len = s.to - s.from;
    const t0 = s.from;
    // the main peak ends on its strongest onset in its last 12 s: the last hit
    const lastHit =
      s.role === 'main-peak' ? (strong(Math.max(t0 + 4, s.to - 12), s.to - 1, 0.5, 1).sort((a, b) => b.strength - a.strength)[0]?.t ?? s.to - 3) : s.to;
    // the scene's colour on everything it uses, changed slowly (LEDs fade)
    for (const g of ['grid', 'whip', 'fan', 'flower']) if (has(g)) set(t0, g, { color: s.color, intensity: 1 }, s.role === 'main-peak' ? 0.5 : 1.5);
    if (has('chaser')) set(t0, 'chaser', { color: s.accent, intensity: 1 }, 1);
    if (has('geyser')) set(t0, 'geyser', { color: s.accent, intensity: 1 }, 1);

    // the floor (grid): it follows the music's loudness, how high by density
    const floor: Record<number, [number, number]> = { 1: [0.06, 0.3], 2: [0.15, 0.5], 3: [0.25, 0.65], 4: [0.35, 0.8], 5: [0.45, 0.95] };
    const [lo, hi] = floor[s.density];
    // the main peak's last seconds belong to the last hit and the stop
    const isLast = s === scenes[scenes.length - 1];
    const beforeMain = scenes[scenes.indexOf(s) + 1]?.role === 'main-peak';
    const floorEnd =
      s.role === 'main-peak' ? Math.max(1, lastHit - LEAD - t0) : beforeMain ? Math.max(1, len - FALL - DARK) : isLast ? Math.max(1, len - FALL - 1.5) : len;
    if (gN) {
      const target = s.density === 1 ? seed : 'grid';
      if (s.density === 1 && t0 > 0) set(t0, 'grid', { pressure: 0 }, FALL, { ease: 'in' });
      macro(t0, target, 'follow', { curve: 'level', min: lo, max: hi, dur: round(floorEnd), step: 0.25 }, { stagger: s.density >= 3 ? 0.002 : 0, order: 'center' });
    }
    // a seed-only moment before the main peak: lower everything 3 s early, a short dark
    if (beforeMain) {
      const dark = s.to - FALL - DARK;
      for (const g of ['grid', 'whip', 'fan', 'flower', 'chaser']) if (has(g)) set(dark, g, { pressure: 0 }, FALL, { ease: 'in' });
      if (seed) set(dark + FALL, seed, { pressure: 0.04 }, 0.5);
    }

    // the moving jets (whips, fans): formations by phrase from density 2
    const movers = ['whip', 'fan'].filter(has);
    if (s.density >= 2 && movers.length) {
      // density 2: one kind sways; 3+: formations open and cross by phrase
      const who = s.density === 2 ? [movers[0]] : movers;
      for (const g of who) set(t0, g, { pressure: s.density === 2 ? 0.45 : 0.75 }, 2, { ease: 'out', stagger: 0.04, order: 'center' });
      let k = 0;
      for (let t = t0; t < t0 + len - 2; t += phrase, k++) {
        for (const g of who) {
          if (s.density === 2) macro(t, g, 'sway', { amp: 18, period: round(phrase / 2), cycles: 2 });
          else macro(t, g, 'spread', k % 2 ? { from: 35, to: -35, dur: 2 } : { from: -40, to: 40, dur: 2 });
        }
      }
      // gone before the next scene unless it keeps them (3 s to fall)
      if (s.role !== 'main-peak') for (const g of who) set(Math.max(t0 + 2, s.to - FALL - (beforeMain ? DARK : 0)), g, { pressure: 0, pan: 0 }, FALL, { ease: 'in' });
    }

    // accents on strong onsets: chasers from density 4 (and the main peak)
    if (s.density >= 4 && has('chaser')) {
      for (const o of strong(t0 + 1, Math.min(s.to - 2, lastHit - 1.5), 0.75, 2.5)) macro(o.t - LEAD, 'chaser', 'chase', { speed: 24, hold: 0.35, level: 0.9 }, { order: 'index' });
    }
    // flowers open with the first peak and the main one
    if (s.density >= 4 && has('flower')) {
      set(t0 + 1, 'flower', { pressure: 0.8 }, 1.5, { ease: 'out' });
      macro(t0 + 2.5, 'flower', 'bloom', { to: 30, dur: 3 });
      if (s.role !== 'main-peak') set(s.to - FALL, 'flower', { pressure: 0, tilt: 0 }, FALL, { ease: 'in' });
    }
    // the geyser: a reward that grows, on the first peak's strongest onset (the last hit has the other)
    if (s.role === 'first-peak' && has('geyser')) {
      const hit = strong(t0 + 1, s.to - 3, 0.5, 1).sort((a, b) => b.strength - a.strength)[0];
      if (hit) macro(hit.t - LEAD, 'geyser', 'pulse', { level: geyserLevels[0], hold: 1.2, release: 1.5 });
    }
    // the main peak: one colour across everything, every 2 s
    if (s.role === 'main-peak') {
      let i = 0;
      for (let t = t0 + 4; t < lastHit - 2; t += 2, i++) {
        const c = FINALE_TURNS[i % FINALE_TURNS.length];
        for (const g of ['grid', 'whip', 'fan', 'flower']) if (has(g)) set(t, g, { color: c }, 0.6);
      }
      // the last hit: white water, everything up
      const hit = lastHit - LEAD;
      for (const g of ['grid', 'whip', 'fan', 'flower', 'chaser']) if (has(g)) set(hit, g, { pressure: 1, color: C.white, intensity: 1 }, 0.3, { ease: 'out' });
      if (has('whip')) macro(hit, 'whip', 'spread', { from: -25, to: 25, dur: 0.6 });
      if (has('geyser')) macro(hit, 'geyser', 'pulse', { level: geyserLevels[1], hold: 1.5, release: 1.5 }, { set: { color: C.white } });
      // the stop: everything falls at once, the seed stays (as it began)
      const stop = Math.min(s.to - 0.6, hit + 1.6);
      for (const g of ['grid', 'whip', 'fan', 'flower', 'chaser']) if (has(g)) set(stop, g, { pressure: 0, pan: 0, tilt: 0 }, 0.25, { ease: 'in' });
      if (seed) set(stop + 0.3, seed, { pressure: 0.04, color: C.white, intensity: 0.9 }, 0.3);
    }
  }
  // a quiet piece after the main peak (a coda) ends the same way: the water falls in time, the seed stays
  if (scenes[scenes.length - 1] !== main) {
    const fall = end - FALL - 1.5;
    for (const g of ['grid', 'whip', 'fan', 'flower', 'chaser']) if (has(g)) set(fall, g, { pressure: 0, pan: 0, tilt: 0 }, FALL, { ease: 'in' });
    if (seed) set(fall + FALL, seed, { pressure: 0.04, color: C.white, intensity: 0.9 }, 0.3);
  }
  return cues.sort((a, b) => Number(a.t) - Number(b.t));
}
