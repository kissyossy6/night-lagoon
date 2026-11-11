import { JAZZ, JAZZ_AT, RHAPSODY as R, RHAPSODY_AT } from '../show/song';

/**
 * The Fantasia version's opening picture, 0-47 s of its own time: one white
 * line on blue draws a 1930s skyline with the clarinet, then the city wakes.
 * An homage to the look of Fantasia 2000's Rhapsody in Blue (a continuous
 * caricature line on a cobalt ground), drawn from memory: no frames, no
 * characters of the film. The people here are generic.
 *
 *   0-1.5      the blue ground comes up with the mist
 *   1.5-5      the pen enters from the left and climbs with the glissando,
 *              topping the tallest spire on its top note
 *   5-7.2      down the right side to the bridge; its cable last
 *   6-16       night: stars, windows light one by one under the theme
 *   16-24      dawn: the sun rises between the towers (flares at 19.04),
 *              the night windows go out, the ground turns cobalt
 *   20-34      morning traffic: a yellow taxi, then a bus the other way
 *   25.5-38    a girder swings in on a cable; a riveter on it strikes sparks
 *              on the solo's strong notes (26.28, 32.12, 35.05)
 *   36-44      jazz: the windows answer in a wave, notes float up
 *   44-46.5    it all lets go, the line last
 *
 * Its interlude picture (JAZZ, from JAZZ_AT - RHAPSODY_AT) is for the three
 * mounds: one lit window of the evening city on each, the people inside as
 * dark lines on warm yellow - a pianist (left, 78), a trumpeter (right,
 * 80.5) and a dancing couple (centre, 82.5, who spin on the swell at 83).
 * They go out right, left, centre into the dark before the second tutti.
 *
 * Drawn in screen metres (the 116 x 15 m sheet), so shapes keep their
 * proportions on the mist whatever the canvas size. Big shapes and slow
 * moves only: the audience sees this from ~90 m.
 */

type RGB = [number, number, number];
type Pt = [number, number];

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const sstep = (a: number, b: number, x: number) => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const env = (x: number, a: number, b: number, c: number, d: number) => sstep(a, b, x) * (1 - sstep(c, d, x));
const mix = (a: RGB, b: RGB, u: number): RGB => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const rgba = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 3;

const INK: RGB = [255, 255, 255];
const WINDOW: RGB = [255, 214, 90];
const TAXI: RGB = [255, 200, 40];
const SPARK: RGB = [255, 190, 60];
const SUN: RGB = [255, 236, 170];

const GROUND = 1.6; // street level (m above the screen's foot)
const LIT: RGB = [255, 206, 84]; // a lit room
const SHADOW: RGB = [12, 22, 84]; // the people in it

// ------------------------------------------------------------- the city
// Blocks [x0, x1, top] left to right; gaps fall to the street. Two towers
// are drawn by hand: a crowned one with a needle and a stepped one with a
// mast (the city's tallest point, on the glissando's top note).
type Block = [number, number, number];
const BLOCKS_L: Block[] = [
  [-49, -45, 3.8],
  [-45, -41, 5.2],
  [-41, -37.5, 3.4],
  [-37.5, -33, 6.2],
  [-33, -30, 7.2],
  [-30, -27, 6.0],
  [-27, -23.5, 4.2],
  [-22.5, -18.5, 7.6],
  [-18.5, -15.5, 5.0],
];
const CROWN: Pt[] = [
  [-14.6, 5.0],
  [-14.6, 9.0],
  [-14.0, 9.0],
  [-14.0, 9.7],
  [-13.6, 9.7],
  [-13.6, 10.4],
  [-13.25, 10.4],
  [-13.25, 11.0],
  [-12.95, 11.0],
  [-12.8, 12.4], // the needle
  [-12.65, 11.0],
  [-12.35, 11.0],
  [-12.35, 10.4],
  [-12.0, 10.4],
  [-12.0, 9.7],
  [-11.6, 9.7],
  [-11.6, 9.0],
  [-11.0, 9.0],
  [-11.0, 5.0],
];
const BLOCKS_M: Block[] = [
  [-11.0, -7.0, 6.4],
  [-7.0, -3.0, 4.6],
  [-3.0, 1.0, 5.6],
];
const TALL_X = 5.0;
const TALL: Pt[] = [
  [1.0, 5.6],
  [2.0, 5.6],
  [2.0, 8.0],
  [3.0, 8.0],
  [3.0, 9.6],
  [3.9, 9.6],
  [3.9, 10.8],
  [4.55, 10.8],
  [4.55, 11.6],
  [4.85, 11.6],
  [TALL_X, 13.4], // the mast: the glissando's top note
  [5.15, 11.6],
  [5.45, 11.6],
  [5.45, 10.8],
  [6.1, 10.8],
  [6.1, 9.6],
  [7.0, 9.6],
  [7.0, 8.0],
  [8.0, 8.0],
  [8.0, 5.6],
];
const BLOCKS_R: Block[] = [
  [8.0, 11.5, 5.6],
  [11.5, 14.0, 7.0],
  [14.0, 17.5, 4.0],
  [17.5, 20.5, 6.2],
  [20.5, 24.0, 4.6],
];
// the bridge: a tower on the deck, its cable drawn after the line
const BRIDGE_DECK = 3.0;
const BRIDGE: Pt[] = [
  [26.0, GROUND],
  [26.0, BRIDGE_DECK],
  [30.5, BRIDGE_DECK],
  [30.5, 8.6],
  [33.5, 8.6],
  [33.5, BRIDGE_DECK],
  [52.0, BRIDGE_DECK],
  [58.0, BRIDGE_DECK],
];
const CABLE_TOP: Pt = [32.0, 8.6];

/** One continuous outline of the whole skyline, left to right. */
function skyline(): Pt[] {
  const pts: Pt[] = [[-58, GROUND]];
  const blocks = (list: Block[]) => {
    for (const [x0, x1, top] of list) {
      const last = pts[pts.length - 1];
      if (Math.abs(last[0] - x0) > 0.01) pts.push([x0, GROUND]); // a gap: along the street
      else if (Math.abs(last[1] - top) < 0.01) {
        pts.push([x1, top]);
        continue;
      }
      pts.push([x0, top], [x1, top]);
    }
    const last = pts[pts.length - 1];
    pts.push([last[0], GROUND]);
  };
  blocks(BLOCKS_L);
  pts.push([CROWN[0][0], GROUND], ...CROWN);
  blocks(BLOCKS_M);
  pts.pop(); // straight into the tall tower at the same height
  pts.push(...TALL);
  blocks(BLOCKS_R);
  pts.push(...BRIDGE);
  return pts;
}
const LINE = skyline();
const CUM: number[] = [0];
for (let i = 1; i < LINE.length; i++) {
  const [ax, ay] = LINE[i - 1];
  const [bx, by] = LINE[i];
  CUM.push(CUM[i - 1] + Math.hypot(bx - ax, by - ay));
}
const TOTAL = CUM[CUM.length - 1];
const PEAK_LEN = CUM[LINE.findIndex((p) => p[0] === TALL_X && p[1] > 13)];

/** How much of the line is drawn at time u (in metres along it). */
function penLength(u: number): number {
  if (u <= R.penIn) return 0;
  if (u <= R.peak) return PEAK_LEN * ((u - R.penIn) / (R.peak - R.penIn)) ** 1.35; // speeds up with the glissando
  return PEAK_LEN + (TOTAL - PEAK_LEN) * easeOut((u - R.peak) / (R.drawn - R.peak - 0.6));
}

/** Window rectangles inside the blocks and tower shafts: [x, y, phase]. */
const WINDOWS: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  const shafts: Block[] = [...BLOCKS_L, [-14.4, -11.2, 8.6], ...BLOCKS_M, [2.2, 7.8, 8.0], ...BLOCKS_R];
  let k = 0;
  for (const [x0, x1, top] of shafts) {
    for (let y = GROUND + 0.9; y < top - 0.7; y += 1.05)
      for (let x = x0 + 0.75; x < x1 - 0.5; x += 1.15) {
        k++;
        if (hash(k * 3.1) < 0.35) continue; // dark rooms
        out.push([x, y, hash(k * 7.7)]);
      }
  }
  return out;
})();

// ----------------------------------------------------------- the drawing

export class RhapsodyPicture {
  private readonly sx: number;
  private readonly sy: number;

  constructor(
    private readonly g: CanvasRenderingContext2D,
    private readonly W: number,
    private readonly H: number,
  ) {
    this.sx = W / 116;
    this.sy = H / 15;
  }

  private X = (x: number) => (x / 116 + 0.5) * this.W;
  /** Heights are squeezed into 0.5-12 m: the mist's ragged top eats the last metres. */
  private Y = (y: number) => this.H * (1 - (0.5 + y * 0.86) / 15);

  render(u: number): void {
    if (u >= JAZZ_AT - RHAPSODY_AT) {
      this.evening(JAZZ.at + u - (JAZZ_AT - RHAPSODY_AT));
      return;
    }
    const { g } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';

    const on = sstep(0, 1.6, u) * (1 - sstep(R.end + 0.3, R.length - 0.5, u));
    const day = sstep(16, 24, u);
    this.sky(day, on);
    if (on < 0.002) return;

    const stars = env(u, 5.5, 9, 15, 20) * on;
    if (stars > 0.01) this.stars(u, stars);
    const sun = env(u, 15.5, 17, R.end, R.end + 2) * on;
    if (sun > 0.01) this.sun(u, sun);

    // the city: filled a shade darker than the sky so the sun sets behind it
    const city = sstep(R.penIn, R.drawn, u);
    this.fillCity(day, city * on);
    this.windows(u, on);
    this.girder(u, on);
    this.traffic(u, on);
    this.notes(u, on);
    // the line goes last, a beat after everything else
    const ink = 1 - sstep(R.end + 0.8, R.length - 0.8, u);
    this.line(u, ink);
  }

  private sky(day: number, on: number) {
    const { g, W, H } = this;
    const top = mix([4, 10, 48], [16, 44, 140], day);
    const low = mix([14, 30, 104], [44, 90, 196], day);
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, rgba(mix([0, 0, 0], top, on)));
    gr.addColorStop(1, rgba(mix([0, 0, 0], low, on)));
    g.fillStyle = gr;
    g.fillRect(0, 0, W, H);
  }

  private stars(u: number, a: number) {
    const { g } = this;
    g.fillStyle = rgba(INK);
    for (let i = 0; i < 26; i++) {
      const x = -48 + 96 * hash(i * 1.7);
      const y = 9 + 5 * hash(i * 2.3);
      if (Math.abs(x - TALL_X) < 4 && y < 13.8) continue;
      const tw = 0.6 + 0.4 * Math.sin(u * (1 + hash(i * 4.1)) + i);
      const b = a * tw * sstep(5.5 + hash(i * 3.3) * 3, 7 + hash(i * 3.3) * 3, u);
      if (b < 0.02) continue;
      g.globalAlpha = b;
      // a four-point twinkle, drawn as two crossed strokes
      const r = 0.35 + 0.25 * hash(i * 5.9);
      g.strokeStyle = rgba(INK);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(this.X(x - r), this.Y(y));
      g.lineTo(this.X(x + r), this.Y(y));
      g.moveTo(this.X(x), this.Y(y - r * 1.3));
      g.lineTo(this.X(x), this.Y(y + r * 1.3));
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  private sun(u: number, a: number) {
    const { g } = this;
    const x = 17.5;
    const y = lerp(2.0, 10.8, easeOut((u - 15.5) / 9));
    const r = 2.0;
    // the solo's first strong note: the rays flare
    const flare = Math.exp(-Math.max(0, u - R.hits[0]) * 2.2) * (u >= R.hits[0] ? 1 : 0);
    g.globalAlpha = a;
    g.fillStyle = rgba(mix(SUN, [255, 255, 255], flare * 0.5), 0.9);
    g.beginPath();
    g.ellipse(this.X(x), this.Y(y), r * this.sx, r * this.sy, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = rgba(SUN);
    g.lineWidth = 3.5;
    g.beginPath();
    const n = 14;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + u * 0.08;
      const r0 = r + 0.5;
      const r1 = r + 1.3 + 1.4 * flare + (i % 2 ? 0 : 0.5);
      g.moveTo(this.X(x + Math.cos(th) * r0), this.Y(y + Math.sin(th) * r0));
      g.lineTo(this.X(x + Math.cos(th) * r1), this.Y(y + Math.sin(th) * r1));
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  private fillCity(day: number, a: number) {
    if (a < 0.01) return;
    const { g } = this;
    g.globalAlpha = a;
    g.fillStyle = rgba(mix([8, 18, 70], [26, 60, 160], day));
    g.beginPath();
    g.moveTo(this.X(-58), this.Y(0));
    for (const [x, y] of LINE) g.lineTo(this.X(x), this.Y(y));
    g.lineTo(this.X(58), this.Y(0));
    g.closePath();
    g.fill();
    // the street below the bridge deck stays the city's colour too
    g.globalAlpha = 1;
  }

  private windows(u: number, on: number) {
    const { g } = this;
    const w = 0.5 * this.sx;
    const h = 0.6 * this.sy;
    for (let i = 0; i < WINDOWS.length; i++) {
      const [x, y, ph] = WINDOWS[i];
      // night: lit one by one under the theme, out at dawn
      let b = sstep(6.5 + ph * 8, 7 + ph * 8, u) * (1 - sstep(17 + ph * 6, 17.6 + ph * 6, u)) * 0.85;
      // jazz: a wave of light runs through the city with the music
      if (u > 35.5) {
        const wave = Math.sin((x / 116) * 9 - (u - 36) * 3.2 + ph * 0.8);
        b = Math.max(b, env(u, 36, 37.5, R.end - 0.5, R.end + 1) * clamp01(wave * 1.6 - 0.2));
      }
      b *= on;
      if (b < 0.03) continue;
      g.globalAlpha = b;
      g.fillStyle = rgba(WINDOW);
      g.fillRect(this.X(x) - w / 2, this.Y(y) - h / 2, w, h);
    }
    g.globalAlpha = 1;
  }

  /** A riveter on a girder hung from a crane cable, sparks on the strong notes. */
  private girder(u: number, on: number) {
    const a = env(u, 25.2, 26.2, 37, 38.5) * on;
    if (a < 0.01) return;
    const { g } = this;
    const cx = -30;
    // down from above the screen, swaying, then hoisted away
    const y = lerp(18, 9.6, easeOut((u - 25.2) / 1.6)) + lerp(0, 8, sstep(37, 38.5, u) ** 2);
    const tilt = Math.sin((u - 25.2) * 0.9) * 0.05;
    const half = 5;
    const S = 1.6; // drawn large enough to read from the seats
    const pt = (dx: number, dy: number): Pt => [cx + S * (dx * Math.cos(tilt) - dy * Math.sin(tilt)), y + S * (dx * Math.sin(tilt) + dy * Math.cos(tilt))];
    g.globalAlpha = a;
    g.strokeStyle = rgba(INK);
    g.lineWidth = 3.5;
    // the cable
    g.beginPath();
    g.moveTo(this.X(cx), this.Y(17));
    const top = pt(0, 0.35);
    g.lineTo(this.X(top[0]), this.Y(top[1]));
    g.stroke();
    // the I-beam: two flanges and its rivet holes
    g.beginPath();
    for (const dy of [0.35, -0.35]) {
      const p0 = pt(-half, dy);
      const p1 = pt(half, dy);
      g.moveTo(this.X(p0[0]), this.Y(p0[1]));
      g.lineTo(this.X(p1[0]), this.Y(p1[1]));
    }
    for (let dx = -half + 0.8; dx < half; dx += 1.6) {
      const p = pt(dx, 0);
      g.moveTo(this.X(p[0]) + 2, this.Y(p[1]));
      g.arc(this.X(p[0]), this.Y(p[1]), 2, 0, Math.PI * 2);
    }
    g.stroke();
    // the riveter sits on the beam, hammer arm swinging with the beat
    const seat = 2.2;
    const hip = pt(seat, 0.4);
    const head = pt(seat - 0.15, 2.25);
    const neck = pt(seat - 0.1, 1.75);
    const swing = Math.sin(u * Math.PI * 2) * 0.6;
    const hand = pt(seat - 1.0 - 0.2 * Math.cos(swing), 1.55 + 0.7 * Math.sin(swing));
    g.lineWidth = 3.5;
    g.beginPath();
    g.moveTo(this.X(hip[0]), this.Y(hip[1]));
    g.lineTo(this.X(neck[0]), this.Y(neck[1]));
    // legs dangling over the edge
    const knee = pt(seat + 0.7, 0.45);
    const foot = pt(seat + 0.8 + 0.1 * Math.sin(u * 2), -0.9);
    g.moveTo(this.X(hip[0]), this.Y(hip[1]));
    g.lineTo(this.X(knee[0]), this.Y(knee[1]));
    g.lineTo(this.X(foot[0]), this.Y(foot[1]));
    // the hammer arm
    g.moveTo(this.X(neck[0]), this.Y(neck[1] - 0.15));
    g.lineTo(this.X(hand[0]), this.Y(hand[1]));
    g.stroke();
    g.beginPath();
    g.ellipse(this.X(head[0]), this.Y(head[1]), 0.42 * S * this.sx, 0.42 * S * this.sy, 0, 0, Math.PI * 2);
    g.stroke();
    // a hat brim
    const brimL = pt(seat - 0.8, 2.55);
    const brimR = pt(seat + 0.5, 2.55);
    g.beginPath();
    g.moveTo(this.X(brimL[0]), this.Y(brimL[1]));
    g.lineTo(this.X(brimR[0]), this.Y(brimR[1]));
    g.stroke();
    // sparks where the hammer meets the beam
    const at = pt(seat - 1.4, 0.4);
    for (const hit of R.hits.slice(1)) this.sparks(at, u - hit, 1.6, a);
    // small sparks on each hammer stroke between them
    const beat = u % 1;
    if (u > 26.4 && u < 36.8) this.sparks(at, beat - 0.25, 0.6, a);
    g.globalAlpha = 1;
  }

  private sparks(at: Pt, age: number, size: number, a: number) {
    if (age < 0 || age > 0.9) return;
    const { g } = this;
    const k = 1 - age / 0.9;
    g.globalAlpha = a * k;
    g.strokeStyle = rgba(SPARK);
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 12; i++) {
      const th = -0.2 + (i / 11) * (Math.PI + 0.4) + hash(i * 9.1) * 0.2;
      const r0 = size * (0.4 + age * 2.5);
      const r1 = r0 + size * (0.8 + hash(i * 3.7) * 0.9);
      g.moveTo(this.X(at[0] + Math.cos(th) * r0), this.Y(at[1] + Math.sin(th) * r0 - age * age * 2));
      g.lineTo(this.X(at[0] + Math.cos(th) * r1), this.Y(at[1] + Math.sin(th) * r1 - age * age * 2));
    }
    g.stroke();
    // the flash itself
    g.fillStyle = rgba([255, 240, 200], 0.9 * k * k);
    g.beginPath();
    g.ellipse(this.X(at[0]), this.Y(at[1]), size * 0.7 * this.sx, size * 0.7 * this.sy, 0, 0, Math.PI * 2);
    g.fill();
  }

  /** Morning traffic on the street: a yellow taxi, then a bus the other way. */
  private traffic(u: number, on: number) {
    const taxi = (u - 20) / 12;
    if (taxi > 0 && taxi < 1) this.car(lerp(-46, 26, taxi), 1, TAXI, on * env(u, 20, 20.8, 31, 32), u, 4.4, 1.9);
    const bus = (u - 25) / 10;
    if (bus > 0 && bus < 1) this.car(lerp(24, -46, bus), -1, null, on * env(u, 25, 25.8, 34, 35), u, 7.5, 2.6);
  }

  private car(x: number, dir: number, fill: RGB | null, a: number, u: number, len: number, tall: number) {
    if (a < 0.01) return;
    const { g } = this;
    const bob = Math.abs(Math.sin(u * 7 + x)) * 0.08;
    const y0 = GROUND - 0.15 + bob;
    // body, nose toward 'dir' (a rounded 1930s profile)
    const p = (fx: number, fy: number): [number, number] => [this.X(x + dir * (fx - 0.5) * len), this.Y(y0 + fy * tall)];
    const body: [number, number][] = fill
      ? [p(0, 0.3), p(0.02, 0.55), p(0.25, 0.6), p(0.35, 1), p(0.72, 1), p(0.8, 0.6), p(0.98, 0.52), p(1, 0.3)]
      : [p(0, 0.3), p(0, 0.95), p(0.06, 1), p(0.94, 1), p(1, 0.85), p(1, 0.3)];
    g.globalAlpha = a;
    g.beginPath();
    g.moveTo(...body[0]);
    for (const q of body.slice(1)) g.lineTo(...q);
    g.closePath();
    if (fill) {
      g.fillStyle = rgba(fill, 0.95);
      g.fill();
    }
    g.strokeStyle = rgba(INK);
    g.lineWidth = 3.5;
    g.stroke();
    // windows of the bus
    if (!fill) {
      g.beginPath();
      for (let i = 0; i < 5; i++) {
        const [ax, ay] = p(0.1 + i * 0.17, 0.85);
        const [bx, by] = p(0.22 + i * 0.17, 0.6);
        g.rect(Math.min(ax, bx), ay, Math.abs(bx - ax), by - ay);
      }
      g.lineWidth = 2.5;
      g.stroke();
    }
    // wheels turning
    g.lineWidth = 3.5;
    for (const fx of [0.2, 0.8]) {
      const [cx, cy] = p(fx, 0.12);
      const rx = 0.42 * this.sx;
      const ry = 0.42 * this.sy;
      g.fillStyle = rgba([10, 20, 70]);
      g.beginPath();
      g.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const th = (-dir * u * 8) % (Math.PI * 2);
      g.beginPath();
      g.moveTo(cx - Math.cos(th) * rx, cy - Math.sin(th) * ry);
      g.lineTo(cx + Math.cos(th) * rx, cy + Math.sin(th) * ry);
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** Jazz: notes float up from a window as the city swings. */
  private notes(u: number, on: number) {
    const a0 = env(u, 36, 37, R.end - 0.5, R.end + 1) * on;
    if (a0 < 0.01) return;
    const { g } = this;
    g.strokeStyle = rgba(INK);
    g.fillStyle = rgba(INK);
    g.lineWidth = 3;
    for (let i = 0; i < 7; i++) {
      const born = 36 + i * 1.1;
      const age = u - born;
      if (age < 0 || age > 5) continue;
      const x = -5 + Math.sin(age * 1.4 + i) * 1.4 + (i % 3) * 3 - 3;
      const y = 6.2 + age * 1.5;
      const a = a0 * env(age, 0, 0.5, 3.8, 5);
      if (a < 0.02) continue;
      g.globalAlpha = a;
      // an eighth note: head, stem, flag
      const hx = this.X(x);
      const hy = this.Y(y);
      g.beginPath();
      g.ellipse(hx, hy, 0.38 * this.sx, 0.28 * this.sy, -0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.moveTo(hx + 0.34 * this.sx, hy);
      g.lineTo(hx + 0.34 * this.sx, this.Y(y + 1.5));
      g.quadraticCurveTo(this.X(x + 1.0), this.Y(y + 1.1), this.X(x + 0.9), this.Y(y + 0.6));
      g.stroke();
    }
    g.globalAlpha = 1;
  }

  /** The pen's line: drawn up to where the pen is, its tip glowing. */
  private line(u: number, a: number) {
    const len = penLength(u);
    if (len <= 0 || a < 0.01) return;
    const { g } = this;
    let tip: Pt = LINE[0];
    const path = new Path2D();
    path.moveTo(this.X(LINE[0][0]), this.Y(LINE[0][1]));
    for (let i = 1; i < LINE.length; i++) {
      if (CUM[i] <= len) {
        path.lineTo(this.X(LINE[i][0]), this.Y(LINE[i][1]));
        tip = LINE[i];
        continue;
      }
      const f = (len - CUM[i - 1]) / (CUM[i] - CUM[i - 1]);
      tip = [lerp(LINE[i - 1][0], LINE[i][0], f), lerp(LINE[i - 1][1], LINE[i][1], f)];
      path.lineTo(this.X(tip[0]), this.Y(tip[1]));
      break;
    }
    // the bridge's cable, sagging from the tower to the deck on both sides
    const cable = sstep(R.drawn - 0.8, R.drawn + 0.6, u);
    if (cable > 0) {
      const [tx, ty] = CABLE_TOP;
      const reach = (side: number, to: number) => {
        const n = 16;
        path.moveTo(this.X(tx), this.Y(ty));
        for (let i = 1; i <= n * cable; i++) {
          const f = i / n;
          const x = lerp(tx, to, f);
          const y = lerp(ty, BRIDGE_DECK + 0.3, f) - Math.sin(f * Math.PI) * 1.6 * (side > 0 ? 1 : 0.6);
          path.lineTo(this.X(x), this.Y(y));
        }
      };
      reach(1, 50);
      reach(-1, 26.5);
    }
    g.globalAlpha = a * 0.28;
    g.strokeStyle = rgba([170, 210, 255]);
    g.lineWidth = 9;
    g.stroke(path);
    g.globalAlpha = a;
    g.strokeStyle = rgba(INK);
    g.lineWidth = 3.6;
    g.stroke(path);
    // the pen's tip while it draws
    const drawing = len < TOTAL - 0.01;
    if (drawing) {
      const r = 0.55;
      const gr = g.createRadialGradient(this.X(tip[0]), this.Y(tip[1]), 0, this.X(tip[0]), this.Y(tip[1]), r * 2.5 * this.sy);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(0.3, 'rgba(200,230,255,0.6)');
      gr.addColorStop(1, 'rgba(120,170,255,0)');
      g.fillStyle = gr;
      g.fillRect(this.X(tip[0]) - r * 3 * this.sy, this.Y(tip[1]) - r * 3 * this.sy, r * 6 * this.sy, r * 6 * this.sy);
    }
    g.globalAlpha = 1;
  }
  // ------------------------------------------------- the evening windows

  /** The interlude on the mounds; s is show time. */
  private evening(s: number): void {
    const { g } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const end = JAZZ.at + JAZZ.length;
    const on = sstep(JAZZ.at + 0.5, JAZZ.at + 2.5, s) * (1 - sstep(end - 3, end - 0.5, s));
    const top = mix([0, 0, 0], [5, 10, 44], on);
    const low = mix([0, 0, 0], [16, 30, 100], on);
    const gr = g.createLinearGradient(0, 0, 0, this.H);
    gr.addColorStop(0, rgba(top));
    gr.addColorStop(1, rgba(low));
    g.fillStyle = gr;
    g.fillRect(0, 0, this.W, this.H);
    if (on < 0.01) return;
    const [outR, outL, outC] = JAZZ.out;
    // [centre x, half width, top, lights on, lights out]: inside each mound's
    // dome (sides 28 x 12 m, centre 40 x 18 m), clear of its thin rim
    // [centre x, half width, top, scale, lights on, lights out]; each room is
    // drawn at 'scale' about its sill so the people read from the seats
    const rooms: [number, number, number, number, number, number, (s: number, a: number) => void][] = [
      [-40, 7, 7.8, 1.2, JAZZ.left, outL, (t, a) => this.pianist(t, a)],
      [40, 7, 7.8, 1.2, JAZZ.right, outR, (t, a) => this.trumpeter(t, a)],
      [0, 10.5, 11.2, 1.1, JAZZ.centre, outC, (t, a) => this.dancers(t, a)],
    ];
    for (const [cx, hw, topY, k, lit, out, who] of rooms) {
      g.setTransform(k, 0, 0, k, this.X(cx) * (1 - k), this.Y(GROUND) * (1 - k));
      // the frame shows faintly before the light, and stays a moment after
      const frame = on * env(s, JAZZ.at + 1, JAZZ.at + 3, out + 0.3, out + 2);
      const light = on * sstep(lit - 0.15, lit + 0.5, s) * (1 - sstep(out, out + 0.5, s));
      const x0 = this.X(cx - hw);
      const x1 = this.X(cx + hw);
      const y0 = this.Y(topY);
      const y1 = this.Y(GROUND);
      if (light > 0.01) {
        g.globalAlpha = light;
        const lg = g.createRadialGradient((x0 + x1) / 2, y1, 0, (x0 + x1) / 2, y1, (x1 - x0) * 0.75);
        lg.addColorStop(0, rgba(mix(LIT, [255, 240, 200], 0.4)));
        lg.addColorStop(1, rgba(LIT));
        g.fillStyle = lg;
        g.fillRect(x0, y0, x1 - x0, y1 - y0);
        who(s, light);
      }
      if (frame > 0.01) {
        g.globalAlpha = frame * (0.45 + 0.55 * Math.max(light, 0));
        g.strokeStyle = rgba(INK);
        g.lineWidth = 4;
        g.strokeRect(x0, y0, x1 - x0, y1 - y0);
        // a sill and the curtains tied back at the top corners
        g.beginPath();
        g.moveTo(this.X(cx - hw - 0.8), y1);
        g.lineTo(this.X(cx + hw + 0.8), y1);
        for (const side of [-1, 1]) {
          const xs = cx + side * hw;
          g.moveTo(this.X(xs), y0);
          g.quadraticCurveTo(this.X(xs - side * 2.2), this.Y(topY - 1.2), this.X(xs - side * 0.6), this.Y(topY - 3.2));
          g.lineTo(this.X(xs), this.Y(topY - 3.6));
        }
        g.stroke();
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
  }

  private ink(a: number, w = 7) {
    const { g } = this;
    g.globalAlpha = a;
    g.strokeStyle = rgba(SHADOW);
    g.fillStyle = rgba(SHADOW);
    g.lineWidth = w;
  }

  private head(x: number, y: number, r = 0.6) {
    this.g.beginPath();
    this.g.ellipse(this.X(x), this.Y(y), r * this.sx, r * this.sy * 0.86, 0, 0, Math.PI * 2);
    this.g.fill();
  }

  private poly(pts: Pt[]) {
    const { g } = this;
    g.beginPath();
    g.moveTo(this.X(pts[0][0]), this.Y(pts[0][1]));
    for (const [x, y] of pts.slice(1)) g.lineTo(this.X(x), this.Y(y));
    g.stroke();
  }

  /** Left: at an upright piano, rocking with the music, hands running. */
  private pianist(s: number, a: number) {
    const { g } = this;
    this.ink(a);
    // the piano, solid, its keyboard sticking out
    g.fillRect(this.X(-46), this.Y(5.9), this.X(-41) - this.X(-46), this.Y(GROUND) - this.Y(5.9));
    g.fillRect(this.X(-41), this.Y(4.3), this.X(-39.6) - this.X(-41), this.Y(3.9) - this.Y(4.3));
    this.poly([[-41, 3.9], [-41, GROUND]]);
    // a candlestick on top
    this.poly([[-44.5, 5.9], [-44.5, 6.9]]);
    // the stool
    this.poly([[-37.4, 3.0], [-35.8, 3.0]]);
    this.poly([[-36.6, 3.0], [-36.6, GROUND]]);
    // the player rocks forward on the beat
    const rock = Math.sin(s * Math.PI * 2 * 0.9) * 0.25;
    const hip: Pt = [-36.7, 3.25];
    const sh: Pt = [-37.6 + rock, 6.0];
    this.poly([hip, [-37.0 + rock * 0.5, 4.8], sh]);
    this.head(-37.9 + rock * 1.2, 6.8 + Math.abs(rock) * 0.3);
    // legs under the keyboard
    this.poly([hip, [-38.8, 3.3], [-39.0, GROUND]]);
    // two arms, hands running along the keys
    const run = Math.sin(s * 5.3);
    this.poly([sh, [-38.8, 5.0], [-40.1 + run * 0.35, 4.35]]);
    this.poly([sh, [-38.5, 4.9], [-40.6 - run * 0.35, 4.35]]);
  }

  /** Right: a trumpeter, bell raised, notes rising from it. */
  private trumpeter(s: number, a: number) {
    const sway = Math.sin(s * Math.PI * 2 * 0.45) * 0.3;
    this.ink(a);
    const hip: Pt = [41.2 + sway * 0.3, 4.0];
    const sh: Pt = [41.0 + sway, 6.2];
    const mouth: Pt = [40.2 + sway, 6.95];
    this.poly([[40.4, GROUND], hip, [42.0, GROUND]]);
    this.poly([hip, sh]);
    this.head(40.8 + sway, 7.1);
    // the horn: from the lips up and to the left, flaring at the bell
    const bell: Pt = [36.6 + sway, 8.0];
    this.poly([mouth, bell]);
    const g = this.g;
    g.beginPath();
    g.moveTo(this.X(bell[0] + 0.2), this.Y(bell[1] - 0.25));
    g.lineTo(this.X(bell[0] - 0.7), this.Y(bell[1] - 0.9));
    g.lineTo(this.X(bell[0] - 0.3), this.Y(bell[1] + 0.85));
    g.closePath();
    g.fill();
    // valves and the hands on them
    this.poly([sh, [39.6 + sway, 6.6], [38.8 + sway, 7.3]]);
    this.poly([sh, [40.3 + sway, 5.6], [39.4 + sway, 7.05]]);
    // notes float from the bell
    for (let i = 0; i < 4; i++) {
      const age = (s - JAZZ.right - 0.4 - i * 0.9) % 3.6;
      if (s < JAZZ.right + 0.4 + i * 0.9 || age > 2.6) continue;
      const x = bell[0] - 0.4 + age * 0.5 + Math.sin(age * 2 + i) * 0.3;
      const y = bell[1] - 1.6 - age * 1.0;
      const k = env(age, 0, 0.3, 1.8, 2.6);
      this.g.globalAlpha = a * k;
      this.head(x, y, 0.32);
      this.poly([[x + 0.3, y], [x + 0.3, y + 1.0], [x + 0.75, y + 0.6]]);
    }
  }

  /** Centre: a couple dancing; she spins on the swell. */
  private dancers(s: number, a: number) {
    const step = Math.sin(s * Math.PI * 2 * 0.5);
    const cx = step * 0.8;
    // her turn: one full spin on the swell's top
    const spin = sstep(JAZZ.spin, JAZZ.spin + 1.4, s);
    const flare = Math.sin(spin * Math.PI); // 0 -> 1 -> 0 through the turn
    this.ink(a);
    // him: hat, straight back, one arm up to hers
    const mh: Pt = [cx - 2.6, 4.4];
    const ms: Pt = [cx - 2.7, 7.6];
    this.poly([[cx - 3.6 + step * 0.4, GROUND], mh, [cx - 1.8 - step * 0.4, GROUND]]);
    this.poly([mh, ms]);
    this.head(cx - 2.75, 8.45, 0.65);
    this.poly([[cx - 3.75, 9.0], [cx - 1.75, 9.0]]); // hat brim
    this.g.fillRect(this.X(cx - 3.3), this.Y(9.9), this.X(cx - 2.2) - this.X(cx - 3.3), this.Y(9.0) - this.Y(9.9));
    // her: a skirt that swings out as she turns
    const wx = cx + 2.4 - flare * 0.4;
    const waist: Pt = [wx, 5.0];
    const ws: Pt = [wx, 7.5];
    const hem = 1.4 + flare * 1.6;
    const lift = flare * 1.1;
    const g = this.g;
    g.beginPath();
    g.moveTo(this.X(waist[0]), this.Y(waist[1]));
    g.lineTo(this.X(wx - hem), this.Y(2.6 + lift));
    g.quadraticCurveTo(this.X(wx), this.Y(2.2 + lift * 0.5), this.X(wx + hem), this.Y(2.6 + lift));
    g.closePath();
    g.fill();
    this.poly([[wx - 0.4, 2.5 + lift * 0.5], [wx - 0.5, GROUND]]);
    this.poly([[wx + 0.4, 2.5 + lift * 0.5], [wx + 0.6 + flare * 0.6, GROUND + 0.2 * flare]]);
    this.poly([waist, ws]);
    this.head(wx + 0.1, 8.3, 0.6);
    // joined hands held high between them; her free arm out in the turn
    const hands: Pt = [(ms[0] + ws[0]) / 2, 9.4 + flare * 0.6];
    this.poly([ms, hands, ws]);
    this.poly([ws, [wx + 1.6 + flare * 0.8, 7.0 - flare * 0.8]]);
    this.poly([ms, [cx - 1.4, 6.3], [wx - 0.3, 6.1]]); // his hand at her back
  }
}
