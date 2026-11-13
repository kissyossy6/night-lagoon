import { kind } from '../fixtures';
import { groundAt } from './landscape';
import { arc, band, line } from './shapes';
import type { AudienceEdge, GroupDef, PyroSite, ScaleTier, Scenery, ScreenDef, SeatDef, Selection, Vec3, Venue, WaterShape } from './types';

/**
 * A venue written as parts (docs/detailed-design.md 6.1): the file the venue
 * editor saves and the built-in venues are written in (src/venues/builtin/).
 * buildVenue() turns it into the Venue the show runs on.
 *
 * Positions are [x, z] on the water (metres; x stage right, z toward the
 * audience), angles are degrees (0 = +x, 90 = +z, toward the audience).
 */

/** Where a water part stands in its group, and which kind it is. */
interface WaterPart {
  /** Cue target group ('grid'); parts of one group join in order. */
  group: string;
  /** A kind of the fixture table (src/fixtures/). */
  fixture: string;
  /** Shown in the venue editor; also makes a named selection ('@前列'). */
  name?: string;
  /** 外す: fixtures left out of the array, by their place in it (0 = first). */
  skip?: number[];
  /** ずらす: single fixtures of the array moved by [dx, dz] metres. */
  nudge?: { i: number; by: [number, number] }[];
  note?: string;
}

export type Part =
  /** 列: a straight row, evenly spaced, both ends included. */
  | (WaterPart & { kind: 'line'; count: number; from: [number, number]; to: [number, number] })
  /** 帯: a row of two staggered lines; every other fixture sits pitch/2 behind. */
  | (WaterPart & { kind: 'band'; count: number; from: [number, number]; to: [number, number]; pitch: number })
  /** 弧: along a circle from a0 to a1 (degrees), both ends included. */
  | (WaterPart & { kind: 'arc'; count: number; center: [number, number]; radius: number; a0: number; a1: number })
  /** 円: a full circle, the first fixture at a0 (degrees). */
  | (WaterPart & { kind: 'ring'; count: number; center: [number, number]; radius: number; a0?: number })
  /** 1台: one fixture. */
  | (WaterPart & { kind: 'single'; at: [number, number] })
  /** 水幕: one mist screen, the wide sheet or a mound. */
  | { kind: 'screen'; fixture: 'screen' | 'mound'; center: [number, number]; width: number; height: number; name?: string; note?: string }
  /**
   * プロジェクター: one per venue; at its foot [x, z] and `height` up, facing
   * `aim` [x, z]; `covers` names the screens it lights (their names), all when
   * missing. Cues name it 'projector' (its zones follow the mounds it lights).
   */
  | { kind: 'projector'; at: [number, number]; height: number; aim: [number, number]; covers?: string[]; name?: string; note?: string }
  /** 花火の台: a row of fireworks tubes; cues name it 'pyro:<site>'. */
  | { kind: 'pyro'; site: string; on: 'barge' | 'land'; tubes: number; from: [number, number]; to: [number, number]; height: number; note?: string }
  /** 客席: the front edge of the audience. */
  | { kind: 'seats'; from: [number, number]; to: [number, number]; name?: string; note?: string }
  /**
   * 岸 (scenery): the bank and the land behind it. Without from / to it runs
   * round the whole rim of the water; with them it is a straight bank, the
   * land on its right seen from above (drawn left to right: the audience's
   * side). `height` above the water, `width` of paving along the edge.
   */
  | { kind: 'shore'; from?: [number, number]; to?: [number, number]; height: number; width: number; name?: string; note?: string }
  /** 手すり・柵 (scenery): along a line, `height` over the bank it stands on, posts at most `spacing` apart. */
  | { kind: 'rail'; from: [number, number]; to: [number, number]; height: number; spacing: number; name?: string; note?: string }
  /**
   * 客 (scenery): people standing or sitting in a band `depth` deep behind
   * the line (on its right, as a bank's land), `density` per m², facing the
   * fixtures.
   */
  | { kind: 'crowd'; from: [number, number]; to: [number, number]; depth: number; density: number; pose: 'stand' | 'sit'; name?: string; note?: string };

export type PartKind = Part['kind'];

/** Japanese part names, for the editor and messages. */
export const PART_NAMES: Record<PartKind, string> = {
  line: '列',
  band: '帯',
  arc: '弧',
  ring: '円',
  single: '1台',
  screen: '水幕',
  projector: 'プロジェクター',
  pyro: '花火の台',
  seats: '客席',
  shore: '岸',
  rail: '手すり',
  crowd: '客',
};

/** Parts that are only scenery (岸・手すり・客): drawn, never cued. */
export function isSceneryPart(p: Part): p is Extract<Part, { kind: 'shore' | 'rail' | 'crowd' }> {
  return p.kind === 'shore' || p.kind === 'rail' || p.kind === 'crowd';
}

export interface VenueDoc {
  id: string;
  name: string;
  scale: ScaleTier;
  water: WaterShape;
  parts: Part[];
  /** Named targets written by hand; the parts' names add more after these. */
  selections?: Selection[];
  /** Camera angles; missing ones are made from the seats and the parts. */
  cameras?: (SeatDef & { note?: string })[];
  wind?: Vec3;
  patch?: Venue['patch'];
  note?: string;
}

const rad = (deg: number) => Math.PI * (deg / 180);

/** Where each fixture of a water part stands, before 外す / ずらす. */
export function partPositions(p: Part): Vec3[] {
  switch (p.kind) {
    case 'line':
      return along(p.count, p.from, p.to, 0);
    case 'band':
      return along(p.count, p.from, p.to, p.pitch);
    case 'arc':
      return arc(p.count, p.center[0], p.center[1], p.radius, rad(p.a0), rad(p.a1));
    case 'ring': {
      const a0 = rad(p.a0 ?? 0);
      return arc(p.count, p.center[0], p.center[1], p.radius, a0, a0 + (Math.PI * 2 * (p.count - 1)) / p.count);
    }
    case 'single':
      return [[p.at[0], 0, p.at[1]]];
    case 'pyro':
      return along(p.tubes, p.from, p.to, 0).map(([x, , z]) => [x, p.height, z]);
    default:
      return [];
  }
}

/**
 * A row from `from` to `to`. With a pitch, every other fixture steps back by
 * pitch/2, square to the row (behind it, seen from the audience, for a row
 * drawn left to right). Straight across the water this is shapes.ts's
 * line()/band() exactly.
 */
function along(n: number, from: [number, number], to: [number, number], pitch: number): Vec3[] {
  const [x0, z0] = from;
  const [x1, z1] = to;
  if (z0 === z1) return pitch ? band(n, x0, x1, z0, pitch) : line(n, x0, x1, z0);
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dz) || 1;
  return Array.from({ length: n }, (_, i) => {
    const f = i / Math.max(1, n - 1);
    const back = (i % 2) * pitch * 0.5;
    return [x0 + dx * f + (dz / len) * back, 0, z0 + dz * f - (dx / len) * back];
  });
}

/** A water part's fixtures as they stand: nudges applied, skipped ones gone. */
export function placed(p: Part): Vec3[] {
  return placedAt(p).map((f) => f.pos);
}

/** As placed(), each with its place in the array (before 外す). */
export function placedAt(p: Part): { i: number; pos: Vec3 }[] {
  const pos = partPositions(p);
  if (!('group' in p)) return pos.map((q, i) => ({ i, pos: q }));
  for (const { i, by } of p.nudge ?? []) {
    if (pos[i]) pos[i] = [pos[i][0] + by[0], pos[i][1], pos[i][2] + by[1]];
  }
  const skip = new Set(p.skip ?? []);
  return pos.map((q, i) => ({ i, pos: q })).filter((f) => !skip.has(f.i));
}

/** Water parts (列・帯・弧・円・1台). */
export function isWaterPart(p: Part): p is Extract<Part, { group: string }> {
  return 'group' in p;
}

export function buildVenue(doc: VenueDoc): Venue {
  const groups: GroupDef[] = [];
  const auto: Selection[] = [];
  const screens: ScreenDef[] = [];
  const pyro: PyroSite[] = [];
  let audience: AudienceEdge | undefined;
  const screenNames: (string | undefined)[] = [];
  let projector: Extract<Part, { kind: 'projector' }> | undefined;
  const scenery: Scenery = { shores: [], rails: [], crowds: [] };
  doc.parts.forEach((p, n) => {
    if (p.kind === 'shore') {
      const rim = !p.from || !p.to;
      scenery.shores.push({ rim, from: p.from ?? [0, 0], to: p.to ?? [0, 0], height: p.height, width: p.width });
    } else if (p.kind === 'crowd') {
      scenery.crowds.push({ from: p.from, to: p.to, depth: p.depth, density: p.density, pose: p.pose, seed: n });
    }
  });
  // a rail stands on the bank under its middle (after all the banks are known)
  for (const p of doc.parts) {
    if (p.kind !== 'rail') continue;
    const base = groundAt(scenery, doc.water, (p.from[0] + p.to[0]) / 2, (p.from[1] + p.to[1]) / 2) ?? 0;
    scenery.rails.push({ from: p.from, to: p.to, height: p.height, spacing: p.spacing, base });
  }
  for (const p of doc.parts) {
    if (isWaterPart(p)) {
      kind(p.fixture); // unknown kinds stop here, with the name
      let g = groups.find((x) => x.name === p.group);
      if (!g) groups.push((g = { name: p.group, kind: p.fixture, positions: [] }));
      else if (g.kind !== p.fixture) throw new Error(`グループ ${p.group} に別の種類（${g.kind} と ${p.fixture}）が混ざっています`);
      const start = g.positions.length;
      g.positions.push(...placed(p));
      if (p.name && g.positions.length > start) auto.push({ name: p.name, target: `${p.group}[${start}-${g.positions.length - 1}]` });
    } else if (p.kind === 'screen') {
      screens.push({ center: [p.center[0], 0, p.center[1]], width: p.width, height: p.height, dome: p.fixture === 'mound', group: p.fixture });
      screenNames.push(p.name);
    } else if (p.kind === 'projector') {
      projector ??= p; // one per venue: the first
    } else if (p.kind === 'pyro') {
      pyro.push({ name: p.site, kind: p.on, tubes: partPositions(p) });
    } else if (p.kind === 'seats') {
      audience = { from: [p.from[0], 0, p.from[1]], to: [p.to[0], 0, p.to[1]] };
    }
  }
  // a part that is its whole group needs no name of its own: the group is one
  for (const s of auto) {
    const g = groups.find((x) => s.target.startsWith(x.name + '['))!;
    if (s.target === `${g.name}[0-${g.positions.length - 1}]`) s.target = g.name;
  }
  // hand-written first; a part's name is added unless its name or its
  // target is already there
  const selections = [...(doc.selections ?? [])];
  for (const s of auto) {
    if (!selections.some((x) => x.name === s.name || x.target === s.target)) selections.push(s);
  }
  const venue: Venue = {
    id: doc.id,
    name: doc.name,
    scale: doc.scale,
    water: doc.water,
    groups,
    selections,
    screens,
    pyro,
    seats: [],
  };
  if (audience) venue.audience = audience;
  if (projector) {
    const covers = projector.covers;
    venue.projector = {
      at: [projector.at[0], projector.height, projector.at[1]],
      aim: [projector.aim[0], 0, projector.aim[1]],
      covers: screens.map((_, k) => k).filter((k) => !covers || (screenNames[k] !== undefined && covers.includes(screenNames[k]!))),
    };
  }
  if (doc.wind) venue.wind = doc.wind;
  if (scenery.shores.length || scenery.rails.length || scenery.crowds.length) venue.scenery = scenery;
  if (doc.patch) venue.patch = doc.patch;
  venue.seats = doc.cameras?.map(({ note: _, ...c }) => c) ?? autoCameras(venue);
  return venue;
}

/**
 * Camera angles for a venue that lists none: from the middle of the seats
 * (or in front of the fixtures), the whole venue from further back, and from
 * above. Heights and distances follow the fixtures' spread.
 */
export function autoCameras(v: Venue): SeatDef[] {
  const pts = [...v.groups.flatMap((g) => g.positions), ...v.screens.map((s) => s.center)];
  if (!pts.length) pts.push([0, 0, 0]);
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs), 0.5);
  const tall = 0.3 * span;
  const front = v.audience ? (v.audience.from[2] + v.audience.to[2]) / 2 : cz + span;
  const seatX = v.audience ? (v.audience.from[0] + v.audience.to[0]) / 2 : cx;
  const look: Vec3 = [cx, tall * 0.5, cz];
  // a camera that would sit inside a bank stands on it instead (at its
  // height over the bank); cameras above the ground stay where they were
  const lift = (s: SeatDef): SeatDef => {
    const g = groundAt(v.scenery, v.water, s.pos[0], s.pos[2]);
    return g !== null && s.pos[1] < g + 0.01 ? { ...s, pos: [s.pos[0], g + s.pos[1], s.pos[2]] } : s;
  };
  return ([
    { id: 'audience', label: '客席', pos: [seatX, Math.max(0.3, span * 0.08), front + span * 0.15], target: look, fov: 50 },
    { id: 'wide', label: '遠景', pos: [cx, span * 0.25, front + span * 0.8], target: look, fov: 44 },
    { id: 'eye', label: '目線', pos: [seatX, Math.max(0.05, span * 0.01), front], target: [cx, tall * 0.4, cz], fov: 54 },
    { id: 'left', label: '左', pos: [cx - span * 0.6, span * 0.08, front], target: look, fov: 48 },
    { id: 'right', label: '右', pos: [cx + span * 0.6, span * 0.08, front], target: look, fov: 48 },
    { id: 'aerial', label: '空撮', pos: [cx, span * 0.6, cz + span * 0.9], target: [cx, 0, cz], fov: 48 },
  ] as SeatDef[]).map(lift);
}
