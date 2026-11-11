/**
 * Waveform analysis of the background music, so the fountains can follow it.
 *
 * From the decoded recording (mono, decimated to 22.05 kHz; 1024-point frames
 * every 256 samples, ~11.6 ms) it measures:
 *   - band envelopes: low (40-250 Hz), mid (250-2 kHz), high (2-8 kHz) and
 *     overall level, in dB, smoothed (fast attack, slower release) and scaled
 *     to 0..1 between the track's 10th and 98th percentiles
 *   - onsets: spectral flux of the log magnitude (positive changes only),
 *     peaks above an adaptive threshold (local mean + half a local standard
 *     deviation over ±0.35 s), at least 80 ms apart; strength 0..1
 *
 * Pure and deterministic: the same file always gives the same show.
 */

export interface Curve {
  /** Samples per second. */
  rate: number;
  values: Float32Array;
}

export interface Onset {
  t: number;
  /** 0..1, relative to the track's strongest onsets. */
  strength: number;
}

export interface MusicFeatures {
  duration: number;
  curves: Record<'low' | 'mid' | 'high' | 'level', Curve>;
  onsets: Onset[];
}

const WIN = 1024;
const HOP = 256;
/** Output rate of the curves (Hz). */
const CURVE_RATE = 20;

/** In-place radix-2 FFT (re, im of length n, n a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] as number, re[i] as number];
      [im[i], im[j]] = [im[j] as number, im[i] as number];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const xr = (re[b] as number) * cr - (im[b] as number) * ci;
        const xi = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - xr;
        im[b] = (im[a] as number) - xi;
        re[a] = (re[a] as number) + xr;
        im[a] = (im[a] as number) + xi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

function percentile(v: Float32Array, p: number): number {
  const s = Float32Array.from(v).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))] as number;
}

export function analyseMusic(buffer: AudioBuffer): MusicFeatures {
  // mono, decimated by two
  const chans = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
  const sr = buffer.sampleRate / 2;
  const n = Math.floor(buffer.length / 2);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const d of chans) s += (d[2 * i] as number) + (d[2 * i + 1] as number);
    x[i] = s / (2 * chans.length);
  }

  const frames = Math.max(0, Math.floor((n - WIN) / HOP) + 1);
  const frameRate = sr / HOP;
  const hann = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const bin = (hz: number) => Math.round((hz / sr) * WIN);
  const bands: [number, number][] = [
    [bin(40), bin(250)],
    [bin(250), bin(2000)],
    [bin(2000), bin(8000)],
  ];
  const top = bin(8000);
  const bandDb = bands.map(() => new Float32Array(frames));
  const levelDb = new Float32Array(frames);
  const flux = new Float32Array(frames);
  const re = new Float32Array(WIN);
  const im = new Float32Array(WIN);
  let prev = new Float32Array(top);
  let cur = new Float32Array(top);
  for (let f = 0; f < frames; f++) {
    const o = f * HOP;
    for (let i = 0; i < WIN; i++) {
      re[i] = (x[o + i] as number) * (hann[i] as number);
      im[i] = 0;
    }
    fft(re, im);
    let total = 0;
    let fl = 0;
    for (let k = 1; k < top; k++) {
      const p = (re[k] as number) ** 2 + (im[k] as number) ** 2;
      total += p;
      const lm = Math.log1p(100 * Math.sqrt(p));
      cur[k] = lm;
      const d = lm - (prev[k] as number);
      if (d > 0) fl += d;
    }
    bands.forEach(([a, b], j) => {
      let e = 0;
      for (let k = a; k < b; k++) e += (re[k] as number) ** 2 + (im[k] as number) ** 2;
      (bandDb[j] as Float32Array)[f] = 10 * Math.log10(e + 1e-9);
    });
    levelDb[f] = 10 * Math.log10(total + 1e-9);
    flux[f] = f === 0 ? 0 : fl;
    [prev, cur] = [cur, prev];
  }

  // envelopes: smoothed, scaled to the track's own range, resampled
  const attack = Math.exp(-1 / (0.03 * frameRate));
  const release = Math.exp(-1 / (0.2 * frameRate));
  const curve = (db: Float32Array): Curve => {
    const sm = new Float32Array(frames);
    let y = db[0] ?? 0;
    for (let f = 0; f < frames; f++) {
      const v = db[f] as number;
      const k = v > y ? attack : release;
      y = k * y + (1 - k) * v;
      sm[f] = y;
    }
    const lo = percentile(sm, 0.1);
    const hi = percentile(sm, 0.98);
    const len = Math.ceil((frames / frameRate) * CURVE_RATE);
    const values = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const f = Math.min(frames - 1, Math.round((i / CURVE_RATE) * frameRate));
      values[i] = Math.min(1, Math.max(0, ((sm[f] as number) - lo) / Math.max(1e-6, hi - lo)));
    }
    return { rate: CURVE_RATE, values };
  };

  // onsets: adaptive threshold over ±0.35 s, local peaks at least 80 ms apart
  const w = Math.round(0.35 * frameRate);
  const gap = Math.round(0.08 * frameRate);
  const peaks: { f: number; v: number }[] = [];
  for (let f = 1; f < frames - 1; f++) {
    const v = flux[f] as number;
    if (v < (flux[f - 1] as number) || v < (flux[f + 1] as number)) continue;
    let s = 0;
    let s2 = 0;
    let c = 0;
    for (let k = Math.max(0, f - w); k < Math.min(frames, f + w); k++) {
      const u = flux[k] as number;
      s += u;
      s2 += u * u;
      c++;
    }
    const mean = s / c;
    const sd = Math.sqrt(Math.max(0, s2 / c - mean * mean));
    const th = mean + 0.5 * sd;
    if (v <= th) continue;
    const last = peaks[peaks.length - 1];
    if (last && f - last.f < gap) {
      if (v - th > last.v) peaks[peaks.length - 1] = { f, v: v - th };
      continue;
    }
    peaks.push({ f, v: v - th });
  }
  const ref = percentile(Float32Array.from(peaks.map((p) => p.v)), 0.95) || 1;
  const onsets = peaks.map((p) => ({
    t: (p.f * HOP + WIN / 2) / sr,
    strength: Math.min(1, p.v / ref),
  }));

  return {
    duration: buffer.duration,
    curves: {
      low: curve(bandDb[0] as Float32Array),
      mid: curve(bandDb[1] as Float32Array),
      high: curve(bandDb[2] as Float32Array),
      level: curve(levelDb),
    },
    onsets,
  };
}

/** Value of a curve at t (linear). */
export function curveAt(c: Curve, t: number): number {
  const x = Math.max(0, t * c.rate);
  const i = Math.floor(x);
  const a = c.values[Math.min(i, c.values.length - 1)] ?? 0;
  const b = c.values[Math.min(i + 1, c.values.length - 1)] ?? a;
  return a + (b - a) * (x - i);
}

/**
 * The beat of a piece, as a hint for the editor's BPM and offset when a
 * project brings its own music (docs/music-plan.md 4). Each onset votes, by
 * its strength, for where it falls in a beat of each candidate tempo; the
 * tempo whose votes line up best wins (the length of the summed phase
 * vector), and their mean phase gives the first beat. A beat twice as fast
 * lines the same onsets up just as well, so ties go to the tempo nearer
 * 120 BPM. Null when nothing lines up (free-time music, too few onsets).
 */
export function estimateTempo(onsets: readonly Onset[], range: [number, number] = [60, 200]): { bpm: number; offset: number; confidence: number } | null {
  const os = onsets.filter((o) => o.strength > 0.05);
  if (os.length < 16) return null;
  const total = os.reduce((a, o) => a + o.strength, 0);
  const score = (bpm: number) => {
    const w = (2 * Math.PI * bpm) / 60;
    let c = 0;
    let s = 0;
    for (const o of os) {
      c += o.strength * Math.cos(w * o.t);
      s += o.strength * Math.sin(w * o.t);
    }
    return { r: Math.hypot(c, s) / total, phase: Math.atan2(s, c) };
  };
  let best = { bpm: 0, r: -1 };
  const consider = (bpm: number) => {
    const { r } = score(bpm);
    // within 2 %, the tempo nearer 120 BPM (not its double or half)
    const better = r > best.r * 1.02 || (r > best.r * 0.98 && Math.abs(Math.log2(bpm / 120)) < Math.abs(Math.log2(best.bpm / 120)));
    if (better) best = { bpm, r };
  };
  for (let bpm = range[0]; bpm <= range[1]; bpm += 0.5) consider(bpm);
  const coarse = best.bpm;
  for (let bpm = coarse - 0.5; bpm <= coarse + 0.5; bpm += 0.02) {
    const { r } = score(bpm);
    if (r > best.r) best = { bpm, r };
  }
  if (best.r < 0.2) return null;
  const bpm = Math.round(best.bpm * 10) / 10;
  const period = 60 / bpm;
  const { phase } = score(bpm);
  // the first beat: on the onsets' mean phase, at the music's first clear onset
  // (not the grid run back to 0 s before the music starts)
  let offset = ((phase / (2 * Math.PI)) * period) % period;
  if (offset < 0) offset += period;
  const start = os.find((o) => o.strength > 0.3)?.t ?? os[0].t;
  while (offset < start - period / 2) offset += period;
  return { bpm, offset: Math.round(offset * 1000) / 1000, confidence: best.r };
}
