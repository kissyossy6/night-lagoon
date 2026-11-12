import { TYPE_ID, flightTime, headTurns, type NozzleSpec, type NozzleType } from '../core/nozzles';
import { NOZZLES, kind } from '../fixtures';
import { LAGOON, type Vec3, type Venue } from '../venues';

/**
 * Fixture layout of the show, built from a venue (src/venues/; the lagoon
 * after World of Color by default). Metres; x stage right, y up, z toward
 * the audience.
 */

export interface Fixture {
  index: number;
  group: string;
  /** The kind of fixture (src/fixtures/, e.g. 'grid', 'desk-jet'). */
  kind: string;
  type: NozzleType;
  /**
   * Whether the head turns: pan and tilt lean the water and the drawn head.
   * From the kind (NozzleUse.turns, else the type's headTurns); every reader
   * (the water, the haze, the editor's outline and picking, the head-speed
   * limit, refitting, the drawn bodies) asks this, not the type.
   */
  turns: boolean;
  spec: NozzleSpec;
  position: [number, number, number];
  /** Particle slots (spray) and mist sprites given to this fixture. */
  spray: number;
  mist: number;
  /** Column ribbons per sub-jet. */
  strands: number;
  /** Seconds of flight the particles must cover. */
  life: number;
  /** Seconds of full-pressure emission one slot cycle covers (see JetField). */
  slotSpan: number;
}

export interface Layout {
  fixtures: Fixture[];
  groups: Record<string, number[]>;
  /** Controllable channels: every fixture, the water screens, then the projector's zones (last). */
  channels: number;
  screenIndex: number;
  /** Water screen: centre, width, height. */
  screen: { center: [number, number, number]; width: number; height: number };
  /** Every mist screen, each a cue channel: the wide sheet, then the three mounds. */
  screens: ScreenUnit[];
  /**
   * The projector behind the screens, one channel per zone ('projector',
   * 'projector[1-1]'): only intensity is used. Empty without screens.
   */
  projector: ProjectorZone[];
  /** Where the projector stands (behind the screens, low, throwing toward the audience). */
  projectorAt: [number, number, number];
  venue: Venue;
  /** Named targets ('@前列' in a cue) -> the plain target notation. */
  selections: Record<string, string>;
  /** Fireworks tubes, apart from the water channels (src/pyro/schedule.ts). */
  tubes: Tube[];
  /** 'pyro' (every tube) and 'pyro:<site>' -> tube indices. */
  pyroGroups: Record<string, number[]>;
}

export interface Tube {
  index: number;
  site: string;
  position: [number, number, number];
}

/**
 * One mist screen. The wide sheet spans the lagoon; the three mounds (left,
 * centre, right) are World of Color's small hills of mist, the centre one
 * tallest (docs/video-review.md R8). All share one projected panorama.
 */
export interface ScreenUnit {
  index: number;
  center: [number, number, number];
  width: number;
  height: number;
  dome: boolean;
  /** The projector lights it (Venue.projector.covers). */
  lit: boolean;
}

/**
 * One zone of the projector (docs/reports/2026-11-08-screen/projector.md).
 * The projector throws one panorama from behind the screens; the mist only
 * catches it. Its brightness is set per zone, a column of the panorama
 * (world x, metres) that holds one mound, like World of Color's fixed,
 * edge-blended projectors (docs/show-knowledge/k4-light-screen.md S8).
 */
export interface ProjectorZone {
  index: number;
  x0: number;
  x1: number;
}
/** Width (m) over which two zones of the projector blend into each other. */
export const ZONE_BLEND = 3;

/**
 * The projector's zones for a venue's screens: one per mound, split halfway
 * between neighbouring mounds and running out to the widest screen's ends;
 * one zone when there are no mounds; none without screens.
 */
function projectorZones(all: ScreenUnit[], first: number, moundIdx: Set<number>): ProjectorZone[] {
  // only the screens the projector lights
  const screens = all.filter((u) => u.lit);
  if (!screens.length) return [];
  const lo = Math.min(...screens.map((u) => u.center[0] - u.width / 2));
  const hi = Math.max(...screens.map((u) => u.center[0] + u.width / 2));
  const mounds = screens.filter((u) => moundIdx.has(u.index)).sort((a, b) => a.center[0] - b.center[0]);
  if (!mounds.length) return [{ index: first, x0: lo, x1: hi }];
  return mounds.map((m, k) => ({
    index: first + k,
    x0: k === 0 ? lo : (mounds[k - 1].center[0] + mounds[k - 1].width / 2 + m.center[0] - m.width / 2) / 2,
    x1: k === mounds.length - 1 ? hi : (m.center[0] + m.width / 2 + mounds[k + 1].center[0] - mounds[k + 1].width / 2) / 2,
  }));
}

/** A zone's brightness at world x: zone values blended across the zone edges. */
export function zoneAt(zones: ProjectorZone[], values: number[], x: number): number {
  if (!zones.length) return 0;
  let v = values[0];
  for (let k = 1; k < zones.length; k++) {
    const u = Math.min(1, Math.max(0, (x - zones[k].x0) / ZONE_BLEND + 0.5));
    v += (values[k] - values[k - 1]) * u;
  }
  return v;
}

/** The zones a screen's mist stands in. */
export function zonesOfScreen(zones: ProjectorZone[], u: ScreenUnit): ProjectorZone[] {
  if (!u.lit) return [];
  const a = u.center[0] - u.width / 2;
  const b = u.center[0] + u.width / 2;
  return zones.filter((z) => Math.min(b, z.x1) - Math.max(a, z.x0) > ZONE_BLEND);
}

/**
 * How big this fixture's water is drawn, against the lagoon's (stage 7, B7
 * drawing only). Drop, mist, haze and glow sizes were made for 10–75 m jets;
 * a 10 cm desk jet drawn with 5 cm drops and 50 cm mist turned the whole view
 * white. Below 10 m every drawn size shrinks with the jet's height; at 10 m
 * and over (every lagoon fixture) it is exactly 1, so the lagoon is unchanged.
 *   size: mist, haze, glow pools, foam width
 *   drop: spray drops; real drops stay about a millimetre at least, so they
 *         stop shrinking at 3% (1 mm)
 */
export const SIZE_REF_HEIGHT = 10;
export function drawScale(height: number): { size: number; drop: number } {
  const size = Math.min(1, height / SIZE_REF_HEIGHT);
  return { size, drop: Math.max(size, 0.03) };
}

/** Particle budget multiplier per quality tier. */
export type Quality = 'high' | 'medium' | 'low' | 'export';
/** 'export' (stage 7 H1): only for video and Vision Pro exports, three times the drops. */
export const QUALITY_SCALE: Record<Quality, number> = { high: 1, medium: 0.55, low: 0.25, export: 3 };

export function buildLayout(venue: Venue = LAGOON, quality: Quality = 'high'): Layout {
  const scale = QUALITY_SCALE[quality];
  const fixtures: Fixture[] = [];
  const groups: Record<string, number[]> = {};
  for (const g of venue.groups) {
    groups[g.name] = [];
    const k = kind(g.kind);
    const n = k.nozzle;
    if (!n) throw new Error(`'${g.kind}' は噴水の種類ではありません (グループ ${g.name})`);
    for (const pos of g.positions) {
      const spec: NozzleSpec = { ...NOZZLES[n.type], ...n.spec, ...g.spec, origin: pos, pressure: 0 };
      const life = flightTime({ ...spec, pressure: 1 });
      const index = fixtures.length;
      fixtures.push({
        index,
        group: g.name,
        kind: g.kind,
        type: n.type,
        turns: n.turns ?? headTurns(n.type),
        spec,
        position: pos,
        spray: Math.max(16, Math.round(n.spray * scale)),
        mist: Math.max(4, Math.round(n.mist * scale)),
        strands: n.strands,
        life,
        // continuous jets cycle their slots once per flight; shots pack all
        // slots into one burst so a 1 s shot is as dense as a steady jet
        slotSpan: n.burst ?? life,
      });
      groups[g.name].push(index);
    }
  }
  // the water screens are cue-controlled like fixtures: pressure = height
  // fraction, intensity = projection brightness. Channels follow the
  // venue's order; the wide sheet ('screen') comes first
  const screenIndex = fixtures.length;
  const screens: ScreenUnit[] = venue.screens.map((d, k) => ({
    index: screenIndex + k,
    center: d.center,
    width: d.width,
    height: d.height,
    dome: d.dome,
    lit: !venue.projector || venue.projector.covers.includes(k),
  }));
  for (const [k, d] of venue.screens.entries()) (groups[d.group] ??= []).push(screenIndex + k);
  const wide = venue.screens.find((d) => d.group === 'screen') ?? venue.screens[0];
  // a venue without screens (a desk basin, a garden pond) still has a frame
  // for the projector maths; nothing is drawn with it
  const screen = wide ? { center: wide.center, width: wide.width, height: wide.height } : { center: [0, 0, 0] as Vec3, width: 1, height: 0 };
  const projectorIndex = screenIndex + screens.length;
  const projector = projectorZones(screens, projectorIndex, new Set(groups.mound ?? []));
  if (projector.length) groups.projector = projector.map((z) => z.index);
  const tubes: Tube[] = [];
  const pyroGroups: Record<string, number[]> = { pyro: [] };
  for (const site of venue.pyro) {
    const own: number[] = (pyroGroups[`pyro:${site.name}`] = []);
    for (const position of site.tubes) {
      own.push(tubes.length);
      pyroGroups.pyro.push(tubes.length);
      tubes.push({ index: tubes.length, site: site.name, position });
    }
  }
  return {
    fixtures,
    groups,
    channels: projectorIndex + projector.length,
    screenIndex,
    screen,
    screens,
    projector,
    // rear projection: behind the wide sheet, low (the lagoon: 40 m behind, 1.5 m up)
    projectorAt: venue.projector ? ([...venue.projector.at] as [number, number, number]) : ([screen.center[0], 1.5, screen.center[2] - 40] as [number, number, number]),
    venue,
    selections: Object.fromEntries(venue.selections.map((v) => [v.name, v.target])),
    tubes,
    pyroGroups,
  };
}

export { TYPE_ID };
