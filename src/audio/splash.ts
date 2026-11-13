import { curveAt, type Curve } from './analysis';
import { CH, evaluate, type CompiledShow } from '../show/cues';
import type { Layout } from '../show/layout';

/**
 * Water sound: the splash of the show's water, rendered ahead of time from
 * the cues and played under the music (prototype, 2026-10-26).
 *
 * What is heard at a real lagoon is mostly water coming down, not water going
 * up, so every bit of water a nozzle emits is heard when it lands, one flight
 * time later (~ life x sqrt(pressure), ballistic). Only the big shots are also
 * heard at launch, as a rush of water (and a geyser's "don").
 *
 * Two layers:
 *   - shaa: the steady "しゃー" of water raining onto the lagoon, noise in the
 *     soft band 0.5-3.5 kHz with a slow, uneven flutter, as rain on water sounds
 *   - body: a little low wash under it for heavy falling water (geysers)
 * Tonal bubble chirps were tried first and sounded like dripping, not like a
 * fountain (2026-10-26), so nothing here has a pitch.
 * Everything is summed per side from the whole field (never one sound per
 * nozzle), smoothed so nothing starts or stops with a click, and ducked under
 * loud music: the sound comes through in the quiet passages and the breaks,
 * where it is the reward, and keeps out of the way in the tuttis.
 */

/** Listener: the audience camera (cameras.ts). */
const LISTENER: [number, number] = [0, 66];
/** Envelope rate (Hz). */
const RATE = 100;
/** Envelope level of a typical moment with water, before ducking. */
const LEVEL = 0.28;
/** Range compression of the landing envelope (0 none, 1 flat). */
const SQUEEZE = 0.4;
/** Gains of the two layers. */
const SHAA = 0.25;
const BODY = 0.6;
/** Gain of a launch against the splash. */
const LAUNCH = 1.6;
/** Cut under the loudest music (dB). */
const DUCK_DB = 15;

/**
 * Per group: how much water lands (relative), and how much of it is heavy
 * (wash) rather than broken into drops.
 */
const GROUP: Record<string, { water: number; heavy: number; launch?: number }> = {
  // only the big water is heard: the grid's and chasers' many small jets,
  // and the whips' and fans' long runs, only piled up into a busy hiss
  // (2026-10-26/27). The big shots are also heard going up.
  flower: { water: 1.6, heavy: 0.3, launch: 0.45 },
  geyser: { water: 3.5, heavy: 0.8, launch: 0.75 },
};

interface Launch {
  t: number;
  amp: number;
  pan: number;
  big: boolean;
  /** The output it goes to, for the spatial water (-1: stereo, panned). */
  out: number;
}

/** How the water of one instant comes down over five neighbouring envelope steps. */
const SPREAD = [0.1, 0.22, 0.36, 0.22, 0.1];

/** Deterministic noise, so the same show always sounds the same. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Equal-power gains for pan -1..1. */
function panGains(pan: number): [number, number] {
  const a = ((pan + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

/** Groups whose water is heard (the others only add up to a hiss). */
export const SPLASH_GROUPS: readonly string[] = Object.keys(GROUP);

/**
 * Render the water sound of a compiled show. 'level' is the music's loudness
 * curve (analysis.ts, 0..1); without it nothing is ducked.
 */
export function renderSplash(show: CompiledShow, layout: Layout, duration: number, sampleRate: number, level?: Curve): AudioBuffer {
  return splash(show, layout, duration, sampleRate, level, null);
}

/**
 * The water sound split into places, for the Vision Pro export (spatial.ts):
 * 'place' gives each fixture's output (0..outputs-1, or -1 to leave it out),
 * and each output is one mono channel of the buffer, to be heard from where
 * its fixtures stand. Heard from 'listener' (x, z): the nearer water is the
 * louder, as in the stereo sound (which hears it from the audience seat).
 * Everything else (landing, ducking, launches, the lagoon's tail) is as in
 * renderSplash. Only 'range' (s) is rendered (the buffer starts at its
 * start); the levels are still set from the whole show.
 */
export function renderSplashPlaces(
  show: CompiledShow,
  layout: Layout,
  duration: number,
  sampleRate: number,
  level: Curve | undefined,
  listener: [number, number],
  outputs: number,
  place: (fx: Layout['fixtures'][number]) => number,
  range: [number, number],
): AudioBuffer {
  return splash(show, layout, duration, sampleRate, level, { listener, outputs, place, range });
}

function splash(
  show: CompiledShow,
  layout: Layout,
  duration: number,
  sampleRate: number,
  level: Curve | undefined,
  places: { listener: [number, number]; outputs: number; place: (fx: Layout['fixtures'][number]) => number; range: [number, number] } | null,
): AudioBuffer {
  const n = Math.ceil(duration * RATE) + 1;
  // landing power per output (left and right side, or each place), heavy and light
  const outs = places ? places.outputs : 2;
  const heavy = Array.from({ length: outs }, () => new Float32Array(n));
  const light = Array.from({ length: outs }, () => new Float32Array(n));
  const launches: Launch[] = [];
  const listener = places ? places.listener : LISTENER;
  // a place gets half the power, as the centre does from each side in stereo
  const PLACE_GAIN = Math.SQRT1_2;

  for (const fx of layout.fixtures) {
    const g = GROUP[fx.group];
    if (!g) continue;
    const out = places ? places.place(fx) : -1;
    if (places && (out < 0 || out >= outs)) continue;
    const [x, , z] = fx.position;
    const d = places ? Math.max(1e-3, Math.hypot(x - listener[0], z - listener[1])) : Math.hypot(x - listener[0], z - listener[1]);
    const near = (40 / d) ** 2; // power falls with the square of the distance
    const pan = Math.max(-1, Math.min(1, x / 70));
    const [gl, gr] = panGains(pan);
    let prev = 0;
    for (let k = 0; k < n; k++) {
      const p = evaluate(show, fx.index, CH.pressure, k / RATE);
      if (g.launch && p > 0.15 && prev <= 0.15) launches.push({ t: k / RATE, amp: g.launch * Math.sqrt(near), pan, big: fx.group === 'geyser', out });
      prev = p;
      if (p < 0.02) continue;
      // flow ~ sqrt(p), impact speed ~ sqrt(p): power ~ flow x speed^2
      const e = (g.water * near * Math.sqrt(p) * p) / RATE;
      const land = k + fx.life * Math.sqrt(p) * RATE;
      // the water comes down over a spread of times, not in one instant
      const spread = Math.max(1, 0.12 * fx.life * RATE);
      for (let j = -2; j <= 2; j++) {
        const i = Math.round(land + (j * spread) / 2);
        if (i < 0 || i >= n) continue;
        const w = e * (SPREAD[j + 2] as number);
        if (places) {
          heavy[out][i] += w * g.heavy * PLACE_GAIN * PLACE_GAIN;
          light[out][i] += w * (1 - g.heavy) * PLACE_GAIN * PLACE_GAIN;
          continue;
        }
        heavy[0][i] += w * g.heavy * gl * gl;
        heavy[1][i] += w * g.heavy * gr * gr;
        light[0][i] += w * (1 - g.heavy) * gl * gl;
        light[1][i] += w * (1 - g.heavy) * gr * gr;
      }
    }
  }

  // smooth (fast attack, slow release: falling water thins out) and turn power into amplitude
  const smooth = (v: Float32Array) => {
    const a = 1 - Math.exp(-1 / (0.06 * RATE));
    const r = 1 - Math.exp(-1 / (0.4 * RATE));
    let y = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i] as number;
      y += (x - y) * (x > y ? a : r);
      v[i] = Math.sqrt(y);
    }
  };
  for (const v of [...heavy, ...light]) smooth(v);

  // normalise on a typical moment with water (not the loudest geyser hit),
  // and squeeze the range like the ear does: a few jets are not 30 dB below a full stage
  // every output's heavy and light, in this order (left heavy, left light, right heavy, right light)
  const all = (i: number) => (places ? Math.hypot(...heavy.flatMap((h, o) => [h[i] as number, light[o][i] as number])) : Math.hypot(heavy[0][i] as number, light[0][i] as number, heavy[1][i] as number, light[1][i] as number));
  const totals: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = all(i);
    if (a > 1e-7) totals.push(a);
  }
  totals.sort((a, b) => a - b);
  const ref = totals[Math.floor(totals.length * 0.75)] ?? 1;
  for (let i = 0; i < n; i++) {
    const a = all(i) / ref;
    const f = a > 1e-9 ? a ** -SQUEEZE / ref : 0;
    for (const v of [...heavy, ...light]) v[i] = (v[i] as number) * f;
  }
  const peak = 1;
  const duck = new Float32Array(n);
  let dy = 1;
  for (let i = 0; i < n; i++) {
    const l = level ? curveAt(level, i / RATE) : 0;
    const s = Math.min(1, Math.max(0, (l - 0.35) / 0.55));
    const target = 10 ** ((-DUCK_DB * s * s * (3 - 2 * s)) / 20);
    dy += (target - dy) * (target < dy ? 0.08 : 0.02); // duck in ~0.12 s, recover in ~0.5 s
    duck[i] = (dy * LEVEL) / peak;
  }

  // the places render only their range: sample i is at (i + off) / sampleRate in the show
  const off = places ? Math.round(places.range[0] * sampleRate) : 0;
  const len = places ? Math.max(1, Math.ceil((places.range[1] - places.range[0]) * sampleRate)) : Math.ceil(duration * sampleRate);
  const out = new AudioBuffer({ length: len, numberOfChannels: outs, sampleRate });
  const env = (v: Float32Array, i: number) => {
    const x = ((i + off) / sampleRate) * RATE;
    const k = Math.min(n - 2, Math.floor(x));
    const f = x - k;
    return ((v[k] as number) * (1 - f) + (v[k + 1] as number) * f) * ((duck[k] as number) * (1 - f) + (duck[k + 1] as number) * f);
  };
  const lp = (fc: number) => 1 - Math.exp((-2 * Math.PI * fc) / sampleRate);

  for (let ch = 0; ch < outs; ch++) {
    const rand = rng(0x5eed + ch * 7919);
    const y = out.getChannelData(ch);
    const H = heavy[ch] as Float32Array;
    const L = light[ch] as Float32Array;
    // shaa: white noise high-passed at ~500 Hz (two poles) and softened above ~3.5 kHz
    // body: noise through two low-pass poles (~400 Hz) minus a rumble below ~70 Hz
    const aHi1 = lp(500);
    const aHi2 = lp(500);
    const aTop = lp(3500);
    const a1 = lp(400);
    const a2 = lp(700);
    const aHp = lp(70);
    // flutter: a slowly wandering gain, so the sheet of sound is not machine-even
    const aFl = lp(3);
    let h1 = 0;
    let h2 = 0;
    let top = 0;
    let w1 = 0;
    let w2 = 0;
    let wHp = 0;
    let fl = 0;
    for (let i = 0; i < len; i++) {
      const wn = rand() * 2 - 1;
      h1 += (wn - h1) * aHi1;
      const x1 = wn - h1;
      h2 += (x1 - h2) * aHi2;
      const x2 = x1 - h2;
      top += (x2 - top) * aTop;
      w1 += (wn - w1) * a1;
      w2 += (w1 - w2) * a2;
      wHp += (w2 - wHp) * aHp;
      fl += (rand() * 2 - 1 - fl) * aFl;
      const h = env(H, i);
      const l = env(L, i);
      y[i] = top * SHAA * (h + l) * (1 + 18 * fl) + (w2 - wHp) * BODY * h;
    }
  }

  // big shots going up: a rush of water (and, for a geyser, the air's low
  // "don"). Shots fired together are heard as one, not stacked; they are
  // ducked far less than the splash, so a launch still reads over the music.
  launches.sort((a, b) => a.t - b.t);
  const merged: Launch[] = [];
  for (const e of launches) {
    const last = merged[merged.length - 1];
    if (last && e.t - last.t < 0.12 && last.out === e.out) {
      const p2 = last.amp * last.amp + e.amp * e.amp;
      last.pan = (last.pan * last.amp + e.pan * e.amp) / (last.amp + e.amp);
      last.amp = Math.sqrt(p2);
      last.big ||= e.big;
    } else merged.push({ ...e });
  }
  for (const e of merged) {
    const rand = rng(Math.round(e.t * 1000) + 17);
    const k = Math.min(n - 1, Math.floor(e.t * RATE));
    const gain = LEVEL * ((duck[k] as number) / LEVEL) ** 0.35 * Math.min(e.amp, 2) * LAUNCH;
    const [gl, gr] = panGains(e.pan);
    const s0 = Math.floor(e.t * sampleRate) - off;
    if (s0 >= len) continue;
    const decay = e.big ? 0.45 : 0.25;
    const m = Math.min(len - s0, Math.ceil(decay * 5 * sampleRate));
    // a place's launch stays in its own output; in stereo it is panned
    const P = places ? out.getChannelData(e.out) : null;
    const L = out.getChannelData(0);
    const R = out.getChannelData(places ? 0 : 1);
    const aLo = lp(1800);
    const aHp = lp(250);
    const aThump = lp(180);
    let lo = 0;
    let hp = 0;
    let th = 0;
    for (let j = 0; j < m; j++) {
      const tt = j / sampleRate;
      const wn = rand() * 2 - 1;
      lo += (wn - lo) * aLo;
      hp += (lo - hp) * aHp;
      th += (wn - th) * aThump;
      // rush: up in ~40 ms, then away as the water leaves the nozzle
      let v = (lo - hp) * 2.5 * Math.min(1, tt / 0.04) * Math.exp(-tt / decay);
      if (e.big) v += Math.sin(2 * Math.PI * 52 * tt * (1 - tt)) * Math.exp(-tt / 0.12) * 0.6 + th * 3 * Math.exp(-tt / 0.06);
      v *= gain * Math.min(1, j / 40);
      if (P) {
        if (s0 + j >= 0) P[s0 + j] += v * PLACE_GAIN;
        continue;
      }
      L[s0 + j] += v * gl;
      R[s0 + j] += v * gr;
    }
  }

  // an open lagoon: a little width and a short tail, then a soft limit
  // (a place has no other side: its own sound answers it)
  const dry = Array.from({ length: outs }, (_, ch) => Float32Array.from(out.getChannelData(ch)));
  for (let ch = 0; ch < outs; ch++) {
    const y = out.getChannelData(ch);
    const own = dry[ch] as Float32Array;
    const other = (places ? own : dry[1 - ch]) as Float32Array;
    const d1 = Math.round((ch ? 0.031 : 0.023) * sampleRate);
    const d2 = Math.round((ch ? 0.067 : 0.053) * sampleRate);
    for (let i = d2; i < len; i++) y[i] += 0.18 * (other[i - d1] as number) + 0.12 * (own[i - d2] as number);
    for (let i = 0; i < len; i++) y[i] = Math.tanh((y[i] as number) * 1.5) / 1.5;
  }
  return out;
}

/** The music with the water (or fireworks) sound added, for the video export, each at its level. */
export function mixSplash(music: AudioBuffer, splash: AudioBuffer | null, gain = 1, musicGain = 1): AudioBuffer {
  const out = new AudioBuffer({ length: music.length, numberOfChannels: 2, sampleRate: music.sampleRate });
  for (let ch = 0; ch < 2; ch++) {
    const y = out.getChannelData(ch);
    y.set(music.getChannelData(Math.min(ch, music.numberOfChannels - 1)));
    if (musicGain !== 1) for (let i = 0; i < y.length; i++) y[i] = (y[i] as number) * musicGain;
    if (!splash) continue;
    const s = splash.getChannelData(ch);
    const m = Math.min(y.length, s.length);
    for (let i = 0; i < m; i++) y[i] = (y[i] as number) + (s[i] as number) * gain;
  }
  return out;
}
