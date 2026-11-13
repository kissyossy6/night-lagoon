import { kind } from '../fixtures';
import { audienceDistance } from '../pyro/schedule';
import type { ScaleTier, SeatDef, Vec3, Venue, WaterShape } from '../venues/types';
import { groundAt } from '../venues/landscape';
import { apex } from '../venues/rules';
import type { Layout } from './layout';

/**
 * 近い席 for the Vision Pro export (追記46a): the nearest place a person
 * could really stand or sit in any venue — the built-in ones and the ones
 * made in venue.html — worked out from the venue's shape, not placed by hand.
 *
 * From 66 m (the lagoon's 客席) the two eyes see the stage almost alike (about
 * 2 px apart at 7680 per eye), so the 180° movie has little depth. Nearer, it
 * has more. How near is set by what is true of a real venue:
 *
 * - never in front of the audience's front edge (Venue.audience): that is
 *   where the fireworks' safety distance is measured from (src/venues/rules.ts),
 *   and nothing in front of it is a place for people
 * - out of the spray: as far from every fixture as its water is tall
 *   (fountain-layout / fountain-physics: spray spreads about as far as the
 *   column is tall, Safe Rain), and from a mist screen as far as it is tall.
 *   Water leaned toward the audience is the show's to keep off the seats; the
 *   venue rules already warn about it (rule 'spray')
 * - on land: outside the water by a step (WATER_MARGIN)
 * - no nearer any fireworks tube than the audience already is
 * - eyes at a person's height for the scale (EYE_HEIGHT) above the ground
 *   there (the bank, 46c's scenery: the lagoon's is 0.8 m up, so its rail
 *   stays below the eyes), looking level at the middle of the fixtures: in a
 *   headset the horizon must stay level
 *
 * The seat starts on the front edge where it is nearest the fixtures and
 * steps back, away from the stage, until all of that holds. A venue with no
 * front edge steps out from the middle of the fixtures toward its 客席 camera.
 *
 * Only the 180° export lists it: a flat camera from here would cut the tall
 * water off at the top, and the player already has near flat views (目線・水面).
 */

/** Eyes above the ground (the bank's top where the venue has one, else the water's level), by scale (m). */
export const EYE_HEIGHT: Record<ScaleTier, number> = {
  // standing at the shore or the edge of the square
  lagoon: 1.6,
  plaza: 1.6,
  // on a garden chair by the pond
  garden: 1.2,
  // seated at the desk, eyes above the tank's water
  desk: 0.3,
};

/** The least step between the water and the seat (m), by scale. */
const WATER_MARGIN: Record<ScaleTier, number> = { lagoon: 1, plaza: 1, garden: 0.5, desk: 0.1 };

/** Eye distance (m), as the 180° export draws (src/export/vr180.ts). */
export const IPD = 0.064;

/** A spray source: a fixture (a point) or a mist screen (a segment along x), and how far its spray reaches. */
interface Source {
  a: [number, number];
  b: [number, number];
  reach: number;
  name: string;
}

function sources(v: Venue): Source[] {
  const out: Source[] = [];
  for (const g of v.groups) {
    const h = g.spec?.height ?? apex(g.kind);
    const name = g.label ?? kind(g.kind).name;
    for (const p of g.positions) out.push({ a: [p[0], p[2]], b: [p[0], p[2]], reach: h, name });
  }
  for (const s of v.screens) {
    const [x, , z] = s.center;
    out.push({ a: [x - s.width / 2, z], b: [x + s.width / 2, z], reach: s.height, name: s.group === 'screen' ? '水幕' : '霧の山' });
  }
  return out;
}

function toSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len2 = dx * dx + dz * dz;
  const u = len2 ? Math.min(1, Math.max(0, ((x - a[0]) * dx + (z - a[1]) * dz) / len2)) : 0;
  return Math.hypot(x - (a[0] + dx * u), z - (a[1] + dz * u));
}

/** How far a point is outside the water (m; negative inside, Infinity-like for no water edge). */
function outsideWater(w: WaterShape, x: number, z: number): number {
  switch (w.kind) {
    case 'infinite':
      return -Infinity;
    case 'circle':
      return Math.hypot(x, z) - w.radius;
    case 'roundedRect': {
      const r = Math.min(w.radius, w.width / 2, w.depth / 2);
      const dx = Math.abs(x) - (w.width / 2 - r);
      const dz = Math.abs(z) - (w.depth / 2 - r);
      return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0) - r;
    }
    default: {
      const dx = Math.abs(x) - w.width / 2;
      const dz = Math.abs(z) - w.depth / 2;
      return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0);
    }
  }
}

const asLayout = (venue: Venue) => ({ venue }) as unknown as Layout;

/** The middle of the fixtures and screens on the ground [x, z], and their spread (m). */
function middle(v: Venue): { c: [number, number]; span: number } {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const s of sources(v)) {
    xs.push(s.a[0], s.b[0]);
    zs.push(s.a[1], s.b[1]);
  }
  if (!xs.length) return { c: [0, 0], span: 1 };
  const c: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  return { c, span: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 0.3) };
}

/** What a seat sees and whether a person could be there. */
export interface SeatFacts {
  /** To the middle of the fixtures (m). */
  centre: number;
  /** To the nearest fixture or screen (m), and what it is. */
  nearest: number;
  nearestName: string;
  /** Inside some fixture's spray (its name), or null. */
  wet: string | null;
  /** Nearer a fireworks tube than the audience may stand. */
  insidePyroSafety: boolean;
}

export function seatFacts(v: Venue, pos: Vec3): SeatFacts {
  const [x, , z] = pos;
  const { c, span } = middle(v);
  let nearest = Infinity;
  let nearestName = '';
  let wet: string | null = null;
  for (const s of sources(v)) {
    const d = toSegment(x, z, s.a, s.b);
    if (d < nearest) {
      nearest = d;
      nearestName = s.name;
    }
    if (!wet && d < s.reach - 1e-6) wet = s.name;
  }
  // a little slack: the hand-placed seats on the front edge itself are fine
  const slack = 0.005 * span;
  const insidePyroSafety = v.pyro.some((p) => p.tubes.some((t) => Math.hypot(x - t[0], z - t[2]) < audienceDistance(t, asLayout(v)) - slack));
  return { centre: Math.hypot(x - c[0], z - c[1]), nearest, nearestName, wet, insidePyroSafety };
}

/** Left and right eyes' difference, in pixels of the 180° image, for something d metres away. */
export function disparityPx(d: number, eye: number): number {
  return ((IPD / Math.max(d, 1e-3)) * eye) / Math.PI;
}

export interface NearSeat extends SeatDef {
  /** Why it stands where it does: the rule that stopped it ('edge' = the front edge itself). */
  stoppedBy: 'edge' | 'spray' | 'water' | 'pyro';
}

/** The 近い席 of a venue (see the top of this file). */
export function nearSeat(v: Venue): NearSeat {
  const { c, span } = middle(v);
  const src = sources(v);
  const tubes = v.pyro.flatMap((p) => p.tubes);
  const hasAudience = !!v.audience || v.seats.length > 0;
  const tubeLimit = tubes.map((t) => (hasAudience ? audienceDistance(t, asLayout(v)) : 0));
  const margin = WATER_MARGIN[v.scale] ?? 1;

  // where to start and which way is "back, away from the stage"
  let start: [number, number];
  let back: [number, number];
  if (v.audience) {
    const a: [number, number] = [v.audience.from[0], v.audience.from[2]];
    const b: [number, number] = [v.audience.to[0], v.audience.to[2]];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const u = len2 ? Math.min(1, Math.max(0, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dz) / len2)) : 0;
    start = [a[0] + dx * u, a[1] + dz * u];
    const len = Math.sqrt(len2) || 1;
    back = len2 ? [-dz / len, dx / len] : [0, 1];
    // the side of the edge away from the stage
    const side = (start[0] - c[0]) * back[0] + (start[1] - c[1]) * back[1];
    if (side < 0 || (side === 0 && back[1] < 0)) back = [-back[0], -back[1]];
  } else {
    const seat = v.seats.find((s) => s.id === 'audience') ?? v.seats[0];
    const dx = seat ? seat.pos[0] - c[0] : 0;
    const dz = seat ? seat.pos[2] - c[1] : 1;
    const len = Math.hypot(dx, dz);
    back = len > 1e-6 ? [dx / len, dz / len] : [0, 1];
    start = [c[0], c[1]];
  }

  const why = (x: number, z: number): NearSeat['stoppedBy'] | null => {
    if (src.some((s) => toSegment(x, z, s.a, s.b) < s.reach)) return 'spray';
    if (v.water.kind !== 'infinite' && outsideWater(v.water, x, z) < margin) return 'water';
    if (tubes.some((t, k) => Math.hypot(x - t[0], z - t[2]) < tubeLimit[k] - 1e-6)) return 'pyro';
    return null;
  };

  const step = Math.max(span, 0.3) / 400;
  let s = 0;
  let stoppedBy: NearSeat['stoppedBy'] = v.audience ? 'edge' : 'water';
  for (let k = 0; k < 40000; k++) {
    const r = why(start[0] + back[0] * s, start[1] + back[1] * s);
    if (!r) break;
    stoppedBy = r;
    s += step;
  }
  const x = start[0] + back[0] * s;
  const z = start[1] + back[1] * s;
  const y = (groundAt(v.scenery, v.water, x, z) ?? 0) + (EYE_HEIGHT[v.scale] ?? 1.6);
  return { id: 'near', label: '近い席（自動）', pos: [x, y, z], target: [c[0], y, c[1]], fov: 60, stoppedBy };
}
