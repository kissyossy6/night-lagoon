import type { Burst } from '../pyro/schedule';
import type { Vec3 } from '../venues';
import type { CompiledShow } from '../show/cues';
import type { Layout } from '../show/layout';
import { slice } from '../export/video';
import type { Curve } from './analysis';
import { OUTPUT_CEILING } from './levels';
import { PYRO_CEILING, pyroSounds } from './pyro';
import { SPLASH_GROUPS, renderSplashPlaces } from './splash';

/**
 * Spatial sound for the Vision Pro export (2026-11-12, handoff 追記46b).
 *
 * The stereo mix turns with the head: look right and the stage turns right
 * too. Here every sound is put where it is in the venue, as a sound field
 * around the seat (Ambisonics, 3rd order, ACN channel order, SN3D), which
 * the dev server turns into Apple Positional Audio Codec (APAC) in the movie
 * (tools/apmp/join). The headset renders the field for the way the head
 * points, so the stage stays in front of the seat:
 *   - music: two virtual speakers at the sides of the stage (where the
 *     venue's fixtures spread, seen from the seat), the left and right
 *     channels of the music. Not delayed: the water is set to the music
 *   - fireworks: each shell's sounds (pyro.ts pyroSounds) from where they
 *     happen, the launch from the tube and the burst from the sky, with
 *     their distance's delay and level as in the stereo track
 *   - water: the splash (splash.ts renderSplashPlaces) from its fixtures,
 *     grouped by kind and by direction from the seat
 *
 * Directions (Ambisonics): x to the front (the centre of the 180° picture,
 * vr180.ts's yaw, 0 = toward -z), y to the left, z up; azimuth counter-
 * clockwise from the front. Apple's renderer agrees (tested 2026-11-12: a
 * source at +90° is 8 dB louder in the left ear).
 */

/** Ambisonic order of the export: 16 channels (Apple's APAC encoder takes 1st to 3rd). */
export const AMBI_ORDER = 3;
/** Sample rate of the spatial track. */
export const AMBI_RATE = 48000;
export const ambiChannels = (order: number) => (order + 1) * (order + 1);

/**
 * Levels against the stereo mix, so each sound is about as loud in the
 * headset (Apple's binaural renderer, looking ahead) as in the stereo track:
 * measured with scripts/spatial-check.mjs (花火版 166-176 s from the 客席,
 * 2026-11-12) at 1.0, the music was 2.6 dB louder, the fireworks 2.0 dB
 * quieter, the water 1.4 dB louder.
 */
const TRIM = { music: 0.74, water: 0.85, pyro: 1.26 };
/** Each music speaker at least / at most this far (deg) from the stage's middle. */
const SPEAKER_MIN = 15;
const SPEAKER_MAX = 45;
/** The speakers a little above the eye. */
const SPEAKER_UP = 5;
/** A burst's left and right channels (its wide tail) this far (deg) apart either side of it. */
const PYRO_SPREAD = 12;
/** Water: directions within this many degrees are heard as one place; at most PLACES places. */
const PLACE_DEG = 20;
const PLACES = 12;

/** Which way the head points, from the front of the picture (rad): yaw to the left, pitch up. For checks. */
export interface Head {
  yaw: number;
  pitch: number;
}

export interface SpatialInput {
  /** The music, or null for none. */
  music: AudioBuffer | null;
  musicGain: number;
  /** Where the fixtures are (the music's speakers, the water). */
  layout: Layout;
  /** The water sound, or null when it is off. */
  water: { show: CompiledShow; level?: Curve; duration: number; gain: number } | null;
  /** The fireworks, or null for none. */
  pyro: { bursts: Burst[]; gain: number } | null;
  from: number;
  to: number;
  /** The seat (between the eyes) and the heading of the picture's centre, as vr180.ts takes them. */
  seat: Vec3;
  yaw: number;
  head?: Head;
  order?: number;
}

/** The field for the range, handed out in blocks (interleaved, ACN order) so a whole show never sits in memory at once. */
export interface SpatialAudio {
  order: number;
  channels: number;
  rate: number;
  frames: number;
  block(start: number, n: number): Float32Array<ArrayBuffer>;
}

function factorial(n: number) {
  let f = 1;
  for (let i = 2; i <= n; i++) f *= i;
  return f;
}

/** Associated Legendre function P_l^m(x), without the Condon-Shortley phase (Ambisonics' convention). */
function legendre(l: number, m: number, x: number) {
  let pmm = 1;
  const s = Math.sqrt(Math.max(0, 1 - x * x));
  for (let i = 1; i <= m; i++) pmm *= (2 * i - 1) * s;
  if (l === m) return pmm;
  let pm1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pm1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = (x * (2 * ll - 1) * pm1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pm1;
    pm1 = pll;
  }
  return pll;
}

/** Real spherical harmonics, SN3D, in ACN order, for a direction (az to the left, el up; rad). */
export function harmonics(order: number, az: number, el: number): Float32Array {
  const out = new Float32Array(ambiChannels(order));
  const x = Math.sin(el);
  for (let l = 0; l <= order; l++) {
    for (let m = -l; m <= l; m++) {
      const a = Math.abs(m);
      const n = Math.sqrt(((m === 0 ? 1 : 2) * factorial(l - a)) / factorial(l + a));
      out[l * l + l + m] = n * legendre(l, a, x) * (m >= 0 ? Math.cos(a * az) : Math.sin(a * az));
    }
  }
  return out;
}

/**
 * Where a point is from the seat, in the picture's frame: forward (the
 * centre of the picture), left and up (m).
 */
function local(p: Vec3, seat: Vec3, yaw: number): [number, number, number] {
  const dx = p[0] - seat[0];
  const dy = p[1] - seat[1];
  const dz = p[2] - seat[2];
  const f = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
  const r = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return [f, -r, dy];
}

/** Direction (az, el) of a point in the picture's frame, turned by az0 (rad, to the left), as heard by a head turned by 'head'. */
function directionOf([f0, l0, u]: [number, number, number], head: Head | undefined, az0 = 0): [number, number] {
  let f = f0 * Math.cos(az0) - l0 * Math.sin(az0);
  let l = f0 * Math.sin(az0) + l0 * Math.cos(az0);
  if (head) {
    // the head turns left by yaw, then tips up by pitch: the sound turns the other way
    const f1 = f * Math.cos(head.yaw) + l * Math.sin(head.yaw);
    const l1 = -f * Math.sin(head.yaw) + l * Math.cos(head.yaw);
    const f2 = f1 * Math.cos(head.pitch) + u * Math.sin(head.pitch);
    const u2 = -f1 * Math.sin(head.pitch) + u * Math.cos(head.pitch);
    f = f2;
    l = l1;
    u = u2;
  }
  return [Math.atan2(l, f), Math.atan2(u, Math.hypot(f, l))];
}

const deg = Math.PI / 180;

/** The music's two speakers, as forward/left/up from the seat: at the sides of where the fixtures spread. */
function speakers(layout: Layout, seat: Vec3, yaw: number): [[number, number, number], [number, number, number]] {
  const ahead = layout.fixtures.map((fx) => local(fx.position as Vec3, seat, yaw)).filter(([f]) => f > 0);
  let mid = 0;
  let half = 30 * deg;
  if (ahead.length) {
    const az = ahead.map(([f, l]) => Math.atan2(l, f)).sort((a, b) => a - b);
    // the middle 80 % of the fixtures, to either side (as many left out on each)
    const k = Math.floor(0.1 * az.length);
    const lo = az[k] as number;
    const hi = az[az.length - 1 - k] as number;
    mid = (lo + hi) / 2;
    half = Math.min(SPEAKER_MAX * deg, Math.max(SPEAKER_MIN * deg, (hi - lo) / 2));
  }
  const at = (az: number): [number, number, number] => [Math.cos(az), Math.sin(az), Math.tan(SPEAKER_UP * deg)];
  return [at(mid + half), at(mid - half)];
}

interface Source {
  sig: Float32Array;
  /** Output sample where sig[0] plays (may be before 0). */
  i0: number;
  gain: number;
  coef: Float32Array;
  pyro: boolean;
}

/**
 * Like limit.ts, but only the gain: turned down where |x| would pass the
 * ceiling, falling at most 20 dB per 5 ms ahead of a peak and rising at most
 * 6 dB per 100 ms after it.
 */
function limitGain(x: Float32Array, sampleRate: number, ceiling: number): Float32Array {
  const len = x.length;
  const g = new Float32Array(len);
  for (let i = 0; i < len; i++) g[i] = Math.min(1, ceiling / Math.max(1e-9, Math.abs(x[i] as number)));
  const ahead = Math.pow(10, 20 / 20 / (0.005 * sampleRate));
  const back = Math.pow(10, 6 / 20 / (0.1 * sampleRate));
  for (let i = len - 2; i >= 0; i--) g[i] = Math.min(g[i] as number, (g[i + 1] as number) * ahead);
  for (let i = 1; i < len; i++) g[i] = Math.min(g[i] as number, (g[i - 1] as number) * back);
  return g;
}

/** Add each source's part of [a, b) (output samples) to 'out', scaled by its gain and 'extra'. */
function addMono(sources: Source[], out: Float32Array, a: number, extra?: (s: Source, i: number) => number) {
  for (const s of sources) {
    const from = Math.max(a, s.i0);
    const to = Math.min(a + out.length, s.i0 + s.sig.length);
    for (let i = from; i < to; i++) out[i - a] = (out[i - a] as number) + (s.sig[i - s.i0] as number) * s.gain * (extra ? extra(s, i) : 1);
  }
}

/** The whole field for the range (see the file's comment). */
export async function spatialMix(o: SpatialInput): Promise<SpatialAudio> {
  const order = o.order ?? AMBI_ORDER;
  const nch = ambiChannels(order);
  const sr = AMBI_RATE;
  const frames = Math.max(1, Math.round((o.to - o.from) * sr));
  const start = Math.round(o.from * sr);
  const sources: Source[] = [];
  const place = (p: [number, number, number], az0 = 0) => harmonics(order, ...directionOf(p, o.head, az0));

  if (o.music) {
    const [l, r] = await slice(o.music, o.from, o.to, sr);
    const [sl, sr2] = speakers(o.layout, o.seat, o.yaw);
    const gain = o.musicGain * TRIM.music;
    sources.push({ sig: l as Float32Array, i0: 0, gain, coef: place(sl), pyro: false });
    sources.push({ sig: r as Float32Array, i0: 0, gain, coef: place(sr2), pyro: false });
  }

  if (o.water) {
    // the water's places: kind x direction from the seat, at their fixtures' middle
    const keys = new Map<string, { n: number; p: [number, number, number] }>();
    let step = PLACE_DEG * deg;
    const keyOf = (fx: Layout['fixtures'][number]) => {
      const [f, l] = local(fx.position as Vec3, o.seat, o.yaw);
      return `${fx.group}|${Math.round(Math.atan2(l, f) / step)}`;
    };
    const heard = o.layout.fixtures.filter((fx) => SPLASH_GROUPS.includes(fx.group));
    for (;;) {
      keys.clear();
      for (const fx of heard) {
        const k = keyOf(fx);
        const e = keys.get(k) ?? { n: 0, p: [0, 0, 0] };
        const q = local(fx.position as Vec3, o.seat, o.yaw);
        e.n++;
        e.p = [e.p[0] + q[0], e.p[1] + q[1], e.p[2] + q[2]];
        keys.set(k, e);
      }
      if (keys.size <= PLACES) break;
      step *= 1.5;
    }
    const names = [...keys.keys()];
    if (names.length) {
      // only the range (and half a second before it, for the filters to settle)
      const t0 = Math.max(0, o.from - 0.5);
      const range: [number, number] = [t0, Math.min(o.water.duration, o.to)];
      const buf = renderSplashPlaces(o.water.show, o.layout, o.water.duration, sr, o.water.level, [o.seat[0], o.seat[2]], names.length, (fx) => names.indexOf(keyOf(fx)), range);
      names.forEach((k, ch) => {
        const e = keys.get(k)!;
        const p: [number, number, number] = [e.p[0] / e.n, e.p[1] / e.n, e.p[2] / e.n];
        sources.push({ sig: buf.getChannelData(ch), i0: Math.round(t0 * sr) - start, gain: o.water!.gain * TRIM.water, coef: place(p), pyro: false });
      });
    }
  }

  if (o.pyro) {
    for (const s of pyroSounds(o.pyro.bursts, o.seat, sr)) {
      const i0 = Math.round(s.t * sr) - start;
      const len = s.snd instanceof Float32Array ? s.snd.length : s.snd[0].length;
      if (i0 >= frames || i0 + len <= 0) continue;
      const p = local(s.from, o.seat, o.yaw);
      const gain = s.gain * o.pyro.gain * TRIM.pyro;
      if (s.snd instanceof Float32Array) sources.push({ sig: s.snd, i0, gain, coef: place(p), pyro: true });
      else {
        // the boom's two channels a little apart, around where it happens
        sources.push({ sig: s.snd[0], i0, gain: gain * Math.SQRT1_2, coef: place(p, PYRO_SPREAD * deg), pyro: true });
        sources.push({ sig: s.snd[1], i0, gain: gain * Math.SQRT1_2, coef: place(p, -PYRO_SPREAD * deg), pyro: true });
      }
    }
  }

  // levels as in the stereo mix: the fireworks limited on their own (pyro.ts), then the sum (main.ts).
  // The field's first channel (W) is the sum of all sources, and no other channel is larger for one source
  const pyro = sources.filter((s) => s.pyro);
  let gPyro: Float32Array | null = null;
  if (pyro.length) {
    const w = new Float32Array(frames);
    // the fireworks' own level, before the 音量 menu and the trim, as pyro.ts limits it
    addMono(pyro.map((s) => ({ ...s, gain: s.gain / (o.pyro!.gain * TRIM.pyro) })), w, 0);
    gPyro = limitGain(w, sr, PYRO_CEILING);
  }
  const extra = gPyro ? (s: Source, i: number) => (s.pyro ? (gPyro![i] as number) : 1) : undefined;
  const w = new Float32Array(frames);
  addMono(sources, w, 0, extra);
  const gAll = limitGain(w, sr, OUTPUT_CEILING);

  return {
    order,
    channels: nch,
    rate: sr,
    frames,
    block(a: number, n: number) {
      const out = new Float32Array(n * nch);
      for (const s of sources) {
        const from = Math.max(a, s.i0);
        const to = Math.min(a + n, s.i0 + s.sig.length);
        const c = s.coef;
        for (let i = from; i < to; i++) {
          const v = (s.sig[i - s.i0] as number) * s.gain * (s.pyro && gPyro ? (gPyro[i] as number) : 1) * (gAll[i] as number);
          const k = (i - a) * nch;
          for (let ch = 0; ch < nch; ch++) out[k + ch] = (out[k + ch] as number) + v * (c[ch] as number);
        }
      }
      return out;
    },
  };
}
