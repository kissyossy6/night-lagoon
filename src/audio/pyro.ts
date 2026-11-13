import type { Burst } from '../pyro/schedule';
import { rng } from '../pyro/schedule';
import type { Vec3 } from '../venues';
import BOOM from './pyro-boom.json';
import { limit } from './limit';

/**
 * Fireworks sound (docs/detailed-design.md 3.7), rendered ahead of time from
 * the show's bursts and played under the music, like the water sound
 * (splash.ts).
 *
 * Every sound reaches the seat late by its distance / 343 m/s, so a 10号 on
 * the far shore is seen a second before it is heard.
 *   - launch: "ぽん", a short, dull version of the boom from the tube (the
 *     first, a 70 Hz tone, was too small to hear). The rising whistle
 *     ("ひゅー", a plain tone that sounded like a sound effect) is off
 *   - burst: "ドーン", made from measurements of real fireworks
 *     (2026-11-03, .claude/skills/sound-design): 25 single booms in
 *     recordings from Wikimedia Commons, each band's level every 10 ms
 *     (src/audio/pyro-boom.json). Noise through ten band filters, each
 *     following its measured curve, so every burst is new and none is a
 *     recording. The weight of a real boom is at 90-900 Hz (the first,
 *     hand-made sound put it at 35-60 Hz, which most speakers cannot play).
 *     The tail's echoes wander as measured (lump); the head is the same in
 *     both ears, the tail different in each, so it is wide. Bigger shells
 *     are longer and lower (set by ear: the recordings do not say the size)
 *     and a 千輪's small shells are short pops. PYRO_FEEL brings the far,
 *     slightly muffled recordings nearer: weight, crack, a faster attack and
 *     a room; tilt and pitch make it lower
 *   - crackle: the small shells of a 千輪 pop, and strobe stars fizz
 * Loud on purpose (decided 2026-11-03): nothing is ducked under the music;
 * only the sum is limited (turned down, not clipped) so it never clips.
 */

const C = 343;
/** Overall level of a 5号 burst heard from 300 m (1.0 since the measured boom, 2026-11-03: as loud as the first sound, EBU R128). */
const LEVEL = 1.0;
/** Bigger shells: the curves stretched by (号/5)^STRETCH, and the bands below 160 Hz LOW_DB louder per doubling of 号. Set by ear. */
const STRETCH = 0.35;
const LOW_DB = 3;
/** The loudest the fireworks track may reach. */
const CEILING = 0.9;

/**
 * How the measured boom is played (2026-11-03): the recordings are from far
 * off and a little muffled; these bring it nearer and give it room. All 0 /
 * off is the measured sound. Set by ear.
 */
export interface PyroFeel {
  /** dB on the bands below 160 Hz, fading over ~0.35 s: the body's weight. */
  weight: number;
  /** dB on the bands from 900 Hz up in the first ~30 ms: the crack of a near burst. */
  crack: number;
  /** Seconds to the loudest moment (measured: 0.05). */
  attack: number;
  /** A room under the boom: its level (dB against the boom's head), 0 for none... */
  room: number;
  /** ...and its time to fall 60 dB (s). */
  roomT60: number;
  /** dB per octave above 375 Hz (the middle of the measured weight): below 0 makes the boom lower. */
  tilt: number;
  /** Every band's frequencies times this: below 1 moves the whole boom down. */
  pitch: number;
  /** The launch "ぽん" (a short, dull boom from the tube): level against the burst of its shell. */
  launch: number;
  /** The rising whistle "ひゅー" of shells from 4号 up (a plain tone: off since 2026-11-03). */
  whistle: boolean;
}

export const MEASURED: PyroFeel = { weight: 0, crack: 0, attack: 0.05, room: 0, roomT60: 0, tilt: 0, pitch: 1, launch: 0.3, whistle: false };
/** The user: the launch almost unheard, the boom lower (2026-11-03). */
export const PYRO_FEEL: PyroFeel = { weight: 6, crack: 0, attack: 0.012, room: -20, roomT60: 3.5, tilt: -3, pitch: 1, launch: 0.05, whistle: false };

/**
 * Band-pass (0 dB at the centre) biquad coefficients, RBJ, for one of
 * STAGES run in a row: a single one leaks so much that the loud 160-500 Hz
 * filled the high bands. Each stage is wider, so the row passes lo..hi.
 */
const STAGES = 6;
function bandpass(lo: number, hi: number, sr: number) {
  const f0 = Math.sqrt(lo * hi);
  const q = (f0 / (hi - lo)) * Math.sqrt(Math.pow(2, 1 / STAGES) - 1);
  const w = (2 * Math.PI * Math.min(f0, sr * 0.45)) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
}

function panGains(pan: number): [number, number] {
  const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
  return [Math.cos(a), Math.sin(a)];
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * One sound of the fireworks track as the listener hears it: when it
 * arrives (s, distance delay included), the sound (mono, or a left and a
 * right channel), its level (distance included), its stereo pan, and where it
 * comes from. renderPyro mixes these into stereo; the Vision Pro export
 * places each at its point in space instead (spatial.ts).
 */
export interface PyroSound {
  t: number;
  snd: Float32Array | [Float32Array, Float32Array];
  gain: number;
  pan: number;
  from: Vec3;
}

export function renderPyro(bursts: Burst[], listener: Vec3, duration: number, sampleRate: number, feel: PyroFeel = PYRO_FEEL): AudioBuffer {
  const len = Math.ceil(duration * sampleRate);
  const out = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate });
  const L = out.getChannelData(0);
  const R = out.getChannelData(1);
  const sr = sampleRate;

  /** Mix a mono sound in at time t, scaled and panned. */
  const mix = (t: number, snd: Float32Array, gain: number, pan: number) => {
    const i0 = Math.round(t * sr);
    const [gl, gr] = panGains(pan);
    const a = gain * gl;
    const b = gain * gr;
    const from = Math.max(0, -i0);
    const to = Math.min(snd.length, len - i0);
    for (let i = from; i < to; i++) {
      const v = snd[i];
      L[i0 + i] += v * a;
      R[i0 + i] += v * b;
    }
  };

  /** Mix a stereo sound in at time t, scaled and panned. */
  const mix2 = (t: number, [sl, sr2]: [Float32Array, Float32Array], gain: number, pan: number) => {
    const i0 = Math.round(t * sr);
    const [gl, gr] = panGains(pan);
    // pan by level, keeping each ear's own tail (a sqrt-2 law at the centre)
    const a = gain * gl * Math.SQRT2;
    const b = gain * gr * Math.SQRT2;
    const from = Math.max(0, -i0);
    const to = Math.min(sl.length, len - i0);
    for (let i = from; i < to; i++) {
      L[i0 + i] += sl[i] * a;
      R[i0 + i] += sr2[i] * b;
    }
  };

  for (const s of pyroSounds(bursts, listener, sampleRate, feel)) {
    if (s.snd instanceof Float32Array) mix(s.t, s.snd, s.gain, s.pan);
    else mix2(s.t, s.snd, s.gain, s.pan);
  }

  // loud, but never clipping: turned down, not bent (src/audio/limit.ts)
  limit([L, R], sr, CEILING);
  return out;
}

/** The loudest the fireworks track may reach (renderPyro's limit). */
export const PYRO_CEILING = CEILING;

/**
 * Every sound of the fireworks, in the order renderPyro mixes them, heard
 * from 'listener' (the launch and burst of each shell, a strobe's fizz).
 */
export function pyroSounds(bursts: Burst[], listener: Vec3, sampleRate: number, feel: PyroFeel = PYRO_FEEL): PyroSound[] {
  const sr = sampleRate;
  const sounds: PyroSound[] = [];
  const mix = (t: number, snd: Float32Array, gain: number, pan: number, from: Vec3) => sounds.push({ t, snd, gain, pan, from });

  // each sound is made once per size (and kept): the shells of a run differ
  // only in level, place and time, as real shells of one size sound alike
  const cache = new Map<string, Float32Array>();
  const sound = (key: string, dur: number, gen: (s: number) => number) => {
    let snd = cache.get(key);
    if (!snd) {
      snd = new Float32Array(Math.round(dur * sr));
      for (let i = 0; i < snd.length; i++) snd[i] = gen(i / sr);
      cache.set(key, snd);
    }
    return snd;
  };

  /**
   * "ドーン" for a size, as a left and a right channel (pyro-boom.json):
   * ten bands of noise, each shaped by its measured curve, then the feel's
   * weight, crack, attack and room. A 千輪's small shell is the same, short
   * and without the lows; the launch is short and dull, without the room.
   */
  const booms = new Map<string, [Float32Array, Float32Array]>();
  const boom = (size: number, kind: 'burst' | 'child' | 'launch'): [Float32Array, Float32Array] => {
    const key = `${size}${kind}`;
    const had = booms.get(key);
    if (had) return had;
    const child = kind === 'child';
    const launch = kind === 'launch';
    const stretch = child ? 0.3 : launch ? 0.35 * Math.pow(size / 5, 0.3) : Math.pow(size / 5, STRETCH);
    const frames = BOOM.env_db[0].length;
    const room = !child && !launch && feel.room < 0 && feel.roomT60 > 0;
    const nBoom = Math.round(frames * BOOM.frame_s * stretch * sr);
    const n = room ? Math.max(nBoom, Math.round(feel.roomT60 * Math.sqrt(stretch) * sr)) : nBoom;
    const nz = [rng(13), rng(14), rng(15)];
    const lumps = rng(17);
    const bands = BOOM.bands.map(([lo, hi], k) => {
      // white noise of power 1 through the band has power ~ (pi/2)(hi - lo) / (sr/2): bring each band
      // back to about 1 (the rest is in trim_db, from comparing with the recordings)
      const norm = Math.sqrt(3 * (sr / 2) / ((Math.PI / 2) * (hi - lo) * feel.pitch));
      // tilt only above the middle of the weight: the lows are weight's
      const octaves = Math.log2(Math.sqrt(lo * hi) / 375);
      const tilt = octaves > 0 ? feel.tilt * octaves : 0;
      const low = hi <= 160 ? (child ? -12 : launch ? 4 : LOW_DB * Math.log2(size / 5)) : 0;
      // the launch is a thud from inside the tube: little of the crack
      const dull = launch && lo >= 900 ? -14 : 0;
      const gain = norm * Math.pow(10, (BOOM.trim_db[k] + low + dull + tilt) / 20);
      const weight = hi <= 160 && !child ? feel.weight : 0;
      const crack = lo >= 900 && !launch ? feel.crack : 0;
      return { f: bandpass(lo * feel.pitch, hi * feel.pitch, sr), env: BOOM.env_db[k], gain, weight, crack, zl: new Float64Array(4 * STAGES), zr: new Float64Array(4 * STAGES) };
    });
    // the measured rise (to MEASURED.attack) squeezed into the feel's
    const top = MEASURED.attack * stretch;
    const rise = Math.min(top, feel.attack * stretch);
    const envTime = (s: number) => (s < rise ? (s * top) / rise : s + top - rise);
    const L = new Float32Array(n);
    const R = new Float32Array(n);
    const { db: lumpDb, period_s: lumpT, from_s: lumpFrom } = BOOM.lump;
    let la = 0;
    let lb = 0;
    let lt0 = 0;
    let lt1 = 0;
    let peak = 0;
    for (let i = 0; i < nBoom; i++) {
      const s = i / sr;
      const te = envTime(s);
      // the tail's lumps: a level that wanders to a new random value every ~period
      if (s >= lt1) {
        la = lb;
        lb = (lumps() * 2 - 1) * lumpDb * 1.7;
        lt0 = s;
        lt1 = s + lumpT * (0.6 + lumps() * 0.8) * stretch;
      }
      const u = (s - lt0) / (lt1 - lt0);
      const w = Math.min(1, Math.max(0, (s - lumpFrom * stretch) / 0.1));
      const lump = Math.pow(10, (w * (la + (lb - la) * (0.5 - 0.5 * Math.cos(Math.PI * u)))) / 20);
      // the same noise at the head (one place), its own in each ear in the tail (wide)
      const c = s < 0.06 ? 1 : Math.max(0.3, 1 - ((s - 0.06) / 0.25) * 0.7);
      const own = Math.sqrt(1 - c * c);
      const common = nz[0]() * 2 - 1;
      const xl = c * common + own * (nz[1]() * 2 - 1);
      const xr = c * common + own * (nz[2]() * 2 - 1);
      const fpos = te / (BOOM.frame_s * stretch);
      const f0 = Math.min(frames - 1, Math.floor(fpos));
      const f1 = Math.min(frames - 1, f0 + 1);
      const ff = fpos - f0;
      let yl = 0;
      let yr = 0;
      for (const b of bands) {
        let db = b.env[f0] + (b.env[f1] - b.env[f0]) * ff;
        if (b.weight) db += b.weight * Math.exp(-te / (0.35 * stretch));
        if (b.crack) db += b.crack * Math.exp(-te / (0.03 * stretch));
        const a = b.gain * Math.pow(10, db / 20);
        const { b0, b2, a1, a2 } = b.f;
        // direct form I, the stages in a row, one row per ear: z = [x1, x2, y1, y2] per stage
        let ol = xl;
        let or = xr;
        for (let st = 0; st < STAGES; st++) {
          const z = b.zl;
          const j = st * 4;
          const y = b0 * ol + b2 * z[j + 1] - a1 * z[j + 2] - a2 * z[j + 3];
          z[j + 1] = z[j];
          z[j] = ol;
          z[j + 3] = z[j + 2];
          z[j + 2] = y;
          ol = y;
          const w = b.zr;
          const yr2 = b0 * or + b2 * w[j + 1] - a1 * w[j + 2] - a2 * w[j + 3];
          w[j + 1] = w[j];
          w[j] = or;
          w[j + 3] = w[j + 2];
          w[j + 2] = yr2;
          or = yr2;
        }
        yl += ol * a;
        yr += or * a;
      }
      // the measurements end at 2.5 s, still -40 dB: fade the last 0.4 s, or the stop is heard
      const end = Math.min(1, (nBoom - i) / (0.4 * stretch * sr));
      L[i] = yl * lump * end;
      R[i] = yr * lump * end;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    let head = 0;
    const headN = Math.min(nBoom, Math.round(0.1 * stretch * sr));
    for (let i = 0; i < n; i++) {
      L[i] /= peak;
      R[i] /= peak;
      if (i < headN) head += L[i] * L[i] + R[i] * R[i];
    }
    if (room) {
      // the lagoon and the shore answering: dull noise, its own in each
      // ear, swelling over 80 ms and falling 60 dB over roomT60
      const level = Math.sqrt(head / (2 * headN)) * Math.pow(10, feel.room / 20) * 3.5;
      const t60 = feel.roomT60 * Math.sqrt(stretch);
      const kl = 1 - Math.exp((-2 * Math.PI * 700 * feel.pitch) / sr);
      const kh = 1 - Math.exp((-2 * Math.PI * 60) / sr);
      const rl = rng(19);
      const rr = rng(23);
      let al = 0;
      let ar = 0;
      let hl = 0;
      let hr = 0;
      for (let i = 0; i < n; i++) {
        const s = i / sr;
        al += (rl() * 2 - 1 - al) * kl;
        ar += (rr() * 2 - 1 - ar) * kl;
        hl += (al - hl) * kh;
        hr += (ar - hr) * kh;
        const env = level * (1 - Math.exp(-s / 0.08)) * Math.exp((-6.9 * s) / t60) * Math.min(1, (n - i) / (0.1 * sr));
        L[i] += (al - hl) * env;
        R[i] += (ar - hr) * env;
      }
    }
    const pair: [Float32Array, Float32Array] = [L, R];
    booms.set(key, pair);
    return pair;
  };

  const mix2 = (t: number, snd: [Float32Array, Float32Array], gain: number, pan: number, from: Vec3) => sounds.push({ t, snd, gain, pan, from });

  const grain = sound('grain', 0.012, (() => {
    const g = rng(31);
    return (s: number) => (g() * 2 - 1) * Math.exp(-s / 0.003);
  })());

  const panOf = (p: Vec3) => (p[0] - listener[0]) / Math.max(30, Math.abs(p[2] - listener[2]));
  const size2 = (x: number) => Math.round(x * 2) / 2;

  for (const b of bursts) {
    const r = rng(b.seed + 101);
    const child = b.parent !== undefined;
    const size = size2(b.size);
    if (!child) {
      // launch: a short, dull boom from the tube
      const d0 = dist(listener, b.origin);
      const lift = LEVEL * feel.launch * Math.pow(b.size / 5, 0.7) * (300 / Math.max(60, d0));
      if (lift > 0) mix2(b.tLaunch + d0 / C, boom(size, 'launch'), lift, panOf(b.origin), b.origin);
      // the whistle of a climbing shell (comets and shells from 4号 up)
      if (feel.whistle && (b.shell === 'comet' || (b.size >= 4 && b.shell !== 'mine'))) {
        const rise = b.tBurst - b.tLaunch;
        const mid: Vec3 = [(b.origin[0] + b.center[0]) / 2, (b.origin[1] + b.center[1]) / 2, (b.origin[2] + b.center[2]) / 2];
        const dm = dist(listener, mid);
        const fA = 700 + Math.round(r() * 3) * 100;
        const dur = Math.round(rise * 8) / 10;
        let ph = 0;
        const snd = sound(`hyu${fA}_${dur}`, dur, (s) => {
          const u = s / dur;
          ph += (2 * Math.PI * (fA + 900 * u)) / sr;
          return Math.min(1, s / 0.15) * (1 - u) * (1 - u * 0.5) * Math.sin(ph + 0.4 * Math.sin(ph * 0.013));
        });
        mix(b.tLaunch + 0.15 + dm / C, snd, LEVEL * 0.05 * (300 / Math.max(60, dm)), panOf(mid), mid);
      }
    }
    if (b.shell === 'comet') continue;

    // burst
    const d1 = dist(listener, b.center);
    const tb = b.tBurst + d1 / C;
    const pan = panOf(b.center);
    const amp = LEVEL * (child ? 0.12 : Math.pow(b.size / 5, 0.7)) * (300 / Math.max(80, d1));
    // the echoes are in the measured tail
    mix2(tb, boom(size, child ? 'child' : 'burst'), amp, pan, b.center);
    // strobe stars fizz as they blink: tiny noise grains through the burn
    if (b.shell === 'strobe') {
      const grains = Math.round(b.burn * 120);
      for (let k = 0; k < grains; k++) mix(tb + 0.25 + r() * (b.burn - 0.25), grain, amp * 0.08 * (0.5 + r()), pan + (r() - 0.5) * 0.4, b.center);
    }
  }

  return sounds;
}
