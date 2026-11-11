import type { NozzleSpec } from '../core/nozzles';

/**
 * A venue: everything a show is placed in — the water, the fixtures and how
 * they are grouped, the mist screens, the seats. Metres; x stage right, y up,
 * z toward the audience (as in show/layout.ts).
 */

export type Vec3 = [number, number, number];

/**
 * One row of fixtures of one kind (a cue target group, e.g. 'grid'). What
 * the kind is — its nozzle, particles, lane, placement rules — is the
 * fixture table (src/fixtures/); the venue only says where they stand.
 */
export interface GroupDef {
  name: string;
  /** A kind of the fixture table ('grid', 'whip'…). */
  kind: string;
  positions: Vec3[];
  /** Tweaks over the kind's nozzle for this venue only. */
  spec?: Partial<NozzleSpec>;
  /** Lane name, when it is not the kind's. */
  label?: string;
}

/** How a group shows as an editor lane (made from the fixture table by lanesOf()). */
export interface LaneStyle {
  group: string;
  name: string;
  /** Block fill for cues without a colour. */
  base: string;
  /** Accent used for the lane header. */
  accent: string;
}

/** A named target, used in cues as '@name'. */
export interface Selection {
  name: string;
  /** A target in the plain notation, e.g. 'grid[0-87]'. */
  target: string;
}

/** A seat / camera angle. */
export interface SeatDef {
  id: string;
  label: string;
  pos: Vec3;
  target: Vec3;
  /** Vertical field of view (deg). */
  fov: number;
  /**
   * A window narrower than this shape (width ÷ height) keeps the width the
   * seat shows at this shape: it sees more sky and water instead of cutting
   * the sides. Wider windows use fov as it is. For seats whose subject is
   * wide, like the fireworks seats (set where it would reach the sides).
   */
  fitWidth?: number;
}

/** A mist screen; each is one cue channel of its group. */
export interface ScreenDef {
  center: Vec3;
  width: number;
  height: number;
  dome: boolean;
  group: 'screen' | 'mound';
}

/** A row of fireworks tubes; cues name it 'pyro:<name>' or by a selection. */
/**
 * The projector behind the screens (src/show/layout.ts ProjectorZone): where
 * it stands, the point it faces, and which screens it lights (by their place
 * in Venue.screens). A venue with screens and no projector gets one 40 m
 * behind the wide sheet, lighting every screen.
 */
export interface ProjectorDef {
  at: Vec3;
  aim: Vec3;
  covers: number[];
}

export interface PyroSite {
  name: string;
  kind: 'barge' | 'land';
  tubes: Vec3[];
}

/** The front edge of the audience, for the fireworks' safety distance. */
export interface AudienceEdge {
  from: Vec3;
  to: Vec3;
}

export type WaterShape =
  | { kind: 'infinite' }
  | { kind: 'rect'; width: number; depth: number }
  | { kind: 'circle'; radius: number }
  | { kind: 'strip'; width: number; depth: number }
  | { kind: 'roundedRect'; width: number; depth: number; radius: number };

export type ScaleTier = 'desk' | 'garden' | 'plaza' | 'lagoon';

export interface Venue {
  id: string;
  name: string;
  scale: ScaleTier;
  water: WaterShape;
  groups: GroupDef[];
  selections: Selection[];
  screens: ScreenDef[];
  /** Missing: the default one (see ProjectorDef). */
  projector?: ProjectorDef;
  pyro: PyroSite[];
  /** Nearest the audience stands; missing means the seats are used. */
  audience?: AudienceEdge;
  /** Wind over the venue (m/s), which carries the smoke; default a light breeze. */
  wind?: Vec3;
  seats: SeatDef[];
  /**
   * DMX addresses chosen by hand, per group ('grid', 'screen'…): the group's
   * first fixture starts there and the rest follow on. Groups not named are
   * patched after them automatically (src/export/control/profiles.ts).
   */
  patch?: Record<string, { universe: number; address: number }>;
}
