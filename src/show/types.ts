/**
 * Show data model. A show is a list of timed cues (JSON). Cues set nozzle
 * parameters on groups; macros expand into plain cues when the show loads.
 */

export type Ease = 'linear' | 'in' | 'out' | 'inOut' | 'step';

/** Controllable parameters of one fixture. Angles in degrees. */
export interface Params {
  pressure: number; // 0..1, maps to height
  pan: number; // tilt toward +x (stage right), deg
  tilt: number; // tilt toward the audience (+z), deg
  color: string; // LED ring colour, #rrggbb
  intensity: number; // LED ring brightness 0..1+
}

export type ParamKey = keyof Params;
export const PARAM_KEYS: ParamKey[] = ['pressure', 'pan', 'tilt', 'color', 'intensity'];

/** Order in which a stagger walks the target nozzles. */
export type Order = 'index' | 'reverse' | 'center' | 'edges' | 'random';

export type MacroName = 'wave' | 'chase' | 'pulse' | 'bloom' | 'sway' | 'rainbow' | 'spread' | 'lean' | 'follow';

/**
 * Scenes of the water-screen projection (src/screen/projection.ts), each
 * drawn for the song section of the same name.
 */
export type SceneName = 'intro' | 'awakening' | 'theme' | 'story' | 'build' | 'finale' | 'coda' | 'rhapsody' | 'jazz';

/** How a video fills the very wide screen (116 m x 15 m). */
export type VideoFit = 'cover' | 'contain' | 'stretch';

/**
 * What the projector shows from a cue on, until the next cue with a clip:
 * a scene played from its start (plus `from` seconds), a video file from
 * `from` seconds, or 'sync', the picture that belongs to the show time.
 * Before the first clip the projector follows the show time.
 */
export interface Clip {
  scene: SceneName | 'sync' | 'video';
  /** scene 'video': the file, relative to the page ("videos/boat.mp4"). */
  src?: string;
  from?: number;
  /** scene 'video': how the picture fills the screen; default 'cover'. */
  fit?: VideoFit;
  /**
   * A drawn scene played on its own, like a media server's clip: the scenes
   * that overlap it in the show's picture (the story's boat fading out under
   * the build's light) are left out. Default: drawn as the show time has it.
   */
  alone?: boolean;
}

/** Kinds of aerial shell (src/pyro/shells.ts). */
export type ShellName = 'botan' | 'kiku' | 'yanagi' | 'yashi' | 'ring' | 'senrin' | 'strobe' | 'comet' | 'mine';

/**
 * How a cue's lean is shared out (src/pyro/schedule.ts):
 * - fan: each tube leans by where it stands in the row, -spread/2 at the
 *   left end to +spread/2 at the right, all at once
 * - v: the left half leans left, the right half right (a V)
 * - x: the left half leans right, the right half left (they cross)
 * - sweep-lr / sweep-rl / sweep-out: the shots go off in turn, interval
 *   apart, stepping through the fan left to right, right to left, or from
 *   the middle outward. A run (count > 1) steps through its shots on each
 *   tube; single shots step through the tubes.
 */
export type FirePattern = 'fan' | 'v' | 'x' | 'sweep-lr' | 'sweep-rl' | 'sweep-out';

/**
 * Fireworks: one shell (or a run of them) from the tubes a cue targets. The
 * cue's t is when the shell bursts; the launch is worked out from the rise
 * time (src/pyro/schedule.ts).
 */
export interface Fire {
  shell: ShellName;
  /** Size in 号 (2.5..10). */
  size: number;
  /** 1..3 colours; the 2nd and 3rd are colour changes as the stars burn. */
  colors: string[];
  /** Shells in a run from each tube (default 1). */
  count?: number;
  /** Seconds between the shells of a run (default 0.25). */
  interval?: number;
  /** Lean along the row of tubes (deg, + toward stage right). */
  angle?: number;
  /**
   * Lean toward the audience (deg, + toward the audience, - away). Toward the
   * audience is shown as a red warning (src/pyro/schedule.ts).
   */
  tilt?: number;
  /** How the tubes of a cue (or the shots of a run) share out their lean, on top of angle and tilt. */
  pattern?: FirePattern;
  /** The pattern's width (deg, the outermost leans are +-spread/2; default ANGLE.spread). */
  spread?: number;
  /** Seed of the look; default from the cue's index. */
  seed?: number;
  /**
   * How strongly the burst lights the sky around it in its colour for a
   * moment (default SKY_GLOW = 0.1 in src/pyro/shells.ts; 1 is the
   * comparison lab's idea 2 in full; 0 none).
   */
  glow?: number;
  /**
   * Seconds each star burns, for this cue only (default the kind's,
   * SHELLS[shell].burn in src/pyro/shells.ts). The 千輪's little shells keep
   * their own.
   */
  burn?: number;
}

export interface Cue {
  /** Seconds, or "bar:beat" (1-based, beat may be fractional). */
  t: number | string;
  /** Group name, range "grid[0-15]", or comma list "whip,fan". */
  target: string;
  set?: Partial<Params>;
  dur?: number;
  ease?: Ease;
  stagger?: number;
  order?: Order;
  macro?: MacroName;
  args?: Record<string, number | string>;
  /** Water screens only: switch the projected picture. */
  clip?: Clip;
  /** Fireworks tubes only ('pyro', 'pyro[0-4]', '@奥の台'): fire shells. */
  fire?: Fire;
  label?: string;
}

export interface ShowFile {
  /**
   * File format; missing means 1 (before venues). 3: the picture's brightness
   * is the projector's ('projector' cues); older files put it on the screens
   * and are converted when compiled (src/show/projector.ts).
   */
  version?: 2 | 3;
  /** Venue id (src/venues/); missing means the lagoon. */
  venue?: string;
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** Seconds of audio before bar 1 beat 1. */
  offset: number;
  duration: number;
  cues: Cue[];
  /** Named stretches for the timeline and the player (src/show/sections.ts); missing means the song's form. */
  sections?: ShowSection[];
  /**
   * The project's own music (docs/music-plan.md), kept in its folder
   * (projects/<id>/<file>). Missing: the shared recording (public/music/background.*,
   * Rhapsody in Blue), its sections and its story on the screen.
   */
  music?: ShowMusic;
}

/** A project's own music file. */
export interface ShowMusic {
  /** The stored file's name in the project's folder (music-<hash>.<ext>). */
  file: string;
  /** The name it was picked with, for people. */
  name: string;
  /** Its length in seconds. */
  duration: number;
}

/** One named stretch of a show: starts at `t` seconds, ends where the next one starts. */
export interface ShowSection {
  name: string;
  t: number;
  /** Band colour; missing picks one from the palette. */
  color?: string;
}

/** Named song sections (bar numbers 1-based, end exclusive). */
export interface Section {
  name: string;
  from: number;
  to: number;
}
