import type { NozzleSpec, NozzleType } from '../core/nozzles';
import type { Layout } from '../show/layout';
import type { Cue, ParamKey } from '../show/types';

/**
 * The fixture table (docs/editor-architecture.md 4.3): what each kind of
 * fixture is, in one place. A venue (src/venues/) says which kinds stand
 * where and how many; everything about the kind itself is here — its lane,
 * the inspector's sections, the nozzle it fires, and the numbers the venue
 * editor's rules read (where it may stand, how close, how much water).
 *
 * Adding a kind = adding one entry to water.ts / screen.ts / pyro.ts and
 * listing it in index.ts.
 */

/** Folders of the timeline (one per kind of show element). */
export type Folder = 'water' | 'screen' | 'pyro';

/** The inspector's sections for a cue of this kind, in order. */
export type CueSection = 'zone' | 'set' | 'motion' | 'clip' | 'macro' | 'fire';

/** Where a fixture can stand. */
export type Ground = 'water' | 'barge' | 'land';

export interface NozzleUse {
  type: NozzleType;
  /** Over the nozzle preset (src/fixtures/water.ts NOZZLES). */
  spec: Partial<NozzleSpec>;
  /** Particle slots and mist sprites per fixture at 'high' quality. */
  spray: number;
  mist: number;
  /** Column ribbons per sub-jet. */
  strands: number;
  /** For shots: how long one burst lasts at most (s). */
  burst?: number;
}

export interface Placement {
  /** Where it may stand. */
  on: Ground[];
  /**
   * Nearest two of this kind may stand (m), centre to centre. Closer stops
   * the venue editor (docs/dev-plan.md F, step 1). 仮 values: sources in the
   * entries.
   */
  spacing: number;
  /** Water at full pressure (L/s): per fixture, or per metre of width (screens). */
  flow: number;
  flowPer: 'unit' | 'metre';
  /**
   * Farthest from upright any of its jets can point (deg), head travel and
   * the jets' own opening together. With the apex height it gives where the
   * water lands (2h·sin2θ, fountain-physics 4) for the venue rules.
   */
  lean: number;
}

export interface FixtureKind {
  id: string;
  /** Lane name in the timeline. */
  name: string;
  /** Name in the venue editor's list of what can be placed. */
  label: string;
  folder: Folder;
  /** Lane colours: block fill for cues without a colour, lane header accent. */
  lane: { base: string; accent: string };
  /** Water fixtures: the nozzle and its particle budget. */
  nozzle?: NozzleUse;
  cue: {
    sections: CueSection[];
    /** The set values the inspector offers (default: all); a value a cue already sets is always shown. */
    params?: ParamKey[];
    /** Highest value the inspector offers, where it is not the parameter's own. */
    max?: Partial<Record<ParamKey, number>>;
    /** What a target counts: fixtures (台) or fireworks tubes (本の筒). */
    unit: 'fixtures' | 'tubes';
    /** A new cue made by double-clicking the lane, without its time. */
    newCue: (group: string, layout: Layout) => Omit<Cue, 't'>;
  };
  place: Placement;
}
