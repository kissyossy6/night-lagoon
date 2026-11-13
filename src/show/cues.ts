import * as THREE from 'three';
import { curveAt, type Curve } from '../audio/analysis';
import type { Layout } from './layout';
import { compilePyro, type Burst, type PyroWarning } from '../pyro/schedule';
import { isScreen, needsProjector, projectorCues, withoutScreenIntensity, zoneChannels } from './projector';
import { sceneStart } from './song';
import type { Cue, Ease, Order, ShowFile, VideoFit } from './types';

/**
 * Cue compiler and evaluator.
 *
 * A show compiles into one track per (fixture, channel). A track is a list of
 * segments {start, dur, ease, to}; evaluating at t finds the last segment that
 * started at or before t and interpolates from the value the channel had when
 * that segment started. A later cue therefore overrides an earlier one from
 * its own start, beginning at whatever value the earlier one had reached.
 * Evaluation is a pure function of t, so the show can seek anywhere.
 */

export const CHANNELS = ['pressure', 'pan', 'tilt', 'r', 'g', 'b', 'intensity'] as const;
export type Channel = (typeof CHANNELS)[number];
export const CH: Record<Channel, number> = { pressure: 0, pan: 1, tilt: 2, r: 3, g: 4, b: 5, intensity: 6 };
const DEFAULTS = [0, 0, 0, 0.0, 0.42, 1.0, 1.0]; // dark, upright, cyan, full brightness

interface Segment {
  start: number;
  dur: number;
  ease: Ease;
  to: number;
  from: number; // value at start, filled in by compile
  source: number;
}

export interface CompiledShow {
  file: ShowFile;
  /** tracks[fixture * CHANNELS.length + channel] */
  tracks: Segment[][];
  /** Expanded plain cues (after macros), for the timeline editor. */
  plain: PlainCue[];
  /** Cues (file indices) whose head moves were slowed to the head's top speed. */
  limited: number[];
  /** Cues whose colour or brightness changes were slowed to the LED drivers' fades (src/show/checks.ts). */
  ledSlowed: number[];
  /** Projector clips by start time; see screenAt(). */
  clips: ClipCue[];
  /** Fireworks, one per shell, by burst time (src/pyro/schedule.ts). */
  bursts: Burst[];
  /** Shells fired nearer the audience than their safety distance. */
  pyroWarnings: PyroWarning[];
}

/**
 * From `start` on, the projector shows its picture (or the video's) for time
 * base + (t - start).
 */
export interface ClipCue {
  start: number;
  base: number;
  source: number;
  video?: VideoRef;
  /** The one drawn scene the clip plays (Clip.alone). */
  only?: string;
}

export interface VideoRef {
  src: string;
  fit: VideoFit;
}

/** What the projector shows at one show time: picture time t, of a video or the drawn scenes. */
export interface ScreenFrame {
  t: number;
  video?: VideoRef;
  /** Draw only this scene (a clip played alone). */
  only?: string;
  /**
   * Nothing chosen to show: black. A show on its own music has no story
   * timed to it (the drawn story belongs to Rhapsody in Blue), so before
   * its first clip the screens stay dark (docs/music-plan.md 4.3).
   */
  blank?: boolean;
  /**
   * The projector's brightness across the panorama, left to right, as a
   * share of its brightest zone; missing when every zone is alike.
   */
  mask?: number[];
}

/**
 * Top angular speed of a moving head (deg/s). The whip mechanism moves 110 deg
 * end to end in under 2 s (Disney US7886992, docs/research.md); the show
 * footage moves far slower than that limit (docs/video-review.md R7). A move
 * that asks for more takes longer, and the next cue starts from wherever the
 * head got to, like a real servo running flat out.
 */
export const HEAD_MAX_DEG_S = 90;

/**
 * Flowers and fans run on on/off valves, not variable-speed pumps: turning
 * them on or off takes a fraction of a second whatever the cue's duration,
 * so the water front shoots out at full speed and, at the end, the water
 * already in the air runs out along its full arcs. A slow ramp from or to
 * zero made the whole shape grow and shrink as if it were being scaled.
 */
export const VALVE_OPEN_S = 0.2;

/**
 * Envelopes of the background music (src/audio/analysis.ts), for the 'follow'
 * macro. Set them before compiling; without them 'follow' holds the middle of
 * its range.
 */
let CURVES: Record<string, Curve> = {};
export function setCurves(c: Record<string, Curve>) {
  CURVES = c;
}
export const VALVE_CLOSE_S = 0.25;

/**
 * LED rings run through dimmer drivers: a colour cross-fades and a light dies
 * away, it never jumps. Cues asking for a faster change are slowed to these
 * (2026-10-26: snap colour changes and lights vanishing at once looked unreal).
 */
export const LED_COLOR_FADE_S = 0.6;
export const LED_FADE_OUT_S = 0.9;
export const LED_FADE_IN_S = 0.12;

/** A cue after macro expansion and target resolution: one fixture set. */
export interface PlainCue {
  start: number;
  fixture: number;
  channel: number;
  to: number;
  dur: number;
  ease: Ease;
  source: number; // index of the cue in the show file
}

export function cueTime(t: number | string, file: Pick<ShowFile, 'bpm' | 'beatsPerBar' | 'offset'>): number {
  if (typeof t === 'number') return t;
  const [bar, beat = '1'] = t.split(':');
  const spb = 60 / file.bpm;
  return file.offset + (Number(bar) - 1) * file.beatsPerBar * spb + (Number(beat) - 1) * spb;
}

/**
 * Resolve "grid", "grid[0-15]", "grid[0-15:2]", "whip,fan" into fixture
 * indices. "@前列" names one of the venue's selections (layout.selections),
 * also inside a list ("@前列,whip"); a selection may name another, up to
 * four deep. Unknown names resolve to nothing, like unknown groups.
 */
export function resolveTarget(target: string, layout: Layout, depth = 0): number[] {
  const out: number[] = [];
  for (const part of target.split(',').map((s) => s.trim())) {
    if (part.startsWith('@')) {
      const named = layout.selections[part.slice(1)];
      if (named !== undefined && depth < 4) out.push(...resolveTarget(named, layout, depth + 1));
      continue;
    }
    const m = /^([a-zA-Z]+)(?:\[(\d+)-(\d+)(?::(\d+))?\])?$/.exec(part);
    if (!m) continue;
    const g = layout.groups[m[1]];
    if (!g) continue;
    if (m[2] === undefined) {
      out.push(...g);
    } else {
      const step = Number(m[4] ?? 1);
      for (let i = Number(m[2]); i <= Math.min(Number(m[3]), g.length - 1); i += step) out.push(g[i]);
    }
  }
  return out;
}

/** Stagger rank of each target position for an order mode. */
function ranks(n: number, order: Order = 'index', seed = 1): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  switch (order) {
    case 'reverse':
      return idx.map((i) => n - 1 - i);
    case 'center':
      return idx.map((i) => Math.abs(i - (n - 1) / 2));
    case 'edges':
      return idx.map((i) => (n - 1) / 2 - Math.abs(i - (n - 1) / 2));
    case 'random': {
      let s = seed * 9301 + 49297;
      const r = idx.map(() => ((s = (s * 9301 + 49297) % 233280) / 233280));
      const sorted = [...idx].sort((a, b) => r[a] - r[b]);
      const out = new Array<number>(n);
      sorted.forEach((i, k) => (out[i] = k));
      return out;
    }
    default:
      return idx;
  }
}

function ease(kind: Ease, x: number): number {
  if (x >= 1) return 1;
  if (x <= 0) return kind === 'step' ? 1 : 0;
  switch (kind) {
    case 'in':
      return x * x;
    case 'out':
      return 1 - (1 - x) * (1 - x);
    case 'inOut':
      return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    case 'step':
      return 1;
    default:
      return x;
  }
}

const tmpColor = new THREE.Color();

/** Push the per-channel sets of one cue on one fixture. */
function emit(out: PlainCue[], fixture: number, start: number, cue: Cue, set: NonNullable<Cue['set']>, source: number) {
  const dur = Math.max(cue.dur ?? 0, 0);
  const e: Ease = cue.ease ?? (dur > 0 ? 'inOut' : 'step');
  const push = (ch: Channel, to: number) => out.push({ start, fixture, channel: CH[ch], to, dur, ease: e, source });
  if (set.pressure !== undefined) push('pressure', set.pressure);
  if (set.pan !== undefined) push('pan', THREE.MathUtils.degToRad(set.pan));
  if (set.tilt !== undefined) push('tilt', THREE.MathUtils.degToRad(set.tilt));
  if (set.intensity !== undefined) push('intensity', set.intensity);
  if (set.color !== undefined) {
    tmpColor.set(set.color); // linear RGB
    push('r', tmpColor.r);
    push('g', tmpColor.g);
    push('b', tmpColor.b);
  }
}

const num = (v: number | string | undefined, d: number) => (v === undefined ? d : Number(v));

/** Expand one cue (plain or macro) into per-fixture sets. */
function expand(cue: Cue, source: number, file: ShowFile, layout: Layout, out: PlainCue[]) {
  // fireworks are not water channels (src/pyro/schedule.ts)
  if (cue.fire) return;
  const t0 = cueTime(cue.t, file);
  const fx = resolveTarget(cue.target, layout);
  const rk = ranks(fx.length, cue.order, source + 1);
  const stagger = cue.stagger ?? 0;
  const a = cue.args ?? {};
  fx.forEach((f, i) => {
    const t = t0 + rk[i] * stagger;
    switch (cue.macro) {
      case undefined:
        if (cue.set) emit(out, f, t, cue, cue.set, source);
        break;
      // pressure (or another channel) oscillating between base +- amp
      case 'wave':
      case 'sway': {
        const ch = String(a.param ?? (cue.macro === 'sway' ? 'pan' : 'pressure')) as 'pressure' | 'pan' | 'tilt';
        const period = num(a.period, 2);
        const base = num(a.base, cue.macro === 'sway' ? 0 : 0.6);
        const amp = num(a.amp, cue.macro === 'sway' ? 40 : 0.3);
        const dur = num(a.dur, period * num(a.cycles, 2));
        const half = period / 2;
        // first quarter: from current value to the first peak
        let tt = t;
        let sign = 1;
        emit(out, f, tt, { ...cue, dur: half / 2, ease: 'out' }, { [ch]: base + amp }, source);
        tt += half / 2;
        while (tt + half <= t + dur) {
          sign = -sign;
          emit(out, f, tt, { ...cue, dur: half, ease: 'inOut' }, { [ch]: base + sign * amp }, source);
          tt += half;
        }
        emit(out, f, tt, { ...cue, dur: half / 2, ease: 'in' }, { [ch]: base }, source);
        break;
      }
      // a short burst: up, hold, down
      case 'pulse': {
        const level = num(a.level, 1);
        const hold = num(a.hold, 0.3);
        const rest = num(a.rest, 0);
        emit(out, f, t, { ...cue, dur: num(a.attack, 0.05), ease: 'out' }, { pressure: level, ...(cue.set ?? {}) }, source);
        emit(out, f, t + hold, { ...cue, dur: num(a.release, 0.15), ease: 'in' }, { pressure: rest }, source);
        break;
      }
      // a lit window running along the group: each nozzle pulses in turn
      case 'chase': {
        const speed = num(a.speed, 12); // nozzles per second
        const hold = num(a.hold, 0.35);
        const laps = num(a.laps, 1);
        const n = fx.length;
        for (let lap = 0; lap < laps; lap++) {
          const ts = t0 + (rk[i] + lap * n) / speed;
          emit(out, f, ts, { ...cue, dur: 0.06, ease: 'out' }, { pressure: num(a.level, 1), ...(cue.set ?? {}) }, source);
          emit(out, f, ts + hold, { ...cue, dur: 0.2, ease: 'in' }, { pressure: num(a.rest, 0) }, source);
        }
        break;
      }
      // ring jets opening outward like a flower
      case 'bloom': {
        emit(out, f, t, { ...cue, dur: num(a.dur, 2), ease: 'inOut' }, { tilt: num(a.to, 25), ...(cue.set ?? {}) }, source);
        break;
      }
      // formation: pan fixed by position along the targets, from 'from' on the
      // first to 'to' on the last. -a..+a opens a fan outward, +a..-a crosses
      // the jets over the centre
      case 'spread': {
        const u = fx.length > 1 ? i / (fx.length - 1) : 0.5;
        const ch = String(a.param ?? 'pan') as 'pan' | 'tilt';
        const angle = num(a.from, -45) + (num(a.to, 45) - num(a.from, -45)) * u;
        emit(out, f, t, { ...cue, dur: num(a.dur, 2), ease: 'inOut' }, { [ch]: angle, ...(cue.set ?? {}) }, source);
        break;
      }
      // every target leans to the same angle, holds, and comes back; with a
      // stagger it runs along the line as a wave
      case 'lean': {
        const ch = String(a.param ?? 'pan') as 'pan' | 'tilt';
        const move = num(a.dur, 1.5);
        emit(out, f, t, { ...cue, dur: move, ease: 'inOut' }, { [ch]: num(a.angle, 40), ...(cue.set ?? {}) }, source);
        // back: 'stay' keeps the lean for the next cue to pick up
        if (a.back !== 'stay') {
          emit(out, f, t + move + num(a.hold, 1), { ...cue, dur: move, ease: 'inOut' }, { [ch]: num(a.back, 0) }, source);
        }
        break;
      }
      // a channel that follows an envelope of the music: min..max, sampled
      // every 'step' seconds for 'dur'; a stagger delays the curve along the
      // targets, so loudness travels across the line
      case 'follow': {
        const ch = String(a.param ?? 'pressure') as 'pressure' | 'intensity';
        const lo = num(a.min, 0.2);
        const hi = num(a.max, 0.8);
        const step = num(a.step, 0.25);
        const dur = num(a.dur, 8);
        const c = CURVES[String(a.curve ?? 'level')];
        const lag = t - t0;
        for (let s = 0; s < dur - 1e-6; s += step) {
          const u = c ? curveAt(c, t0 + s + step - lag) : 0.5;
          emit(out, f, t + s, { ...cue, dur: step, ease: 'linear' }, { [ch]: lo + (hi - lo) * u }, source);
        }
        break;
      }
      // hue spread across the targets
      case 'rainbow': {
        const h0 = num(a.hue, 0);
        const span = num(a.span, 1);
        const hue = (((h0 + (span * i) / Math.max(1, fx.length)) % 1) + 1) % 1;
        const c = new THREE.Color().setHSL(hue, 1, 0.5);
        emit(out, f, t, cue, { color: `#${c.getHexString()}` }, source);
        break;
      }
    }
  });
}

/**
 * Compile a show. A file from before the projector (version < 3) has its
 * screens' brightness turned into projector cues first (src/show/projector.ts);
 * the result keeps the file as it was, and the cue indices (warnings, the
 * editor) still point into it.
 */
export function compileShow(file: ShowFile, layout: Layout): CompiledShow {
  if (!needsProjector(file, layout)) return { ...compileRaw(file, layout, true), file };
  return { ...compileRaw(toProjector(file, layout), layout, true), file };
}

/**
 * A file from before the projector as a version 3 file: the screens'
 * brightness taken off them and written as projector cues after the rest
 * (src/show/projector.ts). The other cues keep their places.
 */
export function toProjector(file: ShowFile, layout: Layout): ShowFile {
  if (!needsProjector(file, layout)) return file;
  const old = compileRaw(file, layout, false);
  const nCh = CHANNELS.length;
  const cues = projectorCues(layout, (f, ch) => old.tracks[f * nCh + CH[ch]], DEFAULTS[CH.intensity], (s, t) => segValue(s as Segment, t));
  const kept = withoutScreenIntensity(file, layout, (c) => resolveTarget(c.target, layout));
  return { ...file, version: 3, cues: [...kept, ...cues] };
}

/**
 * Compile cues as written. With `projector`, a screen's brightness
 * ('intensity' on 'screen' or 'mound') goes to the projector's zones that
 * screen stands in: the projector makes the picture, the screens only hold mist.
 */
function compileRaw(file: ShowFile, layout: Layout, projector: boolean): CompiledShow {
  const raw: PlainCue[] = [];
  file.cues.forEach((c, i) => expand(c, i, file, layout, raw));
  const plain = projector && layout.projector.length ? raw.flatMap((p) => (p.channel === CH.intensity && isScreen(layout, p.fixture) ? zoneChannels(layout, p.fixture).map((fixture) => ({ ...p, fixture })) : [p])) : raw;
  const nCh = CHANNELS.length;
  const tracks: Segment[][] = Array.from({ length: layout.channels * nCh }, () => []);
  // stable sort by start time; equal starts keep file order (later wins)
  const order = plain.map((_, i) => i).sort((a, b) => plain[a].start - plain[b].start || a - b);
  for (const i of order) {
    const p = plain[i];
    tracks[p.fixture * nCh + p.channel].push({ start: p.start, dur: p.dur, ease: p.ease, to: p.to, from: 0, source: p.source });
  }
  const limited = new Set<number>();
  const ledSlowed = new Set<number>();
  const maxRate = THREE.MathUtils.degToRad(HEAD_MAX_DEG_S);
  tracks.forEach((segs, k) => {
    let prev: Segment | null = null;
    const ch = k % nCh;
    const def = DEFAULTS[ch];
    const fixture = layout.fixtures[Math.floor(k / nCh)];
    const head = (ch === CH.pan || ch === CH.tilt) && !!fixture?.turns;
    const valve = ch === CH.pressure && (fixture?.type === 'ring' || fixture?.type === 'fan');
    // a projector's picture fades as fast as it is told (not an LED driver)
    const led = ch >= CH.r && !(layout.projector.length && Math.floor(k / nCh) >= layout.projector[0].index);
    for (const s of segs) {
      s.from = prev ? segValue(prev, s.start) : def;
      if (head && limitSpeed(s, maxRate)) limited.add(s.source);
      if (valve) valveTiming(s);
      // the state a show opens on (a cue at 0 s, no fade) is set before the
      // show starts, so it is not an LED change: without this the start screen
      // showed every ring at the default cyan, fading out after play (owner 2026-11-13)
      const preset = !prev && s.start <= 0 && s.dur === 0;
      if (led && !preset && ledTiming(s, ch)) ledSlowed.add(s.source);
      prev = s;
    }
  });
  const pyro = compilePyro(file, layout);
  return { file, tracks, plain, limited: [...limited].sort((a, b) => a - b), ledSlowed: [...ledSlowed].sort((a, b) => a - b), clips: compileClips(file), bursts: pyro.bursts, pyroWarnings: pyro.warnings };
}

function compileClips(file: ShowFile): ClipCue[] {
  const clips: ClipCue[] = [];
  file.cues.forEach((c, source) => {
    if (!c.clip) return;
    const start = cueTime(c.t, file);
    const from = Number(c.clip.from) || 0;
    if (c.clip.scene === 'video') {
      if (c.clip.src && Number.isFinite(start)) clips.push({ start, base: from, source, video: { src: c.clip.src, fit: c.clip.fit ?? 'cover' } });
      return;
    }
    const base = c.clip.scene === 'sync' ? start : sceneStart(c.clip.scene) + from;
    const only = c.clip.alone && c.clip.scene !== 'sync' ? c.clip.scene : undefined;
    if (Number.isFinite(start) && Number.isFinite(base)) clips.push({ start, base, source, ...(only ? { only } : {}) });
  });
  // equal starts keep file order (later wins), as for the other channels
  return clips.sort((a, b) => a.start - b.start || a.source - b.source);
}

/** What the projector shows at show time t. */
export function screenAt(show: CompiledShow, t: number): ScreenFrame {
  let clip: ClipCue | undefined;
  for (const c of show.clips) {
    if (c.start > t) break;
    clip = c;
  }
  if (!clip) return show.file.music ? { t, blank: true } : { t };
  return { t: clip.base + (t - clip.start), video: clip.video, ...(clip.only ? { only: clip.only } : {}) };
}

/** On/off through a valve: a move from or to zero pressure is quick. */
function valveTiming(s: Segment) {
  const opening = s.from < 0.02 && s.to >= 0.02;
  const closing = s.from >= 0.02 && s.to < 0.02;
  const limit = opening ? VALVE_OPEN_S : closing ? VALVE_CLOSE_S : Infinity;
  if (s.dur > limit) {
    s.dur = limit;
    s.ease = 'linear';
  }
}

/** Colour and brightness changes no faster than the LED drivers fade. True if slowed. */
function ledTiming(s: Segment, ch: number): boolean {
  if (Math.abs(s.to - s.from) < 1e-3) return false;
  if (ch === CH.intensity) {
    if (s.to < s.from) {
      // the light dies away: quick at first, then a tail
      if (s.dur < LED_FADE_OUT_S) {
        s.dur = LED_FADE_OUT_S;
        s.ease = 'out';
        return true;
      }
    } else if (s.dur < LED_FADE_IN_S) {
      s.dur = LED_FADE_IN_S;
      s.ease = 'out';
      return true;
    }
  } else if (s.dur < LED_COLOR_FADE_S) {
    s.dur = LED_COLOR_FADE_S;
    s.ease = 'inOut';
    return true;
  }
  return false;
}

/** Peak speed of a segment over its mean speed, per ease. */
const PEAK: Record<Ease, number> = { linear: 1, in: 2, out: 2, inOut: 2, step: 1 };

/** Stretch a head move that is faster than the head can go. True if changed. */
function limitSpeed(s: Segment, maxRate: number): boolean {
  const dist = Math.abs(s.to - s.from);
  if (dist < 1e-4) return false;
  const need = (dist * PEAK[s.ease]) / maxRate;
  if (s.dur >= need - 1e-6) return false;
  // a jump becomes a flat-out move
  if (s.ease === 'step') s.ease = 'linear';
  s.dur = (dist * PEAK[s.ease]) / maxRate;
  return true;
}

function segValue(s: Segment, t: number): number {
  const x = s.dur > 0 ? (t - s.start) / s.dur : 1;
  return s.from + (s.to - s.from) * ease(s.ease, x);
}

/** Value of one channel of one fixture at time t. */
export function evaluate(show: CompiledShow, fixture: number, channel: number, t: number): number {
  const segs = show.tracks[fixture * CHANNELS.length + channel];
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found < 0 ? DEFAULTS[channel] : segValue(segs[found], t);
}
