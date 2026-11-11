import { BPM, FINALE_STEPS, MUSIC, RHAPSODY_AT, SECTIONS, SHOW_DURATION, STORY_BEATS as SB, barToSeconds, finaleColor } from '../show/song';
import { RhapsodyPicture } from './rhapsody';
import type { VideoFit } from '../show/types';

/**
 * Original, procedurally drawn projection content for the water screen.
 *
 * One continuous story told in light, drawn with Canvas 2D only (no images):
 *   intro      night sky, faint stars, a slow aurora ribbon
 *   awakening  light streams flow in one by one, motes hop on the beat
 *   theme      bold colour fields and waves sweeping the panorama
 *   story      a paper boat with a lantern crosses a night sea toward a
 *              rising moon; fireflies join it, floating lanterns light up and
 *              rise, and the boat's lantern flies up into the moon
 *   build      the moon bursts into accelerating radial rays, energy gathers
 *   finale     rainbow wash, beat-synced bursts and a rainbow arc
 *   coda       a calm sunrise from the last hit (174 s), climbing again with
 *              the ending's last climb; the mound lets it go before the final chord
 *
 * Past the show's end (RHAPSODY_AT, reached through a clip) lives the Fantasia
 * version's opening: a white line on blue drawing the city, and its
 * interlude: three lit windows on the mounds (rhapsody.ts).
 *
 * render(t) is a pure function of t (no state carried between frames).
 * The screen is ~7.7:1 while the canvas is narrower, so round shapes are drawn
 * squeezed in x by K so they read round on the mist.
 */

type RGB = [number, number, number];

/** Physical aspect of the mist screen (116 m x 15 m). */
export const SCREEN_ASPECT = 116 / 15;

const C = {
  cyan: [0, 180, 255] as RGB,
  blue: [30, 60, 255] as RGB,
  green: [60, 255, 90] as RGB,
  purple: [192, 60, 255] as RGB,
  red: [255, 48, 0] as RGB,
  orange: [255, 122, 0] as RGB,
  yellow: [255, 214, 40] as RGB,
  warm: [255, 214, 160] as RGB,
  cream: [255, 244, 222] as RGB,
  white: [255, 255, 255] as RGB,
  firefly: [190, 255, 120] as RGB,
};
const RAINBOW: RGB[] = [C.red, C.orange, C.yellow, C.green, C.cyan, C.blue, C.purple];

const TAU = Math.PI * 2;
const BEAT = 60 / BPM;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const sstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
/** Rise over a..b, hold, fall over c..d. */
const env = (x: number, a: number, b: number, c: number, d: number) => sstep(a, b, x) * (1 - sstep(c, d, x));
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3;
const easeInOut = (u: number) => {
  u = clamp01(u);
  return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
};
const fract = (x: number) => x - Math.floor(x);
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i + seed * 57.31), hash(i + 1 + seed * 57.31), u);
}
const mix = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const rgba = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const hexRGB = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function rainbow(h: number): RGB {
  const x = fract(h) * RAINBOW.length;
  const i = Math.floor(x);
  return mix(RAINBOW[i], RAINBOW[(i + 1) % RAINBOW.length], sstep(0, 1, x - i));
}

function sectionSpan(name: string, fa: number, fb: number): [number, number] {
  const s = SECTIONS.find((x) => x.name === name);
  return s ? [barToSeconds(s.from), barToSeconds(s.to)] : [fa, fb];
}
const AWAKE = sectionSpan('awakening', 16, 48);
const THEME = sectionSpan('theme', 48, 80);
const STORY = sectionSpan('story', 80, 112);
const BUILD = sectionSpan('build', 112, 128);
const FINALE = sectionSpan('finale', 128, 160);
/**
 * The finale's light ends with the edit's hit (176.6); the sun rises in the
 * calm after it and is up when the chorus comes in (178.5).
 */
const LAST_HIT = MUSIC.last;
const END_DARK = SHOW_DURATION - 2;

// Sky gradient keyframes: [t, top, horizon, bottom].
const SKY: [number, RGB, RGB, RGB][] = [
  [0, [0, 0, 0], [0, 0, 0], [0, 0, 0]],
  [3, [0, 0, 4], [1, 2, 8], [2, 3, 12]],
  [12, [2, 4, 18], [4, 8, 30], [8, 14, 44]],
  [24, [3, 4, 24], [8, 10, 44], [14, 22, 70]],
  [AWAKE[1] - 2, [6, 4, 30], [10, 10, 50], [18, 16, 70]],
  [THEME[0] + 2, [10, 4, 40], [14, 8, 60], [26, 10, 80]],
  [THEME[1] - 2, [10, 4, 40], [14, 8, 60], [26, 10, 80]],
  // the story's sky stays dark: on mist a black ground lets the picture float
  [STORY[0] + 3, [1, 2, 12], [7, 12, 36], [10, 16, 46]],
  [STORY[0] + 26, [4, 6, 22], [18, 22, 56], [22, 24, 60]],
  [BUILD[0] + 1, [4, 2, 20], [10, 6, 40], [24, 10, 60]],
  [BUILD[1] - 1, [12, 6, 40], [24, 12, 70], [40, 20, 90]],
  [FINALE[0] + 2, [14, 0, 44], [30, 4, 60], [50, 8, 70]],
  [FINALE[1] - 2, [14, 0, 44], [30, 4, 60], [50, 8, 70]],
  [LAST_HIT + 2.5, [24, 10, 70], [120, 40, 90], [255, 110, 40]],
  [MUSIC.fade, [24, 10, 70], [120, 40, 90], [255, 110, 40]],
  [END_DARK, [0, 0, 0], [0, 0, 0], [0, 0, 0]],
];

// Story geometry (fractions of W / H).
const MOON_X = 0.76;
const HORIZON = 0.64;

export class ProjectionContent {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly W: number;
  private readonly H: number;
  /** x squeeze so circles drawn in canvas px look round on the screen. */
  private readonly K: number;
  /** 2x reduction chain for averageColor (bilinear at exactly 2x = box filter). */
  private readonly chain: { c: HTMLCanvasElement; g: CanvasRenderingContext2D }[] = [];
  /**
   * CPU-side canvas that receives the last (tiny) level and is read back. Only
   * this canvas is ever read, so Chrome's readback heuristics never demote the
   * big canvas from the GPU.
   */
  private readonly reader: CanvasRenderingContext2D;
  private avg: [number, number, number] = [0, 0, 0];
  private avgDirty = true;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly rhapsody: RhapsodyPicture;

  constructor(width = 2048, height = 384) {
    this.W = width;
    this.H = height;
    this.K = width / height / SCREEN_ASPECT;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.g = this.canvas.getContext('2d', { alpha: false })!;
    let cw = width;
    let ch = height;
    while (cw > 64 || ch > 16) {
      cw = Math.max(1, Math.round(cw / 2));
      ch = Math.max(1, Math.round(ch / 2));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const cg = c.getContext('2d')!;
      cg.imageSmoothingEnabled = true;
      cg.imageSmoothingQuality = 'low';
      cg.globalCompositeOperation = 'copy';
      this.chain.push({ c, g: cg });
    }
    const rc = document.createElement('canvas');
    rc.width = cw;
    rc.height = ch;
    this.reader = rc.getContext('2d', { willReadFrequently: true })!;
    this.reader.globalCompositeOperation = 'copy';
    this.rhapsody = new RhapsodyPicture(this.g, width, height);
    this.render(0);
  }

  /** 0..1 how much the screen should show imagery at time t. */
  level(t: number): number {
    return sstep(0.5, 6, t) * (1 - sstep(END_DARK - 8, END_DARK + 0.5, t));
  }

  averageColor(): [number, number, number] {
    if (this.avgDirty) {
      let src: HTMLCanvasElement = this.canvas;
      for (const { c, g } of this.chain) {
        g.drawImage(src, 0, 0, c.width, c.height);
        src = c;
      }
      const rc = this.reader.canvas;
      this.reader.drawImage(src, 0, 0);
      const d = this.reader.getImageData(0, 0, rc.width, rc.height).data;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += SRGB_TO_LIN[d[i]];
        g += SRGB_TO_LIN[d[i + 1]];
        b += SRGB_TO_LIN[d[i + 2]];
      }
      const n = d.length / 4;
      this.avg = [r / n, g / n, b / n];
      this.avgDirty = false;
    }
    return [this.avg[0], this.avg[1], this.avg[2]];
  }

  /**
   * Draw an image (a video frame) instead of the drawn scenes, fitted to the
   * screen's physical shape; null draws black. sw x sh is its pixel size.
   */
  image(src: CanvasImageSource | null, sw: number, sh: number, fit: VideoFit): void {
    const { g, W, H } = this;
    this.avgDirty = true;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (!src || !sw || !sh) return;
    // the canvas spans the screen's 116 m x 15 m whatever its pixel aspect
    const narrower = sw / sh < SCREEN_ASPECT;
    if (fit === 'stretch') {
      g.drawImage(src, 0, 0, W, H);
    } else if (fit === 'cover') {
      // full width, the middle band of the picture
      if (narrower) g.drawImage(src, 0, (sh - sw / SCREEN_ASPECT) / 2, sw, sw / SCREEN_ASPECT, 0, 0, W, H);
      else g.drawImage(src, (sw - sh * SCREEN_ASPECT) / 2, 0, sh * SCREEN_ASPECT, sh, 0, 0, W, H);
    } else {
      // the whole picture, black at the sides
      const f = narrower ? sw / sh / SCREEN_ASPECT : SCREEN_ASPECT / (sw / sh);
      if (narrower) g.drawImage(src, (W * (1 - f)) / 2, 0, W * f, H);
      else g.drawImage(src, 0, (H * (1 - f)) / 2, W, H * f);
    }
  }

  /**
   * The picture at picture time t. `only`: one scene on its own (a clip
   * played alone, show/types.ts Clip.alone); the night sky stays under it.
   */
  render(t: number, only?: string): void {
    const on = (...names: string[]) => !only || names.includes(only);
    const g = this.g;
    this.avgDirty = true;
    if (t >= RHAPSODY_AT) {
      this.rhapsody.render(t - RHAPSODY_AT);
      return;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    this.sky(t);

    g.globalCompositeOperation = 'lighter';
    const stars = env(t, 1.5, 7, AWAKE[0] + 2, AWAKE[0] + 10) * 0.9 + env(t, STORY[0] - 1, STORY[0] + 4, STORY[1] - 4, STORY[1] + 2);
    if (stars > 0.001 && on('intro', 'story')) this.stars(t, stars);
    const aurora = env(t, 5, 13, AWAKE[0] + 6, AWAKE[0] + 16);
    if (aurora > 0.001 && on('intro')) this.aurora(t, aurora);
    const awake = env(t, AWAKE[0] - 1, AWAKE[0] + 1, AWAKE[1], AWAKE[1] + 3);
    if (awake > 0.001 && on('awakening')) this.awakening(t, awake);
    const theme = env(t, THEME[0] - 1, THEME[0] + 1, THEME[1] - 1, THEME[1] + 2);
    if (theme > 0.001 && on('theme')) this.theme(t, theme);
    // the arches stand first, the mist rises, the picture arrives ~2 s later
    const story = env(t, STORY[0] + 1.5, STORY[0] + 4, STORY[1], STORY[1] + 3);
    if (story > 0.001 && on('story')) this.story(t, story);
    const build = env(t, BUILD[0] - 1.5, BUILD[0] + 0.5, BUILD[1] - 0.05, BUILD[1] + 0.6);
    if (build > 0.001 && on('build')) this.build(t, build);
    // the bursts stop on the last hit, when the sun starts to rise behind the
    // white columns; the light goes on until the pilot lights (docs/show-plan.md)
    const fin = env(t, FINALE[0] - 0.2, FINALE[0], LAST_HIT, LAST_HIT + 1);
    if (fin > 0.001 && on('finale')) this.finale(t, fin);
    const coda = env(t, LAST_HIT, LAST_HIT + 2.5, 1e9, 1e9);
    if (coda > 0.001 && on('coda')) this.coda(t, coda);

    // master fade in from black / out to black
    const m = sstep(0.3, 4, t) * (1 - sstep(MUSIC.fade, END_DARK + 1.5, t));
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (m < 0.999) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.fillStyle = rgba([0, 0, 0], 1 - m);
      g.fillRect(0, 0, this.W, this.H);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  /**
   * The projector's zones: darken the picture where a zone is dimmer than
   * the brightest one (`mask`: brightness shares, evenly spaced left to right).
   */
  dim(mask: number[]): void {
    const g = this.g;
    const gr = g.createLinearGradient(0, 0, this.W, 0);
    mask.forEach((v, i) => gr.addColorStop(i / (mask.length - 1), rgba([0, 0, 0], 1 - v)));
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.fillStyle = gr;
    g.fillRect(0, 0, this.W, this.H);
  }

  // ------------------------------------------------------------------ helpers

  private sprite(c0: RGB, core = 0.6): HTMLCanvasElement {
    // quantise so continuously varying colours reuse a bounded set of sprites
    const c: RGB = [Math.round(c0[0] / 17) * 17, Math.round(c0[1] / 17) * 17, Math.round(c0[2] / 17) * 17];
    const key = `${c[0]},${c[1]},${c[2]}|${core}`;
    let s = this.sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      s.width = s.height = 64;
      const x = s.getContext('2d')!;
      const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, rgba(mix(c, C.white, core), 1));
      gr.addColorStop(0.1, rgba(mix(c, C.white, core * 0.5), 0.9));
      gr.addColorStop(0.3, rgba(c, 0.38));
      gr.addColorStop(0.6, rgba(c, 0.1));
      gr.addColorStop(1, rgba(c, 0));
      x.fillStyle = gr;
      x.fillRect(0, 0, 64, 64);
      this.sprites.set(key, s);
    }
    return s;
  }

  /** Round (on screen) soft glow of radius r (canvas y px). */
  private glow(x: number, y: number, r: number, c: RGB, a: number, core = 0.6, stretch = 1) {
    if (a <= 0.003 || r <= 0.2) return;
    const g = this.g;
    g.globalAlpha = a > 1 ? 1 : a;
    const rx = r * this.K * stretch;
    g.drawImage(this.sprite(c, core), x - rx, y - r, 2 * rx, 2 * r);
  }

  private sky(t: number) {
    let i = 0;
    while (i < SKY.length - 2 && t > SKY[i + 1][0]) i++;
    const [t0, a0, b0, c0] = SKY[i];
    const [t1, a1, b1, c1] = SKY[i + 1];
    const u = sstep(t0, t1, t);
    const gr = this.g.createLinearGradient(0, 0, 0, this.H);
    gr.addColorStop(0, rgba(mix(a0, a1, u)));
    gr.addColorStop(HORIZON, rgba(mix(b0, b1, u)));
    gr.addColorStop(1, rgba(mix(c0, c1, u)));
    this.g.fillStyle = gr;
    this.g.fillRect(0, 0, this.W, this.H);
  }

  // ---------------------------------------------------------------- intro

  private stars(t: number, a: number) {
    const g = this.g;
    const { W, H } = this;
    g.fillStyle = 'rgb(210,230,255)';
    // small stars are batched into a few brightness buckets (one fill each)
    const buckets: number[][] = [[], [], [], []];
    for (let i = 0; i < 240; i++) {
      const x = fract(hash(i * 1.13) + t * 0.0015 * (0.5 + hash(i * 2.9))) * W;
      const y = Math.pow(hash(i * 3.71), 1.3) * H * 0.62;
      const tw = 0.55 + 0.45 * Math.sin(t * (0.8 + 2.2 * hash(i * 5.3)) + i);
      const b = (0.25 + 0.75 * hash(i * 7.7) ** 2) * tw * a * clamp01((t - 1 - hash(i * 9.1) * 4) / 2);
      if (b < 0.02) continue;
      const s = 1.2 + 2.2 * hash(i * 4.4);
      if (i % 9 === 0) {
        this.glow(x, y, 7 + s * 2, i % 2 ? C.cyan : C.warm, b * 0.8, 0.9);
      } else {
        buckets[Math.min(3, Math.floor(b * 4))].push(x, y, s);
      }
    }
    for (let k = 0; k < 4; k++) {
      const list = buckets[k];
      if (!list.length) continue;
      g.globalAlpha = (k + 0.6) / 4;
      g.beginPath();
      for (let j = 0; j < list.length; j += 3) g.rect(list[j], list[j + 1], list[j + 2], list[j + 2]);
      g.fill();
    }
  }

  private aurora(t: number, a: number) {
    const g = this.g;
    const { W, H } = this;
    const step = 32;
    const ribbons: [RGB, RGB, number, number][] = [
      [C.green, C.cyan, 0, 1],
      [C.purple, C.blue, 3.3, 0.6],
    ];
    for (const [c1, c2, seed, k] of ribbons) {
      const ya: number[] = [];
      const hb: number[] = [];
      for (let x = -step; x <= W + step; x += step) {
        const u = x / W;
        ya.push(
          H * (0.3 + 0.08 * seed * 0.05 + 0.11 * Math.sin(u * TAU * 1.2 + t * 0.12 + seed) + 0.05 * Math.sin(u * TAU * 3.1 - t * 0.2 + seed * 2)),
        );
        hb.push(H * (0.1 + 0.22 * vnoise(u * 9 + t * 0.15, seed + 1) * (0.6 + 0.4 * Math.sin(u * 7 - t * 0.3))));
      }
      // curtain: polygon from ribbon edge downward, fading
      const gr = g.createLinearGradient(0, H * 0.12, 0, H * 0.72);
      gr.addColorStop(0, rgba(c2, 0));
      gr.addColorStop(0.25, rgba(c1, 0.55 * k));
      gr.addColorStop(0.55, rgba(mix(c1, c2, 0.5), 0.22 * k));
      gr.addColorStop(1, rgba(c2, 0));
      g.globalAlpha = a;
      g.fillStyle = gr;
      g.beginPath();
      let n = 0;
      for (let x = -step; x <= W + step; x += step, n++) g.lineTo(x, ya[n] - H * 0.04);
      for (let x = W + step, m = n - 1; x >= -step; x -= step, m--) g.lineTo(x, ya[m] + hb[m]);
      g.closePath();
      g.fill();
      // bright ribbon edge
      g.strokeStyle = rgba(mix(c1, C.white, 0.25), 1);
      g.lineJoin = 'round';
      for (const [w, al] of [
        [26, 0.07],
        [9, 0.2],
        [2.5, 0.55],
      ]) {
        g.lineWidth = w;
        g.globalAlpha = a * al * k * (0.8 + 0.2 * Math.sin(t * 0.7 + seed));
        g.beginPath();
        n = 0;
        for (let x = -step; x <= W + step; x += step, n++) g.lineTo(x, ya[n]);
        g.stroke();
      }
      // vertical rays hanging from the ribbon
      g.lineWidth = 3;
      g.strokeStyle = gr;
      g.beginPath();
      for (let i = 0; i < 70; i++) {
        const u = fract(hash(i * 3.3 + seed) + t * 0.004 * (hash(i) - 0.5));
        const j = Math.min(ya.length - 1, Math.max(0, Math.round((u * W + step) / step)));
        const x = u * W;
        g.moveTo(x, ya[j]);
        g.lineTo(x, ya[j] + hb[j] * (0.6 + 0.6 * hash(i * 7.1)));
      }
      g.globalAlpha = a * 0.6;
      g.stroke();
    }
  }

  // ------------------------------------------------------------- awakening

  private awakening(t: number, a: number) {
    const g = this.g;
    const { W, H } = this;
    const beats = t / BEAT;
    const drums = sstep(MUSIC.orchestra - 0.5, MUSIC.orchestra, t);
    const pulse = Math.exp(-fract(beats) * 5) * drums;
    const streams: { c: RGB; y: number; amp: number; f: number; w: number; t0: number; ph: number }[] = [
      { c: C.cyan, y: 0.42, amp: 0.13, f: 1.6, w: 0.5, t0: AWAKE[0], ph: 0 },
      { c: C.blue, y: 0.58, amp: 0.1, f: 2.3, w: -0.4, t0: AWAKE[0] + 4, ph: 1.7 },
      { c: C.green, y: 0.33, amp: 0.09, f: 2.9, w: 0.65, t0: AWAKE[0] + 8, ph: 3.1 },
      { c: C.purple, y: 0.66, amp: 0.12, f: 1.2, w: -0.55, t0: AWAKE[0] + 12, ph: 4.4 },
      { c: C.cyan, y: 0.5, amp: 0.16, f: 3.6, w: 0.8, t0: AWAKE[0] + 16, ph: 5.9 },
    ];
    const step = 24;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const s of streams) {
      const age = t - s.t0;
      if (age <= 0) continue;
      const head = lerp(-0.05, 1.08, easeOut(age / 6)) * W;
      const fadeIn = clamp01(age / 1.5);
      const bright = a * fadeIn * (0.7 + 0.45 * pulse);
      const yAt = (x: number) => {
        const u = x / W;
        return (
          H *
          (s.y +
            s.amp * Math.sin(u * TAU * s.f - t * s.w * 1.4 + s.ph) +
            0.035 * Math.sin(u * TAU * s.f * 2.7 + t * 0.9 + s.ph * 2))
        );
      };
      const passes: [number, number, RGB][] = [
        [34 + 10 * pulse, 0.07, s.c],
        [12, 0.2, s.c],
        [3.2, 0.85, mix(s.c, C.white, 0.55)],
      ];
      for (const [w, al, c] of passes) {
        g.strokeStyle = rgba(c);
        g.lineWidth = w;
        g.globalAlpha = Math.min(1, bright * al);
        g.beginPath();
        for (let x = -step; x < head; x += step) g.lineTo(x, yAt(x));
        g.lineTo(head, yAt(head));
        g.stroke();
      }
      if (head < W * 1.05) this.glow(head, yAt(head), 42, s.c, bright, 0.9);
      // sparkles travelling along the stream
      for (let k = 0; k < 7; k++) {
        const x = fract(hash(k * 7.7 + s.ph) + t * 0.05 * Math.sign(s.w)) * W;
        if (x > head) continue;
        this.glow(x, yAt(x), 12 + 8 * pulse, s.c, bright * 0.8, 0.9);
      }
    }
    // motes drifting upward, hopping on each beat
    const hop = (Math.floor(beats) + easeOut(fract(beats) * 2.5)) * (2 + 4 * drums);
    const motesA = a * env(t, AWAKE[0] + 2, AWAKE[0] + 8, 1e9, 1e9);
    if (motesA > 0.01) {
      for (let i = 0; i < 110; i++) {
        const vx = (hash(i * 1.7) - 0.5) * 30;
        const x = fract(hash(i * 2.3) + (t * vx) / W) * W;
        const yr = fract(hash(i * 4.1) - (hop * (0.6 + 0.8 * hash(i * 6.6)) + t * 6) / H);
        const y = yr * H + Math.sin(t * 0.7 + i) * 8;
        const edge = Math.sin(Math.PI * yr);
        const c = [C.cyan, C.blue, C.green, C.purple, C.white][i % 5];
        const r = (6 + 10 * hash(i * 8.8)) * (1 + 0.5 * pulse);
        this.glow(x, y, r, c, motesA * edge * (0.35 + 0.5 * hash(i * 3.9)) * (0.7 + 0.5 * pulse), 0.8);
      }
    }
  }

  // ----------------------------------------------------------------- theme

  private theme(t: number, a: number) {
    const g = this.g;
    const { W, H } = this;
    const s = t - THEME[0];
    const beats = t / BEAT;
    const bf = fract(beats);
    const pulse = Math.exp(-bf * 5);
    const schemes: RGB[][] = [
      [C.blue, C.cyan, C.purple],
      [C.green, C.cyan, C.blue],
      [C.purple, C.blue, C.red],
      [C.orange, C.red, C.purple],
    ];
    const phrase = s / 8;
    const pi = Math.max(0, Math.min(3, Math.floor(phrase)));
    const pn = Math.min(3, pi + 1);
    const pu = sstep(0.88, 1, phrase - pi);
    const sch = (k: number) => mix(schemes[pi][k % 3], schemes[pn][k % 3], pi === pn ? 0 : pu);

    // colour fields drifting across
    const nF = 5;
    for (let k = 0; k < nF; k++) {
      const dir = k % 2 ? -1 : 1;
      const u = fract(k / nF + dir * s * 0.025 + 0.13 * Math.sin(s * 0.2 + k));
      const cx = lerp(-0.2, 1.2, u) * W;
      const hw = W * (0.17 + 0.05 * Math.sin(k * 2.1 + s * 0.3));
      const gr = g.createLinearGradient(cx - hw, 0, cx + hw, 0);
      const c = sch(k);
      gr.addColorStop(0, rgba(c, 0));
      gr.addColorStop(0.5, rgba(c, 1));
      gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr;
      g.globalAlpha = a * (0.42 + 0.2 * pulse);
      g.fillRect(cx - hw, 0, hw * 2, H);
    }

    // stacked waves
    const step = 32;
    g.lineJoin = 'round';
    for (let j = 0; j < 3; j++) {
      const base = H * (0.5 + 0.12 * j);
      const amp = H * (0.07 + 0.02 * j) * (1 + 0.35 * pulse);
      const f = 2.2 + j * 1.3;
      const sp = (j % 2 ? -1 : 1) * (0.9 + 0.4 * j);
      const yAt = (x: number) =>
        base + amp * Math.sin((x / W) * TAU * f - s * sp + j) + amp * 0.35 * Math.sin((x / W) * TAU * f * 2.3 + s * 1.3);
      const c = sch(j + 1);
      const gr = g.createLinearGradient(0, base - amp, 0, H);
      gr.addColorStop(0, rgba(c, 0.7));
      gr.addColorStop(1, rgba(c, 0.05));
      g.fillStyle = gr;
      g.globalAlpha = a * 0.75;
      g.beginPath();
      g.moveTo(-step, H);
      for (let x = -step; x <= W + step; x += step) g.lineTo(x, yAt(x));
      g.lineTo(W + step, H);
      g.closePath();
      g.fill();
      for (const [w, al, cc] of [
        [16, 0.18, c],
        [3, 0.9, mix(c, C.white, 0.6)],
      ] as [number, number, RGB][]) {
        g.strokeStyle = rgba(cc);
        g.lineWidth = w;
        g.globalAlpha = a * al * (0.6 + 0.4 * pulse);
        g.beginPath();
        for (let x = -step; x <= W + step; x += step) g.lineTo(x, yAt(x));
        g.stroke();
      }
    }

    // one bright sweep per bar, alternating direction
    const bar = Math.floor(t / 2);
    const bu = fract(t / 2);
    const sx = lerp(-0.12, 1.12, easeInOut(bu)) * W;
    const x = bar % 2 ? W - sx : sx;
    const hw = W * 0.07;
    const gr = g.createLinearGradient(x - hw, 0, x + hw, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.globalAlpha = a * 0.32 * Math.sin(Math.PI * bu);
    g.fillRect(x - hw, 0, hw * 2, H);

    // light pillars that flash on each beat
    const b = Math.floor(beats);
    for (let k = 0; k < 4; k++) {
      const px = (0.06 + 0.88 * hash(b * 4.7 + k * 1.3)) * W;
      const pw = W * 0.012;
      const c = sch(k);
      const pg = g.createLinearGradient(px - pw, 0, px + pw, 0);
      pg.addColorStop(0, rgba(c, 0));
      pg.addColorStop(0.5, rgba(mix(c, C.white, 0.5), 1));
      pg.addColorStop(1, rgba(c, 0));
      g.fillStyle = pg;
      g.globalAlpha = a * 0.7 * pulse;
      g.fillRect(px - pw, 0, pw * 2, H);
    }
  }

  // ----------------------------------------------------------------- story

  private moonY(t: number) {
    return this.H * lerp(0.86, 0.32, easeOut((t - STORY[0] - 1) / 20));
  }

  private boatPos(t: number): [number, number, number] {
    const { W, H } = this;
    // out from behind the left arch, across to just left of the centre; the
    // screen's edges ripple, so the boat never sits on them
    const x = lerp(0.16, 0.52, easeInOut((t - SB.boatIn) / 19)) * W;
    const y = H * 0.88 + Math.sin(t * 1.6) * H * 0.012;
    const tilt = Math.sin(t * 1.6 - 0.9) * 0.07;
    return [x, y, tilt];
  }

  private story(t: number, a: number) {
    const g = this.g;
    const { W, H, K } = this;
    const yH = H * HORIZON;
    const mx = MOON_X * W;
    const my = this.moonY(t);
    const R = H * 0.25;
    const moonUp = clamp01((yH - my) / (R * 2));
    const flare = env(t, SB.flare - 0.3, SB.flare + 0.6, 1e9, 1e9);

    // moon halo and disc (sea drawn afterwards hides the part below the horizon)
    g.globalCompositeOperation = 'lighter';
    this.glow(mx, my, H * 1.1, C.blue, a * (0.35 + 0.3 * moonUp), 0.2, 1.6);
    this.glow(mx, my, H * 0.62, C.warm, a * (0.45 + 0.35 * moonUp + 0.5 * flare), 0.5);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
    const mg = g.createRadialGradient(mx - R * K * 0.2, my - R * 0.25, R * 0.1, mx, my, R);
    mg.addColorStop(0, rgba(C.cream));
    mg.addColorStop(0.75, rgba(mix(C.cream, C.warm, 0.6)));
    mg.addColorStop(1, rgba(mix(C.warm, C.orange, 0.25)));
    g.fillStyle = mg;
    g.beginPath();
    g.ellipse(mx, my, R * K, R, 0, 0, TAU);
    g.fill();
    // soft "seas" on the moon so it is not a flat disc
    g.globalAlpha = a * 0.16;
    g.fillStyle = rgba([200, 160, 140]);
    g.beginPath();
    g.ellipse(mx + R * K * 0.25, my - R * 0.15, R * K * 0.28, R * 0.24, 0, 0, TAU);
    g.ellipse(mx - R * K * 0.3, my + R * 0.3, R * K * 0.2, R * 0.16, 0, 0, TAU);
    g.fill();

    // the sea
    g.globalAlpha = a;
    const sg = g.createLinearGradient(0, yH, 0, H);
    sg.addColorStop(0, rgba([10, 22, 60]));
    sg.addColorStop(0.4, rgba([4, 10, 32]));
    sg.addColorStop(1, rgba([1, 3, 12]));
    g.fillStyle = sg;
    g.fillRect(0, yH, W, H - yH);

    g.globalCompositeOperation = 'lighter';
    // horizon line glow
    const hg = g.createLinearGradient(0, yH - 6, 0, yH + 6);
    hg.addColorStop(0, 'rgba(120,160,255,0)');
    hg.addColorStop(0.5, 'rgba(140,180,255,1)');
    hg.addColorStop(1, 'rgba(120,160,255,0)');
    g.fillStyle = hg;
    g.globalAlpha = a * (0.25 + 0.35 * moonUp);
    g.fillRect(0, yH - 6, W, 12);

    // moon glitter path on the water
    g.fillStyle = rgba(C.warm);
    for (let j = 0; j < 30; j++) {
      const v = (j + 0.5) / 30;
      const y = yH + 3 + (H - yH - 3) * Math.pow(v, 1.5);
      const spread = (14 + 150 * v) * K * (0.5 + 0.5 * moonUp);
      for (let k = 0; k < 3; k++) {
        const ox = Math.sin(t * (0.9 + 0.5 * k) + j * 1.7 + k * 2.1) * spread;
        const w = (10 + 70 * v) * K * (0.4 + 0.6 * hash(j * 3.1 + k + Math.floor(t * 2.5)));
        g.globalAlpha = a * moonUp * (0.25 + 0.55 * vnoise(t * 3 + j * 1.3 + k * 9, 3)) * (1 - 0.4 * v);
        g.fillRect(mx + ox - w / 2, y, w, 4 + 6 * v);
      }
    }

    // wave contours
    g.lineJoin = 'round';
    for (let j = 0; j < 3; j++) {
      const base = yH + (H - yH) * (0.18 + 0.3 * j);
      const amp = 2 + 4 * j;
      g.strokeStyle = rgba(mix(C.cyan, C.blue, j * 0.4));
      for (const [w, al] of [
        [16, 0.08],
        [7, 0.3],
      ]) {
        g.lineWidth = w;
        g.globalAlpha = a * al * (1 - j * 0.15);
        g.beginPath();
        for (let x = 0; x <= W; x += 32) {
          g.lineTo(x, base + amp * Math.sin(x * (0.012 - 0.003 * j) + t * (0.8 + 0.3 * j) + j * 2));
        }
        g.stroke();
      }
    }

    // floating lanterns: light up on the water one by one, then rise to the moon
    const [bx, by, tilt] = this.boatPos(t);
    for (let i = 0; i < 40; i++) {
      const tl = SB.lanternsLit + i * 0.12;
      if (t < tl) continue;
      const depth = 0.15 + 0.8 * hash(i * 5.7);
      let x = (0.04 + 0.92 * hash(i * 2.9)) * W;
      let y = yH + (H - yH) * depth + Math.sin(t * 1.3 + i) * 2;
      const tr = SB.lanternsRise + 3 * hash(i * 8.3);
      const sz = 9 + 16 * depth;
      if (t > tr) {
        const r = t - tr;
        y -= 18 * r ** 1.5;
        x += (mx - x) * 0.12 * clamp01(r / 6) + Math.sin(r * 1.5 + i) * 8;
      }
      if (y < -40) continue;
      const lit = clamp01((t - tl) / 1.2) * (0.85 + 0.15 * Math.sin(t * 7 + i * 3));
      this.glow(x, y, sz * 3.2, C.orange, a * lit * 0.8, 0.5);
      this.glow(x, y, sz, C.yellow, a * lit, 0.9);
      if (t < tr + 1) {
        // reflection on the water
        g.fillStyle = rgba(C.orange);
        g.globalAlpha = a * lit * 0.3 * (1 - clamp01(t - tr));
        g.fillRect(x - sz * K * 0.5, y + sz * 0.8, sz * K, sz * 2.5);
      }
    }

    // wake behind the boat
    const boatA = a * sstep(SB.boatIn - 1.5, SB.boatIn + 0.5, t);
    g.strokeStyle = rgba(mix(C.cyan, C.white, 0.4));
    g.lineWidth = 7;
    const u = H * 0.55;
    for (let k = 0; k < 3; k++) {
      const len = (0.6 + 0.5 * k) * u * 3.2 * K;
      g.globalAlpha = boatA * 0.35 * (1 - k * 0.25);
      g.beginPath();
      g.moveTo(bx - u * K * 0.7, by + 2 + k * 4);
      g.quadraticCurveTo(bx - u * K * 0.7 - len * 0.5, by + 6 + k * 7, bx - u * K * 0.7 - len, by + 4 + k * 10);
      g.stroke();
    }

    if (boatA > 0.001) this.boat(t, boatA, bx, by, tilt, u);

    // fireflies gather around the boat
    for (let i = 0; i < 26; i++) {
      const ts = SB.fireflies + i * 0.25;
      if (t < ts) continue;
      const age = t - ts;
      const sx0 = (0.04 + 0.92 * hash(i * 3.3)) * W;
      const sy0 = (0.08 + 0.4 * hash(i * 4.9)) * H;
      const ang = i * 2.39996 + t * (0.5 + 0.3 * hash(i)) * (i % 2 ? 1 : -1);
      const rr = u * (0.7 + 0.5 * hash(i * 6.1));
      const tx = bx + Math.cos(ang) * rr * K * 1.8;
      const ty = by - u * 0.75 + Math.sin(ang) * rr * 0.55;
      const e = easeInOut(age / 5);
      let x = lerp(sx0, tx, e) + Math.sin(t * 2.1 + i) * 10 * (1 - e * 0.6);
      let y = lerp(sy0, ty, e) + Math.cos(t * 1.7 + i * 2) * 8 * (1 - e * 0.6);
      const rise = Math.max(0, t - (SB.fly - 1));
      y -= 14 * rise ** 1.6;
      x += (mx - x) * 0.1 * clamp01(rise / 6);
      const blink = 0.45 + 0.55 * Math.sin(t * (2 + hash(i * 9.2)) + i) ** 2;
      const b = a * clamp01(age) * blink;
      this.glow(x, y, 26, C.firefly, b * 0.75, 0.5);
      this.glow(x, y, 8, C.white, b, 1);
    }

    // the boat's lantern flies up into the moon at the end
    const fly = clamp01((t - SB.fly) / (SB.flare - SB.fly));
    if (fly > 0) {
      const [lx, ly] = this.lanternPos(bx, by, tilt, u);
      const e = easeInOut(fly);
      const x = lerp(lx, mx, e);
      const y = lerp(ly, my, e) - Math.sin(Math.PI * e) * H * 0.25;
      this.glow(x, y, 60, C.orange, a * 0.9 * (1 - e * 0.5), 0.6);
      this.glow(x, y, 16, C.cream, a, 1);
    }
    // the moon answers with a flare
    if (flare > 0) this.glow(mx, my, H * 0.5, C.cream, a * flare * 0.8, 1);
    g.globalCompositeOperation = 'lighter';
  }

  private lanternPos(bx: number, by: number, tilt: number, u: number): [number, number] {
    const lx = 0.62 * u;
    const ly = -0.47 * u;
    const c = Math.cos(tilt);
    const sn = Math.sin(tilt);
    return [bx + (lx * c - ly * sn) * this.K, by + lx * sn + ly * c];
  }

  /** Origami paper boat lit by its own lantern. u = boat height in px. */
  private boat(t: number, a: number, bx: number, by: number, tilt: number, u: number) {
    const g = this.g;
    const K = this.K;
    const lanternOn = 1 - clamp01((t - SB.fly) / 0.4);
    const flick = 0.85 + 0.15 * vnoise(t * 6, 9);
    const [lx, ly] = this.lanternPos(bx, by, tilt, u);

    // lantern glow on the water and around the boat (behind the hull)
    g.globalCompositeOperation = 'lighter';
    this.glow(lx, ly, u * 1.6, C.orange, a * 0.55 * flick * lanternOn, 0.3);
    // broken reflection of the lantern below the hull
    g.fillStyle = rgba(C.orange);
    for (let j = 0; j < 7; j++) {
      const v = j / 6;
      const w = u * K * (0.28 - 0.18 * v) * (0.6 + 0.4 * vnoise(t * 3 + j * 2.3, 5));
      const ox = Math.sin(t * 1.9 + j * 1.3) * u * K * 0.06;
      g.globalAlpha = a * 0.5 * (1 - v * 0.8) * flick * lanternOn;
      g.fillRect(lx + ox - w / 2, by + 6 + j * u * 0.06, w, 2.5);
    }

    g.save();
    g.translate(bx, by);
    g.scale(K, 1);
    g.rotate(tilt);
    const hull = () => {
      g.beginPath();
      g.moveTo(-1.15 * u, -0.36 * u);
      g.lineTo(1.15 * u, -0.36 * u);
      g.lineTo(0.72 * u, 0.04 * u);
      g.lineTo(-0.72 * u, 0.04 * u);
      g.closePath();
    };
    const sailL = () => {
      g.beginPath();
      g.moveTo(-0.62 * u, -0.36 * u);
      g.lineTo(0, -1.08 * u);
      g.lineTo(0, -0.36 * u);
      g.closePath();
    };
    const sailR = () => {
      g.beginPath();
      g.moveTo(0.62 * u, -0.36 * u);
      g.lineTo(0, -1.08 * u);
      g.lineTo(0, -0.36 * u);
      g.closePath();
    };
    // solid paper body (occludes what is behind it)
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a;
    const lit = 0.55 + 0.45 * flick * lanternOn;
    const hg = g.createLinearGradient(0, -0.36 * u, 0, 0.04 * u);
    hg.addColorStop(0, rgba(mix([60, 40, 50], [255, 196, 140], lit)));
    hg.addColorStop(1, rgba(mix([20, 16, 30], [150, 80, 50], lit)));
    g.fillStyle = hg;
    hull();
    g.fill();
    const lg = g.createLinearGradient(-0.6 * u, 0, 0, 0);
    lg.addColorStop(0, rgba(mix([40, 40, 70], [150, 140, 170], lit)));
    lg.addColorStop(1, rgba(mix([70, 60, 90], [235, 220, 230], lit)));
    g.fillStyle = lg;
    sailL();
    g.fill();
    const rg = g.createLinearGradient(0, 0, 0.6 * u, 0);
    rg.addColorStop(0, rgba(mix([80, 60, 60], [255, 236, 200], lit)));
    rg.addColorStop(1, rgba(mix([60, 40, 40], [255, 200, 140], lit)));
    g.fillStyle = rg;
    sailR();
    g.fill();
    // glowing paper edges
    g.globalCompositeOperation = 'lighter';
    g.lineJoin = 'round';
    g.strokeStyle = rgba(C.cream);
    for (const [w, al] of [
      [0.09, 0.15],
      [0.025, 0.85],
    ]) {
      g.lineWidth = w * u;
      g.globalAlpha = a * al;
      hull();
      g.stroke();
      sailL();
      g.stroke();
      sailR();
      g.stroke();
    }
    // lantern body
    if (lanternOn > 0) {
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = a * lanternOn;
      g.fillStyle = rgba([255, 190, 90]);
      g.beginPath();
      g.ellipse(0.62 * u, -0.47 * u, 0.075 * u, 0.1 * u, 0, 0, TAU);
      g.fill();
      g.fillStyle = rgba([60, 30, 20]);
      g.fillRect(0.56 * u, -0.6 * u, 0.12 * u, 0.03 * u);
      g.fillRect(0.56 * u, -0.37 * u, 0.12 * u, 0.025 * u);
    }
    g.restore();
    g.globalCompositeOperation = 'lighter';
    this.glow(lx, ly, u * 0.42, C.yellow, a * flick * lanternOn, 0.9);
  }

  // ----------------------------------------------------------------- build

  private build(t: number, a: number) {
    const g = this.g;
    const { W, H, K } = this;
    const s = Math.max(0, t - BUILD[0]);
    const beats = t / BEAT;
    const sub = s < 8 ? 1 : s < 12 ? 2 : 4;
    const pulse = Math.exp(-fract(beats * sub) * 6);
    const e = easeInOut(s / 6);
    const cx = lerp(MOON_X * W, 0.5 * W, e);
    const cy = lerp(this.moonY(BUILD[0]), 0.45 * H, e);
    const grow = s / 16;

    // rotating rays (drawn in a K-squeezed frame so they are radially even on screen)
    const theta = 0.12 * s + 0.0045 * s ** 3;
    const L = (W / K) * 0.75;
    g.save();
    g.setTransform(K, 0, 0, 1, cx, cy);
    const groups: RGB[] = [C.cyan, C.purple, C.blue];
    const nRays = 36;
    for (let gi = 0; gi < groups.length; gi++) {
      const rg = g.createRadialGradient(0, 0, 0, 0, 0, L);
      const c = groups[gi];
      rg.addColorStop(0, rgba(mix(c, C.white, 0.6), 1));
      rg.addColorStop(0.15, rgba(c, 0.6));
      rg.addColorStop(1, rgba(c, 0));
      g.fillStyle = rg;
      g.globalAlpha = a * (0.35 + 0.45 * grow) * (0.75 + 0.25 * pulse);
      g.beginPath();
      for (let k = gi; k < nRays; k += groups.length) {
        const vis = clamp01(6 + s * 2.2 - k);
        if (vis <= 0) continue;
        const dir = k % 2 ? 1 : -0.6;
        const ang = (k / nRays) * TAU + theta * dir;
        const hw = (0.025 + 0.02 * hash(k)) * vis;
        g.moveTo(0, 0);
        g.lineTo(Math.cos(ang - hw) * L, Math.sin(ang - hw) * L);
        g.lineTo(Math.cos(ang + hw) * L, Math.sin(ang + hw) * L);
        g.closePath();
      }
      g.fill();
    }

    // energy streaks rushing into the centre, faster and faster
    const R0 = L * 0.7;
    g.lineCap = 'round';
    for (let gi = 0; gi < 3; gi++) {
      g.strokeStyle = rgba(mix([C.white, C.cyan, C.purple][gi], C.white, 0.3));
      g.lineWidth = 2 + gi;
      g.globalAlpha = a * (0.4 + 0.5 * grow);
      g.beginPath();
      for (let i = gi; i < 150; i += 3) {
        const ang = hash(i * 1.9) * TAU;
        const cyc = s * (0.18 + 0.12 * hash(i * 2.7)) + 0.012 * s * s + hash(i * 4.3);
        const r = R0 * (1 - fract(cyc)) ** 1.5 + 10;
        const len = 20 + s * 9 + r * 0.15;
        const ca = Math.cos(ang);
        const sa = Math.sin(ang);
        g.moveTo(ca * r, sa * r * 0.85);
        g.lineTo(ca * (r + len), sa * (r + len) * 0.85);
      }
      g.stroke();
    }
    g.restore();

    // gathering core
    const cr = H * (0.08 + 0.22 * grow) * (1 + 0.25 * pulse);
    this.glow(cx, cy, cr * 3, C.blue, a * (0.5 + 0.3 * pulse), 0.3);
    this.glow(cx, cy, cr * 1.6, C.cyan, a * (0.6 + 0.4 * pulse), 0.7);
    this.glow(cx, cy, cr * 0.7, C.white, a, 1);
    // ring shock on each pulse
    g.strokeStyle = rgba(mix(C.cyan, C.white, 0.5));
    g.lineWidth = 3;
    g.globalAlpha = a * pulse * 0.6;
    g.beginPath();
    const rr = cr * (1 + 2.5 * (1 - pulse));
    g.ellipse(cx, cy, rr * K, rr, 0, 0, TAU);
    g.stroke();
    // no white-out into the finale: the light goes out on the silence and the
    // show's one full white is the last hit (docs/show-plan.md)
  }

  // ---------------------------------------------------------------- finale

  private finale(t: number, a: number) {
    const { W, H, K } = this;
    const beats = t / BEAT;

    // Bursts of light on black, in the one colour the whole stage has at that
    // moment (FINALE_STEPS): the mounds change colour with the fountains.
    // No wash, no flash: a full-screen colour washes the mist out, and the
    // show's many colours come one at a time, not as a rainbow at once.
    // From the first colour step the mounds fill with that one colour (a
    // single-colour fill is the one full-screen picture mist carries well),
    // a little brighter on each change, so they read behind the fountains.
    const step0 = FINALE_STEPS[0].t;
    if (t >= step0 - 0.1) {
      const g = this.g;
      const last = FINALE_STEPS.filter((x) => t >= x.t).pop()?.t ?? step0;
      const kick = Math.exp(-(t - last) * 2.5);
      const op = g.globalCompositeOperation;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = rgba(hexRGB(finaleColor(t)));
      g.globalAlpha = a * sstep(step0 - 0.1, step0 + 0.2, t) * (0.45 + 0.35 * kick);
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = op;
    }

    // a burst on every beat, bigger on each downbeat
    const b0 = Math.floor(beats);
    for (let b = b0 - 4; b <= b0; b++) {
      const bt = b * BEAT;
      if (bt < FINALE[0] - 0.01 || bt > FINALE[1] + 1) continue;
      const age = t - bt;
      const life = 2.3;
      if (age < 0 || age > life) continue;
      const big = b % 4 === 0;
      const x = (0.08 + 0.84 * hash(b * 1.71)) * W;
      const y = (0.2 + 0.32 * hash(b * 3.13)) * H;
      const R = H * (big ? 0.55 : 0.36);
      const fade = (1 - age / life) ** 2;
      const col = hexRGB(finaleColor(bt));
      const n = big ? 28 : 18;
      const r = R * (1 - Math.exp(-age * 3.2));
      const fall = 16 * age * age;
      if (age < 0.4) this.glow(x, y, R * 0.6, mix(col, C.white, big ? 0.6 : 0.3), a * (1 - age / 0.4), 0.8);
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * TAU + hash(b + k * 0.37) * 0.2;
        const c = mix(col, C.white, big && k % 2 ? 0.45 : 0.1);
        const ca = Math.cos(ang) * K * 1.25;
        const sa = Math.sin(ang);
        const sz = (big ? 18 : 13) * (1 - age / (life * 1.3)) + 4;
        this.glow(x + ca * r, y + sa * r + fall, sz * 2, c, a * Math.min(1, fade * 1.4), 0.75);
        this.glow(x + ca * r * 0.75, y + sa * r * 0.75 + fall * 0.7, sz * 1.2, c, a * fade * 0.7, 0.5);
      }
    }
  }

  // ------------------------------------------------------------------ coda

  private coda(t: number, a: number) {
    const g = this.g;
    const { W, H, K } = this;
    // the sun rises in the calm after the edit's hit and is up by the chorus
    // (178.5); it climbs again with the ending's last climb (193-204)
    const s = t - LAST_HIT;
    const cx = 0.5 * W;
    const cy = H * (lerp(1.3, 0.85, easeOut(s / 2.2)) - 0.2 * sstep(MUSIC.home, MUSIC.steps[2], t));
    const R = H * 0.3;
    // the geyser gate sends one soft ring outward
    const hit = t >= MUSIC.gate ? Math.exp(-(t - MUSIC.gate) * 0.8) : 0;
    const swell = 0.75 + 0.25 * sstep(LAST_HIT, LAST_HIT + 3, t) + 0.35 * hit;

    // warm horizon band across the whole panorama
    const hg = g.createLinearGradient(0, H * 0.35, 0, H);
    hg.addColorStop(0, rgba(C.orange, 0));
    hg.addColorStop(0.7, rgba(C.orange, 0.35));
    hg.addColorStop(1, rgba(C.yellow, 0.6));
    g.fillStyle = hg;
    g.globalAlpha = a * swell;
    g.fillRect(0, 0, W, H);

    // gentle rays
    g.save();
    g.setTransform(K, 0, 0, 1, cx, cy);
    const L = (W / K) * 0.6;
    const rg = g.createRadialGradient(0, 0, R * 0.8, 0, 0, L);
    rg.addColorStop(0, rgba(C.yellow, 0.5));
    rg.addColorStop(1, rgba(C.orange, 0));
    g.fillStyle = rg;
    g.globalAlpha = a * 0.5 * swell;
    g.beginPath();
    for (let k = 0; k < 16; k++) {
      const ang = Math.PI + (k + 0.5) / 16 * Math.PI + Math.sin(t * 0.1) * 0.05;
      const hw = 0.035;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(ang - hw) * L, Math.sin(ang - hw) * L);
      g.lineTo(Math.cos(ang + hw) * L, Math.sin(ang + hw) * L);
      g.closePath();
    }
    g.fill();
    g.restore();

    // sun: wide halo, core, disc
    this.glow(cx, cy, H * 1.3, C.red, a * 0.45 * swell, 0.2, 2.5);
    this.glow(cx, cy, H * 0.75, C.orange, a * 0.6 * swell, 0.5, 1.4);
    g.globalAlpha = a;
    const dg = g.createRadialGradient(cx, cy - R * 0.2, R * 0.1, cx, cy, R);
    dg.addColorStop(0, rgba([255, 246, 210]));
    dg.addColorStop(0.7, rgba([255, 200, 110]));
    dg.addColorStop(1, rgba([255, 150, 50]));
    g.fillStyle = dg;
    g.beginPath();
    g.ellipse(cx, cy, R * K, R, 0, 0, TAU);
    g.fill();

    if (hit > 0.01) {
      const rr = R * (1.1 + (t - MUSIC.gate) * 0.9);
      g.strokeStyle = rgba(C.warm);
      g.lineWidth = 6;
      g.globalAlpha = a * hit * 0.6;
      g.beginPath();
      g.ellipse(cx, cy, rr * K * 1.4, rr, 0, 0, TAU);
      g.stroke();
    }
  }
}

const SRGB_TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
