import type { Onset } from '../audio/analysis';
import { CH, evaluate, type CompiledShow } from './cues';
import type { Layout } from './layout';
import { theme } from '../ui/theme';
import { DEFAULT_SECTIONS } from './sections';

/**
 * Waveform scope for judging sync by eye: the music's waveform and onsets
 * over what the stage does at the same moment, in a window that scrolls past
 * a fixed playhead.
 *
 *   音  waveform (min/max), onset ticks (taller = stronger)
 *   水  mean pressure of the jets, filled in the stage's light colour;
 *       white ticks where geysers fire
 *   光  the stage's light colour and brightness
 *
 * Also draws the whole-show waveform behind the seek bar.
 */

/** Waveform bins per second. */
const PEAK_RATE = 200;
/** Stage summary samples per second. */
const SUM_RATE = 20;
/** Playhead position in the scope window (0..1 from the left). */
const HEAD = 0.3;
const LABEL_W = 30;

interface Peaks {
  min: Float32Array;
  max: Float32Array;
}

interface Summary {
  show: CompiledShow;
  n: number;
  water: Float32Array;
  geyser: Float32Array;
  /** sRGB 0..1, already scaled by brightness */
  rgb: Float32Array;
  /** 1 once a sample is summarised */
  ready: Uint8Array;
  /** next sample of the background sweep */
  done: number;
}

const toSrgb = (c: number) => Math.pow(Math.min(1, Math.max(0, c)), 1 / 2.2);

export class Scope {
  /** Seconds shown in the scope window. */
  span = 8;
  /** Section start times (s), marked as thin lines; the show file's, set by the player. */
  sectionStarts: number[] = DEFAULT_SECTIONS.map((s) => s.t);
  private peaks: Peaks | null = null;
  private duration = 0;
  private onsets: Onset[] = [];
  private sum: Summary | null = null;
  private dragging = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private overview: HTMLCanvasElement,
    private seek: (t: number) => void,
    private now: () => number,
  ) {
    const toTime = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const w = r.width - LABEL_W;
      return this.now() + ((e.clientX - r.left - LABEL_W) / w - HEAD) * this.span;
    };
    let grabT = 0;
    let grabX = 0;
    canvas.onpointerdown = (e) => {
      this.dragging = true;
      grabT = this.now();
      grabX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!this.dragging) return;
      // drag the waveform like a tape under the playhead
      const w = canvas.getBoundingClientRect().width - LABEL_W;
      this.seek(Math.max(0, grabT - ((e.clientX - grabX) / w) * this.span));
    };
    canvas.onpointerup = (e) => {
      // a click without a drag jumps to that point
      if (this.dragging && Math.abs(e.clientX - grabX) < 3) this.seek(Math.max(0, toTime(e)));
      this.dragging = false;
    };
    canvas.onwheel = (e) => {
      e.preventDefault();
      this.span = Math.min(40, Math.max(2, this.span * Math.exp(e.deltaY * 0.002)));
    };
  }

  setAudio(buffer: AudioBuffer, onsets: Onset[]) {
    const sr = buffer.sampleRate;
    const n = Math.ceil(buffer.duration * PEAK_RATE);
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    const chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i));
    const per = sr / PEAK_RATE;
    for (let b = 0; b < n; b++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(buffer.length, Math.floor((b + 1) * per));
      for (let i = Math.floor(b * per); i < end; i++) {
        let v = 0;
        for (const c of chans) v += c[i];
        v /= chans.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
    // scale to the loudest sample so a quiet recording still fills its lane
    let top = 1e-6;
    for (let b = 0; b < n; b++) top = Math.max(top, -min[b], max[b]);
    for (let b = 0; b < n; b++) {
      min[b] /= top;
      max[b] /= top;
    }
    this.peaks = { min, max };
    this.duration = buffer.duration;
    this.onsets = onsets;
  }

  /** Summarise the stage a chunk at a time, so a new show never stalls a frame. */
  private summarise(show: CompiledShow, layout: Layout, from: number, to: number) {
    if (this.sum?.show !== show) {
      const n = Math.ceil(show.file.duration * SUM_RATE) + 1;
      this.sum = { show, n, water: new Float32Array(n), geyser: new Float32Array(n), rgb: new Float32Array(n * 3), ready: new Uint8Array(n), done: 0 };
    }
    const s = this.sum;
    // what is on screen first, then the rest in the background
    const todo: number[] = [];
    for (let k = Math.max(0, Math.floor(from * SUM_RATE)); k <= Math.min(s.n - 1, Math.ceil(to * SUM_RATE)) && todo.length < 160; k++) if (!s.ready[k]) todo.push(k);
    for (; s.done < s.n && todo.length < 160; s.done++) if (!s.ready[s.done]) todo.push(s.done);
    if (!todo.length) return;
    const screens = new Set([...(layout.groups.screen ?? []), ...(layout.groups.mound ?? [])]);
    const geysers = new Set(layout.groups.geyser ?? []);
    const jets = layout.fixtures.map((_, i) => i).filter((i) => !screens.has(i));
    for (const k of todo) {
      s.ready[k] = 1;
      const t = k / SUM_RATE;
      let water = 0;
      let geyser = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      let wet = 0;
      for (const f of jets) {
        const p = evaluate(show, f, CH.pressure, t);
        water += p;
        if (geysers.has(f)) geyser = Math.max(geyser, p);
        if (p < 0.02) continue;
        const i = evaluate(show, f, CH.intensity, t);
        r += evaluate(show, f, CH.r, t) * i;
        g += evaluate(show, f, CH.g, t) * i;
        b += evaluate(show, f, CH.b, t) * i;
        wet++;
      }
      s.water[k] = water / Math.max(1, jets.length);
      s.geyser[k] = geyser;
      const d = Math.max(1, wet);
      s.rgb[k * 3] = toSrgb(r / d);
      s.rgb[k * 3 + 1] = toSrgb(g / d);
      s.rgb[k * 3 + 2] = toSrgb(b / d);
    }
  }

  private fit(c: HTMLCanvasElement): CanvasRenderingContext2D {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /** Waveform under the seek bar, the played part brighter. */
  drawOverview(t: number, total: number) {
    const c = this.overview;
    const ui = theme();
    if (!c.clientWidth) return;
    const ctx = this.fit(c);
    const W = c.clientWidth;
    const H = c.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (!this.peaks) return;
    const { min, max } = this.peaks;
    const mid = H / 2;
    const head = (t / total) * W;
    for (let x = 0; x < W; x++) {
      const b0 = Math.floor(((x / W) * total) * PEAK_RATE);
      const b1 = Math.max(b0 + 1, Math.floor((((x + 1) / W) * total) * PEAK_RATE));
      let lo = 0;
      let hi = 0;
      for (let b = b0; b < Math.min(b1, min.length); b++) {
        if (min[b] < lo) lo = min[b];
        if (max[b] > hi) hi = max[b];
      }
      ctx.fillStyle = x < head ? ui.overviewPast : ui.overview;
      ctx.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
    }
  }

  draw(t: number, show: CompiledShow, layout: Layout) {
    const ui = theme();
    this.summarise(show, layout, t - HEAD * this.span, t + (1 - HEAD) * this.span);
    const c = this.canvas;
    if (!c.clientWidth) return;
    const ctx = this.fit(c);
    const W = c.clientWidth;
    const H = c.clientHeight;
    const pw = W - LABEL_W;
    const t0 = t - HEAD * this.span;
    const pxs = pw / this.span;
    const X = (tt: number) => LABEL_W + (tt - t0) * pxs;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = ui.scopeBg;
    ctx.fillRect(0, 0, W, H);

    const A = { y: 14, h: 62 }; // 音
    const Wt = { y: A.y + A.h + 4, h: 34 }; // 水
    const L = { y: Wt.y + Wt.h + 3, h: 12 }; // 光

    // seconds grid and section starts
    ctx.font = `${ui.fs2xs} ${ui.fontPlayer}`;
    ctx.textBaseline = 'top';
    const step = this.span > 20 ? 5 : this.span > 8 ? 2 : 1;
    for (let s = Math.max(0, Math.ceil(t0 / step) * step); s < t0 + this.span; s += step) {
      const x = X(s);
      ctx.fillStyle = ui.scopeGrid;
      ctx.fillRect(x, A.y, 1, H - A.y);
      ctx.fillStyle = ui.scopeText;
      ctx.fillText(`${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, '0')}`, x + 2, 1);
    }
    for (const st of this.sectionStarts) {
      if (st < t0 || st > t0 + this.span) continue;
      ctx.fillStyle = ui.scopeSection;
      ctx.fillRect(X(st), 0, 1, H);
    }

    // 音: waveform
    if (this.peaks) {
      const { min, max } = this.peaks;
      const mid = A.y + A.h / 2;
      for (let x = LABEL_W; x < W; x++) {
        const ta = t0 + (x - LABEL_W) / pxs;
        const tb = ta + 1 / pxs;
        if (tb < 0 || ta > this.duration) continue;
        const b0 = Math.max(0, Math.floor(ta * PEAK_RATE));
        const b1 = Math.min(min.length, Math.max(b0 + 1, Math.floor(tb * PEAK_RATE)));
        let lo = 0;
        let hi = 0;
        for (let b = b0; b < b1; b++) {
          if (min[b] < lo) lo = min[b];
          if (max[b] > hi) hi = max[b];
        }
        ctx.fillStyle = ta < t ? ui.scopeWavePast : ui.scopeWave;
        ctx.fillRect(x, mid - hi * (A.h / 2), 1, Math.max(1, (hi - lo) * (A.h / 2)));
      }
      // onsets: ticks above the waveform, taller when stronger
      for (const o of this.onsets) {
        if (o.t < t0 || o.t > t0 + this.span) continue;
        const h = 3 + o.strength * 9;
        ctx.fillStyle = `rgba(${ui.scopeOnsetRgb},${0.35 + 0.6 * o.strength})`;
        ctx.fillRect(X(o.t) - 0.5, A.y - 1, 1.5, h);
        if (o.strength > 0.5) ctx.fillRect(X(o.t) - 0.5, A.y, 1, A.h);
      }
    } else {
      ctx.fillStyle = ui.scopeText;
      ctx.fillText('音楽を読み込むと波形が出ます', LABEL_W + 8, A.y + A.h / 2 - 6);
    }

    // 水 and 光 from the stage summary
    const s = this.sum;
    if (s) {
      for (let x = LABEL_W; x < W; x++) {
        const tt = t0 + (x - LABEL_W) / pxs;
        const k = Math.round(tt * SUM_RATE);
        if (k < 0 || k >= s.n || !s.ready[k]) continue;
        const r = Math.round(s.rgb[k * 3] * 255);
        const g = Math.round(s.rgb[k * 3 + 1] * 255);
        const b = Math.round(s.rgb[k * 3 + 2] * 255);
        const col = `rgb(${r},${g},${b})`;
        const h = Math.min(1, s.water[k] * 1.6) * Wt.h;
        ctx.fillStyle = col;
        ctx.fillRect(x, Wt.y + Wt.h - h, 1, h);
        if (s.geyser[k] > 0.3) {
          ctx.fillStyle = ui.scopeGeyser;
          ctx.fillRect(x, Wt.y, 1, 4);
        }
        ctx.fillStyle = col;
        ctx.fillRect(x, L.y, 1, L.h);
      }
    }

    // lane labels and the playhead
    ctx.fillStyle = ui.scopeLabelBg;
    ctx.fillRect(0, 0, LABEL_W, H);
    ctx.fillStyle = ui.scopeLabel;
    ctx.textBaseline = 'middle';
    ctx.fillText('音', 10, A.y + A.h / 2);
    ctx.fillText('水', 10, Wt.y + Wt.h / 2);
    ctx.fillText('光', 10, L.y + L.h / 2);
    ctx.fillStyle = ui.scopePlayhead;
    ctx.fillRect(X(t) - 0.5, 0, 1.5, H);
  }
}
