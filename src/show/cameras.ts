import * as THREE from 'three';
import type { MusicFeatures } from '../audio/analysis';
import { MUSIC, SHOW_DURATION } from './song';
import { LAGOON, type Venue } from '../venues';

/**
 * Camera angles and the automatic camera work ("おまかせ").
 *
 * Metres, as in layout.ts: x stage right, y up, z toward the audience. The
 * jets stand between z = -11 (geysers) and z = 15.5 (front grid band), the
 * water screen at z = -20; whips reach 30 m, geysers 61 m.
 */

export interface View {
  pos: [number, number, number];
  target: [number, number, number];
  /** Vertical field of view (deg). */
  fov: number;
  /** Narrower windows than this shape keep its width (SeatDef.fitWidth). */
  fitWidth?: number;
}

/** The vertical fov that keeps a fitWidth view's width in this window. */
export function fovFor(v: View, aspect: number): number {
  if (!v.fitWidth || aspect >= v.fitWidth) return v.fov;
  const half = Math.tan(THREE.MathUtils.degToRad(v.fov) / 2) * (v.fitWidth / aspect);
  return THREE.MathUtils.radToDeg(2 * Math.atan(half));
}

const angleOf = (s: { label: string; pos: View['pos']; target: View['target']; fov: number; fitWidth?: number }) => ({
  label: s.label,
  pos: s.pos,
  target: s.target,
  fov: s.fov,
  ...(s.fitWidth ? { fitWidth: s.fitWidth } : {}),
});

export type AngleName = 'audience' | 'eye' | 'screen' | 'wide' | 'low' | 'left' | 'right' | 'aerial' | 'sky' | 'pyro';

/** Fixed angles, in the order the player lists them: the lagoon's seats (src/venues/lagoon.ts). */
export const ANGLES = Object.fromEntries(
  LAGOON.seats.map((s) => [s.id, angleOf(s)]),
) as Record<AngleName, View & { label: string }>;

export const ANGLE_NAMES = Object.keys(ANGLES) as AngleName[];

/** For an angle the venue does not list: the nearest kind of view it has. */
const FALLBACK: Record<AngleName, AngleName[]> = {
  audience: ['wide'],
  eye: ['low', 'audience'],
  screen: ['audience'],
  wide: ['audience'],
  low: ['eye', 'audience'],
  left: ['wide'],
  right: ['wide'],
  aerial: ['wide'],
  sky: ['wide'],
  pyro: ['sky', 'wide'],
};

/**
 * Point the fixed angles at another venue's seats (the player opened with
 * ?venue=, src/show/main.ts). Angles the venue has no seat for take the
 * nearest one it has. Without ?venue= this is never called: the lagoon's.
 */
export function useVenueAngles(venue: Venue) {
  if (venue === LAGOON) return;
  const seat = (n: AngleName) => venue.seats.find((s) => s.id === n);
  for (const n of ANGLE_NAMES) {
    const s = seat(n) ?? FALLBACK[n].map(seat).find(Boolean) ?? venue.seats[0];
    if (s) ANGLES[n] = angleOf({ ...s, label: ANGLES[n].label });
  }
}

/** One shot of the automatic camera: a move from one view to another. */
export interface Shot {
  start: number;
  end: number;
  from: View;
  to: View;
  /** For the status line and tests. */
  kind: string;
}

export function applyView(cam: THREE.PerspectiveCamera, v: View): THREE.Vector3 {
  cam.position.set(...v.pos);
  cam.lookAt(...v.target);
  const fov = fovFor(v, cam.aspect);
  if (cam.fov !== fov) {
    cam.fov = fov;
    cam.updateProjectionMatrix();
  }
  return new THREE.Vector3(...v.target);
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerp3 = (a: number[], b: number[], k: number) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)] as [number, number, number];

/** The automatic camera's view at show time t. */
export function viewAt(shots: Shot[], t: number): View {
  let lo = 0;
  let hi = shots.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (shots[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const s = shots[lo];
  const x = Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start)));
  // a camera operator eases into and out of a move, but keeps it going: a
  // gentle sine ease, not a smoothstep that stops dead at both ends
  const k = 0.5 - 0.5 * Math.cos(Math.PI * (0.15 + 0.7 * x));
  const k0 = 0.5 - 0.5 * Math.cos(Math.PI * 0.15);
  const k1 = 0.5 - 0.5 * Math.cos(Math.PI * 0.85);
  const e = (k - k0) / (k1 - k0);
  return { pos: lerp3(s.from.pos, s.to.pos, e), target: lerp3(s.from.target, s.to.target, e), fov: lerp(s.from.fov, s.to.fov, e) };
}

// ------------------------------------------------------------------- moves
/** Seeded PRNG (mulberry32): the same music always gives the same edit. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
const sign = (r: Rand) => (r() < 0.5 ? -1 : 1);
const deg = THREE.MathUtils.degToRad;

/** A camera on a circle around the stage centre, 'a' radians from straight ahead. */
function around(a: number, radius: number, y: number, target: [number, number, number], fov: number): View {
  return { pos: [Math.sin(a) * radius, y, target[2] + Math.cos(a) * radius], target, fov };
}

/**
 * Move builders: (random, shot length) → [from, to]. Speeds are per second,
 * so a short shot in a tutti moves less far than a long one in a calm scene.
 */
const MOVES: Record<string, (r: Rand, d: number) => [View, View]> = {
  /** slow push in from the back of the house, from a little to one side */
  push: (r, d) => {
    const a = deg(range(r, -22, 22));
    const near = range(r, 66, 78);
    const far = near + Math.min(40, 2.4 * d);
    const tg: [number, number, number] = [0, 14, -2];
    return [around(a, far, 9, tg, 48), around(a * 0.8, near, 7.5, tg, 48)];
  },
  /** arc around the stage */
  orbit: (r, d) => {
    const a0 = deg(range(r, -50, 50));
    const da = deg(Math.min(30, 2.6 * d)) * -Math.sign(a0 || 1);
    const radius = range(r, 70, 88);
    const y = range(r, 6, 14);
    const tg: [number, number, number] = [0, 13, -2];
    return [around(a0, radius, y, tg, 48), around(a0 + da, radius, y, tg, 48)];
  },
  /** sideways along the shore, the target with it */
  truck: (r, d) => {
    const x = range(r, -26, 26);
    const dx = sign(r) * Math.min(26, 2.2 * d);
    const z = range(r, 52, 64);
    return [
      { pos: [x - dx / 2, 6, z], target: [(x - dx / 2) * 0.7, 12, 0], fov: 50 },
      { pos: [x + dx / 2, 6, z], target: [(x + dx / 2) * 0.7, 12, 0], fov: 50 },
    ];
  },
  /** rise from the water to above the jets */
  crane: (r, d) => {
    const x = range(r, -18, 18);
    const z = range(r, 56, 68);
    const dy = Math.min(26, 3.5 * d);
    return [
      { pos: [x, 1.5, z], target: [x * 0.3, 12, 0], fov: 52 },
      { pos: [x, 1.5 + dy, z], target: [x * 0.3, 12 + dy * 0.15, 0], fov: 52 },
    ];
  },
  /** at the waterline in front of the grid, drifting */
  low: (r, d) => {
    const x = range(r, -24, 24);
    const dx = sign(r) * Math.min(10, 1.2 * d);
    const z = range(r, 30, 36);
    return [
      { pos: [x - dx / 2, 0.9, z], target: [(x - dx / 2) * 0.8, 12, 0], fov: 62 },
      { pos: [x + dx / 2, 0.9, z], target: [(x + dx / 2) * 0.8, 12, 0], fov: 62 },
    ];
  },
  /** close along the front grid band, looking down the row */
  grid: (r, d) => {
    const s = sign(r);
    const x = s * range(r, 20, 40);
    const dx = -s * Math.min(12, 1.5 * d);
    return [
      { pos: [x, 2.5, 30], target: [x * 0.4, 6, 12], fov: 55 },
      { pos: [x + dx, 2.5, 30], target: [(x + dx) * 0.4, 6, 12], fov: 55 },
    ];
  },
  /** high above the shore, slowly turning */
  aerial: (r, d) => {
    const a0 = deg(range(r, -25, 25));
    const da = sign(r) * deg(Math.min(14, 1.2 * d));
    const y = range(r, 44, 56);
    const tg: [number, number, number] = [0, 6, -2];
    return [around(a0, 84, y, tg, 48), around(a0 + da, 84, y, tg, 48)];
  },
  /** the whole lagoon for a big hit: geyser tops in frame */
  wide: (r, d) => {
    const a = deg(range(r, -8, 8));
    const tg: [number, number, number] = [0, 22, -4];
    return [around(a, 116, 12, tg, 44), around(a, 116 - Math.min(14, 1.4 * d), 12, tg, 44)];
  },
  /** pull out to the whole lagoon (the ending) */
  pullout: (r, d) => {
    const tg: [number, number, number] = [0, 18, -4];
    return [around(0, 72, 9, tg, 46), around(0, 72 + Math.min(50, 8 * d), 16, tg, 44)];
  },
  /** a fixed angle, held */
  ...Object.fromEntries(ANGLE_NAMES.map((n) => [`hold:${n}`, () => [ANGLES[n], ANGLES[n]] as [View, View]])),
};

// ---------------------------------------------------------------- the edit
interface Scene {
  from: number;
  to: number;
  /** Typical shot length (s); cuts snap to the music's onsets nearby. */
  cut: number;
  moves: string[];
  /** The first shot of the scene (a big hit gets the wide angle). */
  first?: string;
}

const M = MUSIC;
/**
 * The edit follows the show's sections (song.ts): long, slow moves while the
 * music is calm, short cuts in the tuttis and the finale, a wide angle on each
 * geyser hit (tutti, finale), and still, screen-facing shots for the story,
 * where the picture on the water is the point (no zooming there).
 */
const SCENES: Scene[] = [
  { from: 0, to: 16, cut: 8, moves: ['push', 'low'], first: 'push' },
  { from: 16, to: M.orchestra, cut: 7, moves: ['orbit', 'truck', 'low', 'push', 'aerial'] },
  { from: M.orchestra, to: M.tutti, cut: 5, moves: ['crane', 'orbit', 'grid', 'truck', 'low'] },
  { from: M.tutti, to: M.interlude, cut: 3, moves: ['orbit', 'low', 'grid', 'crane', 'aerial', 'truck'], first: 'wide' },
  { from: M.interlude, to: M.tutti2, cut: 7, moves: ['aerial', 'orbit', 'push', 'truck'] },
  { from: M.tutti2, to: M.piano, cut: 3.2, moves: ['orbit', 'grid', 'low', 'crane', 'aerial', 'truck'], first: 'wide' },
  { from: M.piano, to: 121, cut: 6, moves: ['hold:audience'] },
  { from: 121, to: 155.5, cut: 40, moves: ['hold:screen'] },
  { from: 155.5, to: 158.5, cut: 3, moves: ['hold:audience'] },
  { from: 158.5, to: M.finale, cut: 5, moves: ['hold:low'] },
  { from: M.finale, to: M.climax, cut: 2.6, moves: ['orbit', 'low', 'grid', 'crane', 'truck', 'aerial'], first: 'wide' },
  { from: M.climax, to: M.grand, cut: 4.6, moves: ['pullout'] },
  { from: M.grand, to: M.settle, cut: 2.6, moves: ['orbit', 'low', 'grid', 'crane', 'truck'], first: 'wide' },
  { from: M.settle, to: M.home, cut: 4.5, moves: ['aerial', 'orbit', 'truck', 'push'] },
  { from: M.home, to: M.chord - 0.5, cut: 3.4, moves: ['crane', 'low', 'orbit', 'grid'] },
  { from: M.chord - 0.5, to: SHOW_DURATION, cut: 6, moves: ['pullout'], first: 'wide' },
];

/**
 * Plan the automatic camera for the whole show. With the music analysis the
 * cuts land on its onsets (the strongest within reach of each planned cut).
 */
/**
 * A show that opens on the water screen (the Fantasia version's city picture)
 * holds the camera still on it until the orchestra, as the story does.
 */
export const screenOpening = (show: { cues: { t: number | string; clip?: { scene: string } }[] }) =>
  show.cues.some((c) => c.clip?.scene === 'rhapsody' && Number(c.t) < 1);

export function directShow(music?: MusicFeatures | null, opts: { screenOpening?: boolean } = {}): Shot[] {
  const scenes = opts.screenOpening ? [{ from: 0, to: M.orchestra, cut: 60, moves: ['hold:screen'] } as Scene, ...SCENES.slice(2)] : SCENES;
  const r = rng(20261025);
  const onsets = music?.onsets ?? [];
  const snap = (t: number, reach: number, lo: number, hi: number) => {
    let best = t;
    let score = 0.3; // weak onsets don't pull a cut
    for (const o of onsets) {
      if (o.t <= lo || o.t >= hi || Math.abs(o.t - t) > reach) continue;
      const s = o.strength * (1 - (0.5 * Math.abs(o.t - t)) / reach);
      if (s > score) {
        score = s;
        best = o.t;
      }
    }
    return best;
  };

  const shots: Shot[] = [];
  let prev = '';
  for (const sc of scenes) {
    // planned cuts, evenly spread, each snapped to the music
    const n = Math.max(1, Math.round((sc.to - sc.from) / sc.cut));
    const len = (sc.to - sc.from) / n;
    const cuts = [sc.from];
    for (let i = 1; i < n; i++) cuts.push(snap(sc.from + i * len, len * 0.35, cuts[i - 1] + len * 0.5, sc.to - len * 0.5));
    cuts.push(sc.to);
    for (let i = 0; i < n; i++) {
      let kind = i === 0 && sc.first ? sc.first : sc.moves[Math.floor(r() * sc.moves.length)];
      // never the same move twice in a row: a cut must change the picture
      if (kind === prev && sc.moves.length > 1) kind = sc.moves[(sc.moves.indexOf(kind) + 1) % sc.moves.length];
      const d = cuts[i + 1] - cuts[i];
      const [from, to] = MOVES[kind](r, d);
      shots.push({ start: cuts[i], end: cuts[i + 1], from, to, kind });
      prev = kind;
    }
  }
  return shots;
}
