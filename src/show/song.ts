import type { Section } from './types';

/**
 * Timing contract shared by the music, the choreography and the projection.
 *
 * The music is a recording (public/music/background.mp3: Rhapsody in Blue by
 * the US Marine Band, its first 176.5 s cut into the piece's last 30 s at a
 * hit, scripts/splice-ending.py), not a click track, so
 * the show is laid out in seconds against landmarks measured from it (MUSIC).
 * The 120 BPM bar grid (bar = 2 s) stays only as an authoring unit for the
 * timeline editor and the generated scores (?music=score|original).
 */
export const BPM = 120;
export const BEATS_PER_BAR = 4;
export const SECONDS_PER_BAR = (60 / BPM) * BEATS_PER_BAR;
/**
 * The last chord rings out in a hall until about 210 s (the recording ends at
 * 214.3); the show runs on until the last water is down (~213) and the pilot
 * lights have shown.
 */
export const SHOW_DURATION = 217;
/** The two generated scores (?music=score|original) were composed for 180 s. */
export const SCORE_DURATION = 180;

/**
 * Landmarks of the recording (s), from its loudness envelope (0.25 s RMS):
 * onsets are rises of 6 dB or more over the previous 2 s.
 */
export const MUSIC = {
  /** the clarinet's opening trill; its glissando tops out ~5 s */
  trill: 0.94,
  /** the solo ends and the music almost stops before the orchestra */
  hush: 44.0,
  /** the orchestra joins under the clarinet's theme */
  orchestra: 45.25,
  orchestra2: 49.0,
  /** first tutti, loud until 76 */
  tutti: 62.25,
  /** the music falls away for half a second (65.4-65.95)... */
  breath1: 65.4,
  /** ...and the brass lifts the theme (+10 dB): the tutti's real swell */
  lift: 66.03,
  /** the music drops to a quieter interlude */
  interlude: 76.5,
  /** almost silent for half a second before the second tutti */
  dip: 90.5,
  /** second tutti, the biggest rise (+10 dB), loud until 112 */
  tutti2: 92.25,
  /** the second tutti's second climb, after a short dip at 106 */
  climb: 106.63,
  /** the second tutti lets go and fades into the story */
  release: 111.5,
  /** short dip, then piano and band, moderate */
  piano: 115.0,
  /** a short rising phrase after the story, before the break */
  phrase: 157.76,
  /** near-silent break */
  pause: 160.5,
  /** the loud passage that runs to the end (+20 dB onset) */
  finale: 162.75,
  /** the finale grows from the bass alone to the full band */
  surge: 166.94,
  /** a one-beat dip in the finale (not an onset: never snapped) */
  breath: 169.0,
  /** the second wave of the finale */
  wave2: 170.83,
  /** its loudest moment */
  climax: 174.0,
  /** a second hit inside the loudest moment */
  hit2: 175.12,
  /**
   * The edit: the recording jumps from 176.5 s to the piece's ending (1046 s
   * of the full recording, in another key) and lands on this hit
   */
  last: 176.59,
  /** after a breath (177.5-178.4) the ending's first wave enters */
  grand: 178.59,
  /**
   * the geyser gate stands on the chorus's entry: tried on its second phrase
   * (180.94) on 2026-10-27, but the music's rise is here and the user put it
   * back. 180.94 stays a strong attack of the chorus if wanted again
   */
  gate: 178.54,
  /** hammered chords, the ending's loudest moment (182.05-183.75) */
  hammer: 182.05,
  /** the band holds on, a step lower, in phrases (184-192.5) */
  settle: 184.1,
  /** a near-silent beat before the last climb */
  gap: 192.6,
  /** the last climb begins */
  home: 193.41,
  /** the climb's chords, each louder (201.44, 202.58, 203.76) */
  steps: [201.44, 202.58, 203.76],
  /** the final chord */
  chord: 205.99,
  /** the chord's attack is over; it rings out until ~210 (splice-ending.py) */
  fade: 206.6,
} as const;

/**
 * The story's events on the music (measured from the recording), shared by
 * the projection (src/screen/projection.ts) and the fountains: the boat sails
 * in with the piano figure, the fireflies gather after the strong note at
 * 130.5, the lanterns light on the swell and rise after 145, and the boat's
 * lantern flies to the moon on the story's climax, which flares at its top.
 */
export const STORY_BEATS = {
  boatIn: 120.5,
  fireflies: 130.5,
  lanternsLit: 136.0,
  lanternsRise: 145.5,
  fly: 150.8,
  flare: 152.92,
} as const;

/**
 * The finale's second wave recalls the show's colours in order, one colour
 * on the whole stage at a time (World of Color and Expo 2025 both run their
 * finale colour this way, docs/show-knowledge/v3-structure.md): the
 * awakening's cyan, the first tutti's pink, the second tutti's purple.
 * Shared with the projection so the mounds change with the fountains.
 */
export const FINALE_STEPS: { t: number; color: string }[] = [
  { t: 169.5, color: '#00b4ff' },
  { t: MUSIC.wave2, color: '#ff4fd0' },
  { t: 172.52, color: '#c03cff' },
];
/** The finale colour on stage at time t (red-orange before the steps). */
export function finaleColor(t: number): string {
  let c = '#ff3000';
  for (const s of FINALE_STEPS) if (t >= s.t) c = s.color;
  return c;
}

/**
 * The Fantasia version's opening picture (src/screen/rhapsody.ts): a white
 * line on blue draws the city with the clarinet, an homage to the look of
 * Fantasia 2000's Rhapsody in Blue drawn from memory (no frames of the film).
 * It is not a section of the show time, so it lives far past the end of the
 * show and screen cues reach it with a clip.
 */
export const RHAPSODY_AT = 1000;
export const RHAPSODY = {
  /** the pen enters with the glissando and tops the tallest spire at its top note */
  penIn: 1.5,
  peak: 5.0,
  /** the skyline is finished */
  drawn: 7.2,
  /** the solo's strong notes (measured): the sun flares, rivets spark */
  hits: [19.04, 26.28, 32.12, 35.05],
  /** the picture lets go with the solo */
  end: 44.0,
  length: 47,
} as const;

/**
 * The Fantasia version's interlude picture on the three mounds (rhapsody.ts,
 * clip scene 'jazz'): three lit windows of the evening city, one per mound,
 * lit on the interlude's phrases (measured: quiet and low from 76.5, a
 * brighter voice at 80.5, the swell peaks at 83-83.5 and falls at 85.5).
 * Times are show seconds; the picture is played from a clip at 'at'.
 */
export const JAZZ_AT = RHAPSODY_AT + 100;
export const JAZZ = {
  at: 76,
  /** the pianist (left), the trumpeter (right), the dancers (centre) */
  left: 78.0,
  right: 80.5,
  centre: 82.5,
  /** the dancer spins on the swell's top */
  spin: 83.0,
  /** the windows go out right, left, centre */
  out: [85.4, 85.8, 86.2],
  length: 14,
} as const;

/** Seconds → (fractional) bar on the authoring grid. */
const bar = (t: number) => t / SECONDS_PER_BAR + 1;

export const SECTIONS: Section[] = [
  { name: 'intro', from: 1, to: bar(16) }, // 0-16 s      clarinet trill, glissando, theme
  { name: 'awakening', from: bar(16), to: bar(MUSIC.tutti) }, // 16-62 s   the orchestra joins at 45 s
  { name: 'theme', from: bar(MUSIC.tutti), to: bar(MUSIC.piano) }, // 62-115 s  two tuttis around a quiet interlude
  { name: 'story', from: bar(MUSIC.piano), to: bar(158.5) }, // 115-158 s piano and band, water screen
  { name: 'build', from: bar(158.5), to: bar(MUSIC.finale) }, // 158-163 s the break, in the dark
  { name: 'finale', from: bar(MUSIC.finale), to: bar(MUSIC.last) }, // 163-176.6 s
  { name: 'ending', from: bar(MUSIC.last), to: bar(MUSIC.fade) }, // 176.6-206.6 s the piece's ending
  { name: 'coda', from: bar(MUSIC.fade), to: bar(SHOW_DURATION) + 0.0001 }, // 206.6-217 s the chord rings out, the water drops, the pilot lights
];

/**
 * The bar-based form the two generated scores were composed in
 * (src/audio/score.ts, original-score.ts), for their audio check.
 */
export const SCORE_SECTIONS: Section[] = [
  { name: 'intro', from: 1, to: 9 },
  { name: 'awakening', from: 9, to: 25 },
  { name: 'theme', from: 25, to: 41 },
  { name: 'story', from: 41, to: 57 },
  { name: 'build', from: 57, to: 65 },
  { name: 'finale', from: 65, to: 81 },
  { name: 'coda', from: 81, to: 91 },
];

export function barToSeconds(bar: number, beat = 1): number {
  return (bar - 1) * SECONDS_PER_BAR + (beat - 1) * (60 / BPM);
}

/** Start (s) of the projection scene drawn for a section, or NaN. */
export function sceneStart(name: string): number {
  if (name === 'rhapsody') return RHAPSODY_AT;
  if (name === 'jazz') return JAZZ_AT;
  const s = SECTIONS.find((x) => x.name === name);
  return s ? barToSeconds(s.from) : NaN;
}

export function sectionAt(t: number): { section: Section; progress: number } {
  const b = bar(t);
  const s = SECTIONS.find((x) => b >= x.from && b < x.to) ?? SECTIONS[SECTIONS.length - 1];
  return { section: s, progress: Math.min(1, Math.max(0, (b - s.from) / (s.to - s.from))) };
}
