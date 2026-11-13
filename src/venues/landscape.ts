import type { CrowdDef, Pt2, RailDef, ScaleTier, Scenery, ShoreDef, WaterShape } from './types';

/**
 * Where the scenery stands (2026-11-12): the banks' land, the ground's
 * height, the people of a crowd. Shared by the venue's parts (parts.ts), its
 * rules (rules.ts), the venue editor's top view and the 3D (show/scenery.ts),
 * so all four agree on every person.
 *
 * Sizes are the real ones, whatever the scale tier: a person is 1.5–1.9 m
 * tall at a desk too (SCENE_SIZE says why the desk has none).
 */

/**
 * What a new part of each kind starts with, per scale tier (the built-in
 * venues use the same numbers):
 * - 岸 lagoon: a promenade 0.8 m above the water (a park's revetment edge,
 *   about knee to hip high) with 6 m of paving; plaza: the paving round a
 *   floor fountain, flush (2 cm, only so it does not fight the water plane);
 *   garden: a lawn 3 cm over the pond with 25 cm stones on its rim (low, as
 *   a garden pond's edge; the garden's 目線 camera is 5 cm up); desk: the
 *   tank's 1 cm wall 1.5 cm over the water, the desk top level with it.
 * - 手すり 1.1 m, posts every 2 m (a guard rail along a quay; garden and desk
 *   have none, a plaza's floor fountain needs none).
 * - 客 standing 2 per m² (a full event crowd: shoulder to shoulder, about
 *   0.5 m²each), sitting on the ground 1 per m² (a picnic sheet each).
 *   The desk has no people: its seat is the one person at the desk, half a
 *   metre from the tank; anyone beside them would stand outside the frame or
 *   fill it as a blur, and small figurines would make the tank look like a
 *   model, which it is not. Its scenery is the tank's rim and the desk top.
 */
export const SCENE_SIZE: Record<ScaleTier, { shoreHeight: number; shoreWidth: number; railHeight: number; railSpacing: number; crowdDepth: number }> = {
  desk: { shoreHeight: 0.015, shoreWidth: 0.01, railHeight: 0.06, railSpacing: 0.1, crowdDepth: 1 },
  garden: { shoreHeight: 0.03, shoreWidth: 0.25, railHeight: 0.6, railSpacing: 1.2, crowdDepth: 1.5 },
  plaza: { shoreHeight: 0.02, shoreWidth: 2, railHeight: 1.1, railSpacing: 2, crowdDepth: 6 },
  lagoon: { shoreHeight: 0.8, shoreWidth: 6, railHeight: 1.1, railSpacing: 2, crowdDepth: 14 },
};
export const DENSITY = { stand: 2, sit: 1 } as const;

/** How far a bank's land runs back from the water (m): to the horizon, so no water shows behind the audience. */
export const LAND_FAR = 1200;
/** The most people one venue draws (rules.ts notes more). */
export const MAX_PEOPLE = 12_000;

// ---------------------------------------------------------------- water
/** Signed distance from [x, z] to the water's edge (m): negative on the water. Infinite water: -Infinity. */
export function sdWater(w: WaterShape, x: number, z: number): number {
  switch (w.kind) {
    case 'infinite':
      return -Infinity;
    case 'circle':
      return Math.hypot(x, z) - w.radius;
    default: {
      const r = w.kind === 'roundedRect' ? Math.min(w.radius, w.width / 2, w.depth / 2) : 0;
      const qx = Math.abs(x) - (w.width / 2 - r);
      const qz = Math.abs(z) - (w.depth / 2 - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - r;
    }
  }
}

/**
 * The water's edge pushed out by `off` metres, as a closed outline
 * (counter-clockwise seen from above with z down; n points per quarter turn
 * of a rounded corner). Infinite water has none.
 */
export function rimOutline(w: WaterShape, off = 0, n = 12): Pt2[] {
  if (w.kind === 'infinite') return [];
  const [hw, hd, r0] = w.kind === 'circle' ? [w.radius, w.radius, w.radius] : [w.width / 2, w.depth / 2, w.kind === 'roundedRect' ? Math.min(w.radius, w.width / 2, w.depth / 2) : 0];
  const r = r0 + off;
  const cx = hw - r0;
  const cz = hd - r0;
  const out: Pt2[] = [];
  const corners: [number, number, number][] = [
    [cx, cz, 0],
    [-cx, cz, Math.PI / 2],
    [-cx, -cz, Math.PI],
    [cx, -cz, (3 * Math.PI) / 2],
  ];
  const steps = r > 0 ? (w.kind === 'circle' ? n * 4 : n) : 0;
  for (const [x, z, a0] of corners) {
    if (!steps) {
      out.push([x + Math.sign(Math.cos(a0 + Math.PI / 4)) * off, z + Math.sign(Math.sin(a0 + Math.PI / 4)) * off]);
      continue;
    }
    const k = w.kind === 'circle' ? steps / 4 : steps;
    for (let i = 0; i <= k; i++) {
      const a = a0 + (Math.PI / 2) * (i / k);
      out.push([x + Math.cos(a) * r, z + Math.sin(a) * r]);
    }
  }
  // the quarter turns meet on one point
  return out.filter((p, i) => {
    const q = out[(i + 1) % out.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9;
  });
}

// ---------------------------------------------------------------- banks
/** A straight line's frame: unit direction, its normal toward the land (right of from → to, z down), length. */
export function lineFrame(from: Pt2, to: Pt2) {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const len = Math.hypot(dx, dz) || 1e-9;
  const t: Pt2 = [dx / len, dz / len];
  const n: Pt2 = [-t[1], t[0]];
  return { t, n, len };
}

/** Is [x, z] on this bank's land (behind the water's edge, out to LAND_FAR)? */
export function onShore(s: ShoreDef, w: WaterShape, x: number, z: number): boolean {
  if (s.rim) {
    const d = sdWater(w, x, z);
    return d >= 0 && d <= LAND_FAR;
  }
  const { t, n, len } = lineFrame(s.from, s.to);
  const px = x - s.from[0];
  const pz = z - s.from[1];
  const u = px * t[0] + pz * t[1];
  const v = px * n[0] + pz * n[1];
  return u >= 0 && u <= len && v >= 0 && v <= LAND_FAR;
}

/** Distance from [x, z] on this bank's land to its water's edge (m). */
export function shoreEdgeDistance(s: ShoreDef, w: WaterShape, x: number, z: number): number {
  if (s.rim) return sdWater(w, x, z);
  const { n } = lineFrame(s.from, s.to);
  return (x - s.from[0]) * n[0] + (z - s.from[1]) * n[1];
}

/** Top of the land at [x, z] (m above the water), or null where there is no bank (the water, or land with no bank drawn). */
export function groundAt(sc: Scenery | undefined, w: WaterShape, x: number, z: number): number | null {
  let top: number | null = null;
  for (const s of sc?.shores ?? []) if (onShore(s, w, x, z)) top = Math.max(top ?? -Infinity, s.height);
  return top;
}

/** Is [x, z] on land: on a bank, or outside water that has an edge? */
export function onLand(sc: Scenery | undefined, w: WaterShape, x: number, z: number): boolean {
  return groundAt(sc, w, x, z) !== null || (w.kind !== 'infinite' && sdWater(w, x, z) > 0);
}

/** Posts of a rail, evenly spaced, both ends included. */
export function railPosts(r: Pick<RailDef, 'from' | 'to' | 'spacing'>): Pt2[] {
  const { len } = lineFrame(r.from, r.to);
  const n = Math.max(1, Math.ceil(len / Math.max(r.spacing, 1e-3) - 1e-9));
  return Array.from({ length: n + 1 }, (_, i) => [r.from[0] + ((r.to[0] - r.from[0]) * i) / n, r.from[1] + ((r.to[1] - r.from[1]) * i) / n]);
}

// --------------------------------------------------------------- people
/** The band a crowd stands in: from, to, and the two corners `depth` behind them. */
export function crowdBand(c: Pick<CrowdDef, 'from' | 'to' | 'depth'>): Pt2[] {
  const { n } = lineFrame(c.from, c.to);
  const back = (p: Pt2): Pt2 => [p[0] + n[0] * c.depth, p[1] + n[1] * c.depth];
  return [c.from, c.to, back(c.to), back(c.from)];
}

export interface Person {
  x: number;
  z: number;
  /** Ground under the feet (m), 0 off the banks. */
  y: number;
  /** Standing height (m); a sitting person is drawn about 0.55 of it tall. */
  h: number;
  /** Shoulders' width as a share of the usual. */
  w: number;
  /** Heading (rad) the person faces, 0 = toward -z (the stage, from the lagoon's shore). */
  yaw: number;
  /** 0..1: how light the clothes are. */
  tone: number;
  sit: boolean;
  /** Which crowd (its place in Scenery.crowds). */
  crowd: number;
}

function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Everyone of one crowd, before any is left out: a staggered grid at the
 * density, jittered so it does not read as rows, each turned toward `focus`
 * (the middle of the fixtures) give or take a little. One in eight is a child.
 */
export function crowdPeople(c: CrowdDef, k: number, focus: Pt2, limit = MAX_PEOPLE): Person[] {
  const { t, n, len } = lineFrame(c.from, c.to);
  // rows as deep as the density's spacing (at least one), people along each
  // row as close as keeps the density
  const density = Math.max(c.density, 1e-3);
  const rows = c.depth > 0 ? Math.max(1, Math.round(c.depth * Math.sqrt(density))) : 0;
  const dv = c.depth / Math.max(rows, 1);
  const du = 1 / (density * dv);
  const r = rng(c.seed * 7919 + 17);
  const out: Person[] = [];
  for (let j = 0; j < rows && out.length < limit; j++) {
    const shift = (j % 2) * 0.5;
    for (let i = 0; ; i++) {
      const u0 = (i + 0.25 + shift) * du;
      if (u0 > len) break;
      const u = Math.min(len, Math.max(0, u0 + (r() - 0.5) * 0.55 * du));
      const v = Math.min(c.depth, Math.max(0, (j + 0.5) * dv + (r() - 0.5) * 0.5 * dv));
      const x = c.from[0] + t[0] * u + n[0] * v;
      const z = c.from[1] + t[1] * u + n[1] * v;
      const child = r() < 0.12;
      // adults about 1.66 m give or take 8 cm; children 1.05-1.35 m
      const g = (r() + r() + r() - 1.5) * 2;
      const h = child ? 1.05 + 0.3 * r() : Math.min(1.88, Math.max(1.5, 1.66 + 0.08 * g));
      const toward = Math.atan2(focus[0] - x, -(focus[1] - z));
      out.push({ x, z, y: 0, h, w: 0.9 + 0.25 * r(), yaw: toward + (r() - 0.5) * 0.45, tone: r(), sit: c.pose === 'sit', crowd: k });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Everyone the venue's crowds hold, standing on the ground; people over the water are left out. */
export function venuePeople(sc: Scenery | undefined, w: WaterShape, focus: Pt2): Person[] {
  const out: Person[] = [];
  (sc?.crowds ?? []).forEach((c, k) => {
    for (const p of crowdPeople(c, k, focus, MAX_PEOPLE - out.length)) {
      const g = groundAt(sc, w, p.x, p.z);
      if (g === null && (w.kind === 'infinite' || sdWater(w, p.x, p.z) <= 0)) continue;
      p.y = g ?? 0;
      out.push(p);
    }
  });
  return out;
}

/** The middle of what stands on the water, [x, z]; people face it. */
export function focusOf(points: Pt2[]): Pt2 {
  if (!points.length) return [0, 0];
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
}
