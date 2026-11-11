import type { MusicFeatures, Onset } from '../audio/analysis';
import { hanabiFireworks } from './hanabi';
import { BEATS_PER_BAR, BPM, FINALE_STEPS, JAZZ, MUSIC, RHAPSODY, SHOW_DURATION, STORY_BEATS } from './song';
import { cueTime, toProjector } from './cues';
import { buildLayout } from './layout';
import type { Cue, Params, ShowFile } from './types';

/**
 * The show: three and a half minutes against the background recording
 * (Rhapsody in Blue cut to its ending, public/music/background.mp3). Written as a small program
 * that emits plain JSON cues, so the timeline editor can take over from the
 * generated file.
 *
 * Two layers of timing:
 *   - scenes sit on landmarks of the recording (MUSIC in src/show/song.ts):
 *     colours, darkness, the water screen, the three geyser hits
 *   - inside a scene the water follows the waveform (src/audio/analysis.ts):
 *     the floor's height follows the music's loudness ('follow') in a shape
 *     set per scene (front low, back high), the front band pops and the
 *     chasers fire on its strong attacks. The whips change formation once
 *     per phrase, on times measured from the recording
 * Without the analysis (the editor, tests) the floor holds the middle of its
 * range and the chasers fire every two seconds.
 * The plan behind each scene, and what each peak shows for the first time,
 * is in docs/show-plan.md.
 *
 *   0-16      intro: pilot lights, one pair of centre whips rises with the
 *             clarinet's glissando
 *   16-44     awakening: cyan + green light accents; the floor low, the
 *             whips widen from two to eight
 *   44-62     the orchestra: the back band and twelve whips; half a second
 *             of dark before the tutti. Chasers, fans, flowers, geysers and
 *             the outer whips are kept for 62 (docs/show-plan.md)
 *   62-76     first tutti: geyser hit (0.7 high), the whole whip line, fans; pink + white
 *   76-92     quiet interlude: only the whip line, deep purple, over pilot
 *             lights; dark through the dip
 *   92-112    second tutti, the first peak: a ripple of the floor and a gold
 *             vortex on the crash, left and right answering the attacks, a
 *             sweep of the whole whip line with the fans; purple + gold
 *   112-115   the floor gathers from the edges into the dark
 *   115-155   story on the wide water screen, framed by whip arches; one gold
 *             flower opens under the moon when it flares
 *   155-163   the break: the story's last picture lingers on the centre
 *             mound, then two seconds of true dark on the silence
 *   163-177   finale (docs/show-plan.md): geyser hit and red-orange on the
 *             bass alone, the full band at 167, the show's colours recalled
 *             one at a time with the mounds at 169.5, half a second of dark,
 *             a gold peak at 174
 *   176.6-206.6 the piece's ending (the recording is cut into it at 176.5):
 *             two calm seconds with only the sun rising, then the chorus
 *             in blue with the eight-geyser gate and its hammered chords, a step
 *             down, then the last climb draining the colour to white, and
 *             the final chord as all the water at once in plain white
 *   206.5-213.5 the chord rings out: every straight jet stands with the ten
 *             geysers until they top out, then all the water drops at once
 *   213.5-217 the opening's cyan pilot lights
 *
 * Three versions share this program (SHOW_VARIANTS):
 *   lagoon    the show above, as built and reviewed on 2026-10-26
 *   fantasia  the same show with a picture-led opening and the first tutti's
 *             colour moved to the music's real swell (docs/show-plan.md):
 *     0-44    the water screen is the actor: a white line on blue draws the
 *             city with the clarinet and the city wakes (src/screen/rhapsody.ts,
 *             an homage to Fantasia 2000's Rhapsody in Blue). The water only
 *             frames it: blue pilot lights, a low footlight in the middle of
 *             the front band, gold flecks when the riveter's sparks fly
 *     62.53   the whole whip line opens its fan in the orchestra's cyan; no
 *             colour change, no geysers yet
 *     65-66   the lights sink with the music's half-second hush...
 *     66.03   ...and the brass lifts the theme: pink, the whips cross, the fans
 *     67.9    the geysers on the cymbal crash
 *     76-89   the interlude is the three mounds': a lit window of the evening
 *             city on each (pianist, trumpeter, dancers), lit on the phrases.
 *             Four whips stand as pillars in the gaps between the mounds; the
 *             pilot lights under each mound warm as its window lights
 *     91.6-94 the second tutti grows with the music: the gold whips rise lit
 *             from the centre on the pickup and fan out as they rise; the
 *             floor ripples low on 92.1 and steps up with the vortex at 94.1
 *     69-74   light and shade in the first tutti: phrase C drops back to the
 *             whips' lean wave, phrase D builds to the loudest note
 *     94-106  the piano runs step across the floor, left and right in turn,
 *             while the rest steps back; everything up only at the climb
 */

export type ShowVariant = 'lagoon' | 'fantasia' | 'hanabi';
/**
 * The one list of the versions: the player's ?show= and start-screen title, the
 * editor's ファイル ▾ menu and its restore notice all read it, so a new version
 * is added here only. short = its name in menus, note = what the menu adds.
 */
export const SHOW_VARIANTS: { id: ShowVariant; label: string; title: string; short: string; note?: string }[] = [
  { id: 'lagoon', label: 'Rhapsody in Blue (今の演出)', title: 'Rhapsody in Blue', short: 'Rhapsody in Blue', note: '今の演出' },
  { id: 'fantasia', label: 'ファンタジア版 (映像の冒頭・1:06 の色替え)', title: 'Rhapsody in Blue — Fantasia', short: 'ファンタジア版' },
  // Night Lagoon's water with fireworks over its finale (src/show/hanabi.ts)
  { id: 'hanabi', label: '花火版 (Rhapsody in Blue＋フィナーレの花火)', title: 'Rhapsody in Blue — 花火', short: '花火版' },
];

/** The version a ?show= value names, else Night Lagoon. */
export function variantOf(id: string | null): ShowVariant {
  return SHOW_VARIANTS.find((v) => v.id === id)?.id ?? 'lagoon';
}

const C = {
  cyan: '#00b4ff',
  blue: '#1e3cff',
  deep: '#0a1aff',
  green: '#3cff5a',
  purple: '#c03cff',
  magenta: '#ff2fb0',
  red: '#ff3000',
  orange: '#ff7a00',
  gold: '#ffb000',
  white: '#ffffff',
  pink: '#ff4fd0',
};

// three bands of two staggered rows (src/show/layout.ts); staggers on the grid
// are per nozzle, so they are half what a single row of 44 would use
const ROW = { front: 'grid[0-87]', mid: 'grid[88-175]', back: 'grid[176-263]' };
const ARC = { left: 'chaser[0-19]', right: 'chaser[20-39]', ring: 'chaser[40-55]', arcs: 'chaser[0-39]' };
const M = MUSIC;
/** The centre mound's gathering light in the break (projector brightness; 0.9 read too faint, 2026-11-08). */
const BREAK_LIGHT = 1.4;
/** Seconds from the final drop until the water is down and the pilot lights wake. */
const PILOT_AFTER_DROP = 4.3;

const round = (t: number) => Math.round(t * 1000) / 1000;
/**
 * The piano's runs in the second tutti (measured from the recording: notes
 * 0.07-0.17 s apart), and the band of the floor that plays each.
 */
const PIANO_RUNS: [number, number, 'front' | 'mid'][] = [
  [94.45, 95.5, 'front'],
  [96.6, 97.25, 'front'],
  [99.7, 101.95, 'mid'],
  [103.35, 105.7, 'front'],
];
/** Every 'step' seconds from a until b (exclusive). */
const every = (a: number, b: number, step: number) => Array.from({ length: Math.max(0, Math.ceil((b - a) / step - 1e-6)) }, (_, i) => a + i * step);

export function buildShow(music?: MusicFeatures, variant: ShowVariant = 'lagoon'): ShowFile {
  const FANT = variant === 'fantasia';
  const cues: Cue[] = [];
  const set = (t: number, target: string, s: Partial<Params>, dur = 0, extra: Partial<Cue> = {}) =>
    cues.push({ t: round(t), target, set: s, dur, ...extra });
  const macro = (t: number, target: string, m: Cue['macro'], args: Cue['args'], extra: Partial<Cue> = {}) =>
    cues.push({ t: round(t), target, macro: m, args, ...extra });
  const off = (t: number, target: string, dur = 1, extra: Partial<Cue> = {}) => set(t, target, { pressure: 0 }, dur, extra);

  // --------------------------------------------------------- music timing
  /**
   * Onsets of the music in [a, b) at least 'min' strong, at least 'gap'
   * seconds apart (the stronger wins a clash). Without the analysis: every
   * 'gap' (at least 2) seconds.
   */
  const onsets = (a: number, b: number, min: number, gap: number): number[] => {
    if (!music) return every(a, b, Math.max(gap, 2));
    const pool = music.onsets.filter((o) => o.t >= a && o.t < b && o.strength >= min);
    const out: Onset[] = [];
    for (const o of pool) {
      const last = out[out.length - 1];
      if (last && o.t - last.t < gap) {
        if (o.strength > last.strength) out[out.length - 1] = o;
      } else out.push(o);
    }
    return out.map((o) => o.t);
  };
  /** The strongest onset within ±win of t (the landmark itself without one). */
  const snap = (t: number, win = 0.4): number => {
    if (!music) return t;
    let best: Onset | null = null;
    for (const o of music.onsets) if (Math.abs(o.t - t) <= win && (!best || o.strength > best.strength)) best = o;
    return best ? round(best.t) : t;
  };
  /**
   * The front band pops on the music's strong attacks, on top of the
   * envelope it follows (which takes over again a quarter second later).
   */
  const pops = (a: number, b: number, min = 0.6) => {
    if (!music) return;
    for (const t of onsets(a, b, min, 0.5)) macro(t, ROW.front, 'pulse', { hold: 0.12, level: 0.95, rest: 0.5, attack: 0.03 }, { stagger: 0.002, order: 'center' });
  };
  /** One channel of a group following an envelope (fixed level without the analysis). */
  const follow = (a: number, b: number, target: string, curve: string, min: number, max: number) => {
    if (music) macro(a, target, 'follow', { curve, min, max, dur: b - a });
    else set(a, target, { pressure: (min + max) / 2 }, 1);
  };
  /**
   * Chasers on the music's onsets, alternating the arcs; the ring on every
   * third, in the same colour unless told otherwise (a white ring leaves a
   * grey mist pillar in the middle of the scene's colour).
   */
  const chases = (times: number[], color: string, speed = 30, ring = color) =>
    times.forEach((t, i) => {
      macro(t, i % 2 ? ARC.right : ARC.left, 'chase', { speed, hold: 0.25 }, { set: { color, intensity: 1 } });
      if (i % 3 === 0) macro(t, ARC.ring, 'chase', { speed: speed + 2, hold: 0.25 }, { set: { color: ring, intensity: 1 } });
    });

  /**
   * A piano run as water: the band steps across the stage, one slice per
   * note of the run (its onsets; every 0.15 s without the analysis), left
   * to right or right to left. The band sits low under it.
   */
  const pianoRun = (a: number, b: number, row: string, rtl: boolean) => {
    const first = Number(row.match(/\[(\d+)-/)![1]);
    const N = 88;
    let notes = music ? onsets(a, b, 0.25, 0.07) : every(a, b, 0.15);
    if (notes.length < 4) notes = every(a, b, (b - a) / 8);
    set(a - 0.2, row, { pressure: 0.06, intensity: 0.45 }, 0.3);
    notes.forEach((t, i) => {
      const k0 = Math.floor((i * N) / notes.length);
      const k1 = Math.max(k0, Math.floor(((i + 1) * N) / notes.length) - 1);
      const [s0, s1] = rtl ? [N - 1 - k1, N - 1 - k0] : [k0, k1];
      const slice = `grid[${first + s0}-${first + s1}]`;
      macro(t, slice, 'pulse', { hold: 0.22, level: 1, rest: 0.1, attack: 0.04 }, { set: { intensity: 1.7 } });
      set(t + 0.3, slice, { intensity: 0.45 }, 0.9);
    });
  };
  /** The floor between the runs: back up and following the music. */
  const floorBetween = (a: number, b: number) => {
    if (b - a < 0.3) return;
    set(a, 'grid', { intensity: 0.6 }, 0.3);
    follow(a, b, ROW.front, 'level', 0.2, 0.6);
    follow(a, b, ROW.mid, 'level', 0.3, 0.7);
    follow(a, b, ROW.back, 'level', 0.4, 0.85);
    pops(a + 0.2, b - 0.3, 0.75);
  };

  // ------------------------------------------------------------ intro 0-16
  // Small and in one place, as Bellagio and Dubai open (docs/show-plan.md):
  // pilot lights on a dark lagoon, then a single pair of centre whips rises
  // with the clarinet's glissando - the show's first actor - and sways with
  // its theme. The middle of the front band wakes under it. Nothing else.
  const CENTRE = { pair: 'whip[11-12]', four: 'whip[10-13]', eight: 'whip[8-15]', twelve: 'whip[6-17]' };
  const FRONT_MID = 'grid[29-58]'; // the middle third of the front band
  // every ring is dark until its nozzle is used: a lit ring over still water
  // shows as a dotted circle in the dark scenes
  set(0, 'whip,chaser,geyser,fan,flower', { intensity: 0 });
  if (FANT) {
    // ------------------------------------------ Fantasia opening 0-44
    // The picture is the actor (docs/show-plan.md): the wide screen is up
    // before the trill and a white line on blue draws the city with the
    // clarinet. The water only frames it - blue pilot lights, and a low
    // footlight in the middle of the front band that breathes with the solo
    // and warms to gold with the picture's sunrise. Once the picture becomes
    // water: the riveter's sparks on the solo's strong notes jump in it.
    // (LED colour takes 0.6 s, too slow for a spark: the colour changes with
    // the dawn and the sparks are height and light.)
    set(0, 'grid', { color: C.blue, intensity: 0.7 });
    set(0, 'screen', { pressure: 0, intensity: 1 });
    set(0, 'screen', { pressure: 1 }, 1.4, { ease: 'out', clip: { scene: 'rhapsody' } });
    for (const row of [ROW.front, ROW.mid, ROW.back]) set(0, row, { pressure: 0.04 }, 1.5, { stagger: 0.008, order: 'center' });
    set(3, 'grid', { color: C.deep, intensity: 0.5 }, 2);
    set(8, FRONT_MID, { color: C.blue, intensity: 0.6 }, 1.5);
    follow(8, M.hush, FRONT_MID, 'level', 0.06, 0.2);
    set(17, FRONT_MID, { color: C.gold, intensity: 0.5 }, 6, { ease: 'inOut' });
    for (const t of RHAPSODY.hits.slice(1).map((h) => snap(h, 0.2))) {
      macro(t, FRONT_MID, 'pulse', { hold: 0.12, level: 0.4, rest: 0.1, attack: 0.03 }, { set: { intensity: 1.3 }, stagger: 0.004, order: 'center' });
      set(t + 0.2, FRONT_MID, { intensity: 0.5 }, 0.9);
    }
    // the city lets go with the solo; the mist sinks before the orchestra
    set(M.hush, 'screen', { pressure: 0 }, 2.5, { ease: 'in' });
    set(RHAPSODY.length, 'screen', { intensity: 1 }, 0, { clip: { scene: 'sync' } });
  } else {
    set(0, 'grid', { color: C.cyan, intensity: 0.9 });
    set(0, 'screen', { pressure: 0, intensity: 1 });
    for (const row of [ROW.front, ROW.mid, ROW.back]) set(0, row, { pressure: 0.04 }, 1.5, { stagger: 0.008, order: 'center' });
    set(3, 'grid', { color: C.deep, intensity: 0.6 }, 2);
    set(M.trill, CENTRE.pair, { pan: 0, tilt: 0, color: C.white, intensity: 0.9 });
    set(M.trill + 0.6, CENTRE.pair, { pressure: 0.65 }, 3.4, { ease: 'in' }); // up with the glissando, top at ~5 s
    set(5, CENTRE.pair, { color: C.cyan }, 1.5);
    follow(6, 16, CENTRE.pair, 'level', 0.45, 0.7);
    macro(7, CENTRE.pair, 'sway', { amp: 8, period: 6, dur: 9 });
    set(8, FRONT_MID, { color: C.cyan, intensity: 0.8 });
    set(8, FRONT_MID, { pressure: 0.15 }, 3, { stagger: 0.03, order: 'center' });

    // ------------------------------------------------------- awakening 16-44
    // Cyan with green as the one accent. The floor comes up low across the
    // front and middle bands, and the whips widen from two to four to eight as
    // the solo goes on. Its strongest notes are answered with light, not water:
    // the middle band flashes green. Chasers, fans, flowers, the back band and
    // the outer whips are kept for the orchestra and the first tutti.
    set(16, ROW.front, { color: C.cyan, intensity: 0.9 }, 2);
    set(16, ROW.mid, { color: C.cyan, intensity: 0.7 }, 2);
    follow(16, 43.5, ROW.front, 'level', 0.08, 0.4);
    follow(18, 43.5, ROW.mid, 'level', 0.05, 0.3);
    set(16, CENTRE.four, { pan: 0, color: C.cyan, intensity: 0.9 });
    set(16, CENTRE.four, { pressure: 0.55 }, 2, { stagger: 0.4, order: 'center' });
    follow(18, 30, CENTRE.four, 'level', 0.4, 0.65);
    macro(18, CENTRE.four, 'sway', { amp: 12, period: 8, dur: 11 });
    set(29, 'whip[8-9],whip[14-15]', { pan: 0, color: C.cyan, intensity: 0.9 });
    set(29, 'whip[8-9],whip[14-15]', { pressure: 0.5 }, 1.5, { stagger: 0.3, order: 'center' });
    follow(30.5, 43.5, CENTRE.eight, 'level', 0.4, 0.7);
    macro(snap(32.12), CENTRE.eight, 'spread', { from: -20, to: 20, dur: 1.5 }); // a small fan
    macro(snap(35.05), CENTRE.eight, 'spread', { from: 20, to: -20, dur: 2 }); // and a small cross
    set(40, CENTRE.eight, { pan: 0 }, 2);
    for (const t of onsets(17, 43.5, 0.9, 3)) {
      set(t, ROW.mid, { color: C.green, intensity: 1.2 }, 0.05);
      set(t + 0.1, ROW.mid, { color: C.cyan, intensity: 0.7 }, 1.2, { ease: 'out' });
    }
  }

  // ---------------------------------------------------------- hush 44-45
  // The solo ends and the music almost stops: the floor sinks back to the
  // middle of the front band and the whips to the centre pair.
  set(M.hush, ROW.mid, { pressure: 0 }, 1.5);
  set(M.hush, ROW.front, { pressure: 0 }, 1.5);
  set(M.hush, FRONT_MID, { pressure: 0.12 }, 1.5);
  set(M.hush, CENTRE.eight, { pressure: 0 }, 1.5);
  if (!FANT) set(M.hush, CENTRE.pair, { pressure: 0.45 }, 1.5);

  // ----------------------------------------------------- orchestra 45-62
  // Green comes in from the back. The whips widen to twelve with the
  // orchestra, the floor builds band by band, the front band pops on its
  // attacks from 50 and the whips open and cross on the strongest. Still no
  // chasers, fans or flowers. Half a second before the tutti the lights go
  // out while the water keeps running.
  const T1 = snap(M.tutti);
  set(M.orchestra, CENTRE.twelve, { pan: 0, color: C.green, intensity: 0.9 });
  set(M.orchestra, CENTRE.twelve, { pressure: 0.6 }, 3, { stagger: 0.25, order: 'center' });
  follow(M.orchestra2, T1 - 0.6, CENTRE.twelve, 'level', 0.5, 0.85);
  set(M.orchestra, ROW.front, { color: C.cyan, intensity: 0.9 });
  follow(M.orchestra + 1, T1 - 0.6, ROW.front, 'level', 0.1, 0.55);
  set(M.orchestra2, ROW.back, { color: C.green, intensity: 0.9 });
  follow(M.orchestra2, T1 - 0.6, ROW.back, 'low', 0.05, 0.6);
  set(M.orchestra2 + 3, ROW.mid, { color: C.cyan, intensity: 0.8 });
  follow(M.orchestra2 + 3, T1 - 0.6, ROW.mid, 'level', 0.05, 0.5);
  pops(50.5, T1 - 2, 0.75);
  macro(snap(50.92), CENTRE.twelve, 'spread', { from: -30, to: 30, dur: 1.5 });
  macro(snap(55.57), CENTRE.twelve, 'spread', { from: 30, to: -30, dur: 1.8 });
  macro(snap(57.81), CENTRE.twelve, 'lean', { angle: 25, dur: 1.3, hold: 0.3, back: 0 }, { stagger: 0.05 });
  if (!FANT) {
    set(T1 - 0.5, 'grid,whip', { intensity: 0 }, 0.06);
    set(T1, 'grid,whip', { intensity: 1 }, 0.05);
  }

  // ------------------------------------------------------- first tutti 62-76
  // Pink with white (the geysers): three of the cards the opening kept back -
  // a geyser hit, the whole whip line, the fans. Gold, the chasers and the
  // flowers' crown wait for the second tutti, so the two peaks look
  // different (docs/reviews/2026-10-26-after.md). The whips change shape
  // once per phrase of the music, not on every attack (docs/show-plan.md):
  // a fan on the hit, a cross when the brass takes the theme after the
  // one-beat breath at 66, a lean wave left to right, then back. Each move
  // is slow enough for the heads (2 x angle / 90 deg/s). The floor keeps one
  // shape (front low, back high) and its height follows the music.
  const PHRASE = [66.5, 69.42, 72.34]; // measured from the recording
  // the geyser hits climb through the show: 0.7 here, 0.8 at the finale,
  // all ten at full height on the last hit
  // Fantasia: the colour, the geysers and the fans wait for the brass's
  // swell at 66.03, after the music's half-second hush (the user found pink
  // on 62.5 sudden); at 62.53 the whole whip line opens in the orchestra's cyan
  const LIFT = FANT ? snap(M.lift, 0.2) : T1;
  // Fantasia: the geysers wait a little longer, for the cymbal crash at 67.9
  // (the user found them early on 66.03; the high band jumps at 67.9)
  const CYMBAL = FANT ? snap(67.9, 0.15) : T1;
  macro(CYMBAL, 'geyser[0-9:3]', 'pulse', { hold: 1.2, level: 0.7 }, { set: { color: C.white } });
  if (FANT) {
    set(T1, 'whip', { color: C.cyan, pressure: 0.9, intensity: 1.2 }, 0.3);
    set(T1, 'grid', { intensity: 0.7 }, 0.3);
    // the lights sink with the music (dimming takes 0.9 s) and come up pink
    set(M.breath1 - 0.5, 'grid,whip', { intensity: 0.3 }, 0.9, { ease: 'out' });
  }
  // (Fantasia: the colour turns while the lights are low - LED colour takes
  // 0.6 s - so the light comes up already pink)
  const HUE = FANT ? LIFT - 0.45 : T1;
  set(HUE, 'grid', { color: C.pink }, 0.3);
  set(HUE, ROW.back, { color: C.magenta }, 0.3);
  set(HUE, 'whip', { color: C.pink }, 0.3);
  set(LIFT, 'whip', { pressure: 1, intensity: 1.35 }, FANT ? 0.12 : 0.3); // the actors: brighter than the floor
  macro(T1, 'whip', 'spread', { from: -50, to: 50, dur: 1.2 });
  macro(FANT ? LIFT : PHRASE[0], 'whip', 'spread', { from: 40, to: -40, dur: 2 });
  macro(PHRASE[1], 'whip', 'lean', { angle: 35, dur: 1.7, back: 'stay' }, { stagger: 0.04 });
  macro(PHRASE[2], 'whip', 'lean', { angle: -35, dur: 1.6, back: 'stay' }, { stagger: 0.04, order: 'reverse' });
  if (FANT) {
    set(LIFT, 'fan', { pressure: 1, color: C.magenta, intensity: 1 }, 0.2);
  } else {
    set(T1, 'fan', { pressure: 1, color: C.magenta, intensity: 1 }, 1);
    off(65.75, 'fan', 0.25); // the fans breathe with the music at 66
    set(PHRASE[0], 'fan', { pressure: 1 }, 0.2);
  }
  set(LIFT, 'grid', { intensity: 0.55 }, FANT ? 0.12 : 0.3); // the floor stays under the whips
  if (FANT) {
    // Fantasia: light and shade by phrase (the user: everything fired big
    // the whole time). The music stays loud, so the shade comes from the
    // texture: phrase B full (pink, the geysers on the cymbal); phrase C
    // drops back - the floor low, the fans closed, the whips' lean wave
    // alone; phrase D builds again to the loudest note at 74.21.
    const [B, Cp, D] = PHRASE;
    follow(T1, Cp, ROW.front, 'level', 0.25, 0.6);
    follow(T1, Cp, ROW.mid, 'level', 0.4, 0.75);
    follow(T1, Cp, ROW.back, 'level', 0.55, 0.9);
    pops(T1 + 0.5, Cp - 0.3, 0.7);
    follow(Cp, D, ROW.front, 'level', 0.06, 0.2);
    follow(Cp, D, ROW.mid, 'level', 0.06, 0.25);
    follow(Cp, D, ROW.back, 'level', 0.1, 0.35);
    set(Cp, 'grid', { intensity: 0.4 }, 0.9);
    off(Cp - 0.1, 'fan', 0.25);
    set(Cp, 'whip', { pressure: 0.85 }, 0.6);
    follow(D, M.interlude - 0.5, ROW.front, 'level', 0.15, 0.6);
    follow(D, M.interlude - 0.5, ROW.mid, 'level', 0.3, 0.75);
    follow(D, M.interlude - 0.5, ROW.back, 'level', 0.45, 0.95);
    set(D, 'grid', { intensity: 0.6 }, 0.3);
    set(D, 'fan', { pressure: 1 }, 0.2);
    set(D, 'whip', { pressure: 1 }, 0.4);
    pops(D + 0.3, M.interlude - 0.5, 0.7);
    void B;
  } else {
    follow(T1, M.interlude - 0.5, ROW.front, 'level', 0.25, 0.6);
    follow(T1, M.interlude - 0.5, ROW.mid, 'level', 0.4, 0.75);
    follow(T1, M.interlude - 0.5, ROW.back, 'level', 0.55, 0.9);
    pops(T1 + 0.5, M.interlude - 0.5, 0.7);
  }

  // --------------------------------------------------- interlude 76-92
  // The valley after the first tutti, in one place only (Bellagio and Dubai
  // narrow their quiet verses to one spot): the floor sinks back to purple
  // pilot lights and only the whip line stays, low and swaying together. The
  // back band gathers with the music to 83.5 in magenta and lets go. Then
  // everything stops early enough to be dark through the dip (a 30 m whip
  // takes ~5 s to fall), and the lights go out on what is still falling.
  set(M.interlude - 0.5, 'grid', { color: C.purple, intensity: 0.8 }, 1.5);
  for (const row of [ROW.front, ROW.mid, ROW.back]) set(M.interlude - 0.5, row, { pressure: 0.04 }, 2, { stagger: 0.008, order: 'edges' });
  // the whips turn back in the dark and come up purple once the leaned
  // water of the tutti has fallen (~3 s)
  set(M.interlude - 0.5, 'whip', { intensity: 0 }, 0.3);
  set(M.interlude - 0.5, 'whip', { pan: 0 }, 1);
  if (FANT) {
    // Fantasia: the mounds' windows are the actors (docs/show-plan.md). The
    // mist rises in the dark as the music drops; each window lights on its
    // phrase and the pilot lights under its mound warm with it (picture ->
    // water). Only the four whips in the gaps between the mounds stand, as
    // purple pillars; the rest would cut through the pictures.
    const PILLARS = 'whip[6-7],whip[16-17]';
    const UNDER = { left: 'grid[4-17]', centre: 'grid[35-52]', right: 'grid[70-83]' };
    off(M.interlude - 0.5, 'whip', 1);
    off(M.interlude - 0.5, 'fan', 0.25);
    set(M.interlude - 0.5, 'fan', { intensity: 0 }, 0.3);
    set(JAZZ.at, 'mound', { pressure: 0, intensity: 0 });
    set(JAZZ.at + 0.5, 'mound', { pressure: 1 }, 2.5, { ease: 'out', clip: { scene: 'jazz' } });
    set(JAZZ.at + 1, 'mound', { intensity: 1 }, 1.5);
    set(M.interlude + 3, PILLARS, { color: C.purple, intensity: 0.8 }, 1.5);
    follow(M.interlude, 85.5, PILLARS, 'level', 0.35, 0.55);
    for (const [t, under] of [
      [JAZZ.left, UNDER.left],
      [JAZZ.right, UNDER.right],
      [JAZZ.centre, UNDER.centre],
    ] as const) {
      set(t - 0.6, under, { color: C.gold }, 0.6);
      set(t, under, { pressure: 0.12, intensity: 1 }, 0.6);
    }
    // the back band breathes under the swell, low enough to keep the
    // windows clear
    set(80, ROW.back, { color: C.magenta, intensity: 0.7 }, 1);
    follow(80.5, 86, ROW.back, 'level', 0.04, 0.3);
    off(85.5, PILLARS, 0.5);
    // the windows go out (rhapsody.ts), then the mist sinks into the dark
    for (const [i, under] of [UNDER.right, UNDER.left, UNDER.centre].entries()) set(JAZZ.out[i], under, { pressure: 0.04, intensity: 0.8 }, 0.5);
    set(JAZZ.out[2] + 0.3, 'mound', { pressure: 0 }, 2.5, { ease: 'in' });
    set(88.5, 'mound', { intensity: 0 }, 0.9);
    set(JAZZ.at + JAZZ.length, 'mound', { intensity: 0 }, 0, { clip: { scene: 'sync' } });
  } else {
    set(M.interlude + 3, 'whip', { color: C.purple, intensity: 0.8 }, 1.5);
    follow(M.interlude, 85.5, 'whip', 'level', 0.3, 0.6);
    macro(M.interlude + 1, 'whip', 'sway', { amp: 15, period: 8, dur: 8 });
    off(M.interlude - 0.5, 'fan', 0.25);
    set(M.interlude - 0.5, 'fan', { intensity: 0 }, 0.3);
    set(80, ROW.back, { color: C.magenta, intensity: 0.9 }, 1);
    follow(80.5, 86, ROW.back, 'level', 0.04, 0.7);
    off(85.5, 'whip', 0.5);
  }
  for (const row of [ROW.front, ROW.mid, ROW.back]) off(86.5, row, 0.5, { stagger: 0.008, order: 'edges' });
  set(89.5, 'grid,whip', { intensity: 0 }, 0.3);

  // ----------------------------------------------------- second tutti 92-112
  // The biggest rise of the music and the show's first peak, played with
  // cards the first tutti kept back (docs/show-plan.md). Like 62.53 and
  // 174.29, the water stands in the dark before the hit - the whips already
  // in their fan, the floor low - so the light finds a shape on the beat
  // (unlit water is all but invisible). The crash is then a ring of light
  // and height running out from the centre, and a gold vortex on the ring;
  // the dense attacks are answered left and right in turn; the second climb
  // is a sweep of the whole whip line with the fans. A purple floor, the
  // actors in gold.
  const T2 = snap(M.tutti2);
  const CLIMB = snap(M.climb, 0.2);
  const END = M.release;
  /** the top of the second tutti's entry (Fantasia), measured */
  const TOP = snap(94.1, 0.2);
  if (FANT) {
    // Fantasia: the entry grows with the music instead of appearing whole on
    // 92.1 (the user found it sudden). The music is not one crash: a pickup
    // at 91.6, hits at 92.1, 92.5 and 93.3, and its top at 94.1-94.5. The
    // gold whips rise lit from the centre outward on the pickup and open
    // their fan as they rise; the floor answers 92.1 with a low ripple and
    // only steps up, with the gold vortex, on the top at 94.1.
    const PICKUP = snap(91.6, 0.2);
    set(89.8, 'whip', { pan: 0, color: C.gold }); // unseen: no water, no light
    set(PICKUP, 'whip', { pressure: 0.9 }, 1.0, { stagger: 0.1, order: 'center' });
    set(PICKUP, 'whip', { intensity: 1.2 }, 0.4, { stagger: 0.1, order: 'center' });
    macro(T2, 'whip', 'spread', { from: -45, to: 45, dur: 1.6 });
    set(T2 - 1, ROW.front, { color: C.purple });
    set(T2 - 1, ROW.mid, { color: C.purple });
    set(T2 - 1, ROW.back, { color: C.magenta });
    for (const row of [ROW.front, ROW.mid, ROW.back]) {
      set(T2, row, { intensity: 0.45 }, 0.1, { stagger: 0.025, order: 'center' });
      macro(T2, row, 'pulse', { hold: 0.15, level: 0.55, rest: 0.2, attack: 0.04 }, { stagger: 0.025, order: 'center' });
    }
    follow(T2 + 1.2, TOP, ROW.front, 'level', 0.12, 0.35);
    follow(T2 + 1.2, TOP, ROW.mid, 'level', 0.18, 0.45);
    follow(T2 + 1.2, TOP, ROW.back, 'level', 0.25, 0.55);
    // the top: the floor steps up to the tutti's level and the vortex turns
    set(TOP, 'grid', { intensity: 0.6 }, 0.12);
    macro(TOP, ARC.ring, 'chase', { speed: 24, hold: 0.25, laps: 3 }, { set: { color: C.gold, intensity: 1 } });
    // TOP..CLIMB: the piano runs, below
  } else {
    // in the dark: the whips rise and open their fan, the floor stands low
    set(T2 - 2.1, 'whip', { pressure: 0.9, color: C.gold }, 1);
    macro(T2 - 1.8, 'whip', 'spread', { from: -45, to: 45, dur: 1.2 });
    for (const row of [ROW.front, ROW.mid, ROW.back]) set(T2 - 1.5, row, { pressure: 0.3 }, 0.8);
    set(T2 - 1.5, ROW.front, { color: C.purple });
    set(T2 - 1.5, ROW.mid, { color: C.purple });
    set(T2 - 1.5, ROW.back, { color: C.magenta });
    // on the beat: the gold fan appears at once; the floor's light and a pulse
    // of height run out from the centre (~1.1 s to the ends)
    set(T2, 'fan', { intensity: 1 }, 0.05);
    for (const row of [ROW.front, ROW.mid, ROW.back]) {
      set(T2, row, { intensity: 0.6 }, 0.1, { stagger: 0.025, order: 'center' }); // the floor stays under the gold whips
      macro(T2, row, 'pulse', { hold: 0.15, level: 0.95, rest: 0.35, attack: 0.04 }, { stagger: 0.025, order: 'center' });
    }
    macro(T2, ARC.ring, 'chase', { speed: 24, hold: 0.25, laps: 3 }, { set: { color: C.gold, intensity: 1 } });
    // the whips are the actors here: gold, the brightest thing on stage
    set(T2, 'whip', { intensity: 1.2 }, 0.05);
    follow(T2 + 1.4, CLIMB, ROW.front, 'level', 0.2, 0.6);
    follow(T2 + 1.4, CLIMB, ROW.mid, 'level', 0.3, 0.7);
    follow(T2 + 1.4, CLIMB, ROW.back, 'level', 0.4, 0.85);
    pops(T2 + 1, CLIMB - 0.5, 0.75);
  }
  // call and response: each strong attack is answered by one half of the
  // whip line leaning outward and the arc on its side running outward,
  // left, right, left...
  const HALF = { left: 'whip[0-11]', right: 'whip[12-23]' };
  set(95.5, 'whip', { pan: 0 }, 1);
  if (FANT) {
    // Fantasia: the piano's runs (measured, PIANO_RUNS) are the actors. On
    // each the rest steps back - the whips lower, the floor sinks - and a
    // band of the floor steps across the stage, one slice per note, left to
    // right then right to left in turn. Between the runs the floor follows
    // the music again, and only the strongest hits get the whips' call and
    // response and the gold chasers. The climb at 106.63 is then the first
    // time everything is up at once.
    const inRun = (t: number) => PIANO_RUNS.some(([a, b]) => t >= a - 0.3 && t <= b + 0.2);
    let gapFrom = TOP;
    PIANO_RUNS.forEach(([a, b, row], i) => {
      floorBetween(gapFrom, a - 0.2);
      gapFrom = b + 0.2;
      // step back
      set(a - 0.2, 'whip', { pressure: 0.35, intensity: 0.55 }, 0.4);
      for (const r of [ROW.front, ROW.mid, ROW.back]) if (r !== ROW[row]) set(a - 0.2, r, { pressure: 0.08, intensity: 0.35 }, 0.4);
      // the run: one slice per note across the band
      pianoRun(a, b, ROW[row], i % 2 === 1);
      set(b + 0.1, 'whip', { pressure: 0.9, intensity: 1.2 }, 0.4);
    });
    floorBetween(gapFrom, CLIMB);
    onsets(95.5, CLIMB - 0.3, 0.85, 0.75)
      .filter((t) => !inRun(t))
      .forEach((t, i) => {
        const left = i % 2 === 0;
        macro(t, left ? HALF.left : HALF.right, 'lean', { angle: left ? -30 : 30, dur: 0.7, hold: 0.1, back: 0 });
        macro(t, left ? ARC.left : ARC.right, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.gold, intensity: 1 }, order: left ? 'index' : 'reverse' });
      });
  } else {
    onsets(96, 102.5, 0.85, 0.75).forEach((t, i) => {
      const left = i % 2 === 0;
      macro(t, left ? HALF.left : HALF.right, 'lean', { angle: left ? -30 : 30, dur: 0.7, hold: 0.1, back: 0 });
      macro(t, left ? ARC.left : ARC.right, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.gold, intensity: 1 }, order: left ? 'index' : 'reverse' });
    });
    // the bass-heavy bars: the whips stand, gold chasers on the strongest notes
    chases(onsets(102.7, CLIMB - 0.3, 0.95, 0.8), C.gold, 30);
  }
  // the second climb: the whole whip line sweeps left to right and back, the
  // fans with it, and a gold crown of flowers rises in the middle of it
  set(CLIMB, 'whip', { pressure: 1 }, 0.3);
  macro(CLIMB, 'whip', 'lean', { angle: 40, dur: 1, back: 'stay' }, { stagger: 0.05 });
  set(CLIMB, 'fan', { pressure: 1, color: C.purple, intensity: 1.1, tilt: 0, pan: 0 }, 0.2);
  macro(CLIMB, 'fan', 'lean', { angle: 35, dur: 1, back: 'stay' }, { stagger: 0.1 });
  const BACK = snap(108.62);
  macro(BACK, 'whip', 'lean', { angle: -40, dur: 1.8, back: 'stay' }, { stagger: 0.05, order: 'reverse' });
  macro(BACK, 'fan', 'lean', { angle: -35, dur: 1.6, back: 'stay' }, { stagger: 0.1, order: 'reverse' });
  set(END - 1.1, 'whip,fan', { pan: 0 }, 1);
  set(CLIMB + 0.3, 'flower', { pressure: 1, color: C.gold, intensity: 1, tilt: 0 }, 0.2);
  macro(CLIMB + 0.6, 'flower', 'bloom', { to: 26, dur: 1.5 });
  follow(CLIMB, END, ROW.front, 'level', 0.35, 0.85);
  follow(CLIMB, END, ROW.mid, 'level', 0.45, 0.95);
  follow(CLIMB, END, ROW.back, 'level', 0.55, 1);
  chases(onsets(CLIMB + 0.3, END - 0.5, 0.8, 0.5), C.gold, 30);
  // the music fades into the story: the flowers close, the whips and fans
  // stop, the floor gathers from the edges, and the lights go out on the
  // falling water before the screen rises at 115
  macro(END - 1.7, 'flower', 'bloom', { to: 0, dur: 0.5 });
  off(END - 1.2, 'flower', 0.25);
  set(END - 1.2, 'flower', { intensity: 0 }, 0.3);
  off(END - 0.5, 'whip', 1);
  set(END, 'whip', { intensity: 0 }, 0.6);
  off(END - 0.5, 'fan', 0.25);
  set(END - 0.5, 'fan', { intensity: 0 }, 0.3);
  for (const row of [ROW.front, ROW.mid, ROW.back]) set(END, row, { pressure: 0 }, 1.2, { stagger: 0.01, order: 'edges' });
  set(END, 'chaser', { intensity: 0 }, 0.5);
  set(114, 'grid,whip,fan,flower', { intensity: 0 }, 0.5);

  // ----------------------------------------------------------- story 115-155
  // The story is the picture's: the water only frames it (docs/show-plan.md).
  // Two arches of blue whips stand first, either side of the wide screen;
  // the mist rises behind them and the picture arrives ~2 s later, the moon
  // first. The projection's events sit on the music (STORY_BEATS in
  // song.ts). Once, the picture becomes water: a second after the moon
  // flares on the story's climax, a single gold flower opens below it.
  // whips 3-6 and 17-20 (x = +-26..41 m): inside the audience view
  const ARCH = { left: 'whip[3-6]', right: 'whip[17-20]' };
  set(M.piano, ARCH.left, { pan: 35, tilt: 0, color: C.blue, intensity: 1 }, 1);
  set(M.piano, ARCH.right, { pan: -35, tilt: 0, color: C.blue, intensity: 1 }, 1);
  set(M.piano + 0.3, ARCH.left, { pressure: 0.6 }, 2.5, { stagger: 0.25, order: 'reverse' });
  set(M.piano + 0.3, ARCH.right, { pressure: 0.6 }, 2.5, { stagger: 0.25 });
  set(M.piano + 0.8, 'screen', { pressure: 1, intensity: 1 }, 4, { ease: 'out' });
  follow(M.piano + 4, 155, ARCH.left, 'level', 0.5, 0.7);
  follow(M.piano + 4, 155, ARCH.right, 'level', 0.5, 0.7);
  // the moon (x = +30 m on the screen) flares; flower 4 stands at x = +27 m
  const UNDER_MOON = 'flower[4-4]';
  set(STORY_BEATS.flare + 0.6, UNDER_MOON, { pressure: 0.6, color: C.gold, intensity: 0.8, tilt: 0 }, 0.2);
  macro(STORY_BEATS.flare + 0.8, UNDER_MOON, 'bloom', { to: 16, dur: 1.5 });
  off(155.2, UNDER_MOON, 0.25);
  set(155.5, 'screen', { pressure: 0 }, 2.5, { ease: 'in' });
  off(155.5, 'whip', 2);

  // ------------------------------------------------ the break 155.5-162.6
  // The story's water falls in the dark while the whips turn back to face the
  // audience. On the short phrase the centre mound's mist rises and the
  // projection's gathering light (the story's moon, drawn by 'build') slides
  // in from the right. It goes out on the silence: two seconds of true dark
  // before the finale.
  set(157.5, 'whip', { pan: 0, tilt: 0 }, 1.5);
  const PH = snap(M.phrase);
  set(PH - 0.3, 'mound[1-1]', { pressure: 0.75, intensity: 0 }, 2.5, { ease: 'out' });
  set(PH + 0.7, 'mound[1-1]', { intensity: 0.9 }, 1.2); // the picture once the mist is there
  set(M.pause - 1, 'mound[1-1]', { pressure: 0 }, 1.5, { ease: 'in' }); // the mist sinks first
  set(M.pause, 'mound[1-1]', { intensity: 0 }, 0.15); // the picture goes on the silence
  // The picture is the projector's (src/show/projector.ts). The boat and the
  // moon leave with the wide sheet; the centre zone then plays the gathering
  // light on its own once the mound's mist is there, the light already
  // sliding in (2 s into the scene, on the beat), and it goes on the silence.
  // Before, the story's picture stayed on the wide sheet's last mist and came
  // up again on the mound: two screens with one boat (the user, 2026-11-08).
  // The mound's brightness above is kept as it was written (the screens'
  // brightness after the break starts from it); inside the break it is
  // replaced by these projector cues.
  const BREAK = { from: 155.5, to: M.breath - 0.4 };
  const breakPicture: Cue[] = [
    { t: BREAK.from, target: 'projector', set: { intensity: 0 }, dur: 2.5, ease: 'in' },
    { t: round(PH + 0.7), target: 'projector[1-1]', set: { intensity: BREAK_LIGHT }, dur: 1.2, clip: { scene: 'build', from: 2, alone: true } },
    { t: M.pause, target: 'projector[1-1]', set: { intensity: 0 }, dur: 0.15 },
    { t: BREAK.to, target: 'projector', clip: { scene: 'sync' } },
  ];

  // ---------------------------------------------- first wave 162.6-166.9
  // The music is the bass alone. Red-orange, the back band gold. The whips
  // open the first tutti's fan again (the theme coming back); the floor stays
  // low and only the back band swells with the bass. Fans, flowers, chasers
  // and the mounds wait (docs/show-plan.md).
  const F = snap(M.finale);
  const S = snap(M.surge);
  const W2 = M.wave2;
  const X = snap(M.climax);
  const CUT = X - 0.5;
  const H2 = snap(M.hit2);
  const L = snap(M.last);
  macro(F, 'geyser[0-9:3]', 'pulse', { hold: 1.6, level: 0.8 }, { set: { color: C.white } });
  // red reads darker at night, but wave 1 stays a step under wave 2, which
  // must climb above it (docs/reviews/2026-10-26-round5-c.md)
  set(F, 'grid', { color: C.red, intensity: 0.75 }, 0.15);
  set(F, ROW.back, { color: C.orange, intensity: 0.75 }, 0.15);
  follow(F + 0.2, S, ROW.front, 'level', 0.1, 0.35);
  follow(F + 0.2, S, ROW.mid, 'level', 0.2, 0.55);
  follow(F + 0.2, S, ROW.back, 'low', 0.4, 0.9);
  set(F, 'whip', { pressure: 0.85, color: C.orange, intensity: 1.1 }, 0.3);
  macro(F, 'whip', 'spread', { from: -45, to: 45, dur: 1.2 });

  // --------------------------------------------- second layer 166.9-169
  // The whole band comes in: the whips cross, the fans open, orange chasers
  // answer the music, the front band pops (no flowers: their crown belongs to
  // the second tutti).
  set(S, 'whip', { pressure: 1 }, 0.3);
  macro(S, 'whip', 'spread', { from: 45, to: -45, dur: 2.0 });
  set(S, 'fan', { pressure: 1, color: C.red, intensity: 0.85, tilt: 0 }, 0.2);
  follow(S, M.breath - 0.3, ROW.front, 'level', 0.25, 0.6);
  follow(S, M.breath - 0.3, ROW.mid, 'level', 0.35, 0.7);
  follow(S, M.breath - 0.3, ROW.back, 'level', 0.45, 0.8);
  pops(S + 0.3, M.breath - 0.4, 0.6);
  chases(onsets(S, M.breath - 0.3, 0.45, 0.45), C.orange, 30);
  // the mounds' mist rises in the dark, ready for the second wave
  set(M.breath - 0.4, 'mound', { pressure: 1, intensity: 0 }, 2, { ease: 'out' });

  // ------------------------------------------------------- breath 169
  // A one-beat dip: the fans and flowers close (valves), the whips come upright.
  // The light sinks with them, so the second wave's blue rises out of the
  // dark instead of cutting straight from full red (the user, 2026-10-27)
  off(M.breath - 0.25, 'fan', 0.25);
  set(M.breath - 0.3, 'whip', { pan: 0 }, 1.1);
  set(M.breath - 0.25, 'grid,whip,chaser', { intensity: 0.2 }, 0.45, { ease: 'out' });
  // the colour turns while the light is low (the LEDs take 0.6 s), so the
  // wave comes up already blue rather than flashing red first
  set(M.breath - 0.1, 'grid,whip,chaser', { color: FINALE_STEPS[0].color }, 0.6);

  // --------------------------------------- second wave 169.5-173.8
  // The show remembers its colours: the whole stage takes one at a time
  // (FINALE_STEPS in song.ts), cut on the music, while the three mounds, up
  // for the first time, burst in the same colour. Each colour climbs a step
  // (docs/reviews/2026-10-26-final-a.md): the floor taller and brighter, the
  // whips stronger, the fans to full height from the second colour. The
  // first step keeps the front low so the mounds read; the last one leads
  // straight into the half-second cut and the last hit.
  const SIDE = [ARC.left, ARC.right, ARC.ring];
  const STEP = [
    // low enough for the mounds, but brighter than wave 1 from the first colour
    { floor: 0.95, front: [0.15, 0.4], mid: [0.2, 0.45], back: [0.25, 0.5], whip: 0.75, fan: 0.55 },
    { floor: 1.1, front: [0.25, 0.55], mid: [0.3, 0.6], back: [0.35, 0.65], whip: 0.85, fan: 1 },
    { floor: 1.25, front: [0.35, 0.7], mid: [0.4, 0.75], back: [0.45, 0.8], whip: 0.95, fan: 1 },
  ];
  FINALE_STEPS.forEach(({ t, color }, i) => {
    const st = STEP[i];
    const until = FINALE_STEPS[i + 1]?.t ?? CUT;
    set(t, 'whip,fan,chaser', { color, intensity: 1 }, 0.08);
    set(t, 'grid', { color, intensity: st.floor }, 0.08);
    set(t, 'whip', { pressure: st.whip }, 0.3);
    set(t, 'fan', { pressure: st.fan, tilt: 0 }, 0.2);
    follow(t, until, ROW.front, 'level', st.front[0], st.front[1]);
    follow(t, until, ROW.mid, 'level', st.mid[0], st.mid[1]);
    follow(t, until, ROW.back, 'level', st.back[0], st.back[1]);
    macro(t, SIDE[i], 'chase', { speed: i === 2 ? 32 : 30, hold: 0.25, laps: i === 2 ? 2 : 1 }, { set: { color } });
  });
  const W1 = FINALE_STEPS[0].t;
  set(W1, 'mound', { intensity: 1.15 }, 0.3);
  macro(W2, 'whip', 'lean', { angle: 30, dur: 0.8, hold: 0.2, back: 0 }, { stagger: 0.03 });
  pops(W1 + 0.3, CUT - 0.3, 0.55);
  // the run-up: both arcs from the centre outward
  const RUN = snap(173.37);
  macro(RUN, ARC.left, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.purple } });
  macro(RUN, ARC.right, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.purple }, order: 'reverse' });

  // ------------------------------------------------ the breath 173.8-174.3
  // Half a second where the lights sink low with the water still running, a
  // held breath before the last hit; the side mounds go down. Not a blackout:
  // everything vanishing at once read as a fault (2026-10-26).
  set(CUT, 'grid,whip,chaser', { intensity: 0.3 }, 0.4, { ease: 'out' });
  set(CUT, 'mound', { intensity: 0.2 }, 0.4, { ease: 'out' });
  set(CUT, 'mound[0-0]', { pressure: 0 }, 1, { ease: 'in' });
  set(CUT, 'mound[2-2]', { pressure: 0 }, 1, { ease: 'in' });
  off(CUT, 'fan', 0.25);

  // ------------------------------------------- the old climax 174.3-176.6
  // The loudest moment of the first three minutes, but no longer the show's:
  // the piece's ending at 178.5 is louder still, and the user asked for the
  // power to be kept for it (2026-10-27). So a gold peak without geysers:
  // the whips upright in gold, the floor up, the chaser arcs and ring, the
  // finale's light on the centre mound.
  set(X, 'whip', { pressure: 1, pan: 0, color: C.gold, intensity: 0.8 }, 0.08);
  set(X, 'grid', { color: C.gold, intensity: 0.6 }, 0.08);
  set(X, ROW.front, { color: C.orange, intensity: 0.9 }, 0.08);
  follow(X, H2, ROW.front, 'level', 0.4, 0.75);
  follow(X, H2, ROW.mid, 'level', 0.5, 0.8);
  follow(X, H2, ROW.back, 'level', 0.55, 0.85);
  macro(X, ARC.arcs, 'pulse', { hold: 0.6 }, { set: { color: C.gold, intensity: 0.9 } });
  macro(X, ARC.ring, 'pulse', { hold: 0.6 }, { set: { color: C.gold, intensity: 0.9 } });
  set(X, 'mound[1-1]', { intensity: 0.9 }, 0.3);
  // the second hit: the arcs run outward in gold, the front band ripples
  macro(H2, ARC.left, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.gold } });
  macro(H2, ARC.right, 'chase', { speed: 40, hold: 0.2 }, { set: { color: C.gold }, order: 'reverse' });
  macro(H2, ROW.front, 'pulse', { hold: 0.15, level: 0.95, rest: 0.6, attack: 0.03 }, { set: { color: C.gold }, stagger: 0.008, order: 'center' });
  // gather: the floor sinks from the edges while the gold whips stand
  for (const row of [ROW.front, ROW.mid, ROW.back]) set(H2 + 0.6, row, { pressure: 0.15 }, 0.6, { stagger: 0.008, order: 'edges' });

  // ---------------------------------------------------- the calm 176.6-178.4
  // The recording jumps here to the piece's ending, in another key, and the
  // music falls away for two seconds. The stage holds back with it: on the
  // hit the light sinks and the water goes down to the pilot lights, and
  // only the sun rises on the centre mound in the dark (projection.ts). The
  // colour turns to the piece's own, blue, low, ready for the chorus.
  const BLUE = '#2a50ff';
  set(L, 'grid,whip,chaser', { intensity: 0.2 }, 0.9, { ease: 'out' });
  set(L + 0.2, 'grid,chaser', { color: BLUE }, 0.6);
  set(L + 0.2, 'whip', { color: C.cyan }, 0.6);
  for (const row of [ROW.front, ROW.mid, ROW.back]) set(L, row, { pressure: 0.04 }, 0.9, { stagger: 0.008, order: 'edges' });
  set(L, 'whip', { pressure: 0.2, pan: 0 }, 1);

  // ------------------------------------ the chorus 178.5-184: the ending's peak
  // The loudest part of the ending, and the show's biggest picture so far:
  // eight white geyser columns stand as a gate with the risen sun in its gap
  // (MUSIC.gate: on the chorus's entry; moved to 180.94 and back, 2026-10-27)
  // (the middle two stay down for it, and less lit mist whitens the sky),
  // the whips rise and open their fan, the fans open in cyan, the floor
  // follows the music in blue and the chasers answer its attacks. On the
  // hammered chords (182-184) the light strikes each chord, the whips cross
  // and the arcs fire left and right. Only the geysers are white: more white
  // columns turn the lit mist into a milky wall (docs/reviews/2026-10-26-round5-d.md).
  const G = snap(M.grand);
  const HM = snap(M.hammer);
  const SET = M.settle;
  // the valves open a beat early so the columns leave the water on the
  // phrase; their rings stay on through the hammered chords: dimmed earlier,
  // the falling columns read as grey smoke over the blue (shots/chorus)
  macro(M.gate - 0.2, 'geyser[0-3],geyser[6-9]', 'pulse', { hold: 1.2, level: 1, ledAfter: 3, ledTo: 0 }, { set: { color: C.white } });
  set(G - 0.4, 'whip', { pressure: 1 }, 0.3);
  set(G, 'whip', { intensity: 1.2 }, 0.12);
  macro(G, 'whip', 'spread', { from: -40, to: 40, dur: 1.2 });
  set(G, 'grid', { intensity: 1 }, 0.12);
  set(G, 'chaser', { intensity: 1 }, 0.12);
  set(G, 'fan', { pressure: 1, color: C.cyan, intensity: 0.9, tilt: 0, pan: 0 }, 0.2);
  macro(G, ARC.ring, 'pulse', { hold: 0.5 }, { set: { color: BLUE, intensity: 1 } });
  set(G - 0.3, 'whip', { pressure: 1, intensity: 1.2 }, 0.3);
  macro(G, 'whip', 'spread', { from: -40, to: 40, dur: 1.2 });
  set(G, 'grid', { intensity: 1 }, 0.12);
  set(G, 'fan', { pressure: 1, color: C.cyan, intensity: 0.9, tilt: 0, pan: 0 }, 0.2);
  follow(G, HM, ROW.front, 'level', 0.25, 0.65);
  follow(G, HM, ROW.mid, 'level', 0.35, 0.75);
  follow(G, HM, ROW.back, 'level', 0.5, 0.95);
  pops(G + 0.3, HM - 0.2, 0.55);
  chases(onsets(G + 0.5, HM - 0.2, 0.45, 0.45), C.cyan, 30, BLUE);
  macro(HM, 'whip', 'spread', { from: 40, to: -40, dur: 1.4 });
  follow(HM, SET, ROW.front, 'level', 0.4, 0.8);
  follow(HM, SET, ROW.mid, 'level', 0.5, 0.85);
  follow(HM, SET, ROW.back, 'level', 0.6, 1);
  onsets(HM - 0.1, SET, 0.5, 0.25).forEach((t, i) => {
    set(t, 'grid', { intensity: 1.4 }, 0.05);
    set(t + 0.1, 'grid', { intensity: 1 }, 0.25);
    macro(t, i % 2 ? ARC.right : ARC.left, 'pulse', { hold: 0.2 }, { set: { color: C.cyan, intensity: 1 } });
    macro(t, ROW.front, 'pulse', { hold: 0.12, level: 0.95, rest: 0.5, attack: 0.03 }, { stagger: 0.002, order: 'center' });
  });

  // ------------------------------------------------ the band holds 184-192.6
  // A step down (the valley before the last climb): the fans close, the floor
  // sinks, and the whips lean on the phrases, left and right in turn.
  off(SET, 'fan', 0.25);
  set(SET, 'whip', { pressure: 0.85, pan: 0 }, 1);
  follow(SET, M.gap - 0.3, ROW.front, 'level', 0.08, 0.3);
  follow(SET, M.gap - 0.3, ROW.mid, 'level', 0.15, 0.45);
  follow(SET, M.gap - 0.3, ROW.back, 'level', 0.3, 0.7);
  set(SET, 'grid', { intensity: 0.8 }, 0.9);
  onsets(SET + 1, M.gap - 1, 0.4, 1.4).forEach((t, i) =>
    macro(t, 'whip', 'lean', { angle: i % 2 ? -25 : 25, dur: 0.9, hold: 0.2, back: 0 }, { stagger: 0.03, order: i % 2 ? 'reverse' : 'index' }),
  );

  // The valley's three phrase attacks lift the music: one geyser each,
  // right, left, right (the user, 2026-10-27), a little taller each time
  // and in the valley's blue. Geysers the climb fires later, so each has
  // 7 s or more to refill; the rings go out so the mist does not stay lit.
  [185.55, 187.58, 189.72].forEach((t0, i) => {
    const g = [7, 2, 8][i];
    macro(snap(t0, 0.3) - 0.2, `geyser[${g}-${g}]`, 'pulse', { hold: 0.6, level: [0.6, 0.62, 0.65][i], ledAfter: 1.8, ledTo: 0 }, { set: { color: '#3c64ff' } });
  });

  // ------------------------------------------------------ the gap 192.6
  // A held breath: the lights sink with the water still low.
  set(M.gap - 0.3, 'grid,whip', { intensity: 0.3 }, 0.4, { ease: 'out' });
  set(M.gap - 0.3, 'whip', { pan: 0, pressure: 0.5 }, 0.6);
  set(M.gap - 0.3, 'grid', { pressure: 0.06 }, 0.5);

  // ------------------------------------------------ the last climb 193.4-206
  // One long, even swell of water up to the final chord: every group grows a
  // little each second instead of stepping up on the chords, which read as
  // sudden jumps with long flat stretches between (the user, 2026-10-27).
  // Groups join low and grow from there, never taking one away. Blue until
  // 3:20, then the stage pales and is white within about two seconds, white
  // carrying the rest of the climb (the user, 2026-10-27, after first asking
  // for blue to the chord). From 3:20 the water grows faster, to full height
  // everywhere a second before the chord. By the end the lagoon is all
  // water: every band at full height, chasers firing faster and faster and
  // their mist filling the air, so the chord can burst out of it (the user:
  // "so much water it nearly goes white, then explode", 2026-10-27).
  const HO = snap(M.home);
  const [S1, S2, S3] = M.steps.map((t) => snap(t, 0.25));
  const PEAK_T = M.chord - 0.1;
  const CLIMB_BLUE = '#3c64ff';
  const CLIMB_CYAN = '#7cc8ff';
  // the floor follows the music inside a band that rises second by second
  const ramp = (a: number, b: number, row: string, from: [number, number], to: [number, number]) => {
    const n = Math.max(1, Math.round(b - a));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) / n;
      const lerp = (i: 0 | 1) => round(from[i] + (to[i] - from[i]) * u);
      follow(a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n, row, 'level', lerp(0), lerp(1));
    }
  };
  const WT = 200; // 3:20: the stage turns white
  const FULL = 204.8; // every band at full height from here to the chord
  ramp(HO, WT, ROW.back, [0.25, 0.5], [0.6, 0.85]);
  ramp(HO + 1, WT, ROW.mid, [0.1, 0.3], [0.45, 0.75]);
  ramp(HO + 2, WT, ROW.front, [0.04, 0.15], [0.3, 0.6]);
  // the climb tops out a step under the chord, in height and in light, so
  // the explosion still jumps above it (the user, 2026-10-27: the two had
  // become one level)
  ramp(WT, FULL, ROW.back, [0.6, 0.85], [0.8, 0.92]);
  ramp(WT, FULL, ROW.mid, [0.45, 0.75], [0.75, 0.88]);
  ramp(WT, FULL, ROW.front, [0.3, 0.6], [0.7, 0.85]);
  for (const row of [ROW.back, ROW.mid, ROW.front]) follow(FULL, PEAK_T, row, 'level', 0.8, 0.9);
  set(HO, 'grid,chaser', { color: CLIMB_BLUE, intensity: 0.5 }, 0.1);
  set(HO + 0.1, 'grid', { intensity: 1.2 }, PEAK_T - HO, { ease: 'linear' });
  set(HO, 'whip', { color: CLIMB_CYAN, intensity: 0.9 }, 0.3);
  set(HO, 'whip', { pressure: 1 }, S2 - HO, { ease: 'linear' });
  set(HO + 0.3, 'whip', { intensity: 1.3 }, WT - HO, { ease: 'linear' });
  // 3:20: blue pales, then white (the LEDs take 0.6 s or more each way); the
  // paler the colour the brighter it reads, so the light steps down a little
  // with it and grows again to the chord
  const CLIMB_WHITE_ALL = 'grid,chaser,whip,fan,flower';
  set(WT, CLIMB_WHITE_ALL, { color: '#c8d4ff' }, 0.8);
  set(WT + 1, CLIMB_WHITE_ALL, { color: C.white }, 0.8);
  const TOP_I = 0.8; // the climb's light at its top; the chord goes to 1-1.2
  set(WT, 'grid', { intensity: 0.7 }, 1.2);
  set(WT + 1.2, 'grid', { intensity: TOP_I }, PEAK_T - WT - 1.2, { ease: 'linear' });
  set(WT, 'whip', { intensity: 0.85 }, 1.2);
  set(WT, 'fan,flower', { intensity: 0.75 }, 1.2);
  const climbColor = (t: number, blue: string) => (t >= WT + 1 ? C.white : t >= WT ? '#c8d4ff' : blue);
  macro(HO, 'whip', 'spread', { from: -30, to: 30, dur: 1.4 });
  macro(S2, 'whip', 'spread', { from: 30, to: -30, dur: 1.4 });
  // the whips sweep back and forth to the end (60 deg in 1.4 s keeps them
  // under the heads' speed)
  macro(S3, 'whip', 'spread', { from: -30, to: 30, dur: 1.4 });
  macro(S3 + 1.4, 'whip', 'spread', { from: 30, to: 0, dur: 0.7 });
  // the fans open low early and are full by the chords; the flowers, held
  // back since the second tutti, join on the middle step and open slowly
  set(HO + 1.5, 'fan', { pressure: 0.25, color: C.cyan, intensity: 0.7, tilt: 0, pan: 0 }, 0.2);
  set(HO + 1.8, 'fan', { pressure: 1 }, S1 - HO - 1.8, { ease: 'linear' });
  set(HO + 1.8, 'fan', { intensity: 1.1 }, PEAK_T - HO - 2.1, { ease: 'linear' });
  const FL = snap(197.27, 0.25);
  set(FL - 0.2, 'flower', { pressure: 0.3, color: C.cyan, intensity: 0.8, tilt: 0 }, 0.2);
  set(FL, 'flower', { pressure: 1 }, FULL - FL, { ease: 'linear' });
  macro(FL, 'flower', 'bloom', { to: 26, dur: PEAK_T - FL });
  // the chords still strike, in the scene's blue
  macro(S1, ARC.left, 'chase', { speed: 36, hold: 0.25 }, { set: { color: C.white, intensity: TOP_I } });
  macro(S1, ARC.right, 'chase', { speed: 36, hold: 0.25 }, { set: { color: C.white, intensity: TOP_I }, order: 'reverse' });
  macro(S2, ARC.ring, 'chase', { speed: 34, hold: 0.25 }, { set: { color: C.white, intensity: TOP_I } });
  macro(S3, ARC.left, 'chase', { speed: 40, hold: 0.25 }, { set: { color: C.white, intensity: TOP_I } });
  macro(S3, ARC.right, 'chase', { speed: 40, hold: 0.25 }, { set: { color: C.white, intensity: TOP_I }, order: 'reverse' });
  pops(S1 + 0.2, M.chord - 0.3, 0.6);
  // from the dip on, the chasers fire faster and faster, the arcs in turn
  // and the ring on every third, until the air over the lagoon is full of
  // their spray (0.8 s apart down to 0.25 s; each arc gets 0.5 s or more)
  {
    let t = 199.5;
    let gap = 0.8;
    let k = 0;
    // they stop a second before the chord so the dip before it goes dark
    while (t < M.chord - 1) {
      macro(t, k % 2 ? ARC.right : ARC.left, 'chase', { speed: 44, hold: 0.25 }, { set: { color: climbColor(t, k % 4 === 3 ? CLIMB_CYAN : CLIMB_BLUE), intensity: t >= WT ? TOP_I : 1 }, order: k % 2 ? 'reverse' : 'index' });
      if (k % 3 === 2) macro(t, ARC.ring, 'chase', { speed: 40, hold: 0.25 }, { set: { color: climbColor(t, CLIMB_BLUE), intensity: t >= WT ? TOP_I : 1 } });
      t = round(t + gap);
      gap = Math.max(0.25, gap * 0.86);
      k++;
    }
  }
  // Single geyser shots on the climb's accents, one column at a time, left
  // and right in turn from the outside in, each a little taller (34 -> 46 m,
  // above the whips but under the final chord's 61 m). The centre pair is
  // left for the chord, and the last shots are 2 s or more before it so the
  // air reservoirs can refill (the user, 2026-10-27). The rings go out after
  // each shot so the mist does not hang lit into the chord.
  const CLIMB_SHOTS = [193.42, 194.37, 195.79, 197.27, 200.43, S1, S2, S3];
  const CLIMB_ORDER = [0, 9, 1, 8, 2, 7, 3, 6];
  CLIMB_SHOTS.forEach((t0, i) => {
    const t = snap(t0, 0.25);
    const g = CLIMB_ORDER[i];
    const level = round(0.55 + (0.2 * i) / (CLIMB_SHOTS.length - 1));
    macro(t - 0.2, `geyser[${g}-${g}]`, 'pulse', { hold: 0.5, level, ledAfter: 1.8, ledTo: 0 }, { set: { color: climbColor(t, CLIMB_BLUE) } });
  });
  // the last two seconds go to pairs, left and right together, faster: the
  // outer geysers, fired eleven seconds before, and each 0.85 s or more
  // before it fires again on the chord
  macro(204.3, 'geyser[0-0],geyser[9-9]', 'pulse', { hold: 0.5, level: 0.8, ledAfter: 1.2, ledTo: 0 }, { set: { color: C.white } });
  macro(204.9, 'geyser[1-1],geyser[8-8]', 'pulse', { hold: 0.45, level: 0.85, ledAfter: 1, ledTo: 0 }, { set: { color: C.white } });
  // the sun on the centre mound sets before the chord
  set(S3, 'mound[1-1]', { intensity: 0 }, 1.5, { ease: 'in' });
  set(S3 + 1, 'mound[1-1]', { pressure: 0 }, 1.5);

  // -------------------------------------------------- the final chord 206
  // The explosion: everything the stage has, at once and in white: all ten
  // geysers at full height (the first time all ten fire), the floor up, the
  // whips upright, the fans and the flowers open, every chaser in one shot
  // and then a second that stays up. The light goes past plain white this time:
  // the user wants the lit water to nearly white out the sky (2026-10-27;
  // it was held at half before so each column read, shots/ending).
  // not snapped: the analysis's strongest onset nearby is the pickup at 205.8,
  // the chord itself lands at 205.99 (+6 dB)
  const CH = M.chord;
  /**
   * The geysers top out about three seconds after the chord. Until then
   * every straight jet stays up with them (the user, 2026-10-27), then all the
   * water drops at once and the light goes with it as it falls.
   */
  const DROP = CH + 3.2;
  // the valves open a beat early so the columns leave the water on the chord;
  // their light stays on until the drop and fades with the falling water
  const GHOLD = 1.2;
  // A 0.3 s dip in the light just before the chord, the water still running
  // (Bellagio's cut before the last hit): out of the white wall the climb
  // has become, the explosion needs a moment of dark to jump from (the
  // user, 2026-10-27). The LEDs fade out no faster than 0.9 s (quick at
  // first), so the fade starts 0.4 s early. Down to a quarter read as the
  // lights failing (the user, 2026-10-27): it sinks to about 60%, a breath
  // rather than a blackout.
  set(CH - 0.4, 'grid,whip,chaser,fan,flower', { intensity: 0.45 }, 0.9, { ease: 'out' });
  macro(CH - 0.2, 'geyser', 'pulse', { hold: GHOLD, level: 1, ledAfter: round(DROP - (CH - 0.2 + GHOLD)), ledTo: 0 }, { set: { color: C.white } });
  set(CH, 'grid', { pressure: 1, color: C.white, intensity: 1.2 }, 0.1);
  set(CH, 'whip', { pressure: 1, pan: 0, tilt: 0, color: C.white, intensity: 1.2 }, 0.1);
  // the valves open a beat early, the light comes back on the chord itself
  macro(CH - 0.1, 'chaser', 'pulse', { hold: 0.8, level: 1 }, { set: { color: C.white } });
  set(CH, 'chaser', { intensity: 1 }, 0.06);
  set(CH + 0.75, 'chaser', { pressure: 1 }, 0.06);
  set(CH, 'fan,flower', { pressure: 1, color: C.white, intensity: 1 }, 0.1);
  macro(CH, 'flower', 'bloom', { to: 32, dur: 0.6 });
  macro(CH, ROW.front, 'pulse', { hold: 0.4, level: 1, rest: 1, attack: 0.03 }, { stagger: 0.003, order: 'center' });

  // ----------------------------------------------- the chord rings 206.5-209.2
  // The fans and the flowers close with the chord's attack gone; the straight
  // columns (floor, whips, chasers) stand at full height in white while the
  // ten geysers climb above them, the chord ringing out in the hall.
  const B = M.fade - 0.1;
  set(B, 'fan,flower', { intensity: 0 }, 0.25);
  off(B, 'fan,flower', 0.25);

  // --------------------------------------------------------- the drop 209.2
  // Every valve shuts at once: the whole stage of water falls together, lit
  // as it falls, and the light fades out as it lands.
  off(DROP, 'grid,whip,chaser', 0.2);
  set(DROP + 0.2, 'grid,whip,chaser', { intensity: 0 }, 3.3, { ease: 'in' });

  // --------------------------------------------------------- coda 213.5-217
  // When the water is down, the opening picture again, in the silence: cyan
  // pilot lights wake from the centre and go out from the edges.
  const PILOT = DROP + PILOT_AFTER_DROP;
  for (const row of [ROW.front, ROW.mid, ROW.back]) {
    set(PILOT, row, { color: C.cyan, intensity: 0.9 });
    set(PILOT, row, { pressure: 0.04 }, 0.6, { stagger: 0.008, order: 'center' });
    off(SHOW_DURATION - 1.2, row, 0.4, { stagger: 0.008, order: 'edges' });
  }

  // After every geyser shot its rings dim: the mist curtain it leaves hangs for
  // ten seconds or more, and with the rings still on it stood in later scenes
  // as glowing pillars. Each shot relights them.
  for (const c of [...cues]) {
    if (c.macro !== 'pulse' || !c.target.startsWith('geyser')) continue;
    c.set = { ...c.set, intensity: 1 };
    const hold = Number(c.args?.hold ?? 0.3);
    const after = Number(c.args?.ledAfter ?? 1.5);
    const to = Number(c.args?.ledTo ?? 0.06);
    cues.push({ t: round(Number(c.t) + hold + after), target: c.target, set: { intensity: to }, dur: after < 1 ? 2 : 3, ease: 'inOut' });
  }

  // the 花火版: the same water, fireworks over it
  if (variant === 'hanabi') cues.push(...hanabiFireworks());

  const file: ShowFile = {
    title: SHOW_VARIANTS.find((v) => v.id === variant)!.title,
    bpm: BPM,
    beatsPerBar: BEATS_PER_BAR,
    offset: 0,
    duration: SHOW_DURATION,
    cues,
  };
  // The screen cues above set the picture's brightness on the screens, as
  // they were written; they become projector cues (the same picture), and the
  // break's picture is written on the projector itself.
  const out = toProjector(file, buildLayout());
  const inBreak = (c: Cue) => c.target.startsWith('projector') && cueTime(c.t, out) >= BREAK.from && cueTime(c.t, out) < BREAK.to;
  // a screen cue that only set the picture's brightness has nothing left. It
  // stays where it is (the fireworks' random numbers come from the cues'
  // places in the file: taking cues out changed the 花火版's shells), named
  // so the editor does not show an empty block
  const empty = (c: Cue) => !c.clip && !c.macro && !c.fire && !Object.keys(c.set ?? {}).length;
  const kept = out.cues.filter((c) => !inBreak(c)).map((c) => (empty(c) && !c.label ? { ...c, label: '明るさ→プロジェクター' } : c));
  return { ...out, version: 3, cues: [...kept, ...breakPicture] };
}

/**
 * A show saved before the music grew to the piece's real ending (2026-10-27:
 * 180 s -> SHOW_DURATION) stops at 3:00 and goes dark under the new ending.
 * Keep what it has before the edit in the music (MUSIC.last, where the old
 * and new recordings part) and take the new ending from the built-in show of
 * the same version. Null when the show already runs the music's length.
 */
export function extendToMusic(file: ShowFile, music?: MusicFeatures): ShowFile | null {
  // a show on its own music has that music's length (docs/music-plan.md)
  if (file.music || !(file.duration < SHOW_DURATION - 0.01)) return null;
  // only a built-in version saved back then (its title; the lagoon's was
  // 'Night Lagoon' before 2026-11-12): a show of your own that is simply
  // shorter (an empty show is 180 s) keeps its length and its cues
  const variant = SHOW_VARIANTS.find((v) => v.title === file.title || v.title.replace('Rhapsody in Blue', 'Night Lagoon') === file.title)?.id;
  if (!variant) return null;
  const built = buildShow(music, variant);
  const cut = MUSIC.last - 0.1;
  const before = file.cues.filter((c) => cueTime(c.t, file) < cut);
  const after = built.cues.filter((c) => cueTime(c.t, built) >= cut);
  return { ...file, duration: SHOW_DURATION, cues: [...before, ...after] };
}

/** The show without the waveform analysis (fixed patterns), for the editor and tests. */
export const MAIN_SHOW: ShowFile = buildShow();
